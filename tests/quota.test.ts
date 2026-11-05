import { expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { codexQuota, claudeQuota, antigravityQuota } from '../src/main/agents/quota'
import { QuotaService } from '../src/main/agents/quota-service'
import { claudeControl } from '../src/main/agents/claude-control'
import { JsonProcess } from '../src/main/agents/process'
import { ClaudeAdapter } from '../src/main/agents/claude'
import type { AgentAdapter } from '../src/main/agents/adapter'
import type { AgentProfile } from '../src/shared/types'
const agent: AgentProfile = {
  id: 'codex',
  name: 'Codex',
  provider: 'codex',
  role: '',
  instructions: '',
  model: '',
  enabled: true,
}
const sample = () =>
  codexQuota({
    ordinaryUsageAllowed: false,
    accountId: 'PRIVATE_ACCOUNT',
    rateLimits: { credits: { balance: '5', unlimited: false } },
    rateLimitsByLimitId: {
      codex: {
        limitName: 'Codex',
        primary: { usedPercent: 23.5, windowDurationMins: 300, resetsAt: 1800000000 },
        secondary: { usedPercent: null, resetsAt: null },
      },
      other: { primary: { usedPercent: 100 } },
    },
  })

it('reads only official AGY zero-turn metadata, dynamic groups and valid remaining fractions', () => {
  const report = {
    status: 'SUCCESS',
    num_turns: 0,
    account: 'PRIVATE_ACCOUNT',
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Runtime group',
            buckets: [
              {
                id: 'weekly',
                name: 'Weekly remaining',
                remaining_fraction: 0.975,
                reset_time: '2026-11-12T00:00:00Z',
              },
              { id: 'other', remaining_fraction: 2, remaining_amount: 12, disabled: true },
            ],
          },
        ],
      },
    },
  }
  const value = antigravityQuota(report)
  expect(value.status).toBe('available')
  expect(value.windows.map((w) => w.remainingPercent)).toEqual([97.5, null])
  expect(value.windows[0].resetsAt).toBe('2026-11-12T00:00:00.000Z')
  expect(value.windows[1]).toMatchObject({ remainingAmount: 12, disabled: true })
  expect(JSON.stringify(value)).not.toContain('PRIVATE_ACCOUNT')
  expect(() => antigravityQuota({ ...report, num_turns: 1 })).toThrow('zero-turn')
  expect(() => antigravityQuota({ ...report, command: { name: 'model' } })).toThrow()
  expect(antigravityQuota({ ...report, command: { name: 'usage', data: {} } }).status).toBe(
    'unavailable',
  )
})

it('normalizes multiple Codex windows without inferring authorization or retaining private fields', () => {
  const q = sample()
  expect(q.windows.map((w) => w.remainingPercent)).toEqual([76.5, null, 0])
  expect(q.windows[0].resetsAt).toBe('2027-01-15T08:00:00.000Z')
  expect(q.ordinaryUsageAllowed).toBe(false)
  expect(q.credits?.balance).toBe('5')
  expect(JSON.stringify(q)).not.toContain('PRIVATE_ACCOUNT')
})
it('never treats unknown or invalid usage as unused quota', () => {
  for (const used of [undefined, null, -1, 101, Infinity, NaN, '1']) {
    expect(
      codexQuota({ rateLimits: { primary: { usedPercent: used, resetsAt: -1 } } }).windows[0],
    ).toMatchObject({ remainingPercent: null, resetsAt: null })
  }
  expect(
    codexQuota({ rateLimits: { primary: { usedPercent: 0 } } }).windows[0].remainingPercent,
  ).toBe(100)
})
it('uses only Claude subscription windows, preserving unknown model limits', () => {
  const q = claudeQuota({
    session: { total_cost_usd: 99 },
    account: 'PRIVATE_ACCOUNT',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 20, resets_at: '2026-11-01T00:00:00Z' },
      seven_day: null,
      model_scoped: [{ display_name: 'Opus', utilization: null }],
    },
  })
  expect(q.windows.map((w) => w.remainingPercent)).toEqual([80, null])
  expect(Object.keys(q).sort()).toEqual([
    'checkedAt',
    'detail',
    'provider',
    'source',
    'status',
    'windows',
  ])
  expect(JSON.stringify(q)).not.toMatch(/PRIVATE_ACCOUNT|total_cost/)
  expect(claudeQuota({ rate_limits_available: false }).status).toBe('unavailable')
})
it('coalesces per-provider reads and throttles force refreshes', async () => {
  let time = Date.now()
  const getQuota = vi.fn(async () => sample())
  const service = new QuotaService(
    new Map([['codex', { getQuota } as unknown as AgentAdapter]]),
    () => time,
  )
  const [a, b] = await Promise.all([service.read(agent), service.read({ ...agent, id: 'second' })])
  expect(getQuota).toHaveBeenCalledTimes(1)
  expect(a.agentId).toBe('codex')
  expect(b.agentId).toBe('second')
  await service.read(agent, true)
  expect(getQuota).toHaveBeenCalledTimes(1)
  time += 5001
  await service.read(agent, true)
  expect(getQuota).toHaveBeenCalledTimes(2)
})
it('retains last successful quota with stale marker on failure and recovers', async () => {
  let time = Date.now()
  const getQuota = vi
    .fn()
    .mockResolvedValueOnce(sample())
    .mockRejectedValueOnce(new Error('PRIVATE_TOKEN'))
    .mockResolvedValue(sample())
  const service = new QuotaService(
    new Map([['codex', { getQuota } as unknown as AgentAdapter]]),
    () => time,
  )
  const first = await service.read(agent)
  time += 46000
  const failed = await service.read(agent)
  expect(failed.stale).toBe(true)
  expect(failed.checkedAt).toBe(first.checkedAt)
  expect(failed.windows).toEqual(first.windows)
  expect(JSON.stringify(failed)).not.toContain('PRIVATE_TOKEN')
  time += 16000
  expect((await service.read(agent)).stale).toBe(false)
})
it('does not expose native subscription quota for Claude API-key mode', async () => {
  const adapter = new ClaudeAdapter(() => 'UNUSED_KEY')
  const value = await adapter.getQuota({ ...agent, provider: 'claude', authMode: 'api' })
  expect(value.status).toBe('unavailable')
  expect(value.windows).toEqual([])
  expect(JSON.stringify(value)).not.toContain('UNUSED_KEY')
})
it('drains pending quota on shutdown without caching late success or accepting new reads', async () => {
  let release!: (value: ReturnType<typeof sample>) => void
  const getQuota = vi.fn(
    () =>
      new Promise<ReturnType<typeof sample>>((resolve) => {
        release = resolve
      }),
  )
  const service = new QuotaService(new Map([['codex', { getQuota } as unknown as AgentAdapter]]))
  const pending = service.read(agent)
  const rejection = expect(pending).rejects.toThrow('shutdown')
  const closing = service.dispose()
  await expect(service.read(agent)).rejects.toThrow('closing')
  release(sample())
  await rejection
  await closing
  expect(getQuota).toHaveBeenCalledTimes(1)
})
it('explicitly marks unsupported headless Antigravity quota', async () => {
  const service = new QuotaService(new Map())
  const value = await service.read({ ...agent, provider: 'antigravity' })
  expect(value.status).toBe('unavailable')
  expect(value.windows).toEqual([])
  expect(value.detail).toContain('/usage')
})
it('queries native Claude usage via correlated control messages without a model turn or transcript scan', async () => {
  const proc = new JsonProcess(
    process.execPath,
    [resolve('tests/fixtures/runtime.mjs'), 'claude-quota'],
    process.cwd(),
  )
  try {
    await claudeControl(proc, { subtype: 'initialize' })
    const raw = await claudeControl(proc, { subtype: 'get_usage', skip_behaviors: true })
    expect(claudeQuota(raw).windows[0].remainingPercent).toBe(75)
  } finally {
    await proc.dispose()
  }
})
