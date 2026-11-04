// Opt-in real packaged runtime fault injection. Only disposable profile/task processes.
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { repository } from '../tests/helpers'
import { guardIdentity } from './release-identity'
import type { ProcessInspection, Snapshot, Task } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-lifecycle')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await repository()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const helper = resolve(executablePath, '..', 'resources/native/agenthub-process-guard.exe')
const terminator = join(base, 'terminate-owned.exe')
execFileSync(
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    `/out:${terminator}`,
    resolve('tests/fixtures/terminate-owned.cs'),
  ],
  { windowsHide: true },
)
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
)
delete env.ELECTRON_RUN_AS_NODE
let app!: ElectronApplication, page: Page
const launch = async () => {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
  page = await app.firstWindow()
  await expect(
    page
      .getByRole('textbox', { name: 'Message' })
      .or(page.getByRole('button', { name: '選擇專案資料夾' }))
      .first(),
  ).toBeVisible()
}
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
const inspect = () =>
  page.evaluate(() => window.agenthub.invoke<ProcessInspection>({ op: 'processes.inspect' }))
const alive = (pid: number) => {
  try {
    // Windows can retain exited process objects while Playwright holds a handle.
    // Test kernel signalled state, not merely whether OpenProcess succeeds.
    execFileSync(terminator, ['alive', String(pid)], { windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const reaped = async (pids: number[]) => {
  await expect.poll(() => pids.filter(alive), { timeout: 10000 }).toEqual([])
}
const terminate = (pid: number) => {
  const creation = execFileSync(helper, ['identity', String(pid)], {
    windowsHide: true,
    encoding: 'utf8',
  }).trim()
  execFileSync(terminator, [String(pid), creation], { windowsHide: true })
}
const outsider = spawn(process.execPath, ['-e', 'setTimeout(()=>{},600000)'], {
  windowsHide: true,
  stdio: 'ignore',
})
const report: Record<string, unknown> = {
  passed: false,
  version,
  packaged: true,
  profile,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
try {
  await launch()
  await app!.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page!.getByRole('button', { name: '選擇專案資料夾' }).click()
  let s = await state()
  const room = s.conversations[0]
  await page!.evaluate(
    ({ projectId, settings }) =>
      Promise.all([
        window.agenthub.invoke({ op: 'project.automation', projectId, enabled: false }),
        window.agenthub.invoke({
          op: 'settings.save',
          settings: { ...settings, maxUsageTokens: 1000000 },
        }),
      ]),
    { projectId: room.projectId, settings: s.settings },
  )
  await page!.evaluate(
    (projectId) =>
      window.agenthub.invoke({ op: 'workspace.prepare', projectId, initialize: false }),
    room.projectId,
  )
  const cases: unknown[] = []
  for (const kind of ['main-crash', 'runtime-crash'] as const) {
    const proof = randomUUID(),
      name = `${kind}.txt`
    const task = await page!.evaluate(
      ({ id, proof, name }) =>
        window.agenthub.invoke<Task>({
          op: 'task.create',
          conversationId: id,
          agentId: 'codex',
          dependencies: [],
          description: `Generated lifecycle acceptance. Use your native file-edit tool to create ${name} containing exactly ${proof}. Then use the AgentHub structured collaboration tool request_response to recipient claude asking it to reply OK. These steps must occur in this order. Do not run shell commands, use network or edit other files. The host will stop you while manual delegation approval is pending.`,
        }),
      { id: room.id, proof, name },
    )
    await expect
      .poll(
        async () => {
          const cards = page.locator('.approval')
          for (const card of await cards.all()) {
            const text = await card.innerText()
            if (text.includes('Start another agent')) return true
            await card
              .getByRole('button', {
                name: text.includes('fileChange/requestApproval') ? '允許一次' : '拒絕',
                exact: true,
              })
              .click()
          }
          const current = (await state()).tasks.find((t) => t.id === task.id)!
          if (['failed', 'completed', 'cancelled'].includes(current.status))
            throw new Error(
              `${kind} ended before fault injection: ${current.status} ${current.error}`,
            )
          return false
        },
        { timeout: 180000, intervals: [400, 800] },
      )
      .toBe(true)
    s = await state()
    const path = join(s.workspaces.find((w) => w.agentId === 'codex')!.path, name)
    const before = await readFile(path)
    expect(before.toString('utf8').trim()).toBe(proof)
    const owned = await inspect()
    const guard = owned.processes.find(
      (p) => p.taskId === task.id && p.stage === 'codex-app-server',
    )
    expect(guard?.pid).toBeTruthy()
    if (kind === 'main-crash') {
      const pids = [owned.ownerPid, owned.appGuardPid!, ...owned.processes.map((p) => p.pid!)]
      // Playwright's own Main ChildProcess handle; no recursive global PID scan.
      console.log('fault.target', JSON.stringify({ owner: owned.ownerPid, launcher: app!.process().pid, guard: owned.appGuardPid, processes: owned.processes }))
      terminate(owned.ownerPid)
      await reaped(pids)
      await app!.close().catch(() => {})
      await launch()
      s = await state()
      expect(s.tasks.find((t) => t.id === task.id)).toMatchObject({
        status: 'waiting_user',
        waitReason: 'recovery',
      })
      await page!.waitForTimeout(1600)
      expect(
        (await state()).tasks.some((t) => t.status === 'running' || t.waitReason === 'approval'),
      ).toBe(false)
      expect((await inspect()).processes.some((p) => p.taskId === task.id)).toBe(false)
    } else {
      terminate(guard!.pid!)
      await reaped([guard!.pid!])
      await expect
        .poll(async () => (await state()).tasks.find((t) => t.id === task.id)?.status, {
          timeout: 15000,
        })
        .toBe('failed')
      expect(alive(owned.ownerPid)).toBe(true)
      const claude = await page!.evaluate(
        (id) =>
          window.agenthub.invoke<Task>({
            op: 'task.create',
            conversationId: id,
            agentId: 'claude',
            dependencies: [],
            description: 'Reply exactly OK. Do not use tools, network or delegate.',
          }),
        room.id,
      )
      await expect
        .poll(
          async () => {
            const current = (await state()).tasks.find((t) => t.id === claude.id)!
            if (current.status === 'failed') throw new Error(current.error)
            return current.status
          },
          { timeout: 120000, intervals: [500, 1000] },
        )
        .toBe('completed')
      const timeline = await page!.evaluate(
        (conversationId) =>
          window.agenthub.invoke<{
            messages: { taskId: string; senderId: string; content: string }[]
          }>({ op: 'messages', conversationId }),
        room.id,
      )
      expect(
        timeline.messages
          .find((m) => m.taskId === claude.id && m.senderId === 'claude')
          ?.content.trim(),
      ).toBe('OK')
    }
    expect((await readFile(path)).equals(before)).toBe(true)
    expect(alive(outsider.pid!)).toBe(true)
    cases.push({
      kind,
      taskId: task.id,
      partialFilePreserved: true,
      unrelatedProcessSurvives: true,
      ...(kind === 'main-crash'
        ? { restartDoesNotReplay: true, recovered: true }
        : { failedVisibly: true, otherNativeAgentAnswersOK: true }),
    })
    console.log('PASS:', kind)
  }
  // Real read-only metadata processes must drain during a normal close.
  const pending = page!
    .evaluate(() => window.agenthub.invoke({ op: 'agents.detect' }))
    .catch(() => {})
  await expect
    .poll(async () => (await inspect()).processes.length, { timeout: 5000 })
    .toBeGreaterThan(0)
  const metadata = await inspect()
  await app!.close()
  await pending
  await reaped([metadata.ownerPid, metadata.appGuardPid!, ...metadata.processes.map((p) => p.pid!)])
  await launch()
  const crash = await inspect()
  await app!
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
    })
    .catch(() => {})
  await reaped([crash.ownerPid, crash.appGuardPid!])
  await app!.close().catch(() => {})
  await launch()
  expect((await state()).tasks.some((t) => t.status === 'running')).toBe(false)
  await page!.getByRole('button', { name: 'Settings', exact: true }).click()
  await page!.getByRole('button', { name: '診斷', exact: true }).click()
  await page!.getByRole('button', { name: '重新整理程序', exact: true }).click()
  await expect(page!.getByLabel('Process diagnostics')).toContainText('Main PID')
  await page!.screenshot({ path: join(base, 'diagnostics.png') })
  await app!.close()
  Object.assign(report, {
    passed: true,
    cases,
    metadataCloseReaped: true,
    rendererCrashReaped: true,
    restartDoesNotReplay: true,
    unrelatedProcessSurvives: alive(outsider.pid!),
  })
  console.log(
    'PASS: real packaged Codex Main/runtime faults, native Claude survives, metadata shutdown, renderer crash and no replay',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app?.close().catch(() => {})
  outsider.kill()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
