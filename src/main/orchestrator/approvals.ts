import { randomUUID } from 'node:crypto'
import type { AppEvent, Approval, Task, Workspace } from '../../shared/types'
import { Store } from '../database/store'
import { redact } from '../permissions/paths'

interface ApprovalEvents {
  isClosing(): boolean
  isRunning(taskId: string): boolean
  publish(event: AppEvent): void
  changed(): void
}
export class ApprovalQueue {
  private approvals = new Map<string, { approval: Approval; resolve: (allow: boolean) => void }>()
  constructor(
    private store: Store,
    private events: ApprovalEvents,
  ) {}
  request(
    task: Task,
    tool: string,
    detail: string,
    signal: AbortSignal,
    risk = 'Review this operation before granting permission.',
  ): Promise<boolean> {
    if (signal.aborted || this.events.isClosing()) return Promise.resolve(false)
    const workspace = this.store.get<Workspace>(
      'workspaces',
      task.workspaceId || `${task.projectId}:${task.agentId}`,
    )
    const canRemember = !!workspace && ['Read', 'Glob', 'Grep'].includes(tool)
    const permissionId = `${task.projectId}:${task.agentId}:${tool}:${workspace?.path}`
    if (canRemember && this.store.get('permissions', permissionId)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const id = randomUUID()
      const onAbort = () => this.resolve(id, false)
      this.approvals.set(id, {
        approval: {
          id,
          agentId: task.agentId,
          taskId: task.id,
          conversationId: task.conversationId,
          tool,
          detail: redact(detail).slice(0, 16000),
          risk,
          canRemember,
          requestedAt: new Date().toISOString(),
        },
        resolve: (allow) => {
          signal.removeEventListener('abort', onAbort)
          resolve(allow)
        },
      })
      signal.addEventListener('abort', onAbort, { once: true })
      const current = this.store.require<Task>('tasks', task.id)
      this.store.put('tasks', { ...current, status: 'waiting_user', waitReason: 'approval' })
      this.publishApprovals()
      this.events.changed()
    })
  }
  resolve(id: string, allow: boolean, remember = false): void {
    const entry = this.approvals.get(id)
    if (!entry) return
    if (allow && remember && entry.approval.canRemember) {
      const task = this.store.require<Task>('tasks', entry.approval.taskId)
      const workspace = this.store.require<Workspace>(
        'workspaces',
        task.workspaceId || `${task.projectId}:${task.agentId}`,
      )
      this.store.put('permissions', {
        id: `${task.projectId}:${task.agentId}:${entry.approval.tool}:${workspace.path}`,
        root: workspace.path,
        tool: entry.approval.tool,
        agentId: task.agentId,
        projectId: task.projectId,
      })
    }
    this.approvals.delete(id)
    if (
      ![...this.approvals.values()].some((other) => other.approval.taskId === entry.approval.taskId)
    ) {
      const task = this.store.get<Task>('tasks', entry.approval.taskId)
      if (task?.waitReason === 'approval' && this.events.isRunning(task.id)) {
        this.store.put('tasks', { ...task, status: 'running', waitReason: undefined })
        this.events.changed()
      }
    }
    entry.resolve(allow)
    this.publishApprovals()
  }
  private publishApprovals(): void {
    this.events.publish({
      type: 'approvals',
      approvals: [...this.approvals.values()].map((x) => x.approval),
    })
  }
  clearTask(taskId: string): void {
    for (const [id, entry] of this.approvals)
      if (entry.approval.taskId === taskId) this.resolve(id, false)
  }
  denyAll(): void {
    for (const id of this.approvals.keys()) this.resolve(id, false)
  }
}
