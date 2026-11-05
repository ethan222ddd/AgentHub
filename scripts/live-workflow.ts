// Opt-in: actual packaged app, three native providers and the user-editable DAG workflow.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { repository } from '../tests/helpers'
import { git } from '../src/main/git/workspaces'
import { guardIdentity } from './release-identity'
import type { Artifact, Detection, Snapshot, WorkflowRun } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-workflow')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await repository(),
  nonce = randomUUID()
await writeFile(
  join(project, 'package.json'),
  JSON.stringify({ private: true, scripts: { test: 'node --test --test-isolation=none' } }),
)
await writeFile(join(project, 'original.txt'), nonce)
await writeFile(
  join(project, 'baseline.test.cjs'),
  `const t=require('node:test'),a=require('node:assert/strict'),f=require('node:fs'); t('preserved original',()=>a.equal(f.readFileSync('original.txt','utf8'),${JSON.stringify(nonce)}));t('integrated contract',()=>{if(f.existsSync('backend.cjs')&&f.existsSync('frontend.cjs'))a.equal(require('./frontend.cjs').formatUpper(require('./backend.cjs').triple(5)),'VALUE: 15')})`,
)
await git(project, ['add', '.'])
await git(project, [
  '-c',
  'user.name=Acceptance',
  '-c',
  'user.email=acceptance@local.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-qm',
  'Generated native workflow baseline',
])
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
const page = await app.firstWindow()
const invoke = <T = unknown>(request: Record<string, unknown>) =>
  page.evaluate((request) => window.agenthub.invoke<T>(request), request)
const state = () => invoke<Snapshot>({ op: 'snapshot' })
const report: Record<string, unknown> = {
  version,
  packaged: true,
  passed: false,
  profile,
  project,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
try {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  const initial = await state(),
    room = initial.conversations[0]
  await invoke({
    op: 'settings.save',
    settings: {
      ...initial.settings,
      autonomy: 'auto',
      maxTurns: 24,
      maxUsageTokens: 1000000,
      timeoutMs: 240000,
    },
  })
  const catalog = await invoke<Detection[]>({ op: 'agents.detect' })
  for (const d of catalog) {
    const model = d.models.find((m) =>
      d.provider === 'codex'
        ? m.id.includes('sol')
        : d.provider === 'claude'
          ? m.id === 'sonnet'
          : m.id.includes('flash') && m.id.endsWith('-low'),
    )
    if (model)
      await invoke({
        op: 'conversation.runtime',
        conversationId: room.id,
        agentId: d.agentId!,
        model: model.id,
        reasoningEffort: model.reasoningEfforts?.includes('low') ? 'low' : '',
      })
  }
  const template = structuredClone(
    initial.workflowTemplates.find((t) => t.id === 'builtin-contract-parallel')!,
  )
  template.id = 'acceptance-three-native-workflow'
  template.name = 'Generated three-native workflow acceptance'
  template.maxFixes = 1
  for (const step of template.steps) {
    if (step.id === 'contract')
      step.instructions += ` Write ONLY contract.json as a compact JSON object with proof ${JSON.stringify(nonce)}, backend signature triple(n) -> n*3, frontend signature formatUpper(n) -> 'VALUE: '+n. Call publish_artifact with paths ['contract.json']. The host checkpoints it safely. Do not run any command, delegate, or modify package.json or original files.`
    if (step.id === 'backend')
      step.instructions += ` Read the immutable artifact with read_artifact. Copy contract.json EXACTLY including whitespace/EOF. Create ONLY backend.cjs exporting triple = n => n*3 and backend.test.cjs using node:test/strict assert. Do not edit baseline.test.cjs, package.json, frontend files or original.txt. No shell, commits or delegation.`
    if (step.id === 'frontend')
      step.instructions += ` Read the immutable artifact with read_artifact. Copy contract.json EXACTLY including whitespace/EOF. Create ONLY frontend.cjs exporting formatUpper = n => 'VALUE: '+n and frontend.test.cjs using node:test/strict assert. Do not edit baseline.test.cjs, package.json, backend files or original.txt. No shell, commits or delegation.`
    if (step.id === 'review-backend')
      step.instructions += ` Scope: backend.cjs, backend.test.cjs and their contract.json consistency. This is an isolated BACKEND snapshot: frontend.cjs/frontend.test.cjs intentionally live in Claude's other worktree until integration. Their absence here is expected, not a defect. Check the assigned implementation and its tests honestly; host tests the integrated combination afterwards.`
    if (step.id === 'review-frontend')
      step.instructions += ` Scope: frontend.cjs, frontend.test.cjs and their contract.json consistency. This is an isolated FRONTEND snapshot: backend.cjs/backend.test.cjs intentionally live in Codex's other worktree until integration. Their absence here is expected, not a defect. Check the assigned implementation and its tests honestly; host tests the integrated combination afterwards.`
  }
  await invoke({ op: 'workflow.save', template })
  const run = await invoke<WorkflowRun>({
    op: 'workflow.start',
    templateId: template.id,
    conversationId: room.id,
    requirement: `Implement this generated contract in separate worktrees; retain original.txt (${nonce}) and baseline tests. Use only native file tools and the structured collaboration bridge. Host handles commands, snapshots, tests and integration.`,
    bindings: { architect: 'antigravity', backend: 'codex', frontend: 'claude' },
  })
  await expect
    .poll(
      async () => {
        const s = await state(),
          current = s.workflowRuns.find((r) => r.id === run.id)!
        if (['attention', 'waiting_user', 'failed', 'cancelled', 'paused'].includes(current.status))
          throw new Error(
            JSON.stringify({
              run: current,
              tasks: s.tasks.map((t) => ({ id: t.id, status: t.status, error: t.error })),
            }),
          )
        return current.status
      },
      { timeout: 900000, intervals: [1000] },
    )
    .toBe('completed')
  const final = await state(),
    finished = final.workflowRuns.find((r) => r.id === run.id)!
  expect(
    new Set(final.tasks.filter((t) => t.workflow?.runId === run.id).map((t) => t.agentId)),
  ).toEqual(new Set(['codex', 'claude', 'antigravity']))
  const reviews = final.reviews.filter(
    (r) => final.tasks.find((t) => t.id === r.taskId)?.workflow?.runId === run.id,
  )
  expect(reviews.length).toBeGreaterThanOrEqual(2)
  expect(reviews.filter((r) => r.status === 'submitted' && r.verdict === 'approve')).toHaveLength(2)
  const tests = final.tests.filter((t) => t.projectId === room.projectId && t.kind === 'test')
  expect(
    tests.filter((t) => t.execution === 'native-sandbox' && t.status === 'passed'),
  ).toHaveLength(2)
  const artifact = final.artifacts.find((a) => a.agentId === 'antigravity') as Artifact
  expect(artifact.files.some((f) => f.path === 'contract.json')).toBe(true)
  expect(await readFile(join(project, 'original.txt'), 'utf8')).toBe(nonce)
  const reads = await invoke<{ files: { content: string }[] }>({
    op: 'artifact.read',
    id: artifact.id,
  })
  expect(reads.files[0].content).toContain(nonce)
  expect(await readFile(join(project, 'backend.cjs'), 'utf8')).toContain('triple')
  expect(await readFile(join(project, 'frontend.cjs'), 'utf8')).toContain('formatUpper')
  expect(await git(project, ['status', '--porcelain'])).toBe('')
  Object.assign(report, {
    passed: true,
    run: finished,
    artifact,
    reviews,
    tests,
    threeNativeProviders: true,
    hostCheckpointWithoutGitGrant: true,
    independentWorktrees: true,
    exactSandboxTests: true,
    preservedOriginal: true,
  })
  await page.screenshot({ path: join(base, 'native-workflow.png') })
  console.log(
    'PASS: real AGY contract publish → parallel Codex/Claude → cross-review → two exact sandbox-tested integrations',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
