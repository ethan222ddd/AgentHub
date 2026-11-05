import { directory } from '../helpers'
import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git } from '../../src/main/git/workspaces'
import type { Snapshot } from '../../src/shared/types'

test('Electron automatically prepares blank and existing source folders, safely excludes secrets, and restores project state without model calls', async () => {
  const base = resolve('.local/e2e-automatic')
  await mkdir(base, { recursive: true })
  const profile = await mkdtemp(join(base, 'profile-')),
    blank = await directory('空白 專案-'),
    existing = await directory('existing-')
  await writeFile(join(existing, 'index.html'), '<html><body>Existing source</body></html>')
  await writeFile(join(existing, '.env'), 'API_KEY=NON_SECRET_TEST_SENTINEL')
  await writeFile(join(existing, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nTEST ONLY')
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  const launch = () => electron.launch({ args: ['.'], env })
  let app = await launch(),
    page = await app.firstWindow()
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, blank)
    await page.getByRole('button', { name: '選擇專案資料夾' }).click()
    await expect(page.getByText('就緒 · 自動管理', { exact: true })).toBeVisible()
    expect(await git(blank, ['branch', '--show-current'])).toBe('main')
    expect(await git(blank, ['rev-parse', 'HEAD'])).toMatch(/^[a-f0-9]{40}$/)
    await expect(page.locator('.mention-container > button')).toContainText('Codex')
    await page.getByLabel('Collaboration mode').selectOption('supervisor')
    await expect(page.locator('.mention-container > button')).not.toContainText('Claude')
    await page.getByLabel('Collaboration mode').selectOption('manual')
    await expect(page.locator('.mention-container > button')).toContainText('Claude')
    await page.locator('.mention-container > button').click()
    await page.getByRole('button', { name: '僅儲存筆記' }).click()
    await page.getByRole('textbox', { name: 'Message' }).fill('No agent calls in this CI test')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, existing)
    await page.getByRole('button', { name: '新增專案', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))).projects
            .length,
      )
      .toBe(2)
    await expect
      .poll(async () => {
        const state = await page.evaluate(() =>
          window.agenthub.invoke<Snapshot>({ op: 'snapshot' }),
        )
        return state.projects.every((p) => p.setup?.state === 'ready')
      })
      .toBe(true)
    const snapshot = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
    expect(snapshot.projects.every((p) => p.autoManaged && p.setup?.state === 'ready')).toBe(true)
    expect(snapshot.tasks).toHaveLength(0)
    const tree = await git(existing, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tree).toContain('index.html')
    expect(tree).not.toMatch(/\.env|private\.pem/)
    expect(await readFile(join(existing, '.env'), 'utf8')).toContain('NON_SECRET_TEST_SENTINEL')
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))).projects
            .length,
      )
      .toBe(2)
    const restored = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
    expect(restored.projects.map((p) => p.id)).toEqual(snapshot.projects.map((p) => p.id))
    expect(restored.tasks).toHaveLength(0)
    await page.screenshot({ path: join(base, 'automatic-ready.png') })
  } finally {
    await app.close()
  }
})
