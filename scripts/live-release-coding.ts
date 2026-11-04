// Opt-in: exact packaged application, real native delegation/artifacts/review.
// Fixture-only explicit host-approved tests. Never claims these are sandbox tests.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { git } from '../src/main/git/workspaces'
import { ownedExec } from '../src/main/agents/process-owner'
import { guardIdentity } from './release-identity'
import type {
  Activity,
  Artifact,
  Detection,
  Message,
  Review,
  Snapshot,
  Task,
  TestRun,
} from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-release-coding')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await mkdtemp(join(base, 'repository-'))
const nonce = randomUUID()
await writeFile(
  join(project, 'package.json'),
  JSON.stringify({ private: true, scripts: { test: 'node --test --test-isolation=none' } }),
)
await writeFile(join(project, 'backend.cjs'), 'exports.double = n => n * 2\n')
await writeFile(join(project, 'frontend.cjs'), 'exports.format = n => `value: ${n}`\n')
await writeFile(join(project, 'original.txt'), nonce)
await writeFile(
  join(project, 'baseline.test.cjs'),
  `const t=require('node:test'),a=require('node:assert/strict'),b=require('./backend.cjs'),f=require('./frontend.cjs');t('original API',()=>a.equal(f.format(b.double(3)),'value: 6'));t('original data preserved',()=>a.equal(require('node:fs').readFileSync('original.txt','utf8'),${JSON.stringify(nonce)}));t('integrated API',()=>{if(b.triple&&f.formatUpper)a.equal(f.formatUpper(b.triple(5)),'VALUE: 15')})`,
)
await git(project, ['init', '-b', 'main'])
await git(project, ['add', '.'])
await git(project, [
  '-c',
  'user.name=Acceptance',
  '-c',
  'user.email=acceptance@agenthub.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-m',
  'Generated baseline',
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
  passed: false,
  version,
  packaged: true,
  profile,
  project,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
async function approvals() {
  const review = page.getByRole('button', { name: '前往批准', exact: true })
  if (await review.count()) await review.first().click()
  for (const card of await page.locator('.approval').all()) {
    const tool = await card.locator('b').first().innerText()
    const allow = [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'item/fileChange/requestApproval',
      'Antigravity scoped workspace access',
    ].includes(tool)
    await card.getByRole('button', { name: allow ? '允許一次' : '拒絕', exact: true }).click()
  }
}
async function settled() {
  await expect
    .poll(
      async () => {
        await approvals()
        const s = await state()
        const failed = s.tasks.find((t) => ['failed', 'cancelled'].includes(t.status))
        if (failed) throw new Error(`${failed.agentId}: ${failed.error}`)
        return s.tasks.length > 0 && s.tasks.every((t) => t.status === 'completed')
      },
      { timeout: 240000, intervals: [400, 800] },
    )
    .toBe(true)
}
try {
  await expect(page.getByRole('button', { name: '選擇專案資料夾' })).toBeVisible()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await expect(page.locator('.conversation-row.selected')).toHaveCount(1)
  let s = await state()
  const room = s.conversations[0]
  await invoke({ op: 'project.automation', projectId: room.projectId, enabled: false })
  await invoke({
    op: 'settings.save',
    settings: {
      ...s.settings,
      maxUsageTokens: 1000000,
      maxTurns: 12,
      maxDepth: 4,
      timeoutMs: 240000,
    },
  })
  await invoke({
    op: 'conversation.configure',
    id: room.id,
    mode: 'collaborative',
    supervisorId: '',
  })
  await invoke({ op: 'workspace.prepare', projectId: room.projectId, initialize: false })
  const detected = await invoke<Detection[]>({ op: 'agents.detect' })
  expect(
    ['codex', 'claude', 'antigravity'].every((id) =>
      detected.some((d) => d.provider === id && d.installed && d.authenticated !== false),
    ),
  ).toBe(true)
  const flash = detected
    .find((d) => d.provider === 'antigravity')
    ?.models.find((m) => m.id.includes('flash') && m.id.endsWith('-low'))
  if (flash)
    await invoke({
      op: 'conversation.runtime',
      conversationId: room.id,
      agentId: 'antigravity',
      model: flash.id,
      reasoningEffort: 'low',
    })
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill(
      `@Codex Generated native collaboration acceptance. First use the structured agenthub_collaborate assign_task to recipient claude with content: "Using native Write/Edit tools, preserve exports.format in frontend.cjs and add exports.formatUpper = n => \`VALUE: \${n}\`. Add frontend.test.cjs using node:test and strict assert for formatUpper(9) === VALUE: 9 and format(9) === value: 9. Do not run commands or delegate. Reply FRONTEND_READY." Then use your native file editing tool to preserve exports.double in backend.cjs and add exports.triple = n => n * 3; add backend.test.cjs using node:test and strict assert for triple(4) === 12 and double(4) === 8. Work only on backend files. No shell, network, commits or other delegation. Finish BACKEND_READY.`,
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await settled()
  s = await state()
  const backend = s.workspaces.find((w) => w.agentId === 'codex')!,
    frontend = s.workspaces.find((w) => w.agentId === 'claude')!
  expect(backend.path).not.toBe(frontend.path)
  expect(await readFile(join(project, 'backend.cjs'), 'utf8')).not.toContain('triple')
  expect(await readFile(join(project, 'frontend.cjs'), 'utf8')).not.toContain('formatUpper')
  const revisions = []
  for (const w of [backend, frontend])
    revisions.push(
      await invoke<string>({
        op: 'git.checkpoint',
        workspaceId: w.id,
        message: 'Generated reviewed coding checkpoint',
      }),
    )
  await invoke<Task>({
    op: 'task.create',
    conversationId: room.id,
    agentId: 'codex',
    dependencies: [],
    description:
      'Use agenthub_collaborate publish_artifact with paths ["backend.cjs"], recipients [], content "Backend immutable contract". Then use request_response to claude: ask it to call read_artifact with the real artifactId returned by publication, report CONTRACT_CONFIRMED and the exported functions. Do not edit files, run commands or delegate again.',
  })
  await settled()
  s = await state()
  const artifact = s.artifacts.find((a) => a.agentId === 'codex')!
  expect(artifact?.revision).toBe(revisions[0])
  const actualArtifact = await invoke<{ files: { content: string }[] }>({
    op: 'artifact.read',
    id: artifact.id,
  })
  expect(actualArtifact.files[0].content).toContain('triple')
  const reads = await invoke<{ activities: Activity[]; messages: Message[] }>({
    op: 'messages',
    conversationId: room.id,
  })
  expect(
    reads.activities.some(
      (a) =>
        a.agentId === 'claude' &&
        a.type === 'collaboration.read' &&
        JSON.parse(a.detail).artifactId === artifact.id,
    ),
  ).toBe(true)
  expect(
    reads.messages.some(
      (m) =>
        m.senderId === 'codex' && m.type === 'collaboration' && m.recipientIds.includes('claude'),
    ),
  ).toBe(true)
  const reviews: Review[] = [],
    tests: TestRun[] = [],
    merges: unknown[] = []
  for (const [index, w] of [backend, frontend].entries()) {
    const review = await invoke<Review>({
      op: 'review.request',
      workspaceId: w.id,
      conversationId: room.id,
      reviewerId: 'antigravity',
    })
    await settled()
    s = await state()
    const submitted = s.reviews.find((r) => r.id === review.id)!
    expect(submitted).toMatchObject({
      status: 'submitted',
      verdict: 'approve',
      revision: revisions[index],
    })
    expect(s.tasks.find((t) => t.id === submitted.taskId)?.status).toBe('completed')
    expect(
      await git(s.workspaces.find((v) => v.id === submitted.workspaceId)!.path, [
        'status',
        '--porcelain',
      ]),
    ).toBe('')
    reviews.push(submitted)
    const preview = await invoke<{
      id: string
      integrationWorkspaceId: string
      integrationCommit: string
      tree: string
    }>({ op: 'git.preview', workspaceId: w.id, direction: 'integrate' })
    const run = await invoke<TestRun>({
      op: 'test.run',
      workspaceId: preview.integrationWorkspaceId,
      script: 'test',
    })
    await expect
      .poll(
        async () => {
          const t = (await state()).tests.find((t) => t.id === run.id)!
          if (t.status === 'failed') throw new Error(t.logs)
          return t.status
        },
        { timeout: 60000, intervals: [300, 600] },
      )
      .toBe('passed')
    const result = (await state()).tests.find((t) => t.id === run.id)!
    expect(result.revision).toBe(preview.integrationCommit)
    tests.push(result)
    // Same IPC as the user's explicit merge button, after review and exact tests.
    const revision = await invoke<string>({ op: 'git.merge', previewId: preview.id })
    expect(await git(project, ['rev-parse', 'HEAD^{tree}'])).toBe(preview.tree)
    merges.push({
      revision,
      testedTree: preview.tree,
      testedCommit: preview.integrationCommit,
      reviewId: review.id,
    })
  }
  const finalRevision = await git(project, ['rev-parse', 'HEAD'])
  const finalTest = await ownedExec(process.execPath, ['--test', '--test-isolation=none'], {
    cwd: project,
    timeout: 30000,
  })
  expect(finalTest.stdout).toMatch(/fail 0/)
  expect(await git(project, ['rev-parse', 'HEAD'])).toBe(finalRevision)
  expect(await git(project, ['status', '--porcelain'])).toBe('')
  await ownedExec(
    process.execPath,
    [
      '-e',
      "const a=require('node:assert/strict'),b=require('./backend.cjs'),f=require('./frontend.cjs');a.equal(f.formatUpper(b.triple(-3)),'VALUE: -9');a.equal(f.format(b.double(7)),'value: 14')",
    ],
    { cwd: project },
  )
  s = await state()
  const delegated = s.tasks.find((t) => t.agentId === 'claude' && t.depth > 0)!
  expect(delegated).toBeTruthy()
  expect(s.tasks.filter((t) => t.agentId === 'antigravity' && t.kind === 'review')).toHaveLength(2)
  await page.getByRole('button', { name: '活動', exact: true }).first().click()
  await page.screenshot({ path: join(base, 'release-coding.png') })
  Object.assign(report, {
    passed: true,
    realDelegation: true,
    artifactReadByClaude: true,
    independentWorktrees: true,
    readOnlyReviews: true,
    structuredVerdicts: true,
    reviews,
    artifact: artifact as Artifact,
    testRecords: tests,
    merges,
    finalRevision,
    finalProjectTest: {
      revision: finalRevision,
      execution: 'host-approved generated fixture',
      stdout: finalTest.stdout,
    },
    tasks: s.tasks,
    providers: detected.map((d) => ({ provider: d.provider, version: d.version })),
  })
  console.log(
    'PASS: packaged native Codex → Claude delegation, immutable artifact read, two Antigravity reviews, exact preview tests/merges and actual final project tests',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
