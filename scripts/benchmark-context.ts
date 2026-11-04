import { performance } from 'node:perf_hooks'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../src/main/database/store'
import { ContextMemory } from '../src/main/orchestrator/context'
const base = resolve('.local/context-benchmark')
await mkdir(base, { recursive: true })
const dir = await mkdtemp(join(base, 'run-')),
  store = new Store(join(dir, 'bench.sqlite'))
const project = store.addProject(dir, 'Generated benchmark'),
  c = store.snapshot().conversations[0]
const start = performance.now()
store.transaction(() => {
  for (let i = 0; i < 5000; i++)
    store.put('messages', {
      id: `generated-${i}`,
      projectId: project.id,
      conversationId: c.id,
      senderId: 'user',
      recipientIds: [],
      type: 'user',
      delivery: 'completed',
      content:
        i === 0
          ? '登入驗證規格，固定基準驗收碼 BENCHMARK_FOUND'
          : `Generated unrelated note ${i}. ` + 'filler '.repeat(50),
      timestamp: '2026-10-31T00:00:00.000Z',
      taskId: null,
      correlationId: 'benchmark',
    })
})
const indexedMs = performance.now() - start,
  latencies: number[] = []
for (let i = 0; i < 30; i++) {
  const t = performance.now()
  const found = new ContextMemory(store.db).find(c.id, '登入驗證規格')
  if (found[0]?.messageId !== 'generated-0') throw new Error('Old source not retrieved')
  latencies.push(performance.now() - t)
}
const t = performance.now(),
  context = store.context(c.id, 0, '登入驗證規格')
const report = {
  messages: 5000,
  indexedMs,
  searchMedianMs: latencies.sort((a, b) => a - b)[15],
  searchMaxMs: Math.max(...latencies),
  contextMs: performance.now() - t,
  contextCharacters: context.characters,
  sourceCount: context.sources.length,
  node: process.version,
}
store.close()
await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
