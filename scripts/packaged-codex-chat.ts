import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repository } from '../tests/helpers'
import type { Snapshot, Message } from '../src/shared/types'
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
  version: string
}

const baseline = process.env.AGENTHUB_DEBUG_BASELINE === '1'
const root = resolve('.local/codex-debug')
await mkdir(root, { recursive: true })
const profile = await mkdtemp(join(root, baseline ? 'baseline-profile-' : 'fixed-profile-'))
const project = await repository()
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
// Emulate an npm-only Windows install: deliberately exclude the Codex Desktop bin.
const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
env.PATH = [
  join(process.env.APPDATA!, 'npm'),
  dirname(git),
  join(process.env.SystemRoot!, 'System32'),
  process.env.SystemRoot!,
].join(';')
const app = await electron.launch({
  executablePath: resolve(
    process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
  ),
  args: [`--user-data-dir=${profile}`],
  env,
})
const report: Record<string, unknown> = { baseline, profile, project, packaged: true }
try {
  const page = await app.firstWindow()
  report.packaged = await app.evaluate(({ app }) => app.isPackaged)
  expect(report.packaged).toBe(true)
  await expect(page.getByRole('button', { name: '選擇專案資料夾' })).toBeVisible()
  report.environment = await app.evaluate(() => ({
    cwd: process.cwd(),
    pathEntries: (process.env.Path || process.env.PATH || '').split(';'),
  }))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  await expect.poll(async () => (await snapshot()).projects.length).toBe(1)
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('@Codex Reply with exactly OK. Do not use tools or modify files.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await snapshot()).tasks.at(-1)?.status).toBe('failed')
  report.preflightError = (await snapshot()).tasks.at(-1)?.error
  report.preflightVisible =
    (await page.getByTestId('message').filter({ hasText: 'WORKSPACE_NOT_READY' }).count()) > 0
  if (baseline) {
    report.detection = await page.evaluate(() => window.agenthub.invoke({ op: 'agents.detect' }))
    await page.screenshot({ path: join(root, 'baseline-packaged.png') })
  } else {
    expect(report.preflightVisible).toBe(true)
    await page.getByRole('button', { name: '設定隔離工作區' }).click()
    await page.getByRole('button', { name: '建立 Git 隔離工作區', exact: true }).click()
    await expect.poll(async () => (await snapshot()).workspaces.length, { timeout: 30000 }).toBe(3)
    await page.getByRole('button', { name: 'Close panel' }).click()
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(
        '@Codex Reply with exactly OK. Do not use tools, read files, modify files, or delegate.',
      )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(async () => (await snapshot()).tasks.at(-1)?.status, {
        timeout: 180000,
        intervals: [500, 1000, 2000],
      })
      .toBe('completed')
    const state = await snapshot()
    const result = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId: id }),
      state.conversations[0].id,
    )
    const answer = result.messages
      .filter((m) => m.senderId === 'codex' && m.delivery === 'completed')
      .at(-1)
    expect(answer?.content.trim()).toBe('OK')
    await expect(page.getByTestId('message').last()).toContainText('OK')
    report.answer = answer?.content
    report.task = { id: state.tasks.at(-1)?.id, status: state.tasks.at(-1)?.status }
    const log = await readFile(state.diagnosticsPath!, 'utf8')
    const events = log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events.some((e) => e.event === 'runtime.resolved' && e.source === 'npm-native')).toBe(
      true,
    )
    for (const method of ['initialize', 'thread/start', 'turn/start'])
      expect(
        events.some((e) => e.event === 'rpc.response' && e.method === method && e.status === 'ok'),
      ).toBe(true)
    expect(events.some((e) => e.method === 'item/agentMessage/delta')).toBe(true)
    expect(events.some((e) => e.method === 'turn/completed' && e.status === 'completed')).toBe(true)
    report.nativeExecutable = events.find((e) => e.event === 'runtime.resolved')?.executable
    report.rpcStagesVerified = [
      'initialize',
      'thread/start',
      'turn/start',
      'item/agentMessage/delta',
      'turn/completed',
    ]
    report.logPath = state.diagnosticsPath
    await page.screenshot({ path: join(root, 'fixed-packaged-OK.png') })
  }
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(
    join(root, baseline ? 'baseline-packaged-report.json' : 'fixed-packaged-report.json'),
    JSON.stringify(report, null, 2),
  )
}
console.log(JSON.stringify(report, null, 2))
