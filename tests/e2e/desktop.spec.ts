import { directory } from '../helpers'
import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
test('real Electron: secure bridge, project selection, SQLite history, theme and restart', async () => {
  const root = resolve('.local/e2e')
  await mkdir(root, { recursive: true })
  const data = await mkdtemp(join(root, 'profile-'))
  const project = await directory('project-')
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  env.AGENTHUB_DATA_DIR = data
  delete env.ELECTRON_RUN_AS_NODE
  let app = await electron.launch({ args: ['.'], env })
  let page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '選擇專案資料夾' })).toBeVisible()
  expect(
    await page.evaluate(() => ({
      node: typeof (window as unknown as { require: unknown }).require,
      bridge: typeof window.agenthub?.invoke,
    })),
  ).toEqual({ node: 'undefined', bridge: 'function' })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await expect(
    page.getByRole('heading', { name: project.split(/[\\/]/).at(-1)!, exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: '.local/agenthub-foundation.png' })
  await page.locator('.mention-container > button').click()
  await page.getByRole('button', { name: '僅儲存筆記' }).click()
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('這是 SQLite 持久化的真實本機筆記。\n\n```ts\nconst result = 42\n```')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('message')).toContainText('這是 SQLite 持久化的真實本機筆記。')
  await expect(page.locator('.code-block pre')).toHaveText('const result = 42\n')
  await expect(page.locator('.code-block .hljs-keyword')).toContainText('const')
  const rejected = await page.evaluate(async () => {
    try {
      await window.agenthub.invoke({ op: 'shell', command: 'whoami' })
      return false
    } catch {
      return true
    }
  })
  expect(rejected).toBe(true)
  expect(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())).toBe(true)
  const fixtureKey = 'fixture-key-for-DPAPI-verification-only'
  await page.evaluate(
    (value) => window.agenthub.invoke({ op: 'credential.save', provider: 'claude', value }),
    fixtureKey,
  )
  expect((await readFile(join(data, 'claude-key.dpapi'))).includes(Buffer.from(fixtureKey))).toBe(
    false,
  )
  await page.evaluate(() =>
    window.agenthub.invoke({ op: 'credential.save', provider: 'claude', value: '' }),
  )
  const exportPath = join(data, 'conversation.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.evaluate(async () => {
    const snapshot = await window.agenthub.invoke<{ conversations: { id: string }[] }>({
      op: 'snapshot',
    })
    await window.agenthub.invoke({
      op: 'export',
      conversationId: snapshot.conversations[0].id,
      format: 'json',
    })
  })
  expect(
    (JSON.parse(await readFile(exportPath, 'utf8')) as { messages: unknown[] }).messages,
  ).toHaveLength(1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: '診斷', exact: true }).click()
  await page.getByRole('button', { name: '重新整理程序', exact: true }).click()
  await expect(page.getByLabel('Process diagnostics')).toContainText('Main PID')
  const ownership = await page.evaluate(() =>
    window.agenthub.invoke<{ ownerPid: number; appGuardPid?: number }>({ op: 'processes.inspect' }),
  )
  expect(ownership.ownerPid).toBeGreaterThan(0)
  if (process.platform === 'win32') expect(ownership.appGuardPid).toBeGreaterThan(0)
  await page.getByRole('button', { name: '一般', exact: true }).click()
  await page.screenshot({ path: '.local/agenthub-settings.png' })
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark')
  await page.getByRole('button', { name: '儲存設定' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await app.close()
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  await expect(page.getByTestId('message')).toContainText('這是 SQLite 持久化的真實本機筆記。')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: '.local/agenthub-chat-dark.png' })
  await app.close()
})
test('Electron can close during initial rendering and reopen without replay', async () => {
  const root = resolve('.local/e2e')
  await mkdir(root, { recursive: true })
  const profile = await mkdtemp(join(root, 'early-close-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  for (let attempt = 0; attempt < 4; attempt++) {
    const app = await electron.launch({ args: ['.'], env })
    await app.firstWindow()
    // Deliberately no DOM/ready-to-show wait on the first three launches.
    if (attempt === 3) {
      const page = await app.firstWindow()
      await expect(page.getByRole('button', { name: '選擇專案資料夾' })).toBeVisible()
      const state = await page.evaluate(() =>
        window.agenthub.invoke<{ tasks: unknown[] }>({ op: 'snapshot' }),
      )
      expect(state.tasks).toHaveLength(0)
    }
    await app.close()
  }
})

test('packaged Windows executable starts with isolated data and secure preload', async () => {
  const executablePath = resolve(
    process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
  )
  test.skip(!existsSync(executablePath), 'Build npm run package:win before the packaged smoke test')
  const root = resolve('.local/packaged')
  await mkdir(root, { recursive: true })
  const data = await mkdtemp(join(root, 'profile-'))
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${data}`], env })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '選擇專案資料夾' })).toBeVisible()
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const snapshot = await page.evaluate(() =>
      window.agenthub.invoke<{ dataPath: string }>({ op: 'snapshot' }),
    )
    expect(snapshot.dataPath).toContain(data)
    await page.screenshot({ path: '.local/agenthub-packaged.png' })
  } finally {
    await app.close()
  }
})
