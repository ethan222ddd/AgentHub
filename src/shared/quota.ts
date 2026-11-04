import type { Provider } from './types'

export interface QuotaWindow {
  id: string
  label: string
  remainingPercent: number | null
  resetsAt: string | null
  remainingAmount?: number
  disabled?: boolean
}
// Only normalized public limits leave Main. No account IDs, credentials or raw responses.
export interface Quota {
  provider: Provider
  status: 'available' | 'unavailable' | 'error'
  source: string
  windows: QuotaWindow[]
  checkedAt: string
  ordinaryUsageAllowed?: boolean | null
  credits?: { balance: string | null; unlimited: boolean }
  detail?: string
}
export interface AgentQuota extends Quota {
  agentId: string
  stale?: boolean
  lastAttemptAt?: string
}
