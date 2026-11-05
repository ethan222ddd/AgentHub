import { useCallback, useEffect, useRef, useState } from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import type { AgentProfile } from '../../shared/types'
import type { AgentQuota } from '../../shared/quota'

export function QuotaControl({
  agents,
  completedTurns,
  en,
}: {
  agents: AgentProfile[]
  completedTurns: string
  en: boolean
}) {
  const [quotas, setQuotas] = useState<AgentQuota[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const pending = useRef(false),
    mounted = useRef(false),
    root = useRef<HTMLDetailsElement>(null)
  const key = agents.map((a) => `${a.id}:${a.authMode}:${a.enabled}`).join('|')
  const ids = useRef<string[]>([])
  ids.current = agents.filter((a) => a.enabled).map((a) => a.id)
  const read = useCallback(async (refresh = false) => {
    if (pending.current || !ids.current.length) return
    pending.current = true
    setBusy(true)
    const requested = ids.current.join('|')
    try {
      const value = await window.agenthub.invoke<AgentQuota[]>({
        op: 'quotas.read',
        agentIds: ids.current,
        refresh,
      })
      if (mounted.current && ids.current.join('|') === requested) {
        setQuotas(value)
        setError('')
        setNow(Date.now())
      }
    } catch {
      if (mounted.current) setError('額度查詢失敗 / Quota query failed')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now())
      if (document.visibilityState === 'visible' && document.hasFocus()) void read()
    }
    setQuotas([])
    refresh()
    const timer = setInterval(refresh, 45000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [key, read])
  useEffect(() => {
    if (document.visibilityState === 'visible') void read(true)
  }, [completedTurns, read])
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && root.current) root.current.open = false
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && root.current?.open) {
        root.current.open = false
        root.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  const t = (zh: string, eng: string) => (en ? eng : zh)
  const stale = (q: AgentQuota) => q.stale || !!error || now - Date.parse(q.checkedAt) > 90000
  const date = (s: string) =>
    new Date(s).toLocaleString(en ? 'en-US' : 'zh-TW', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  return (
    <details
      className="quota-control"
      ref={root}
      onToggle={(e) => {
        if (e.currentTarget.open) void read()
      }}
    >
      <summary aria-label="Remaining quota">
        <Gauge size={13} />
        <span>{t('剩餘額度', 'Remaining quota')}</span>
        {quotas
          .filter((q) => agents.some((a) => a.id === q.agentId))
          .map((q) => (
            <span
              key={q.agentId}
              title={q.windows[0]?.label}
              className={stale(q) ? 'quota-stale' : ''}
            >
              {agents.find((a) => a.id === q.agentId)?.name}:{' '}
              {q.windows[0]?.remainingPercent != null ? `${q.windows[0].remainingPercent}%` : '—'}
              {stale(q) ? ' *' : ''}
            </span>
          ))}
      </summary>
      <section className="quota-menu" aria-label="Quota details">
        <header>
          <strong>{t('帳號額度', 'Account quota')}</strong>
          <button disabled={busy} onClick={() => void read(true)} aria-label="Refresh quota">
            <RefreshCw size={14} />
            {busy ? t('更新中…', 'Updating…') : t('重新整理', 'Refresh')}
          </button>
        </header>
        <p>
          {t(
            '前景每 45 秒及回合結束時更新。各時段額度分開計算；數據由官方 Runtime 提供。',
            'Refreshes every 45 seconds in the foreground and after turns. Windows are independent; values come from official runtimes.',
          )}
        </p>
        {error && <p role="alert">{error}</p>}
        {!quotas.length && (
          <p>
            {busy
              ? t('正在查詢官方額度…', 'Querying official limits…')
              : t('尚無額度資料', 'No quota data yet')}
          </p>
        )}
        {quotas.map((q) => (
          <article key={q.agentId} data-provider={q.provider}>
            <strong>{agents.find((a) => a.id === q.agentId)?.name || q.provider}</strong>
            {stale(q) && (
              <small className="quota-stale">
                {t('資料已過期／更新失敗', 'Stale / refresh failed')}
              </small>
            )}
            {q.status === 'error' && (
              <small role="alert">
                {t(
                  '查詢失敗，請檢查登入／網路／CLI 版本',
                  'Query failed; check login, network and CLI version',
                )}
              </small>
            )}
            {q.status === 'unavailable' && (
              <small>
                {t(
                  '無法透過此 Runtime 取得剩餘額度',
                  'Remaining quota unavailable in this runtime',
                )}
              </small>
            )}
            {q.ordinaryUsageAllowed === false && (
              <p role="alert">
                {t(
                  '供應商目前不允許一般用量；百分比或重置時間不代表已恢復權限。',
                  'Provider currently disallows ordinary usage; percentages or reset times do not restore permission.',
                )}
              </p>
            )}
            {q.windows.map((w) => (
              <div className="quota-window" key={w.id}>
                <span>{w.label}</span>
                <b>
                  {w.remainingPercent === null
                    ? t('未知', 'Unknown')
                    : `${w.remainingPercent}% ${t('剩餘', 'left')}`}
                </b>
                {w.remainingPercent !== null && (
                  <progress
                    aria-label={`${q.provider} ${w.label} remaining`}
                    value={w.remainingPercent}
                    max={100}
                  />
                )}
                <small>
                  {w.resetsAt
                    ? `${t('重置', 'Resets')} ${date(w.resetsAt)}`
                    : t('未提供重置時間', 'No reset time provided')}
                  {w.resetsAt && Date.parse(w.resetsAt) <= now
                    ? ` · ${t('等待供應商更新', 'Awaiting provider update')}`
                    : ''}
                </small>
              </div>
            ))}
            {q.credits && (
              <small>
                {t('Credits 餘額', 'Credit balance')}:{' '}
                {q.credits.unlimited
                  ? t('無上限', 'Unlimited')
                  : (q.credits.balance ?? t('未知', 'Unknown'))}
              </small>
            )}
            {q.detail && <p>{q.detail}</p>}
            <small>
              {t('更新', 'Updated')} <time dateTime={q.checkedAt}>{date(q.checkedAt)}</time> ·{' '}
              {q.source}
            </small>
          </article>
        ))}
      </section>
    </details>
  )
}
