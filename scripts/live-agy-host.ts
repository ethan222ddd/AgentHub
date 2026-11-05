// Actual packaged UI/Orchestrator/native AGY host reads. All sources are generated fixtures.
// Post an unknown source AFTER the task context is prepared; proof cannot come from initial context.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Store } from '../src/main/database/store'
import { guardIdentity } from './release-identity'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { ArtifactStore } from '../src/main/orchestrator/artifacts'
import { repository } from '../tests/helpers'
import type {
  Activity,
  ContextReceipt,
  Detection,
  Message,
  Snapshot,
  Task,
} from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-agy-host')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  projectPath = await repository()
const proof = { search: randomUUID(), read: randomUUID(), artifact: randomUUID() }
const tag = 'REFERENCE_' + randomUUID().replaceAll('-', '')
const seed = new Store(join(profile, 'agenthub.sqlite'))
const project = seed.addProject(projectPath, 'Native host-read acceptance')
seed.put('projects', { ...project, autoManaged: true })
seed.put('settings', {
  ...seed.settings(),
  id: 'general',
  autonomy: 'ask',
  maxUsageTokens: 1000000,
})
const room = seed.snapshot().conversations[0]
const manager = new WorkspaceManager(seed, join(profile, 'workspaces'))
const workspaces = await manager.prepare(project, false)
const source = workspaces.find((w) => w.agentId === 'codex')!
await writeFile(join(source.path, 'contract.txt'), `ARTIFACT_PROOF=${proof.artifact}`)
await git(source.path, ['add', '--', 'contract.txt'])
await git(source.path, [
  '-c',
  'user.name=Acceptance',
  '-c',
  'user.email=acceptance@agenthub.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-m',
  'Generated immutable host contract',
])
const artifact = await new ArtifactStore(seed).publish(
  { projectId: project.id, agentId: 'codex', id: randomUUID() } as Task,
  ['contract.txt'],
  'Generated host fixture, not agent-produced',
)
seed.close()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
let app = await launch(),
  page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
const events = () =>
  page.evaluate(
    (id) =>
      window.agenthub.invoke<{ messages: Message[]; activities: Activity[] }>({
        op: 'messages',
        conversationId: id,
      }),
    room.id,
  )
const report: Record<string, unknown> = {
  ...(await guardIdentity(executablePath)),
  version,
  packaged: true,
  passed: false,
  profile,
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
try {
  await page.locator(`[data-conversation-id="${room.id}"]`).click()
  const catalog = await page.evaluate(() =>
    window.agenthub.invoke<Detection[]>({ op: 'agents.detect' }),
  )
  const model = catalog
    .find((d) => d.provider === 'antigravity')
    ?.models.find((m) => m.id.includes('flash') && m.id.endsWith('-low'))
  if (!model) throw new Error('No supported native flash-low model advertised by CLI')
  await page.evaluate(
    ({ id, model }) =>
      window.agenthub.invoke({
        op: 'conversation.runtime',
        conversationId: id,
        agentId: 'antigravity',
        model,
        reasoningEffort: 'low',
      }),
    { id: room.id, model: model.id },
  )
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill(
      `@Antigravity 真實 Host 資料驗收。不得使用原生檔案、Shell、網路或其他代理。請依序分開三個讀取回合：1. 只呼叫 search_context，content 為 ${tag}；找開頭為 REFERENCE 的使用者來源（不是這則工作需求）。2. 收到搜尋結果後，只呼叫 read_context，讀取該來源 messageId，取得 1600 字以後的 READ_PROOF。3. 收到訊息後，只呼叫 read_artifact，artifactId 為 ${artifact.id}。最後 message 回覆 SEARCH_PROOF、READ_PROOF、ARTIFACT_PROOF 的三個完整碼，requests 為 []。不要重複成功讀取，不要猜測、不宣稱未讀資料。`,
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const permit = page
    .locator('.approval')
    .filter({ hasText: 'Antigravity scoped workspace access' })
  await expect(permit).toBeVisible({ timeout: 30000 })
  // Context was frozen before approval. A normal UI note now introduces previously unknown data.
  await page.locator('.mention-container > button').click()
  await page.getByRole('button', { name: '僅儲存筆記' }).click()
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill(
      `REFERENCE ${tag}\nSEARCH_PROOF=${proof.search}\n${'padding '.repeat(300)}\nREAD_PROOF=${proof.read}`,
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await permit.getByRole('button', { name: '允許一次', exact: true }).click()
  await expect
    .poll(
      async () => {
        const task = (await state()).tasks[0]
        if (task?.status === 'failed') throw new Error(task.error)
        return task?.status
      },
      { timeout: 240000, intervals: [300, 700] },
    )
    .toBe('completed')
  const snapshot = await state(),
    task = snapshot.tasks[0],
    timeline = await events()
  const answer = timeline.messages.find(
    (m) => m.taskId === task.id && m.senderId === 'antigravity' && m.delivery === 'completed',
  )!
  for (const nonce of Object.values(proof)) expect(answer.content).toContain(nonce)
  const completed = timeline.activities.filter(
    (a) => a.taskId === task.id && a.type === 'host.read.completed',
  )
  expect(completed.map((a) => JSON.parse(a.detail).operation)).toEqual([
    'search_context',
    'read_context',
    'read_artifact',
  ])
  const sourceNote = timeline.messages.find(
    (m) => m.type === 'user' && m.content.startsWith('REFERENCE '),
  )!
  expect(JSON.parse(completed[0].detail).sourceMessageIds).toContain(sourceNote.id)
  expect(JSON.parse(completed[1].detail).sourceMessageIds).toContain(sourceNote.id)
  expect(JSON.parse(completed[2].detail)).toMatchObject({
    artifactId: artifact.id,
    revision: artifact.revision,
  })
  expect(task.nativeTurns).toBe(4)
  expect(
    new Set(
      timeline.activities
        .filter((a) => a.taskId === task.id && a.sessionId)
        .map((a) => a.sessionId),
    ).size,
  ).toBe(1)
  const receipts = await page.evaluate(
    (id) =>
      window.agenthub.invoke<ContextReceipt[]>({ op: 'context.receipts', conversationId: id }),
    room.id,
  )
  const receipt = receipts.find((r) => r.taskId === task.id)!
  for (const nonce of Object.values(proof)) expect(receipt.content).not.toContain(nonce)
  expect(timeline.messages.filter((m) => m.senderId === 'antigravity')).toHaveLength(1)
  expect(
    await git(workspaces.find((w) => w.agentId === 'antigravity')!.path, ['status', '--porcelain']),
  ).toBe('')
  report.hostReads = {
    passed: true,
    initialContextContainsNoProof: true,
    searchThenFullSourceThenImmutableArtifact: true,
    oneNativeSession: true,
    onlyFinalAnswerPublished: true,
    sourceReferencesRecorded: true,
    taskId: task.id,
    nativeTurns: task.nativeTurns,
  }
  await page.screenshot({ path: join(base, 'native-host-reads.png') })
  // Real stop after a host result starts the second native turn, before its long final answer.
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill(
      `@Antigravity 取消測試：先只呼叫 search_context content ${tag}，收到結果後 message 用繁體中文寫至少 15000 字說明測試設計，requests []。不要使用原生工具或委派。`,
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(permit).toBeVisible({ timeout: 30000 })
  await permit.getByRole('button', { name: '允許一次', exact: true }).click()
  await expect
    .poll(async () => (await state()).tasks[1]?.nativeTurns || 1, {
      timeout: 120000,
      intervals: [100],
    })
    .toBe(2)
  await page.getByTitle('Stop agents').click()
  await expect
    .poll(async () => (await state()).tasks[1]?.status, { timeout: 15000 })
    .toBe('cancelled')
  const stopped = (await state()).tasks[1]
  expect(stopped.nativeTurns).toBe(2)
  report.cancelledNativeContinuation = true
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect
    .poll(async () => (await state()).tasks.find((t) => t.id === task.id)?.nativeTurns)
    .toBe(4)
  expect((await state()).tasks.find((t) => t.id === stopped.id)?.status).toBe('cancelled')
  report.restartPreservesCountsAndDoesNotReplay = true
  report.passed = true
  console.log(
    'PASS: real packaged AGY search_context → read_context → read_artifact, unknown proofs received in one native session, four charged turns, final-only chat, stop during continuation and restart without replay.',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
