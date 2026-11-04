import type { Quota, QuotaWindow } from '../../shared/quota'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const label = (v: unknown, fallback: string) =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, 120) : fallback
function remaining(used: unknown): number | null {
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100
    ? Math.round((100 - used) * 100) / 100
    : null
}
function date(v: unknown): string | null {
  const ms = typeof v === 'number' ? v * 1000 : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? new Date(ms).toISOString() : null
}
export function codexQuota(raw: unknown): Quota {
  const r = obj(raw),
    windows: QuotaWindow[] = []
  const buckets = Object.entries(obj(r.rateLimitsByLimitId))
  if (!buckets.length) buckets.push(['default', r.rateLimits])
  for (const [id, value] of buckets.slice(0, 40)) {
    const bucket = obj(value)
    for (const period of ['primary', 'secondary']) {
      if (!bucket[period]) continue
      const w = obj(bucket[period])
      const mins = typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null
      windows.push({
        id: `${id}:${period}`,
        label: `${label(bucket.limitName, id)} · ${mins ? `${mins / 60}h` : period}`,
        remainingPercent: remaining(w.usedPercent),
        resetsAt: date(w.resetsAt),
      })
    }
  }
  const credits = obj(obj(r.rateLimits).credits)
  return {
    provider: 'codex',
    source: 'account/rateLimits/read',
    status: windows.length || Object.keys(credits).length ? 'available' : 'unavailable',
    windows,
    checkedAt: new Date().toISOString(),
    ordinaryUsageAllowed:
      typeof r.ordinaryUsageAllowed === 'boolean' ? r.ordinaryUsageAllowed : null,
    ...(Object.keys(credits).length
      ? {
          credits: {
            balance:
              typeof credits.balance === 'string' && /^[\d.,+-]{1,40}$/.test(credits.balance)
                ? credits.balance
                : null,
            unlimited: credits.unlimited === true,
          },
        }
      : {}),
    detail: windows.length
      ? undefined
      : 'No subscription rate-limit windows returned by this runtime/account.',
  }
}
export function claudeQuota(raw: unknown): Quota {
  const r = obj(raw),
    limits = obj(r.rate_limits),
    windows: QuotaWindow[] = []
  if (r.rate_limits_available === true) {
    for (const key of [
      'five_hour',
      'seven_day',
      'seven_day_oauth_apps',
      'seven_day_opus',
      'seven_day_sonnet',
    ]) {
      if (!limits[key]) continue
      const w = obj(limits[key])
      windows.push({
        id: key,
        label: key.replaceAll('_', ' '),
        remainingPercent: remaining(w.utilization),
        resetsAt: date(w.resets_at),
      })
    }
    if (Array.isArray(limits.model_scoped))
      for (const [i, value] of limits.model_scoped.slice(0, 40).entries()) {
        const w = obj(value)
        windows.push({
          id: `model:${i}`,
          label: label(w.display_name, `Model ${i + 1}`),
          remainingPercent: remaining(w.utilization),
          resetsAt: date(w.resets_at),
        })
      }
  }
  return {
    provider: 'claude',
    source: 'Claude Code control/get_usage',
    status: windows.length ? 'available' : 'unavailable',
    windows,
    checkedAt: new Date().toISOString(),
    detail: windows.length
      ? undefined
      : 'Subscription limits unavailable. API accounts and accounts without usage scope do not expose a remaining balance here.',
  }
}
