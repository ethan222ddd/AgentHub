import type { AppEvent, Approval, Conversation, Settings, Task } from '../../shared/types'

export type NoticeKind = 'approval' | 'completed' | 'failed' | 'integration' | 'test'
export interface Notice {
  kind: NoticeKind
  conversationId?: string
  title: string
  body: string
}
export interface NotificationState {
  settings: Settings
  tasks: Task[]
  conversations: Conversation[]
}
export interface NotificationSink {
  show(notice: Notice): void
  badge(count: number, description: string): void
  navigate(conversationId: string): void
  failed(): void
  dispose(): void
}

// Host events only. Never infer completion from an agent's prose or expose tool payloads.
export class DesktopNotifications {
  private tasks = new Map<string, string>()
  private approvals: Approval[] = []
  private unreadFailures = new Set<string>()
  private pendingNavigation?: string
  private ready = false
  private closed = false
  private lastBadge = ''

  constructor(
    private readonly read: () => NotificationState,
    private readonly sink: NotificationSink,
  ) {
    // Restoring history must not announce old completions/failures again.
    for (const task of read().tasks) this.tasks.set(task.id, this.signature(task))
    this.updateBadge()
  }

  private signature(task: Task): string {
    return `${task.status}:${task.integration?.status || ''}`
  }

  private safely(action: () => void): void {
    try {
      action()
    } catch {
      // Notification failures must never change an agent task's outcome.
      try {
        this.sink.failed()
      } catch {
        /* shutdown may have destroyed the window */
      }
    }
  }

  private show(kind: NoticeKind, conversationId?: string): void {
    const { settings, conversations } = this.read()
    if (
      settings.notifications === 'off' ||
      (settings.notifications === 'approvals' && kind !== 'approval' && kind !== 'test') ||
      (conversationId && !conversations.some((c) => c.id === conversationId))
    )
      return
    const labels: Record<NoticeKind, [string, string]> = {
      approval: ['代理正在等待批准', 'Agent approval required'],
      completed: ['代理任務已完成', 'Agent task completed'],
      failed: ['代理任務失敗', 'Agent task failed'],
      integration: ['程式碼整合需要處理', 'Code integration needs attention'],
      test: ['通知測試', 'Test notification'],
    }
    const en = settings.language === 'en'
    this.safely(() =>
      this.sink.show({
        kind,
        conversationId,
        title: `AgentHub · ${labels[kind][en ? 1 : 0]}`,
        // Deliberately omit prompts, commands, repository names and error payloads on the lock screen.
        body: en
          ? 'Click to open the conversation and Activity.'
          : '點擊開啟對應聊天室與活動面板。',
      }),
    )
  }

  accept(event: AppEvent): void {
    if (this.closed) return
    if (event.type === 'approvals') {
      const previous = new Set(this.approvals.map((a) => a.id))
      this.approvals = event.approvals
      for (const approval of this.approvals)
        if (!previous.has(approval.id)) this.show('approval', approval.conversationId)
    } else if (event.type === 'changed') {
      const tasks = this.read().tasks
      const next = new Map<string, string>()
      for (const task of tasks) {
        const signature = this.signature(task)
        next.set(task.id, signature)
        if (task.supersededBy || task.status !== 'failed') this.unreadFailures.delete(task.id)
        if (task.supersededBy || this.tasks.get(task.id) === signature) continue
        if (task.status === 'failed') {
          this.unreadFailures.add(task.id)
          this.show('failed', task.conversationId)
        } else if (task.status === 'completed') this.show('completed', task.conversationId)
        else if (task.status === 'waiting_user' && task.integration?.status === 'attention')
          this.show('integration', task.conversationId)
      }
      this.tasks = next
      for (const id of this.unreadFailures) if (!next.has(id)) this.unreadFailures.delete(id)
    } else return
    this.updateBadge()
  }

  private updateBadge(): void {
    const { tasks, conversations, settings } = this.read()
    const rooms = new Set(conversations.map((c) => c.id))
    const pending = new Set(
      this.approvals.filter((a) => rooms.has(a.conversationId)).map((a) => a.taskId),
    )
    for (const task of tasks)
      if (
        rooms.has(task.conversationId) &&
        !task.supersededBy &&
        (task.status === 'waiting_user' || this.unreadFailures.has(task.id))
      )
        pending.add(task.id)
    const count = pending.size
    const description =
      settings.language === 'en' ? `${count} tasks need attention` : `${count} 個任務需要處理`
    const key = `${count}:${description}`
    if (key === this.lastBadge) return
    this.lastBadge = key
    this.safely(() => this.sink.badge(count, description))
  }

  markRead(conversationId: string): void {
    for (const task of this.read().tasks)
      if (task.conversationId === conversationId) this.unreadFailures.delete(task.id)
    this.updateBadge()
  }

  activate(conversationId: string): void {
    if (this.closed || !this.read().conversations.some((c) => c.id === conversationId)) return
    this.pendingNavigation = conversationId
    this.deliverNavigation()
  }

  rendererReady(): void {
    this.ready = true
    this.deliverNavigation()
  }

  refreshBadge(): void {
    this.lastBadge = ''
    this.updateBadge()
  }

  rendererLoading(): void {
    this.ready = false
  }

  private deliverNavigation(): void {
    if (!this.ready || !this.pendingNavigation) return
    const id = this.pendingNavigation
    this.pendingNavigation = undefined
    if (!this.read().conversations.some((c) => c.id === id)) return
    this.markRead(id)
    this.safely(() => this.sink.navigate(id))
  }

  test(conversationId?: string): void {
    if (this.read().settings.notifications === 'off')
      throw new Error(
        '勿擾已開啟，請先選擇通知模式。Do not disturb is enabled; select a notification mode first.',
      )
    this.show('test', conversationId)
  }

  dispose(): void {
    this.closed = true
    this.pendingNavigation = undefined
    this.safely(() => this.sink.dispose())
  }
}
