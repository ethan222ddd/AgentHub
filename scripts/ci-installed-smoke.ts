// Clean Windows runner: actual NSIS install/reinstall/uninstall, SQLite and Electron.
// No paid runtimes, credentials, simulated agent answers or pre-existing user installs.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { exec } from '../src/main/agents/process'
import { processSupervisor } from '../src/main/agents/process-owner'
import { repository, cleanupTestDirectories } from '../tests/helpers'
import type { Message, Snapshot } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/ci-installer')
await mkdir(base, { recursive: true })
const target = join(base, 'application', 'AgentHub.exe'),
  profile = join(base, 'profile'),
  nonce = randomUUID()
const powershell = join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const install = async (phase: string) => {
  const out = await exec(
    powershell,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('scripts/ci-installer.ps1'),
      '-Phase',
      phase,
    ],
    { windowsHide: true, timeout: 120000 },
  )
  console.log(out.stdout.trim())
}
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
delete env.AGENTHUB_DATA_DIR
delete env.PORTABLE_EXECUTABLE_DIR
let app: Awaited<ReturnType<typeof electron.launch>> | undefined
const report: Record<string, unknown> = {
  version,
  passed: false,
  noModelTurns: true,
  environment:
    process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local Windows validation',
  upgradeKind: 'same-version reinstall; not a native-session version upgrade',
}
try {
  await install('install')
  app = await electron.launch({ executablePath: target, args: [`--user-data-dir=${profile}`], env })
  let page = await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  expect(
    await page.evaluate(() => typeof (window as unknown as { require: unknown }).require),
  ).toBe('undefined')
  const root = await repository()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, root)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' })))
          .conversations.length,
      { timeout: 15000 },
    )
    .toBe(1)
  const s = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' })),
    room = s.conversations[0]
  await page.evaluate(
    async ({ id, settings, nonce }) => {
      await window.agenthub.invoke({
        op: 'send',
        conversationId: id,
        recipients: [],
        content: `CI persisted note ${nonce}`,
      })
      await window.agenthub.invoke({
        op: 'settings.save',
        settings: { ...settings, theme: 'dark' },
      })
    },
    { id: room.id, settings: s.settings, nonce },
  )
  await app.close()
  app = undefined
  await install('install')
  app = await electron.launch({ executablePath: target, args: [`--user-data-dir=${profile}`], env })
  page = await app.firstWindow()
  const data = await page.evaluate(
    (id) => window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId: id }),
    room.id,
  )
  expect(data.messages.some((m) => m.content === `CI persisted note ${nonce}`)).toBe(true)
  const restored = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  expect(restored.settings.theme).toBe('dark')
  expect(restored.tasks).toHaveLength(0)
  await app.close()
  app = undefined
  await install('uninstall')
  Object.assign(report, {
    passed: true,
    installed: true,
    reinstalled: true,
    uninstalled: true,
    historyRestored: true,
    themeRestored: true,
    noReplay: true,
    securePreload: true,
    installerSha256: createHash('sha256')
      .update(await readFile(resolve(`release/${version}/AgentHub Setup ${version}.exe`)))
      .digest('hex'),
  })
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app?.close().catch(() => {})
  await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2))
  await processSupervisor.shutdown()
  await cleanupTestDirectories()
}
