import { describe, expect, it } from 'vitest'
import {
  ARM_MS,
  approvalKeyAction,
  waitedFor,
  type KeyInput,
} from '../src/renderer/lib/approval-keys'
import type { Approval } from '../src/shared/types'

const approval: Approval = {
  id: 'a',
  agentId: 'codex',
  taskId: 't',
  conversationId: 'c',
  tool: 'Bash',
  detail: 'npm test',
  risk: '',
}
const key = (k: string, patch: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  editable: false,
  ...patch,
})
const armed = ARM_MS + 1

describe('approval queue keys', () => {
  it('maps single presses to one decision', () => {
    expect(approvalKeyAction(key('a'), approval, 0, armed)).toBe('allow')
    expect(approvalKeyAction(key('A'), approval, 0, armed)).toBe('allow')
    expect(approvalKeyAction(key('d'), approval, 0, armed)).toBe('deny')
    expect(approvalKeyAction(key('ArrowDown'), approval, 0, armed)).toBe('next')
    expect(approvalKeyAction(key('k'), approval, 0, armed)).toBe('prev')
    expect(approvalKeyAction(key('Escape'), approval, 0, armed)).toBe('close')
  })

  it('refuses to allow a request that only just appeared, but always lets you deny', () => {
    expect(approvalKeyAction(key('a'), approval, 1000, 1000 + ARM_MS - 1)).toBe('not-armed')
    expect(approvalKeyAction(key('d'), approval, 1000, 1001)).toBe('deny')
  })

  it('ignores held keys, modified keys and typing in fields', () => {
    expect(approvalKeyAction(key('a', { repeat: true }), approval, 0, armed)).toBeNull()
    expect(approvalKeyAction(key('a', { ctrlKey: true }), approval, 0, armed)).toBeNull()
    expect(approvalKeyAction(key('d', { editable: true }), approval, 0, armed)).toBeNull()
  })

  it('offers remember only where the host allows remembering', () => {
    expect(approvalKeyAction(key('r'), approval, 0, armed)).toBeNull()
    expect(approvalKeyAction(key('r'), { ...approval, canRemember: true }, 0, armed)).toBe(
      'remember',
    )
    expect(approvalKeyAction(key('a'), undefined, 0, armed)).toBeNull()
  })

  it('describes how long a request has waited', () => {
    const start = Date.parse('2026-11-05T00:00:00Z')
    const waiting = { ...approval, requestedAt: new Date(start).toISOString() }
    expect(waitedFor(waiting, start + 42_000, false)).toBe('42 秒')
    expect(waitedFor(waiting, start + 5 * 60_000, true)).toBe('5 min')
    expect(waitedFor(approval, start, true)).toBe('')
  })
})
