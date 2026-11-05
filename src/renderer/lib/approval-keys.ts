import type { Approval } from '../../shared/types'

/**
 * After the queue shows a new request, allowing it by keyboard waits this long. A quick double
 * press therefore cannot approve a second request the user has not had a chance to read.
 * Deny has no delay: refusing is always safe.
 */
export const ARM_MS = 600

export type ApprovalKeyAction =
  'next' | 'prev' | 'allow' | 'deny' | 'remember' | 'close' | 'not-armed' | null

export interface KeyInput {
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** Typing in a field never triggers approval shortcuts. */
  editable: boolean
}

export function approvalKeyAction(
  input: KeyInput,
  current: Approval | undefined,
  shownAt: number,
  now: number,
): ApprovalKeyAction {
  if (input.key === 'Escape') return 'close'
  // Held keys auto-repeat; one physical press must map to at most one decision.
  if (input.repeat || input.ctrlKey || input.metaKey || input.altKey || input.editable) return null
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  if (key === 'ArrowDown' || key === 'j') return 'next'
  if (key === 'ArrowUp' || key === 'k') return 'prev'
  if (!current) return null
  if (key === 'd') return 'deny'
  if (key === 'a' || key === 'r') {
    if (key === 'r' && !current.canRemember) return null
    if (now - shownAt < ARM_MS) return 'not-armed'
    return key === 'a' ? 'allow' : 'remember'
  }
  return null
}

export function waitedFor(approval: Approval, now: number, en: boolean): string {
  if (!approval.requestedAt) return ''
  const seconds = Math.max(0, Math.round((now - Date.parse(approval.requestedAt)) / 1000))
  if (seconds < 60) return en ? `${seconds}s` : `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return en ? `${minutes} min` : `${minutes} 分鐘`
  return en ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 60)} 小時`
}
