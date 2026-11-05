import { Table2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProfile, Conversation, Task, UsageRecord } from '../../../shared/types'
import { seriesSlot } from '../../lib/series'
import { compactNumber, niceMax, summarizeUsage, usd, type DayBucket } from '../../lib/usage-stats'

type Scope = 'room' | 'project' | 'all'
type Metric = 'tokens' | 'cost'
interface Props {
  usage: UsageRecord[]
  tasks: Task[]
  conversations: Conversation[]
  allAgents: AgentProfile[]
  conversationId: string
  projectId: string
  en: boolean
}
const ranges = [7, 14, 30, 90]
const CHART_H = 188,
  AXIS_W = 44,
  BOTTOM = 22,
  TOP = 8

// Callback ref: the chart element mounts and unmounts as the table view and empty state toggle.
function useWidth<T extends HTMLElement>() {
  const observer = useRef<ResizeObserver>(undefined)
  const [width, setWidth] = useState(520)
  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect()
    if (!element) return
    observer.current = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.floor(entry.contentRect.width))),
    )
    observer.current.observe(element)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  return [ref, width] as const
}
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null
    return value && allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Per-viewer preference only.
  }
}

export function UsageTrends({
  usage,
  tasks,
  conversations,
  allAgents,
  conversationId,
  projectId,
  en,
}: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const [range, setRange] = useState(() =>
    Number(stored('agenthub.usageRange', ['7', '14', '30', '90'], '14')),
  )
  const [scope, setScope] = useState<Scope>(() =>
    stored('agenthub.usageScope', ['room', 'project', 'all'] as const, 'project'),
  )
  const [metric, setMetric] = useState<Metric>('tokens')
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number>()
  const [chartRef, width] = useWidth<HTMLDivElement>()
  const inScope = useMemo(() => {
    const roomIds = new Set(
      scope === 'room'
        ? [conversationId]
        : conversations
            .filter((c) => scope === 'all' || c.projectId === projectId)
            .map((c) => c.id),
    )
    return {
      usage: usage.filter((u) => roomIds.has(u.conversationId)),
      tasks: tasks.filter((t) => roomIds.has(t.conversationId)),
    }
  }, [scope, usage, tasks, conversations, conversationId, projectId])
  const summary = useMemo(
    () => summarizeUsage(inScope.usage, inScope.tasks, range),
    [inScope, range],
  )
  const name = (id: string) => allAgents.find((a) => a.id === id)?.name || id
  // Legend and stack order follow the profile list so an agent keeps its place and color.
  const series = useMemo(() => {
    const present = new Set(summary.agents.filter((a) => a.records).map((a) => a.agentId))
    const ordered = allAgents.filter((a) => present.has(a.id)).map((a) => a.id)
    return [...ordered, ...[...present].filter((id) => !ordered.includes(id))]
  }, [summary, allAgents])
  const value = (day: DayBucket, id: string) =>
    metric === 'tokens' ? day.tokens[id] || 0 : day.cost[id] || 0
  const total = (day: DayBucket) => (metric === 'tokens' ? day.totalTokens : day.totalCost)
  const max = niceMax(Math.max(0, ...summary.days.map(total)))
  const format = (v: number) => (metric === 'tokens' ? compactNumber(v) : usd(v))
  const plotW = width - AXIS_W,
    plotH = CHART_H - TOP - BOTTOM
  const band = plotW / summary.days.length
  const barW = Math.max(2, Math.min(24, band * 0.62))
  const labelEvery = Math.ceil(summary.days.length / 6)
  const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`
  const hovered = hover === undefined ? undefined : summary.days[hover]
  const noData = !summary.totalTokens && !summary.pricedRecords

  return (
    <div className="usage-trends">
      <div className="task-map-toolbar">
        <div className="segmented" role="group" aria-label={text('期間', 'Range')}>
          {ranges.map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => {
                setRange(r)
                remember('agenthub.usageRange', String(r))
              }}
            >
              {text(`${r} 天`, `${r}d`)}
            </button>
          ))}
        </div>
        <select
          aria-label={text('統計範圍', 'Scope')}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as Scope)
            remember('agenthub.usageScope', e.target.value)
          }}
        >
          <option value="room">{text('這個聊天室', 'This conversation')}</option>
          <option value="project">{text('這個專案', 'This project')}</option>
          <option value="all">{text('所有專案', 'All projects')}</option>
        </select>
      </div>
      <dl className="stat-tiles">
        <div>
          <dt>{text('已回報 Token', 'Reported tokens')}</dt>
          <dd>{compactNumber(summary.totalTokens)}</dd>
        </div>
        <div>
          <dt>{text('已回報花費', 'Reported spend')}</dt>
          <dd>{summary.pricedRecords ? usd(summary.totalCost) : '—'}</dd>
          {!!summary.unpricedRecords && (
            <small>
              {text(
                `另有 ${summary.unpricedRecords} 筆未附金額`,
                `${summary.unpricedRecords} records had no price`,
              )}
            </small>
          )}
        </div>
        <div>
          <dt>{text('完成任務', 'Tasks completed')}</dt>
          <dd>{summary.completed}</dd>
          {summary.successRate !== undefined && (
            <small>
              {text('成功率', 'Success rate')} {Math.round(summary.successRate * 100)}%
              {summary.failed ? text(`，失敗 ${summary.failed}`, `, ${summary.failed} failed`) : ''}
            </small>
          )}
        </div>
        <div>
          <dt>{text('每次完成平均 Token', 'Tokens per completed task')}</dt>
          <dd>
            {summary.completed ? compactNumber(summary.totalTokens / summary.completed) : '—'}
          </dd>
        </div>
      </dl>
      <section className="usage-chart-card">
        <header>
          <div>
            <h5>
              {metric === 'tokens'
                ? text('每日 Token 用量', 'Daily token usage')
                : text('每日已回報花費（USD）', 'Daily reported spend (USD)')}
            </h5>
            {metric === 'cost' && !!summary.unpricedRecords && (
              <p className="muted">
                {text(
                  '只計入供應商有附金額的紀錄，沒有金額的不當作零。',
                  'Only records with a provider price are summed; missing prices are not treated as zero.',
                )}
              </p>
            )}
          </div>
          <div className="segmented" role="group" aria-label={text('指標', 'Metric')}>
            <button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>
              Token
            </button>
            <button aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>
              USD
            </button>
          </div>
          <button
            className={`icon-toggle ${table ? 'on' : ''}`}
            aria-pressed={table}
            aria-label={text('表格檢視', 'Table view')}
            title={text('表格檢視', 'Table view')}
            onClick={() => setTable(!table)}
          >
            <Table2 size={14} />
          </button>
        </header>
        {series.length > 1 && (
          <ul className="chart-legend">
            {series.map((id) => (
              <li key={id}>
                <i className="agent-swatch" data-slot={seriesSlot(id, allAgents)} />
                {name(id)}
              </li>
            ))}
          </ul>
        )}
        {noData ? (
          <p className="panel-empty">
            {text(
              '這段期間還沒有供應商回報的用量。代理完成回合後，用量會出現在這裡。',
              'No provider-reported usage in this range yet. It appears here after agents finish turns.',
            )}
          </p>
        ) : table ? (
          <div className="usage-table-scroll">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{text('日期', 'Day')}</th>
                  {series.map((id) => (
                    <th key={id}>{name(id)}</th>
                  ))}
                  <th>{text('合計', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.days
                  .filter((d) => d.totalTokens || d.totalCost)
                  .reverse()
                  .map((d) => (
                    <tr key={d.day}>
                      <td>{dayLabel(d.day)}</td>
                      {series.map((id) => (
                        <td key={id}>{value(d, id) ? format(value(d, id)) : '—'}</td>
                      ))}
                      <td>{format(total(d))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="usage-chart" ref={chartRef} onMouseLeave={() => setHover(undefined)}>
            <svg
              width={width}
              height={CHART_H}
              role="img"
              aria-label={text('每日用量長條圖', 'Daily usage column chart')}
            >
              {[0, 0.5, 1].map((f) => {
                const y = TOP + plotH * (1 - f)
                return (
                  <g key={f}>
                    <line
                      x1={AXIS_W}
                      x2={width}
                      y1={y}
                      y2={y}
                      className={f ? 'grid' : 'baseline'}
                    />
                    <text x={AXIS_W - 8} y={y + 4} className="tick" textAnchor="end">
                      {format(max * f)}
                    </text>
                  </g>
                )
              })}
              {summary.days.map((day, i) => {
                const x = AXIS_W + i * band + (band - barW) / 2
                let y = TOP + plotH
                const segments = series
                  .map((id) => ({ id, v: value(day, id) }))
                  .filter((s) => s.v > 0)
                return (
                  <g key={day.day}>
                    {segments.map((s, k) => {
                      const h = (s.v / max) * plotH
                      y -= h
                      const top = k === segments.length - 1
                      // 2px surface gap between stacked segments; only the top end is rounded.
                      const drawn = Math.max(1, h - (k ? 2 : 0))
                      const r = top ? Math.min(4, barW / 2, drawn) : 0
                      const y0 = y,
                        y1 = y + drawn
                      return (
                        <path
                          key={s.id}
                          className={`bar ${hover !== undefined && hover !== i ? 'faded' : ''}`}
                          data-slot={seriesSlot(s.id, allAgents)}
                          d={`M${x} ${y1} V${y0 + r} Q${x} ${y0} ${x + r} ${y0} H${x + barW - r} Q${x + barW} ${y0} ${x + barW} ${y0 + r} V${y1} Z`}
                        />
                      )
                    })}
                    {(i % labelEvery === 0 || i === summary.days.length - 1) && (
                      <text x={x + barW / 2} y={CHART_H - 6} className="tick" textAnchor="middle">
                        {dayLabel(day.day)}
                      </text>
                    )}
                    <rect
                      x={AXIS_W + i * band}
                      y={TOP}
                      width={band}
                      height={plotH}
                      className="hit"
                      onMouseEnter={() => setHover(i)}
                    />
                  </g>
                )
              })}
            </svg>
            {hovered && (
              <div
                className="chart-tooltip"
                style={{
                  left: Math.min(width - 190, Math.max(0, AXIS_W + hover! * band + band / 2 - 90)),
                }}
              >
                <strong>{hovered.day}</strong>
                {series
                  .filter((id) => value(hovered, id))
                  .map((id) => (
                    <span key={id}>
                      <i className="agent-swatch" data-slot={seriesSlot(id, allAgents)} />
                      {name(id)}
                      <b>{format(value(hovered, id))}</b>
                    </span>
                  ))}
                <span className="tooltip-total">
                  {text('合計', 'Total')}
                  <b>{format(total(hovered))}</b>
                </span>
              </div>
            )}
          </div>
        )}
      </section>
      {!!summary.agents.length && (
        <section className="agent-efficiency">
          <h5>{text('各代理效率', 'Per-agent efficiency')}</h5>
          <div className="usage-table-scroll">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{text('代理', 'Agent')}</th>
                  <th>Token</th>
                  <th>USD</th>
                  <th>{text('完成／失敗', 'Done / failed')}</th>
                  <th>{text('每次完成 Token', 'Tokens / done')}</th>
                  <th>{text('每次完成 USD', 'USD / done')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.agents.map((row) => (
                  <tr key={row.agentId}>
                    <td>
                      <i className="agent-swatch" data-slot={seriesSlot(row.agentId, allAgents)} />
                      {name(row.agentId)}
                    </td>
                    <td>{compactNumber(row.tokens)}</td>
                    <td
                      title={
                        row.unpricedRecords
                          ? text('部分紀錄沒有金額', 'Some records were unpriced')
                          : undefined
                      }
                    >
                      {row.records - row.unpricedRecords ? usd(row.cost) : '—'}
                      {!!row.unpricedRecords && row.records - row.unpricedRecords > 0 && '*'}
                    </td>
                    <td>
                      {row.completed} / {row.failed}
                    </td>
                    <td>{row.tokensPerCompleted ? compactNumber(row.tokensPerCompleted) : '—'}</td>
                    <td>{row.costPerCompleted !== undefined ? usd(row.costPerCompleted) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {text(
              '數字只來自供應商回報。* 表示部分紀錄沒有金額；任何紀錄缺金額時，不計算每次完成 USD。',
              'Figures come only from provider reports. * means some records were unpriced; USD per completed task is omitted whenever any record lacks a price.',
            )}
          </p>
        </section>
      )}
    </div>
  )
}
