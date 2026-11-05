import { describe, expect, it } from 'vitest'
import { compactNumber, niceMax, summarizeUsage, usd } from '../src/renderer/lib/usage-stats'
import type { Task, UsageRecord } from '../src/shared/types'

const now = new Date(2026, 10, 5, 15, 0)
const at = (daysAgo: number, hour = 10) => new Date(2026, 10, 5 - daysAgo, hour).toISOString()
const record = (id: string, patch: Partial<UsageRecord>): UsageRecord => ({
  id,
  taskId: 't',
  conversationId: 'c',
  agentId: 'codex',
  inputTokens: 0,
  outputTokens: 0,
  source: 'test',
  timestamp: at(0),
  ...patch,
})
const task = (id: string, patch: Partial<Task>): Task => ({
  id,
  projectId: 'p',
  conversationId: 'c',
  name: id,
  description: '',
  agentId: 'codex',
  status: 'completed',
  dependencies: [],
  createdAt: at(0),
  correlationId: 'x',
  depth: 0,
  ...patch,
})

describe('usage trends', () => {
  it('buckets by local day inside the range and ignores older records', () => {
    const summary = summarizeUsage(
      [
        record('a', { inputTokens: 800, outputTokens: 200, costUsd: 0.01, timestamp: at(0) }),
        record('b', { inputTokens: 500, agentId: 'claude', costUsd: 0.02, timestamp: at(2) }),
        record('old', { inputTokens: 99999, timestamp: at(7) }),
      ],
      [],
      7,
      now,
    )
    expect(summary.days).toHaveLength(7)
    expect(summary.days.at(-1)).toMatchObject({ day: '2026-11-05', totalTokens: 1000 })
    expect(summary.days.at(-3)?.tokens.claude).toBe(500)
    expect(summary.totalTokens).toBe(1500)
    expect(summary.totalCost).toBeCloseTo(0.03)
  })

  it('never treats a missing provider price as zero spend', () => {
    const summary = summarizeUsage(
      [
        record('priced', { inputTokens: 100, costUsd: 0.5 }),
        record('unpriced', { inputTokens: 300 }),
      ],
      [task('done', {})],
      7,
      now,
    )
    expect(summary.pricedRecords).toBe(1)
    expect(summary.unpricedRecords).toBe(1)
    const codex = summary.agents.find((a) => a.agentId === 'codex')!
    expect(codex.tokensPerCompleted).toBe(400)
    // With one record unpriced, a per-completion USD figure would understate spend.
    expect(codex.costPerCompleted).toBeUndefined()
  })

  it('counts outcomes in the same window and skips replaced attempts', () => {
    const summary = summarizeUsage(
      [],
      [
        task('ok', { completedAt: at(1) }),
        task('bad', { status: 'failed', completedAt: at(1) }),
        task('replaced', { status: 'failed', supersededBy: 'ok' }),
        task('ancient', { completedAt: at(40) }),
        task('running', { status: 'running' }),
      ],
      14,
      now,
    )
    expect(summary.completed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.successRate).toBe(0.5)
  })

  it('formats axis and figure values cleanly', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(137000)).toBe(200000)
    expect(niceMax(4800)).toBe(5000)
    expect(compactNumber(1234)).toBe('1,234')
    expect(compactNumber(48200)).toBe('48.2K')
    expect(compactNumber(20000)).toBe('20K')
    expect(compactNumber(1_250_000)).toBe('1.3M')
    expect(usd(0.0042)).toBe('$0.0042')
    expect(usd(0.82)).toBe('$0.82')
    expect(usd(342.4)).toBe('$342')
  })
})
