import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Store } from '../../src/main/database/store'
import { repository } from '../helpers'

test('project picker completion respects a newer room selection', async () => {
  const base = resolve('.local/e2e-navigation')
  await mkdir(base, { recursive: true })
  const profile = await mkdtemp(join(base, 'profile-')),
    first = await repository(),
    second = await repository(),
    opened = await repository()
  const store = new Store(join(profile, 'agenthub.sqlite'))
  const a = store.addProject(first, 'First'),
    b = store.addProject(second, 'Second')
  for (const project of [a, b]) store.put('projects', { ...project, autoManaged: false })
  const rooms = store.snapshot().conversations
  const roomA = rooms.find((c) => c.projectId === a.id)!,
    roomB = rooms.find((c) => c.projectId === b.id)!
  store.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.locator(`[data-conversation-id="${roomA.id}"]`).click()
    // Only the native file chooser is controlled. Real IPC/Git/setup continue.
    await app.evaluate(({ dialog }, path) => {
      const fixture = globalThis as typeof globalThis & {
        releasePicker?: () => void
        pickerStarted?: boolean
      }
      dialog.showOpenDialog = async () => {
        fixture.pickerStarted = true
        await new Promise<void>((r) => {
          fixture.releasePicker = r
        })
        return { canceled: false, filePaths: [path] }
      }
    }, opened)
    await page.getByRole('button', { name: '新增專案', exact: true }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () => !!(globalThis as typeof globalThis & { pickerStarted?: boolean }).pickerStarted,
        ),
      )
      .toBe(true)
    await page.locator(`[data-conversation-id="${roomB.id}"]`).click()
    await app.evaluate(() => {
      ;(globalThis as typeof globalThis & { releasePicker?: () => void }).releasePicker?.()
    })
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              window.agenthub.invoke<{ projects: { path: string; setup?: { state: string } }[] }>({
                op: 'snapshot',
              }),
            )
          ).projects.find((p) => p.path === opened)?.setup?.state,
        { timeout: 30000 },
      )
      .toBe('ready')
    await expect(page.locator('.conversation-row.selected')).toHaveAttribute(
      'data-conversation-id',
      roomB.id,
    )
    await page.waitForTimeout(400)
    await expect(page.locator('.conversation-row.selected')).toHaveAttribute(
      'data-conversation-id',
      roomB.id,
    )
  } finally {
    await app.close()
  }
})
