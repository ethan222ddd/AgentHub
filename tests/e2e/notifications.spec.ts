import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Store } from '../../src/main/database/store'
import type { Settings } from '../../src/shared/types'

test('notification settings persist, native adapter routes a click, and DND preserves taskbar count', async () => {
  const root = resolve('.local/e2e-notifications')
  await mkdir(root, { recursive: true })
  const data = await mkdtemp(join(root, 'profile-'))
  const db = new Store(join(data, 'agenthub.sqlite'))
  const project = db.addProject(data, 'Notifications')
  db.put('projects', { ...project, autoManaged: false })
  const first = db.snapshot().conversations[0],
    second = db.createConversation(project.id)
  db.put('tasks', {
    id: 'pending-task',
    projectId: project.id,
    conversationId: first.id,
    agentId: 'codex',
    name: 'Integration needs attention',
    description: '',
    status: 'waiting_user',
    waitReason: 'integration',
    integration: { status: 'attention', detail: '' },
    dependencies: [],
    createdAt: new Date().toISOString(),
    correlationId: 'fixture',
    depth: 0,
  })
  db.close()
  // Test-only bootstrap replaces OS delivery, not the app's notification controller,
  // IPC, persisted state, renderer navigation or taskbar adapter.
  const bootstrap = join(data, 'bootstrap.cjs')
  await writeFile(
    bootstrap,
    `
    const { Notification, BrowserWindow } = require('electron');
    globalThis.notificationFixture = { notices: [], overlays: [] };
    Notification.isSupported = () => true;
    Notification.handleActivation = cb => { globalThis.notificationFixture.activate = cb };
    Notification.prototype.show = function() {
      globalThis.notificationFixture.notices.push({ title: this.title, xml: this.toastXml });
    };
    Notification.prototype.close = function() {};
    BrowserWindow.prototype.setOverlayIcon = function(icon, description) {
      globalThis.notificationFixture.overlays.push({ empty: !icon, description });
    };
    import(${JSON.stringify(pathToFileURL(resolve('dist/main/index.js')).href)});
  `,
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({ args: [bootstrap, `--user-data-dir=${data}`], env })
  let app = await launch()
  type Fixture = {
    notices: { title: string; xml: string }[]
    overlays: { empty: boolean; description: string }[]
    activate(details: { type: string; arguments: string }): void
  }
  try {
    let page = await app.firstWindow()
    await page.locator(`[data-conversation-id="${second.id}"]`).click()
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { notificationFixture: Fixture }).notificationFixture
            .notices.length,
      ),
    ).toBe(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: '一般', exact: true }).click()
    await page.getByRole('combobox', { name: 'Desktop notifications' }).selectOption('approvals')
    await page.getByRole('button', { name: '儲存設定', exact: true }).click()
    await expect(page.getByText('設定已儲存', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close settings' }).click()
    await page.evaluate(
      (id) => window.agenthub.invoke({ op: 'notifications.test', conversationId: id }),
      first.id,
    )
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & { notificationFixture: Fixture }
          ).notificationFixture.notices.at(-1)?.xml,
      ),
    ).toContain(first.id)
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].minimize()
      ;(
        globalThis as typeof globalThis & { notificationFixture: Fixture }
      ).notificationFixture.activate({ type: 'click', arguments: 'agenthub:conversation:' + id })
    }, first.id)
    await expect(page.locator('.conversation-row.selected')).toHaveAttribute(
      'data-conversation-id',
      first.id,
    )
    await expect(page.locator('.side-panel')).toBeVisible()
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    ).toBe(false)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: '一般', exact: true }).click()
    await page.getByRole('combobox', { name: 'Desktop notifications' }).selectOption('off')
    await page.getByRole('button', { name: '儲存設定', exact: true }).click()
    await expect(page.getByText('設定已儲存', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '測試通知', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
      '勿擾已開啟',
    )
    expect(
      await app.evaluate(() =>
        (
          globalThis as typeof globalThis & { notificationFixture: Fixture }
        ).notificationFixture.overlays.at(-1),
      ),
    ).toEqual({ empty: false, description: '1 個任務需要處理' })
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    const saved = await page.evaluate(() =>
      window.agenthub.invoke<{ settings: Settings }>({ op: 'snapshot' }),
    )
    expect(saved.settings.notifications).toBe('off')
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { notificationFixture: Fixture }).notificationFixture
            .notices.length,
      ),
    ).toBe(0)
  } finally {
    await app.close()
  }
})
