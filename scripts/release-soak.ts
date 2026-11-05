// Real packaged Electron/SQLite load test. Generated user notes; no model/tool emulation.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Store } from '../src/main/database/store'
import { directory, cleanupTestDirectories } from '../tests/helpers'
import { guardIdentity } from './release-identity'
import { processSupervisor } from '../src/main/agents/process-owner'
import type { AgentProfile, Message, Snapshot } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/release-soak')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-'))
const db = new Store(join(profile, 'agenthub.sqlite'))
const p = db.addProject(await directory('soak-project-'), 'Generated soak fixture')
db.put('projects', { ...p, autoManaged: false })
for (const a of db.list<AgentProfile>('agents')) db.put('agents', { ...a, enabled: false })
const room = db.snapshot().conversations[0],
  nonce = randomUUID()
for (let i = 0; i < 4000; i++)
  db.put('messages', {
    id: `fixture-${i}`,
    projectId: p.id,
    conversationId: room.id,
    senderId: 'user',
    recipientIds: [],
    content: i === 0 ? `EARLIEST_${nonce}` : `Generated history ${i}`,
    type: 'user',
    timestamp: new Date().toISOString(),
    taskId: null,
    correlationId: 'soak',
    delivery: 'completed',
  } satisfies Message)
db.close()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
const report: Record<string, unknown> = {
  version,
  passed: false,
  packaged: true,
  noModelTurns: true,
  profile,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
}
const duration = Number(process.env.AGENTHUB_SOAK_MS || 120000)
if (!Number.isSafeInteger(duration) || duration < 60000 || duration > 3600000)
  throw new Error('Soak duration must be 60s–1h')
let page = await app.firstWindow()
const invoke = <T = unknown>(request: Record<string, unknown>) =>
  page.evaluate((request) => window.agenthub.invoke<T>(request), request)
try {
  await expect(page.locator('.message').last()).toContainText('Generated history 3999')
  const initial = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, memoryKB: m.memory.workingSetSize })),
  )
  const latencies: number[] = [],
    start = Date.now()
  let notes = 0
  while (Date.now() - start < duration) {
    const t = Date.now()
    await invoke({
      op: 'send',
      conversationId: room.id,
      recipients: [],
      content: `SOAK_${nonce}_${notes++} ${'payload '.repeat(64)}`,
    })
    await invoke({ op: 'snapshot' })
    latencies.push(Date.now() - t)
    if (notes % 40 === 0)
      console.log(`Soak: ${Math.round((Date.now() - start) / 1000)}s, ${notes} persistent notes`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const found = await invoke<{ messages: Message[] }>({
    op: 'messages',
    conversationId: room.id,
    search: `EARLIEST_${nonce}`,
  })
  expect(found.messages.some((m) => m.content === `EARLIEST_${nonce}`)).toBe(true)
  expect((await invoke<Snapshot>({ op: 'snapshot' })).tasks).toHaveLength(0)
  expect(await page.locator('.message').count()).toBeLessThan(80)
  const final = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, memoryKB: m.memory.workingSetSize })),
  )
  const sorted = latencies.toSorted((a, b) => a - b),
    p95 = sorted[Math.floor(sorted.length * 0.95)]
  expect(p95).toBeLessThan(2000)
  await page.screenshot({ path: join(base, 'soak.png') })
  await app.close()
  const restored = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    env,
  })
  try {
    page = await restored.firstWindow()
    const history = await invoke<{ messages: Message[] }>({
      op: 'messages',
      conversationId: room.id,
      search: `SOAK_${nonce}`,
    })
    expect(history.messages.length).toBeGreaterThan(0)
    expect((await invoke<Snapshot>({ op: 'snapshot' })).tasks).toHaveLength(0)
  } finally {
    await restored.close()
  }
  Object.assign(report, {
    passed: true,
    durationMs: Date.now() - start,
    initialHistory: 4000,
    notes,
    p95IpcRoundtripMs: p95,
    initialMetrics: initial,
    finalMetrics: final,
    historyRestored: true,
    noReplay: true,
  })
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close().catch(() => {})
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
  await processSupervisor.shutdown()
  await cleanupTestDirectories()
}
