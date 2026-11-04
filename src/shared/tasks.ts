import type { Task } from './types'

export const queuedStatuses = ['pending', 'waiting_agent', 'blocked']
export function isTaskActive(task: Task): boolean {
  return (
    !task.supersededBy &&
    (['pending', 'waiting_agent', 'running', 'reviewing'].includes(task.status) ||
      (task.status === 'waiting_user' && task.waitReason === 'approval'))
  )
}
// Follow only same-room attempts; malformed/cyclic restored records must never start work.
export function latestAttempt(task: Task, tasks: Map<string, Task>): Task | undefined {
  const seen = new Set<string>()
  let current = task
  while (current.supersededBy) {
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    const next = tasks.get(current.supersededBy)
    if (!next || next.conversationId !== task.conversationId || next.retryOf !== current.id)
      return undefined
    current = next
  }
  return current
}
export function taskStatusLabel(task: Task, en = false): string {
  if (task.supersededBy) return en ? 'Replaced by a new attempt' : '已由新嘗試取代'
  const labels: Record<Task['status'], [string, string]> = {
    pending: ['排程中', 'Queued'],
    running: ['執行中', 'Running'],
    waiting_agent: [
      task.waitReason === 'workspace_lock' ? '等待工作區' : '等待依賴任務',
      task.waitReason === 'workspace_lock' ? 'Waiting for workspace' : 'Waiting for dependencies',
    ],
    waiting_user: [
      task.waitReason === 'approval'
        ? '等待批准'
        : task.waitReason === 'integration'
          ? '主要專案整合需處理'
          : '需要檢查後恢復',
      task.waitReason === 'approval'
        ? 'Waiting for approval'
        : task.waitReason === 'integration'
          ? 'Integration needs attention'
          : 'Recovery review required',
    ],
    blocked: ['依賴受阻', 'Blocked by dependencies'],
    reviewing: ['審查中', 'Reviewing'],
    completed: ['已完成', 'Completed'],
    failed: [
      task.failureKind === 'timeout' ? '執行逾時' : '失敗',
      task.failureKind === 'timeout' ? 'Timed out' : 'Failed',
    ],
    cancelled: ['已取消', 'Cancelled'],
    paused: ['已暫停', 'Paused'],
  }
  return labels[task.status]?.[en ? 1 : 0] || task.status
}
