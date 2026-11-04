import { describe, it, expect } from 'vitest'
import { isTaskActive, latestAttempt, taskStatusLabel } from '../src/shared/tasks'
import type { Task } from '../src/shared/types'
const task = (id: string, extra: Partial<Task> = {}) =>
  ({ id, conversationId: 'room', status: 'failed', ...extra }) as Task
describe('Attempt references', () => {
  it('follows explicit retry chains and rejects cycles and foreign-room references', () => {
    const a = task('a', { supersededBy: 'b' }),
      b = task('b', { retryOf: 'a', supersededBy: 'c' }),
      c = task('c', { retryOf: 'b', status: 'completed' })
    const map = new Map([a, b, c].map((t) => [t.id, t]))
    expect(latestAttempt(a, map)).toBe(c)
    map.set('c', { ...c, conversationId: 'foreign' })
    expect(latestAttempt(a, map)).toBeUndefined()
    map.set('c', { ...c, supersededBy: 'b' })
    map.set('b', { ...b, retryOf: 'c' })
    expect(latestAttempt(map.get('c')!, map)).toBeUndefined()
  })
  it('keeps approval work active while interrupted work requires manual review', () => {
    expect(isTaskActive(task('a', { status: 'waiting_user', waitReason: 'approval' }))).toBe(true)
    expect(isTaskActive(task('b', { status: 'waiting_user', waitReason: 'recovery' }))).toBe(false)
    expect(isTaskActive(task('c', { status: 'pending', supersededBy: 'next' }))).toBe(false)
    expect(taskStatusLabel(task('d', { failureKind: 'timeout' }), true)).toBe('Timed out')
  })
})
