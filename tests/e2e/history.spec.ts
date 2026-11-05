import { directory } from '../helpers'
import { test, expect, _electron as electron } from './fixtures'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/database/store'
import type { Message } from '../../src/shared/types'
test('SQLite history pages and searches beyond loaded messages; restore preserves the old profile', async () => {
  const root = resolve('.local/e2e-history')
  await mkdir(root, { recursive: true })
  const profile = await mkdtemp(join(root, 'profile-'))
  const project = await directory('project-')
  const seed = new Store(join(profile, 'agenthub.sqlite'))
  const p = seed.addProject(project, 'Long history')
  const c = seed.snapshot().conversations[0]
  for (let i = 0; i < 240; i++)
    seed.put('messages', {
      id: `history-${i}`,
      projectId: p.id,
      conversationId: c.id,
      senderId: 'user',
      recipientIds: [],
      content: i === 0 ? 'EARLIEST_SEARCH_PROOF' : `History item ${i}`,
      type: 'user',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: 'history',
      delivery: 'completed',
    } satisfies Message)
  seed.close()
  await writeFile(join(project, 'attachment.txt'), 'Actual dropped project attachment')
  const env = Object.fromEntries(
    Object.entries(process.env).filter((v): v is [string, string] => typeof v[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  let app = await electron.launch({ args: ['.'], env })
  let page = await app.firstWindow()
  try {
    await expect(page.locator('.message').last()).toContainText('History item 239')
    expect(await page.locator('.message').count()).toBeLessThan(40)
    await page.getByRole('button', { name: '載入更早訊息' }).click()
    const data = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[] }>({
          op: 'messages',
          conversationId: id,
          search: 'EARLIEST_SEARCH_PROOF',
        }),
      c.id,
    )
    expect(data.messages[0].id).toBe('history-0')
    await page.getByTitle('Search · Ctrl+K').click()
    await page.getByPlaceholder('搜尋目前對話的所有訊息').fill('EARLIEST_SEARCH_PROOF')
    await expect(
      page.getByTestId('message').filter({ hasText: 'EARLIEST_SEARCH_PROOF' }),
    ).toBeVisible()
    const attachment = await page.evaluate(
      async ({ projectId, path }) =>
        window.agenthub.invoke<{ content: string }[]>({
          op: 'attachment.read',
          projectId,
          paths: [path],
        }),
      { projectId: p.id, path: join(project, 'attachment.txt') },
    )
    expect(attachment[0].content).toContain('Actual dropped project attachment')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await page.keyboard.press('Shift+Tab')
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
    ).toBe(true)
    const backupPath = join(profile, 'restore-input.sqlite')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, backupPath)
    await page.evaluate(() => window.agenthub.invoke({ op: 'backup' }))
    await page.evaluate(
      (id) => window.agenthub.invoke({ op: 'history.clear', conversationId: id }),
      c.id,
    )
    const cleared = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId: id }),
      c.id,
    )
    expect(cleared.messages).toHaveLength(0)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, backupPath)
    const preview = await page.evaluate(() =>
      window.agenthub.invoke<{ id: string; counts: Record<string, number> }>({
        op: 'restore.preview',
      }),
    )
    expect(preview.counts.messages).toBe(240)
    const result = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ restartRequired: boolean }>({
          op: 'restore.apply',
          previewId: id,
        }),
      preview.id,
    )
    expect(result.restartRequired).toBe(true)
    await app.close()
    app = await electron.launch({ args: ['.'], env })
    page = await app.firstWindow()
    await expect(page.locator('.message').last()).toContainText('History item 239')
    expect((await readFile(join(profile, 'agenthub.sqlite'))).length).toBeGreaterThan(0)
    await page.screenshot({ path: '.local/agenthub-history.png' })
  } finally {
    await app.close()
  }
})
