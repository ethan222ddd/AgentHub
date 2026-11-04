import { _electron as electron, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Store } from '../src/main/database/store'
import type { Snapshot } from '../src/shared/types'

// Scoped native-OS smoke: no model calls, agent credentials or repository commands.
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const root = resolve('.local/notifications')
await mkdir(root, { recursive: true })
const profile = await mkdtemp(join(root, 'profile-'))
const db = new Store(join(profile, 'agenthub.sqlite'))
const project = db.addProject(profile, 'Notification smoke')
db.put('projects', { ...project, autoManaged: false })
const room = db.snapshot().conversations[0]
// An existing integration item verifies real overlay delivery after restoring history.
db.put('tasks', {
  id: 'integration-attention',
  conversationId: room.id,
  projectId: project.id,
  agentId: 'codex',
  name: 'Integration smoke fixture',
  description: '',
  status: 'waiting_user',
  waitReason: 'integration',
  integration: { status: 'attention', detail: '' },
  dependencies: [],
  createdAt: new Date().toISOString(),
  correlationId: 'notification-smoke',
  depth: 0,
})
db.close()
const executablePath = resolve(
  process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
const report: Record<string, unknown> = {
  version,
  scope: 'Windows notifications only; no paid agents or whole-suite retest',
  appAsarSha256: createHash('sha256')
    .update(await readFile(join(executablePath, '..', 'resources', 'app.asar')))
    .digest('hex'),
  guardSha256: createHash('sha256')
    .update(
      await readFile(
        join(executablePath, '..', 'resources', 'native', 'agenthub-process-guard.exe'),
      ),
    )
    .digest('hex'),
}
type NativeEvents = { states: string[]; overlays: { empty: boolean; description: string }[] }
try {
  const page = await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await page.locator(`[data-conversation-id="${room.id}"]`).click()
  await app.evaluate(({ Notification, BrowserWindow }) => {
    const events: NativeEvents = { states: [], overlays: [] }
    ;(globalThis as typeof globalThis & { notificationSmoke: NativeEvents }).notificationSmoke =
      events
    const show = Notification.prototype.show
    Notification.prototype.show = function () {
      this.once('show', () => events.states.push('shown'))
      this.once('failed', () => events.states.push('failed'))
      // Call the real Windows implementation, not a mock delivery.
      return show.call(this)
    }
    const overlay = BrowserWindow.prototype.setOverlayIcon
    BrowserWindow.prototype.setOverlayIcon = function (image, description) {
      events.overlays.push({ empty: !image, description })
      return overlay.call(this, image, description)
    }
  })
  const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  const settings = (await snapshot()).settings
  await page.evaluate(
    (settings) =>
      window.agenthub.invoke({ op: 'settings.save', settings: { ...settings, language: 'en' } }),
    settings,
  )
  await page.evaluate(
    (id) => window.agenthub.invoke({ op: 'notifications.test', conversationId: id }),
    room.id,
  )
  const events = () =>
    app.evaluate(
      () =>
        (globalThis as typeof globalThis & { notificationSmoke: NativeEvents }).notificationSmoke,
    )
  await expect.poll(async () => (await events()).states.length, { timeout: 15000 }).toBe(1)
  expect((await events()).states).toEqual(['shown'])
  expect((await events()).overlays.at(-1)).toEqual({
    empty: false,
    description: '1 tasks need attention',
  })
  report.nativeToastShown = true
  report.nativeOverlayCalled = true
  // A missing manual workspace fails before any agent is launched: verify actual failure routing.
  await page.evaluate(
    (id) =>
      window.agenthub.invoke({
        op: 'send',
        conversationId: id,
        recipients: ['codex'],
        content: 'Notification preflight smoke; workspace is intentionally absent.',
      }),
    room.id,
  )
  await expect
    .poll(
      async () =>
        (await snapshot()).tasks.filter((t) => t.id !== 'integration-attention').at(-1)?.status,
    )
    .toBe('failed')
  await expect.poll(async () => (await events()).states.length).toBe(2)
  expect((await events()).states).toEqual(['shown', 'shown'])
  expect((await snapshot()).tasks.at(-1)?.error).toContain('WORKSPACE_NOT_READY')
  report.realPreflightFailureNotified = true
  await page.evaluate(
    (settings) =>
      window.agenthub.invoke({
        op: 'settings.save',
        settings: { ...settings, notifications: 'off' },
      }),
    settings,
  )
  const denied = await page.evaluate(async () => {
    try {
      await window.agenthub.invoke({ op: 'notifications.test' })
      return false
    } catch {
      return true
    }
  })
  expect(denied).toBe(true)
  report.doNotDisturbBlocked = true
  report.osClick =
    'Not automated in this smoke; controller activation and renderer navigation covered by scoped Electron E2E'
  report.modelTurns = 0
  // Host settings save precedes the renderer's batched refresh. Wait before opening
  // the modal, whose editable settings intentionally stay local until saved.
  await expect(page.getByRole('button', { name: '新增專案', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: '一般', exact: true }).click()
  await page.screenshot({ path: join(root, 'notification-settings.png') })
  report.success = true
} catch (error) {
  report.success = false
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(root, 'packaged-notifications-report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report, null, 2))
