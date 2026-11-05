import { guardIdentity } from './release-identity'
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { repository } from '../tests/helpers'
import type { Snapshot, Message } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const root = resolve('.local/packaged-team')
await mkdir(root, { recursive: true })
const profile = await mkdtemp(join(root, 'profile-'))
const project = await repository()
const env = Object.fromEntries(
  Object.entries(process.env).filter((v): v is [string, string] => typeof v[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(
    process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
  ),
  args: [`--user-data-dir=${profile}`],
  env,
})
try {
  const page = await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await page.getByRole('button', { name: '變更', exact: true }).click()
  await page.getByRole('button', { name: '建立 Git 隔離工作區', exact: true }).click()
  const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  await expect.poll(async () => (await snapshot()).workspaces.length, { timeout: 30000 }).toBe(3)
  const configured = await snapshot()
  await page.evaluate(
    (settings) =>
      window.agenthub.invoke({ op: 'settings.save', settings: { ...settings, autonomy: 'ask' } }),
    configured.settings,
  )
  await page.getByRole('button', { name: 'Close panel' }).click()
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill(
      '@All Reply with exactly OK. Do not use any tools, read or edit files, run commands or delegate.',
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const start = Date.now()
  while (Date.now() - start < 240000) {
    const state = await snapshot()
    if (state.tasks.some((t) => ['failed', 'cancelled'].includes(t.status)))
      throw new Error(state.tasks.map((t) => t.error || '').join('\n'))
    const permit = page
      .locator('.approval')
      .filter({ hasText: /Antigravity scoped workspace access|Codex live web search/ })
      .getByRole('button', { name: '允許一次', exact: true })
    if (await permit.count()) await permit.first().click()
    if (state.tasks.length === 3 && state.tasks.every((t) => t.status === 'completed')) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const state = await snapshot()
  expect(state.tasks.filter((t) => t.status === 'completed')).toHaveLength(3)
  const result = await page.evaluate(
    (id) => window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId: id }),
    state.conversations[0].id,
  )
  for (const provider of ['codex', 'claude', 'antigravity'])
    expect(
      result.messages
        .find((m) => m.senderId === provider && m.delivery === 'completed')
        ?.content.trim(),
    ).toBe('OK')
  await page
    .getByRole('button', { name: 'Close panel' })
    .click()
    .catch(() => {})
  await page.screenshot({ path: join(root, 'three-real-OK.png') })
  await writeFile(
    join(root, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        version,
        packaged: true,
        ...(await guardIdentity()),
        appAsarSha256: createHash('sha256')
          .update(
            await readFile(
              resolve(
                process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
                '..',
                'resources',
                'app.asar',
              ),
            ),
          )
          .digest('hex'),
        profile,
        project,
        tasks: state.tasks,
        messages: result.messages,
        diagnosticsPath: state.diagnosticsPath,
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: actual packaged Electron renderer → IPC → orchestrator → all three official native runtimes → three OK chat replies.',
  )
} finally {
  await app.close()
}
