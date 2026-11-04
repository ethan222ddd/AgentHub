import { guardIdentity } from './release-identity'
// Opt-in: real packaged Codex/Claude in generated worktrees. No private project data.
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { repository } from '../tests/helpers'
import type { Task, Snapshot } from '../src/shared/types'

const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-recovery')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await repository()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
let app: ElectronApplication = await launch(),
  page: Page = await app.firstWindow()
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
const proof = `PARTIAL_${randomUUID()}`
const report: Record<string, unknown> = {
  version,
  profile,
  project,
  packaged: true,
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
  let s = await state()
  // This regression certifies the explicit manual recovery path with intentional WIP.
  // Automatic integration/restart is separately exercised by live-automatic.ts.
  await page.evaluate(
    (projectId) => window.agenthub.invoke({ op: 'project.automation', projectId, enabled: false }),
    s.projects[0].id,
  )
  report.projectMode = 'manual-isolated'
  // Native Codex context can exceed 200k across several tool steps; change only this disposable profile.
  await page.evaluate(
    (settings) =>
      window.agenthub.invoke({
        op: 'settings.save',
        settings: { ...settings, maxUsageTokens: 1000000 },
      }),
    s.settings,
  )
  await page.evaluate(
    (projectId) =>
      window.agenthub.invoke({ op: 'workspace.prepare', projectId, initialize: false }),
    s.projects[0].id,
  )
  const c = s.conversations[0]
  const first = await page.evaluate(
    ({ id, proof }) =>
      window.agenthub.invoke<Task>({
        op: 'task.create',
        conversationId: id,
        agentId: 'codex',
        description: `This is a generated recovery test. Work only in your assigned workspace. If partial.txt exists, read it and preserve its exact bytes; otherwise use the native file editing tool to create partial.txt containing exactly ${proof}. Then request approval and run exactly: echo AGENTHUB_RECOVERY_OK. Do not use the network, other commands or delegate. After command success reply exactly RECOVERY_OK.`,
        dependencies: [],
      }),
    { id: c.id, proof },
  )
  let paused = false
  let originalBytes: Buffer | undefined
  await expect
    .poll(
      async () => {
        const cards = page.locator('.approval')
        if (await cards.count()) {
          const card = cards.first(),
            text = await card.innerText()
          if (
            text.includes('commandExecution/requestApproval') &&
            text.includes('AGENTHUB_RECOVERY_OK')
          ) {
            s = await state()
            const workspace = s.workspaces.find((w) => w.agentId === 'codex')!
            originalBytes = await readFile(join(workspace.path, 'partial.txt'))
            expect(originalBytes.toString('utf8').trim()).toBe(proof)
            await page.getByTitle('New conversation').first().click()
            await expect(page.getByRole('button', { name: '前往批准', exact: true })).toBeVisible()
            await page.getByRole('button', { name: '前往批准', exact: true }).click()
            await page.evaluate(
              (id) => window.agenthub.invoke({ op: 'task.action', id, action: 'pause' }),
              first.id,
            )
            paused = true
          } else
            await card
              .getByRole('button', {
                name:
                  text.includes('fileChange/requestApproval') ||
                  (/commandExecution\/requestApproval/.test(text) &&
                    /Test-Path|Get-Content|Get-ChildItem/.test(text))
                    ? '允許一次'
                    : '拒絕',
                exact: true,
              })
              .click()
        }
        const task = (await state()).tasks.find((t) => t.id === first.id)!
        if (task.status === 'failed' || task.status === 'completed')
          throw new Error(`Expected pause before command; got ${task.status}: ${task.error}`)
        return paused && task.status === 'paused'
      },
      { timeout: 180000, intervals: [300, 700] },
    )
    .toBe(true)
  const dependent = await page.evaluate(
    ({ id, firstId }) =>
      window.agenthub.invoke<Task>({
        op: 'task.create',
        conversationId: id,
        agentId: 'claude',
        description:
          'Reply exactly DEPENDENCY_OK. Do not use tools, access files or network, run commands or delegate.',
        dependencies: [firstId],
      }),
    { id: c.id, firstId: first.id },
  )
  expect((await state()).tasks.find((t) => t.id === dependent.id)?.status).toBe('waiting_agent')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.locator(`[data-conversation-id="${c.id}"]`).click()
  s = await state()
  expect(s.tasks.find((t) => t.id === dependent.id)).toMatchObject({
    status: 'waiting_user',
    waitReason: 'recovery',
  })
  expect(s.tasks.find((t) => t.id === first.id)?.status).toBe('paused')
  await page.waitForTimeout(1200)
  expect(
    (await state()).tasks.some((t) => t.status === 'running' || t.waitReason === 'approval'),
  ).toBe(false)
  await page.evaluate(
    (id) => window.agenthub.invoke({ op: 'task.action', id, action: 'resume' }),
    first.id,
  )
  await expect
    .poll(
      async () => {
        const cards = page.locator('.approval')
        if (await cards.count()) {
          const card = cards.first(),
            text = await card.innerText()
          const allow =
            /fileChange\/requestApproval/.test(text) ||
            (/commandExecution\/requestApproval/.test(text) &&
              /Get-Content|AGENTHUB_RECOVERY_OK/.test(text))
          await card.getByRole('button', { name: allow ? '允許一次' : '拒絕', exact: true }).click()
        }
        const retry = (await state()).tasks.find((t) => t.retryOf === first.id)
        if (retry?.status === 'failed' || retry?.status === 'cancelled')
          throw new Error(retry.error)
        return retry?.status
      },
      { timeout: 180000, intervals: [300, 700] },
    )
    .toBe('completed')
  s = await state()
  expect(s.tasks.find((t) => t.id === dependent.id)?.waitReason).toBe('recovery')
  expect(
    (
      await readFile(join(s.workspaces.find((w) => w.agentId === 'codex')!.path, 'partial.txt'))
    ).equals(originalBytes!),
  ).toBe(true)
  await page.evaluate(
    (id) => window.agenthub.invoke({ op: 'task.action', id, action: 'resume' }),
    dependent.id,
  )
  await expect
    .poll(
      async () => {
        const next = (await state()).tasks.find((t) => t.retryOf === dependent.id)
        if (next?.status === 'failed') throw new Error(next.error)
        return next?.status
      },
      { timeout: 180000, intervals: [500, 1000] },
    )
    .toBe('completed')
  s = await state()
  expect(s.tasks).toHaveLength(4)
  const activity = await page.evaluate(
    (id) =>
      window.agenthub.invoke<{ activities: { agentId: string; sessionId: string }[] }>({
        op: 'messages',
        conversationId: id,
      }),
    c.id,
  )
  const nativeSessions = new Set(
    activity.activities.filter((a) => a.agentId === 'codex' && a.sessionId).map((a) => a.sessionId),
  )
  expect(nativeSessions.size).toBe(1)
  report.passed = true
  report.tasks = s.tasks
  report.partialFilePreserved = true
  report.restartDidNotReplay = true
  report.dependencyFollowedRetry = true
  report.nativeSessionResumed = true
  report.crossRoomApprovalNotice = true
  await page.screenshot({ path: join(base, 'packaged-recovery.png') })
  console.log(
    'PASS: real packaged Codex partial edit → pause → restart → explicit native resume → Claude dependency; independent attempt history preserved.',
  )
} catch (e) {
  report.error = String(e)
  throw e
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
