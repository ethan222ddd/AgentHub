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
/** Official standalone CLI metadata command. Never infer balance from model token usage. */
export function antigravityQuota(raw: unknown): Quota {
  const r = obj(raw),
    command = obj(r.command),
    data = obj(command.data)
  if (r.status !== 'SUCCESS' || r.num_turns !== 0 || command.name !== 'usage')
    throw new Error('Antigravity did not return a zero-turn official /usage report.')
  const windows: QuotaWindow[] = []
  for (const [groupIndex, value] of (Array.isArray(data.groups) ? data.groups : [])
    .slice(0, 20)
    .entries()) {
    const group = obj(value)
    for (const [index, value] of (Array.isArray(group.buckets) ? group.buckets : [])
      .slice(0, 20)
      .entries()) {
      if (windows.length >= 80) break
      const bucket = obj(value),
        fraction = bucket.remaining_fraction
      windows.push({
        id: `${groupIndex}:${label(bucket.id, String(index))}`,
        label: `${label(group.name, 'Model group')} · ${label(bucket.name, 'Limit')}`,
        remainingPercent:
          typeof fraction === 'number' &&
          Number.isFinite(fraction) &&
          fraction >= 0 &&
          fraction <= 1
            ? Math.round(fraction * 10000) / 100
            : null,
        resetsAt: date(bucket.reset_time),
        ...(typeof bucket.remaining_amount === 'number' &&
        Number.isFinite(bucket.remaining_amount) &&
        bucket.remaining_amount >= 0
          ? { remainingAmount: bucket.remaining_amount }
          : {}),
        ...(typeof bucket.disabled === 'boolean' ? { disabled: bucket.disabled } : {}),
      })
    }
  }
  return {
    provider: 'antigravity',
    source: 'Antigravity CLI /usage',
    status: windows.length ? 'available' : 'unavailable',
    windows,
    checkedAt: new Date().toISOString(),
    detail: windows.length
      ? undefined
      : 'No official quota buckets returned. Verify CLI login and /usage availability.',
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
