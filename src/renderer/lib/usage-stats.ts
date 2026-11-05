import type { Task, UsageRecord } from '../../shared/types'

export interface DayBucket {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  tokens: Record<string, number>
  cost: Record<string, number>
  totalTokens: number
  totalCost: number
}
export interface AgentUsage {
  agentId: string
  tokens: number
  inputTokens: number
  outputTokens: number
  /** Sum of provider-reported USD only. */
  cost: number
  records: number
  /** Records the provider sent without a USD figure; never counted as zero spend. */
  unpricedRecords: number
  completed: number
  failed: number
  /** Tokens divided by completed tasks, or undefined when nothing completed. */
  tokensPerCompleted?: number
  costPerCompleted?: number
}
export interface UsageSummary {
  days: DayBucket[]
  agents: AgentUsage[]
  totalTokens: number
  totalCost: number
  pricedRecords: number
  unpricedRecords: number
  completed: number
  failed: number
  /** completed / (completed + failed); undefined when neither happened in range. */
  successRate?: number
}

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Aggregates provider-reported usage into local calendar days. Task outcomes are counted by
 * completion time (falling back to creation) inside the same range, so the success rate and
 * per-completion cost describe the same window as the chart.
 */
export function summarizeUsage(
  usage: UsageRecord[],
  tasks: Task[],
  rangeDays: number,
  now = new Date(),
): UsageSummary {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - rangeDays)
  const days: DayBucket[] = []
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    days.push({ day: dayKey(d), tokens: {}, cost: {}, totalTokens: 0, totalCost: 0 })
  }
  const index = new Map(days.map((d, i) => [d.day, i]))
  const agents = new Map<string, AgentUsage>()
  const agent = (agentId: string) => {
    let row = agents.get(agentId)
    if (!row) {
      row = {
        agentId,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        records: 0,
        unpricedRecords: 0,
        completed: 0,
        failed: 0,
      }
      agents.set(agentId, row)
    }
    return row
  }
  let pricedRecords = 0,
    unpricedRecords = 0
  for (const record of usage) {
    const at = new Date(record.timestamp)
    if (!(at >= start && at < end)) continue
    const bucket = days[index.get(dayKey(at))!]
    if (!bucket) continue
    const tokens = (record.inputTokens || 0) + (record.outputTokens || 0)
    const row = agent(record.agentId)
    row.tokens += tokens
    row.inputTokens += record.inputTokens || 0
    row.outputTokens += record.outputTokens || 0
    row.records++
    bucket.tokens[record.agentId] = (bucket.tokens[record.agentId] || 0) + tokens
    bucket.totalTokens += tokens
    if (typeof record.costUsd === 'number' && Number.isFinite(record.costUsd)) {
      pricedRecords++
      row.cost += record.costUsd
      bucket.cost[record.agentId] = (bucket.cost[record.agentId] || 0) + record.costUsd
      bucket.totalCost += record.costUsd
    } else {
      unpricedRecords++
      row.unpricedRecords++
    }
  }
  let completed = 0,
    failed = 0
  for (const task of tasks) {
    if (task.supersededBy || !['completed', 'failed'].includes(task.status)) continue
    const at = new Date(task.completedAt || task.createdAt)
    if (!(at >= start && at < end)) continue
    const row = agent(task.agentId)
    if (task.status === 'completed') {
      completed++
      row.completed++
    } else {
      failed++
      row.failed++
    }
  }
  for (const row of agents.values()) {
    if (row.completed) {
      row.tokensPerCompleted = row.tokens / row.completed
      // A per-completion USD figure is only honest when every record was priced.
      if (!row.unpricedRecords && row.records) row.costPerCompleted = row.cost / row.completed
    }
  }
  return {
    days,
    agents: [...agents.values()].sort((a, b) => b.tokens - a.tokens),
    totalTokens: days.reduce((s, d) => s + d.totalTokens, 0),
    totalCost: days.reduce((s, d) => s + d.totalCost, 0),
    pricedRecords,
    unpricedRecords,
    completed,
    failed,
    successRate: completed + failed ? completed / (completed + failed) : undefined,
  }
}

export function compactNumber(value: number): string {
  const trim = (s: string) => s.replace(/\.0$/, '')
  if (Math.abs(value) >= 1e6) return `${trim((value / 1e6).toFixed(value >= 1e7 ? 0 : 1))}M`
  if (Math.abs(value) >= 1e4) return `${trim((value / 1e3).toFixed(value >= 1e5 ? 0 : 1))}K`
  return Math.round(value).toLocaleString('en-US')
}
export function usd(value: number): string {
  return value >= 100
    ? `$${value.toFixed(0)}`
    : value >= 0.1
      ? `$${value.toFixed(2)}`
      : `$${value.toFixed(4)}`
}
/** Rounds an axis maximum up to 1, 2 or 5 × 10^n so tick labels stay clean. */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!
  return step * power
}
