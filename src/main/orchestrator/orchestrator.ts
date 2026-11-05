import { randomUUID } from 'node:crypto'
import type { CollaborationInput } from '../../shared/schemas'
import { isTaskActive, latestAttempt, queuedStatuses } from '../../shared/tasks'
import type {
  AgentProfile,
  AppEvent,
  Conversation,
  Message,
  Project,
  Review,
  Task,
  TestRun,
  UsageRecord,
  WorkflowRun,
  Workspace,
} from '../../shared/types'
import type { AgentAdapter } from '../agents/adapter'
import { trace } from '../app/diagnostics'
import { AttachmentStore } from '../attachments/store'
import { Store } from '../database/store'
import type { AutomaticProjects } from '../git/automatic'
import { WorkspaceManager } from '../git/workspaces'
import { ApprovalQueue } from './approvals'
import { maxDepth } from './autonomy'
import { deliverCollaboration } from './collaboration'
import { executeTurn } from './execute-turn'
import { createReview, requestReviewFix, type ReviewHost, type WorkflowReview } from './reviews'

const planFirstFields = (): Pick<Task, 'planFirst' | 'plan'> => ({
  planFirst: true,
  plan: {
    status: 'drafting',
    content: '',
    files: [],
    steps: [],
    risks: [],
    verification: '',
    structured: false,
    revisions: 0,
  },
})
export class Orchestrator {
  private running = new Map<string, AbortController>()
  private locks = new Set<string>()
  private approvalQueue: ApprovalQueue
  private dedupe = new Set<string>()
  private pumping = false
  private closing = false
  private executions = new Set<Promise<void>>()
  private pauseRequested = new Set<string>()
  private workspaceManager?: WorkspaceManager
  automatic?: AutomaticProjects
  workflowChanged?: () => void
  setWorkspaceManager(manager: WorkspaceManager) {
    this.workspaceManager = manager
  }
  constructor(
    readonly store: Store,
    readonly adapters: Map<string, AgentAdapter>,
    private publish: (event: AppEvent) => void,
  ) {
    this.approvalQueue = new ApprovalQueue(store, {
      isClosing: () => this.closing,
      isRunning: (id) => this.running.has(id),
      publish: (event) => this.publish(event),
      changed: () => this.changed(),
    })
  }
  changed(): void {
    this.workflowChanged?.()
    this.publish({ type: 'changed' })
  }
  send(
    conversationId: string,
    content: string,
    recipients: string[],
    replyTo?: string,
    attachmentIds: string[] = [],
    planFirst = false,
  ): Message {
    const c = this.store.require<Conversation>('conversations', conversationId)
    if (c.stopped && recipients.length)
      throw new Error('Room stopped. Resume before sending agent work.')
    const project = this.store.require<Project>('projects', c.projectId)
    const enabled = this.store
      .list<AgentProfile>('agents')
      .filter((a) => a.enabled && (!project.agentIds || project.agentIds.includes(a.id)))
    if (recipients.some((id) => !enabled.some((a) => a.id === id)))
      throw new Error('Unknown or disabled recipient')
    const targets =
      c.mode === 'supervisor' && !recipients.length && c.supervisorId
        ? [c.supervisorId]
        : [...new Set(recipients)]
    if (targets.some((id) => !enabled.some((a) => a.id === id)))
      throw new Error('Unknown or disabled supervisor/recipient')
    if (c.stopped && targets.length)
      throw new Error('Room stopped. Resume before sending agent work.')
    if (targets.length > Math.min(this.store.settings().maxFanout, this.store.settings().maxTurns))
      throw new Error('Recipient fanout exceeds the configured request budget')
    if (targets.length) this.assertBudget(c.id)
    if (targets.length && this.workflowBusy(c.projectId))
      throw new Error(
        '工作流程執行中；請使用流程控制或先取消流程。Workflow owns this project; use workflow controls or cancel it before starting unrelated work.',
      )
    const attachmentStore = new AttachmentStore(this.store)
    const attached = attachmentStore.resolve(c.projectId, attachmentIds)
    content = [
      content,
      ...attached.filter((a) => a.meta.kind === 'text').map((a) => a.meta.content),
    ]
      .filter(Boolean)
      .join('\n\n')
    if (!content.trim()) content = '請查看附件。 / Please inspect the attachments.'
    if (content.length > 256000)
      throw new Error(
        'Text attachment context exceeds 256k characters. Select fewer files or reference their workspace paths.',
      )
    const message: Message = {
      id: randomUUID(),
      projectId: c.projectId,
      conversationId,
      senderId: 'user',
      recipientIds: targets,
      content,
      type: 'user',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: replyTo || randomUUID(),
      delivery: 'completed',
      ...(attachmentIds.length
        ? { attachments: attachmentStore.metadata(attachmentIds, c.projectId) }
        : {}),
    }
    trace('routing.result', {
      correlationId: message.id,
      conversationId,
      messageId: message.id,
      recipients: targets,
      enabledAgentIds: enabled.map((a) => a.id),
      status: targets.length ? 'routed' : 'local-note',
    })
    this.store.put('messages', message)
    if (c.name === '新對話') this.store.put('conversations', { ...c, name: content.slice(0, 36) })
    // Autonomous team run: one lead plans the contract and assigns the others, so a single
    // prompt to several agents becomes coordinated work instead of parallel duplicates.
    const lead =
      this.store.settings().autonomy === 'auto' && targets.length > 1
        ? c.mode === 'supervisor' && targets.includes(c.supervisorId)
          ? c.supervisorId
          : targets[0]
        : undefined
    for (const agentId of lead ? [lead] : targets)
      this.enqueue(c, agentId, content, message.id, 0, [], {
        attachmentIds,
        ...(planFirst ? planFirstFields() : {}),
        ...(lead ? { team: { lead, members: targets } } : {}),
      })
    this.changed()
    this.pump()
    return message
  }
  private enqueue(
    c: Conversation,
    agentId: string,
    description: string,
    correlationId: string,
    depth: number,
    dependencies: string[],
    extra: Partial<
      Pick<
        Task,
        | 'workspaceId'
        | 'kind'
        | 'reviewId'
        | 'attachmentIds'
        | 'retryOf'
        | 'workflow'
        | 'planFirst'
        | 'plan'
        | 'team'
        | 'autoFix'
      >
    > = {},
  ): Task {
    if (
      extra.workflow &&
      this.store.require<WorkflowRun>('workflow_runs', extra.workflow.runId).status !== 'running'
    )
      throw new Error('Workflow is not running')
    if (!this.store.require<AgentProfile>('agents', agentId).enabled)
      throw new Error('Recipient disabled')
    const settings = this.store.settings()
    this.assertBudget(c.id)
    const project = this.store.require<Project>('projects', c.projectId)
    if (project.agentIds && !project.agentIds.includes(agentId))
      throw new Error('Recipient is not on this project team')
    if (c.stopped) throw new Error('Room stopped by user')
    if (depth > maxDepth(settings))
      throw new Error('Delegation depth limit reached. User intervention required.')
    const count = this.turnCount(correlationId)
    if (count >= settings.maxTurns)
      throw new Error('Agent turn budget reached. Start a new user request to continue.')
    for (const dependency of dependencies) {
      const t = this.store.require<Task>('tasks', dependency)
      if (t.conversationId !== c.id) throw new Error('Dependency must belong to this room')
    }
    const task: Task = {
      id: randomUUID(),
      projectId: c.projectId,
      conversationId: c.id,
      agentId,
      description,
      name: description.slice(0, 90),
      status: 'pending',
      dependencies,
      createdAt: new Date().toISOString(),
      correlationId,
      depth,
      runtime: c.runtimeOverrides?.[agentId] || {
        model: this.store.require<AgentProfile>('agents', agentId).model,
        reasoningEffort: this.store.require<AgentProfile>('agents', agentId).reasoningEffort || '',
      },
      ...extra,
    }
    this.store.put('tasks', task)
    trace('task.queued', { taskId: task.id, agentId, conversationId: c.id, correlationId })
    return task
  }
  private pump(): void {
    if (this.pumping || this.closing) return
    this.pumping = true
    try {
      const all = this.store.list<Task>('tasks')
      const byId = new Map(all.map((t) => [t.id, t]))
      const pending = all.filter((t) => !t.supersededBy && queuedStatuses.includes(t.status))
      for (const task of pending) {
        if (
          task.workflow &&
          this.store.get<WorkflowRun>('workflow_runs', task.workflow.runId)?.status !== 'running'
        )
          continue
        if (this.running.has(task.id)) continue
        if (this.store.require<Conversation>('conversations', task.conversationId).stopped) continue
        const lock = `${task.projectId}:${task.agentId}`
        const deps = task.dependencies.map((id) => {
          const original = byId.get(id)
          return original && original.conversationId === task.conversationId
            ? latestAttempt(original, byId)
            : undefined
        })
        const blockedBy = task.dependencies.filter(
          (_, i) => !deps[i] || ['failed', 'cancelled', 'blocked'].includes(deps[i]!.status),
        )
        if (blockedBy.length) {
          this.queueState(task, 'blocked', undefined, blockedBy)
          continue
        }
        if (deps.some((d) => d?.status !== 'completed')) {
          this.queueState(task, 'waiting_agent', 'dependencies')
          continue
        }
        if (this.locks.has(lock)) {
          this.queueState(task, 'waiting_agent', 'workspace_lock')
          continue
        }
        if (this.running.size >= this.store.settings().maxConcurrent) {
          this.queueState(task, 'pending')
          continue
        }
        this.locks.add(lock)
        const controller = new AbortController()
        this.running.set(task.id, controller)
        const execution = this.execute(task, controller).finally(() => {
          this.running.delete(task.id)
          this.locks.delete(lock)
          this.executions.delete(execution)
          this.pump()
        })
        this.executions.add(execution)
      }
    } finally {
      this.pumping = false
    }
  }
  private queueState(
    task: Task,
    status: Task['status'],
    waitReason?: Task['waitReason'],
    blockedBy?: string[],
  ) {
    if (
      task.status === status &&
      task.waitReason === waitReason &&
      JSON.stringify(task.blockedBy) === JSON.stringify(blockedBy)
    )
      return
    this.store.put('tasks', { ...task, status, waitReason, blockedBy })
    if (status === 'blocked' && task.status !== 'blocked')
      this.store.put('messages', {
        id: randomUUID(),
        projectId: task.projectId,
        conversationId: task.conversationId,
        senderId: 'system',
        recipientIds: ['user'],
        content: `Task blocked by dependencies: ${task.name}. Inspect the prerequisite and retry or reassign it; this task has not run.`,
        type: 'system',
        timestamp: new Date().toISOString(),
        taskId: task.id,
        correlationId: task.correlationId,
        delivery: 'failed',
      } satisfies Message)
    this.changed()
  }
  private execute(task: Task, controller: AbortController): Promise<void> {
    return executeTurn(
      {
        store: this.store,
        adapters: this.adapters,
        automatic: this.automatic,
        changed: () => this.changed(),
        publish: (event) => this.publish(event),
        isClosing: () => this.closing,
        takePause: (id) => this.pauseRequested.delete(id),
        clearApprovals: (taskId) => this.approvalQueue.clearTask(taskId),
        assertBudget: (id) => this.assertBudget(id),
        remainingCost: (id) => this.remainingCost(id),
        turnCount: (id) => this.turnCount(id),
        recordUsage: (...args) => this.recordUsage(...args),
        ask: (...args) => this.ask(...args),
        collaborate: (...args) => this.collaborate(...args),
        integrationMessage: (...args) => this.integrationMessage(...args),
        autoFix: (...args) => this.autoFix(...args),
        requestReview: (...args) => this.requestReview(...args),
      },
      task,
      controller,
    )
  }
  private collaborate(
    task: Task,
    input: CollaborationInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    return deliverCollaboration(
      {
        store: this.store,
        dedupe: this.dedupe,
        changed: () => this.changed(),
        publish: (event) => this.publish(event),
        turnCount: (id) => this.turnCount(id),
        ask: (...args) => this.ask(...args),
        enqueue: (...args) => this.enqueue(...args),
        pump: () => this.pump(),
      },
      task,
      input,
      signal,
    )
  }
  private integrationMessage(task: Task, integration: NonNullable<Task['integration']>) {
    this.store.put('messages', {
      id: randomUUID(),
      projectId: task.projectId,
      conversationId: task.conversationId,
      senderId: 'system',
      recipientIds: ['user'],
      content: `自動整合 · ${integration.status}\n${integration.detail}`,
      type: 'system',
      timestamp: new Date().toISOString(),
      taskId: task.id,
      correlationId: task.correlationId,
      delivery: 'completed',
    } satisfies Message)
    this.changed()
  }
  async retryIntegration(id: string): Promise<void> {
    const task = this.store.require<Task>('tasks', id)
    if (task.workflow)
      throw new Error(
        '請使用工作流程的「檢查後繼續」。Use workflow controls for staged/reviewed work.',
      )
    if (!this.automatic || task.integration?.status !== 'attention')
      throw new Error('No automatic integration is awaiting retry')
    if (
      [...this.running.keys()].some(
        (id) => this.store.require<Task>('tasks', id).projectId === task.projectId,
      )
    )
      throw new Error('Wait for project work to finish before retrying integration')
    const project = this.store.require<Project>('projects', task.projectId)
    const workspace = this.store.require<Workspace>(
      'workspaces',
      task.workspaceId || `${project.id}:${task.agentId}`,
    )
    const controller = new AbortController(),
      lock = `${project.id}:${task.agentId}`
    this.running.set(task.id, controller)
    this.locks.add(lock)
    this.store.put('tasks', { ...task, status: 'reviewing' })
    this.changed()
    const timeout = setTimeout(
      () => controller.abort(new Error('Task timeout')),
      this.store.settings().timeoutMs,
    )
    const execution = (async () => {
      try {
        const integration = await this.automatic!.finish(project, workspace, controller.signal)
        this.store.put('tasks', {
          ...task,
          integration,
          status: integration.status === 'attention' ? 'waiting_user' : 'completed',
          waitReason: integration.status === 'attention' ? 'integration' : undefined,
          error: integration.status === 'attention' ? integration.detail : undefined,
          completedAt: new Date().toISOString(),
        })
        this.integrationMessage(task, integration)
      } catch (error) {
        this.store.put('tasks', {
          ...task,
          status: 'waiting_user',
          waitReason: 'integration',
          error: String(error),
        })
      } finally {
        clearTimeout(timeout)
        this.running.delete(task.id)
        this.locks.delete(lock)
        this.changed()
        this.pump()
      }
    })()
    this.executions.add(execution)
    try {
      await execution
    } finally {
      this.executions.delete(execution)
    }
  }
  private ask(
    task: Task,
    tool: string,
    detail: string,
    signal: AbortSignal,
    risk?: string,
  ): Promise<boolean> {
    return this.approvalQueue.request(task, tool, detail, signal, risk)
  }
  resolveApproval(id: string, allow: boolean, remember = false): void {
    this.approvalQueue.resolve(id, allow, remember)
  }

  stop(conversationId: string): void {
    const c = this.store.require<Conversation>('conversations', conversationId)
    this.store.put('conversations', { ...c, stopped: true })
    for (const task of this.store
      .list<Task>('tasks')
      .filter((t) => t.conversationId === conversationId)) {
      this.running.get(task.id)?.abort(new Error('Stopped by user'))
      if (queuedStatuses.includes(task.status))
        this.store.put('tasks', { ...task, status: 'cancelled', waitReason: undefined })
    }
    this.changed()
  }
  resume(conversationId: string): void {
    const c = this.store.require<Conversation>('conversations', conversationId)
    this.store.put('conversations', { ...c, stopped: false })
    this.changed()
  }
  taskAction(id: string, action: 'pause' | 'resume' | 'cancel', workflowControl = false): void {
    const task = this.store.require<Task>('tasks', id)
    if (task.workflow && !workflowControl)
      throw new Error('請使用工作流程控制。Use workflow pause/resume/cancel controls.')
    if (task.supersededBy)
      throw new Error('This attempt was replaced; open the latest attempt instead')
    if (action === 'resume') {
      if (task.integration)
        throw new Error('Agent 已完成；請使用「重新嘗試整合」，避免重跑開發副作用。')
      if (this.running.has(id)) throw new Error('Task is still stopping')
      if (!['paused', 'waiting_user', 'failed', 'cancelled'].includes(task.status))
        throw new Error('Task cannot be resumed in this state')
      this.retry(task, task.agentId)
    } else {
      if (!isTaskActive(task) && !['blocked', 'paused', 'waiting_user'].includes(task.status))
        throw new Error('Task is already finished')
      if (action === 'pause' && this.running.has(id)) this.pauseRequested.add(id)
      this.running
        .get(id)
        ?.abort(
          new Error(
            action === 'pause'
              ? 'Paused by user; inspect changes before resuming'
              : 'Cancelled by user',
          ),
        )
      if (!this.running.has(id))
        this.store.put('tasks', {
          ...task,
          status: action === 'pause' ? 'paused' : 'cancelled',
          waitReason: undefined,
        })
    }
    this.changed()
    this.pump()
  }
  /** Approve (optionally edited), send back for revision, or cancel a plan awaiting the user. */
  planAction(
    id: string,
    action: 'approve' | 'revise' | 'cancel',
    content?: string,
    feedback?: string,
  ): Task {
    const task = this.store.require<Task>('tasks', id)
    if (
      !task.planFirst ||
      !task.plan ||
      task.status !== 'waiting_user' ||
      task.waitReason !== 'plan' ||
      task.supersededBy
    )
      throw new Error('This task is not waiting for plan approval')
    if (this.running.has(id)) throw new Error('Task is still running')
    if (action === 'cancel') {
      const next = { ...task, status: 'cancelled' as const, waitReason: undefined }
      this.store.put('tasks', next)
      this.changed()
      return next
    }
    const c = this.store.require<Conversation>('conversations', task.conversationId)
    if (c.stopped) throw new Error('Room stopped. Resume before continuing this task.')
    this.assertBudget(c.id)
    if (this.turnCount(task.correlationId) >= this.store.settings().maxTurns)
      throw new Error('Agent turn budget reached. Start a new user request to continue.')
    if (action === 'revise') {
      if (!feedback) throw new Error('Describe what the plan should change')
      if (task.plan.revisions >= 5)
        throw new Error('Plan revision limit reached. Edit the plan and approve it, or cancel.')
    }
    const next: Task = {
      ...task,
      status: 'pending',
      waitReason: undefined,
      error: undefined,
      // Each extra phase is another native turn against the shared budget.
      nativeTurns: (task.nativeTurns || 1) + 1,
      plan:
        action === 'approve'
          ? {
              ...task.plan,
              status: 'approved',
              content: content || task.plan.content,
              approvedAt: new Date().toISOString(),
            }
          : {
              ...task.plan,
              status: 'revising',
              feedback,
              structured: false,
              revisions: task.plan.revisions + 1,
            },
    }
    this.store.put('tasks', next)
    trace('task.plan-' + action, { taskId: id, agentId: task.agentId })
    this.changed()
    this.pump()
    return next
  }
  isBusy(projectId: string): boolean {
    return this.store
      .list<Task>('tasks')
      .some((t) => t.projectId === projectId && (this.running.has(t.id) || isTaskActive(t)))
  }
  private turnCount(correlationId: string) {
    return this.store
      .list<Task>('tasks')
      .filter((task) => task.correlationId === correlationId)
      .reduce((count, task) => count + Math.max(1, task.nativeTurns || 1), 0)
  }
  workflowBusy(projectId: string): boolean {
    return this.store
      .list<WorkflowRun>('workflow_runs')
      .some((r) => r.projectId === projectId && !['completed', 'cancelled'].includes(r.status))
  }
  private assertBudget(conversationId: string) {
    const settings = this.store.settings()
    const rows = this.store
      .list<UsageRecord>('usage_records')
      .filter((u) => u.conversationId === conversationId)
    if (
      settings.maxUsageTokens &&
      rows.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0) >= settings.maxUsageTokens
    )
      throw new Error(
        'Reported token budget reached. Review usage and explicitly raise the limit to continue.',
      )
    if (
      settings.maxCostUsd &&
      rows.reduce((sum, u) => sum + (u.costUsd || 0), 0) >= settings.maxCostUsd
    )
      throw new Error('Reported cost budget reached. Review usage before continuing.')
  }
  private remainingCost(conversationId: string): number | undefined {
    const maximum = this.store.settings().maxCostUsd
    return maximum
      ? Math.max(
          0.001,
          maximum -
            this.store
              .list<UsageRecord>('usage_records')
              .filter((u) => u.conversationId === conversationId)
              .reduce((sum, u) => sum + (u.costUsd || 0), 0),
        )
      : undefined
  }
  private recordUsage(
    task: Task,
    usage: {
      inputTokens: number
      outputTokens: number
      costUsd?: number
      source: string
      scope?: 'session' | 'turn'
    },
    baseline: { input: number; output: number },
    controller: AbortController,
    sessionAgent: string,
  ) {
    const inputTokens = Math.max(
      0,
      usage.inputTokens - (usage.scope === 'session' ? baseline.input : 0),
    )
    const outputTokens = Math.max(
      0,
      usage.outputTokens - (usage.scope === 'session' ? baseline.output : 0),
    )
    if (![inputTokens, outputTokens, usage.costUsd || 0].every(Number.isFinite)) return
    this.store.put('usage_records', {
      id: task.id,
      taskId: task.id,
      conversationId: task.conversationId,
      agentId: task.agentId,
      inputTokens,
      outputTokens,
      costUsd: usage.costUsd,
      source: usage.source,
      timestamp: new Date().toISOString(),
    } satisfies UsageRecord)
    const session = this.store.session(task.conversationId, sessionAgent)
    if (session && usage.scope === 'session')
      this.store.put('sessions', {
        ...session,
        providerInputTokens: usage.inputTokens,
        providerOutputTokens: usage.outputTokens,
        providerTokens: usage.inputTokens + usage.outputTokens,
      })
    try {
      this.assertBudget(task.conversationId)
    } catch (e) {
      controller.abort(e)
    }
    this.changed()
  }
  createTask(conversationId: string, agentId: string, description: string, dependencies: string[]) {
    const c = this.store.require<Conversation>('conversations', conversationId)
    if (this.workflowBusy(c.projectId))
      throw new Error('Workflow owns this project; use workflow controls.')
    const task = this.enqueue(c, agentId, description, randomUUID(), 0, dependencies)
    this.changed()
    this.pump()
    return task
  }
  createWorkflowTask(
    run: WorkflowRun,
    stepId: string,
    description: string,
    dependencies: string[],
    retryOf?: string,
  ): Task {
    const current = this.store.require<WorkflowRun>('workflow_runs', run.id)
    if (current.status !== 'running') throw new Error('Workflow is not running')
    const step = run.template.steps.find((s) => s.id === stepId)
    if (!step || step.kind !== 'task') throw new Error('Invalid workflow task step')
    const c = this.store.require<Conversation>('conversations', run.conversationId)
    const task = this.enqueue(c, run.bindings[step.roleId], description, run.id, 0, dependencies, {
      workflow: { runId: run.id, stepId },
      retryOf,
    })
    task.name = step.name
    this.store.put('tasks', task)
    if (retryOf) {
      const prior = this.store.require<Task>('tasks', retryOf)
      if (prior.workflow?.runId !== run.id || prior.workflow.stepId !== stepId)
        throw new Error('Invalid workflow retry')
      this.store.put('tasks', { ...prior, supersededBy: task.id })
    }
    this.changed()
    this.pump()
    return task
  }
  reassign(id: string, agentId: string) {
    const task = this.store.require<Task>('tasks', id)
    if (task.workflow)
      throw new Error('Cancel the workflow and start with new role bindings to reassign it.')
    if (
      this.running.has(id) ||
      task.supersededBy ||
      ['completed', 'reviewing'].includes(task.status)
    )
      throw new Error('Pause or cancel this task before reassigning')
    const agent = this.store.require<AgentProfile>('agents', agentId)
    if (!agent.enabled) throw new Error('Agent is disabled')
    const project = this.store.require<Project>('projects', task.projectId)
    if (project.agentIds && !project.agentIds.includes(agentId))
      throw new Error('Agent is not on this project team')
    new AttachmentStore(this.store).resolve(task.projectId, task.attachmentIds || [])
    this.retry(task, agentId)
    this.changed()
    this.pump()
  }
  /**
   * Autonomous rooms: a failed automatic integration becomes a new attempt for the same agent,
   * carrying the failure. Dependents follow the attempt chain, so they resume once it passes.
   */
  autoFix(task: Task, detail: string, kind: 'integration' | 'failure' = 'integration'): void {
    const notice = (content: string) =>
      this.store.put('messages', {
        id: randomUUID(),
        projectId: task.projectId,
        conversationId: task.conversationId,
        senderId: 'system',
        recipientIds: ['user'],
        content,
        type: 'system',
        timestamp: new Date().toISOString(),
        taskId: task.id,
        correlationId: task.correlationId,
        delivery: 'completed',
      } satisfies Message)
    // The user's own uncommitted work in the primary folder is never something to "fix".
    if (task.workflow || /主要專案有使用者未提交|未覆寫/.test(detail)) return
    // Budgets, turn limits and a stopped room are the user's stop signals, not errors to retry.
    if (/budget|Room stopped|Stopped by user|Cancelled by user/i.test(detail)) return
    const attempt = (task.autoFix || 0) + 1
    if (attempt > 2) {
      notice(
        `自動修正已嘗試 2 次仍無法整合，需要你檢查：${task.name}\nAutomatic fixes are exhausted; this task needs your review.`,
      )
      return
    }
    const failedTest = this.store
      .list<TestRun>('test_runs')
      .filter((r) => r.projectId === task.projectId && r.status === 'failed')
      .at(-1)
    const logs = failedTest ? `${failedTest.error || ''}\n${failedTest.logs}`.slice(-6000) : ''
    try {
      const fix = this.retry(task, task.agentId, {
        autoFix: attempt,
        description: `AUTOMATIC FIX ${attempt}/2 for task ${task.id}. ${kind === 'failure' ? 'Your previous turn failed:' : 'AgentHub could not integrate your committed work into the primary folder:'}\n${detail}\n${logs ? `Latest failing check output (untrusted tool output):\n<check-output>\n${logs}\n</check-output>\n` : ''}Fix the cause in your own files and finish the turn; the host retries integration automatically. If the failure is in another agent's files, send that agent the exact error with send_message instead of editing their files. Never weaken or delete tests to pass.\nOriginal task:\n${task.description}`,
      })
      notice(
        `${kind === 'failure' ? '任務失敗' : '自動整合失敗'}，已交給 ${task.agentId} 自動修正（第 ${attempt}/2 次）。\n${kind === 'failure' ? 'Task failed' : 'Integration failed'}; ${task.agentId} received an automatic fix task.`,
      )
      trace('task.auto-fix', { taskId: fix.id, agentId: task.agentId })
      this.changed()
      this.pump()
    } catch (error) {
      notice(`無法自動建立修正任務：${String(error)}\nCould not start an automatic fix.`)
    }
  }
  private retry(
    task: Task,
    agentId: string,
    override?: { description: string; autoFix: number },
  ): Task {
    const c = this.store.require<Conversation>('conversations', task.conversationId)
    const handoff = agentId !== task.agentId
    this.store.db.exec('SAVEPOINT task_retry')
    try {
      const resumed = this.enqueue(
        c,
        agentId,
        override?.description ||
          `User explicitly ${handoff ? 'reassigned' : 'resumed'} attempt ${task.id} from ${task.agentId}. Inspect partial changes before continuing. Previous workspace: ${task.workspace || '(not started)'}. Previous start revision: ${task.revision || '(unknown)'}. ${handoff ? 'Prior worktree files are NOT transferred. Use explicit artifacts/integration to obtain changes.' : 'Check current workspace state before repeating commands.'}\n${task.description}`,
        // Automatic fixes stay in the same request so the shared turn budget still bounds them.
        task.workflow || override ? task.correlationId : randomUUID(),
        override ? task.depth : 0,
        task.dependencies,
        {
          ...(override ? { autoFix: override.autoFix } : {}),
          ...(task.team ? { team: task.team } : {}),
          workspaceId: task.kind === 'review' || !handoff ? task.workspaceId : undefined,
          kind: task.kind,
          reviewId: task.reviewId,
          attachmentIds: task.attachmentIds,
          retryOf: task.id,
          workflow: task.workflow,
          // A new attempt keeps the plan gate: an approved plan stays approved.
          ...(task.planFirst ? { planFirst: true, plan: task.plan } : {}),
        },
      )
      resumed.name = task.name
      this.store.put('tasks', resumed)
      this.store.put('tasks', { ...task, supersededBy: resumed.id })
      if (task.reviewId) {
        const review = this.store.require<Review>('reviews', task.reviewId)
        this.store.put('reviews', {
          ...review,
          taskId: resumed.id,
          reviewerId: agentId,
          status: 'pending',
        })
      }
      this.store.db.exec('RELEASE task_retry')
      return resumed
    } catch (error) {
      this.store.db.exec('ROLLBACK TO task_retry; RELEASE task_retry')
      throw error
    }
  }
  requestReview(
    workspaceId: string,
    conversationId: string,
    reviewerId: string,
    parent?: Task,
    workflow?: WorkflowReview,
  ): Promise<Review> {
    return createReview(this.reviewHost, workspaceId, conversationId, reviewerId, parent, workflow)
  }
  private get reviewHost(): ReviewHost {
    return {
      store: this.store,
      workspaceManager: this.workspaceManager,
      workflowBusy: (id) => this.workflowBusy(id),
      enqueue: (...args) => this.enqueue(...args),
      changed: () => this.changed(),
      pump: () => this.pump(),
      createTask: (...args) => this.createTask(...args),
    }
  }
  fixReview(id: string): Promise<Task> {
    return requestReviewFix(this.reviewHost, id)
  }
  async dispose(): Promise<void> {
    this.closing = true
    for (const controller of this.running.values())
      controller.abort(new Error('App closed; inspect partial changes before resuming'))
    this.approvalQueue.denyAll()
    await Promise.all([...this.adapters.values()].map((a) => a.dispose()))
    await Promise.allSettled([...this.executions])
  }
}
