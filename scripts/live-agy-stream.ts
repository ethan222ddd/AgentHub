// Actual packaged chat; asserts native text arrives before completion, never routing JSON.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { repository } from '../tests/helpers'
import { guardIdentity } from './release-identity'
import type { AppEvent, Message, Snapshot } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-agy-stream')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await repository()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env }),
  page = await app.firstWindow()
const invoke = <T = unknown>(r: Record<string, unknown>) =>
  page.evaluate((r) => window.agenthub.invoke<T>(r), r)
const state = () => invoke<Snapshot>({ op: 'snapshot' })
const report: Record<string, unknown> = {
  version,
  packaged: true,
  passed: false,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
try {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  const initial = await state(),
    room = initial.conversations[0]
  await invoke({ op: 'project.automation', projectId: room.projectId, enabled: false })
  await invoke({ op: 'workspace.prepare', projectId: room.projectId, initialize: false })
  // Use the installed CLI's default model, as in the native protocol probe.
  // Some models only emit structured final JSON; that is a valid buffered fallback,
  // but cannot serve as proof of incremental public streaming.
  await page.evaluate(() => {
    const target = window as unknown as { publicEvents: AppEvent[] }
    target.publicEvents = []
    window.agenthub.subscribe((e) => {
      if (e.type === 'delta') target.publicEvents.push(e)
    })
  })
  await invoke({
    op: 'send',
    conversationId: room.id,
    recipients: ['antigravity'],
    content:
      'This is a public streaming protocol test in a disposable workspace. Do not read files, access network or delegate. Produce 70 numbered lines, each line PUBLIC_STREAM_<number> followed by a short ordinary sentence about software testing. Write these as a normal public agent_response before finalizing; do not put the public answer solely in a finish tool. The supplied JSON Schema applies to your final result: put the same public lines in message, and requests must be [].',
  })
  let beforeCompletion = false
  await expect
    .poll(
      async () => {
        const s = await state(),
          task = s.tasks[0]
        if (task.status === 'failed') throw new Error(task.error)
        const count = await page.evaluate(
          () =>
            (window as unknown as { publicEvents: AppEvent[] }).publicEvents.filter(
              (e) => e.type === 'delta' && !e.replace && e.delta.length,
            ).length,
        )
        if (count && task.status !== 'completed') beforeCompletion = true
        return task.status
      },
      { timeout: 240000, intervals: [100] },
    )
    .toBe('completed')
  expect(beforeCompletion).toBe(true)
  const events = await page.evaluate(
    () => (window as unknown as { publicEvents: AppEvent[] }).publicEvents,
  )
  const deltas = events.filter(
    (e): e is Extract<AppEvent, { type: 'delta' }> => e.type === 'delta' && !e.replace,
  )
  expect(deltas.length).toBeGreaterThan(1)
  expect(deltas.map((e) => e.delta).join('')).not.toContain('"requests"')
  const data = await invoke<{ messages: Message[] }>({ op: 'messages', conversationId: room.id })
  expect(data.messages.find((m) => m.senderId === 'antigravity')?.content).toContain(
    'PUBLIC_STREAM_70',
  )
  Object.assign(report, {
    passed: true,
    publicDeltaBeforeCompletion: true,
    deltaCount: deltas.length,
    noRawRoutingJson: true,
    authoritativeFinalReplacement: events.some((e) => e.type === 'delta' && e.replace),
  })
  console.log(
    'PASS: genuine native AGY public fragments arrived in the packaged chat before turn completion',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
