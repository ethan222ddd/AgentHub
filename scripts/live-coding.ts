import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { CodexAdapter } from '../src/main/agents/codex'
import { ClaudeAdapter } from '../src/main/agents/claude'
import { AntigravityAdapter } from '../src/main/agents/antigravity'
import { TestRunner } from '../src/main/tasks/tests'
import { ArtifactStore } from '../src/main/orchestrator/artifacts'
import type { AgentAdapter } from '../src/main/agents/adapter'
import type { Task, TestRun, Workspace, Review } from '../src/shared/types'
const resume = process.env.AGENTHUB_LIVE_CODING_RESUME
const base = resume ? resolve(resume) : resolve('.local/coding', randomUUID())
const rel = relative(resolve('.local/coding'), base)
if (!rel || rel.startsWith('..') || isAbsolute(rel))
  throw new Error('Live fixture must be within .local/coding')
const root = join(base, 'repository')
if (!resume) {
  await mkdir(root, { recursive: true })
  await git(root, ['init'])
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { test: 'node --test *.test.mjs' } }),
  )
  await writeFile(join(root, 'backend.mjs'), 'export const double = n => n * 2\n')
  await writeFile(join(root, 'frontend.mjs'), 'export const format = n => `value: ${n}`\n')
  await writeFile(
    join(root, 'baseline.test.mjs'),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {double} from './backend.mjs';import {format} from './frontend.mjs';test('existing contract',()=>assert.equal(format(double(3)),'value: 6'))\n",
  )
  await git(root, ['add', '.'])
  await git(root, [
    '-c',
    'user.name=AgentHub Test',
    '-c',
    'user.email=test@local.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Baseline working contract',
  ])
}
const store = new Store(join(base, 'state.sqlite'))
const priorTasks = new Set(store.list<Task>('tasks').map((t) => t.id))
const p = store.addProject(root, 'Real coding acceptance')
const c = store.snapshot().conversations[0]
store.put('settings', {
  ...store.settings(),
  id: 'general',
  maxUsageTokens: 500000,
  timeoutMs: 240000,
})
const manager = new WorkspaceManager(store, join(base, 'workspaces'))
const spaces = await manager.prepare(p, false)
const adapters = new Map<string, AgentAdapter>([
  ['codex', new CodexAdapter()],
  ['claude', new ClaudeAdapter(() => undefined)],
  ['antigravity', new AntigravityAdapter()],
])
const o = new Orchestrator(store, adapters, (event) => {
  if (event.type === 'approvals')
    for (const a of event.approvals)
      setTimeout(
        () =>
          o.resolveApproval(
            a.id,
            [
              'Read',
              'Write',
              'Edit',
              'Glob',
              'Grep',
              'Antigravity scoped workspace access',
              'item/fileChange/requestApproval',
            ].includes(a.tool),
          ),
        0,
      )
})
o.setWorkspaceManager(manager)
const runner = new TestRunner(store, () => {})
async function waitTasks() {
  const start = Date.now()
  while (Date.now() - start < 240000) {
    const tasks = store.list<Task>('tasks').filter((t) => !priorTasks.has(t.id))
    if (tasks.some((t) => ['failed', 'cancelled'].includes(t.status)))
      throw new Error(tasks.map((t) => t.error || '').join('\n'))
    if (tasks.every((t) => t.status === 'completed')) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Live coding task timeout')
}
const testRecords: TestRun[] = []
async function test(workspace: Workspace) {
  const run = await runner.run(workspace, 'test')
  const start = Date.now()
  while (
    store.require<TestRun>('test_runs', run.id).status === 'running' &&
    Date.now() - start < 30000
  )
    await new Promise((r) => setTimeout(r, 100))
  const result = store.require<TestRun>('test_runs', run.id)
  if (result.status !== 'passed') throw new Error(result.error || result.logs)
  testRecords.push(result)
}
try {
  if (!resume) {
    o.send(
      c.id,
      'Using your native editing tool, add export const triple = n => n * 3 to backend.mjs, preserving double. Create backend.test.mjs using node:test and node:assert/strict to verify triple(4) === 12 and double(4) === 8. Do not run shell commands, modify other files, or delegate. End with BACKEND_READY.',
      ['codex'],
    )
    o.send(
      c.id,
      'Using your Write/Edit tools, add export const formatUpper = n => `VALUE: ${n}` to frontend.mjs, preserving format. Create frontend.test.mjs using node:test and node:assert/strict to verify formatUpper(9) === "VALUE: 9" and format(9) === "value: 9". Do not run shell commands, modify other files, or delegate. End with FRONTEND_READY.',
      ['claude'],
    )
    await waitTasks()
  }
  const backend = spaces.find((w) => w.agentId === 'codex')!
  const frontend = spaces.find((w) => w.agentId === 'claude')!
  const backendRevision = resume
    ? await git(backend.path, ['rev-parse', 'HEAD'])
    : await manager.checkpoint(backend, 'Reviewed backend acceptance')
  const frontendRevision = resume
    ? await git(frontend.path, ['rev-parse', 'HEAD'])
    : await manager.checkpoint(frontend, 'Reviewed frontend acceptance')
  if (!resume) {
    o.send(
      c.id,
      'The host has checkpointed your changes. Use agenthub_collaborate publish_artifact with paths ["backend.mjs"], content "Backend contract", recipients [], dependencies []. Do not modify files, run commands or delegate.',
      ['codex'],
    )
    await waitTasks()
  }
  const artifact = store.snapshot().artifacts[0]
  if (!artifact || artifact.revision !== backendRevision)
    throw new Error('Missing native immutable artifact publication')
  const read = await new ArtifactStore(store).read(artifact.id, p.id)
  if (!read.files[0].content.includes('triple'))
    throw new Error('Published contract content mismatch')
  const review = await o.requestReview(backend.id, c.id, 'antigravity')
  await waitTasks()
  const result = store.require<Review>('reviews', review.id)
  if (result.status !== 'submitted' || !result.verdict || result.revision !== backendRevision)
    throw new Error('Native immutable review did not submit a verdict')
  if (result.verdict !== 'approve')
    throw new Error('Native reviewer requested changes: ' + result.summary)
  for (const workspace of [backend, frontend]) {
    const preview = await manager.preview(workspace)
    await test(store.require<Workspace>('workspaces', preview.integrationWorkspaceId))
    await manager.merge(preview.id)
    if ((await git(root, ['rev-parse', 'HEAD^{tree}'])) !== preview.tree)
      throw new Error('Final merged tree differs from exact tested snapshot')
  }
  // Test the actual final project, not an earlier worktree.
  const final: Workspace = {
    id: 'final-validation',
    projectId: p.id,
    agentId: 'host',
    path: root,
    branch: await git(root, ['branch', '--show-current']),
  }
  await test(final)
  if (
    !(await readFile(join(root, 'backend.mjs'), 'utf8')).includes('triple') ||
    !(await readFile(join(root, 'frontend.mjs'), 'utf8')).includes('formatUpper')
  )
    throw new Error('Actual final files missing')
  await writeFile(
    resolve('.local/coding-report.json'),
    JSON.stringify(
      {
        passed: true,
        base,
        backendRevision,
        frontendRevision,
        review: result,
        artifact,
        testRecords,
        finalRevision: await git(root, ['rev-parse', 'HEAD']),
        tasks: store.list<Task>('tasks'),
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: real parallel Codex/Claude coding, native artifact publication, Antigravity read-only review, exact snapshot tests, two reviewed merges and final-project tests.',
  )
} finally {
  await runner.dispose()
  await o.dispose()
  store.close()
}
