import { randomUUID } from 'node:crypto'
import type {
  AgentProfile,
  Artifact,
  Conversation,
  Message,
  Project,
  Review,
  Task,
  WorkflowRun,
  WorkflowStep,
  WorkflowTemplate,
  Workspace,
} from '../../shared/types'
import { workflowTemplateSchema } from '../../shared/schemas'
import { workflowHandoffReady } from '../../shared/workflows'
import { finalizedReview, reviewApproved } from '../../shared/reviews'
import { isTaskActive, latestAttempt } from '../../shared/tasks'
import type { Store } from '../database/store'
import type { Orchestrator } from '../orchestrator/orchestrator'
import { git } from '../git/workspaces'
import { redact } from '../permissions/paths'

export class WorkflowService {
  private dirty = false
  private work?: Promise<void>
  private closed = false
  private controllers = new Map<string, AbortController>()
  private resuming = new Set<string>()
  constructor(
    private readonly store: Store,
    private readonly orchestrator: Orchestrator,
  ) {
    orchestrator.workflowChanged = () => this.schedule()
  }

  save(template: WorkflowTemplate): void {
    this.store.put('workflow_templates', workflowTemplateSchema.parse(template))
    this.orchestrator.changed()
  }
  delete(id: string): void {
    this.store.require('workflow_templates', id)
    this.store.remove('workflow_templates', id) // Runs own immutable copies, never live template pointers.
    this.orchestrator.changed()
  }
  private validateBindings(run: Pick<WorkflowRun, 'template' | 'bindings' | 'projectId'>): void {
    workflowTemplateSchema.parse(run.template)
    const project = this.store.require<Project>('projects', run.projectId)
    if (!project.autoManaged || !this.orchestrator.automatic)
      throw new Error(
        '工作流程需要自動管理的隔離工作區。Enable automatic project management first.',
      )
    if (Object.keys(run.bindings).some((id) => !run.template.roles.some((r) => r.id === id)))
      throw new Error('Unknown role binding')
    for (const role of run.template.roles) {
      const agent = this.store.get<AgentProfile>('agents', run.bindings[role.id])
      if (!agent?.enabled || (project.agentIds && !project.agentIds.includes(agent.id)))
        throw new Error(`${role.name}: 請選擇已啟用的團隊成員 / Select an enabled team member`)
    }
    for (const step of run.template.steps.filter((s) => s.kind === 'review')) {
      const source = run.template.steps.find((s) => s.id === step.sourceStepId)!
      if (run.bindings[step.roleId] === run.bindings[source.roleId])
        throw new Error('流程審查者必須與實作者不同。Choose a different reviewer agent instance.')
    }
  }
  start(
    templateId: string,
    conversationId: string,
    requirement: string,
    bindings: Record<string, string>,
  ): WorkflowRun {
    const c = this.store.require<Conversation>('conversations', conversationId)
    if (
      c.stopped ||
      this.orchestrator.isBusy(c.projectId) ||
      this.orchestrator.workflowBusy(c.projectId)
    )
      throw new Error(
        '先完成或取消此專案既有工作流程與任務。Finish/cancel existing project work first; resume the room if stopped.',
      )
    const template = workflowTemplateSchema.parse(
      this.store.require<WorkflowTemplate>('workflow_templates', templateId),
    )
    if (
      template.steps.filter((s) => s.kind !== 'integrate').length > this.store.settings().maxTurns
    )
      throw new Error('範本超過目前回合預算。Template exceeds the configured turn budget.')
    const run: WorkflowRun = {
      id: randomUUID(),
      conversationId,
      projectId: c.projectId,
      template,
      requirement,
      bindings: { ...bindings },
      status: 'running',
      createdAt: new Date().toISOString(),
      steps: Object.fromEntries(template.steps.map((s) => [s.id, { status: 'pending', fixes: 0 }])),
    }
    this.validateBindings(run)
    this.store.put('workflow_runs', run)
    this.message(run, `工作流程開始 / Workflow started: ${template.name}\n${requirement}`)
    this.orchestrator.changed()
    return run
  }
  private message(run: WorkflowRun, content: string): void {
    this.store.put('messages', {
      id: randomUUID(),
      projectId: run.projectId,
      conversationId: run.conversationId,
      senderId: 'system',
      recipientIds: ['user'],
      content: redact(content),
      type: 'system',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: run.id,
      delivery: run.status === 'attention' ? 'failed' : 'completed',
    } satisfies Message)
  }
  private persist(run: WorkflowRun): void {
    const current = this.store.require<WorkflowRun>('workflow_runs', run.id)
    // An async snapshot/integration must never undo Stop, Pause or Cancel.
    if (current.status !== 'running') run.status = current.status
    this.store.put('workflow_runs', run)
    this.orchestrator.changed()
  }
  private assertRunning(run: WorkflowRun): void {
    if (
      this.closed ||
      this.store.require<WorkflowRun>('workflow_runs', run.id).status !== 'running' ||
      this.store.require<Conversation>('conversations', run.conversationId).stopped
    )
      throw new Error('Workflow stopped')
  }
  private halt(
    run: WorkflowRun,
    status: 'attention' | 'paused' | 'cancelled',
    error?: string,
  ): void {
    this.store.put('workflow_runs', { ...run, status, error })
    this.controllers.get(run.id)?.abort(new Error('Workflow stopped'))
    for (const task of this.store.list<Task>('tasks'))
      if (
        task.workflow?.runId === run.id &&
        !task.supersededBy &&
        (isTaskActive(task) || ['blocked', 'paused'].includes(task.status))
      ) {
        try {
          this.orchestrator.taskAction(task.id, status === 'cancelled' ? 'cancel' : 'pause', true)
        } catch {
          /* native completion raced the pause */
        }
      }
    if (error) this.message({ ...run, status }, error)
    this.orchestrator.changed()
  }
  async action(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const run = this.store.require<WorkflowRun>('workflow_runs', id)
    if (['completed', 'cancelled'].includes(run.status))
      throw new Error('Workflow has already finished')
    if (action !== 'resume') {
      this.halt(run, action === 'cancel' ? 'cancelled' : 'paused')
      return
    }
    if (
      run.status === 'running' ||
      this.orchestrator.isBusy(run.projectId) ||
      this.controllers.has(run.id)
    )
      throw new Error('請等待任務停止後再繼續。Wait for tasks to stop before resuming.')
    this.validateBindings(run)
    this.resuming.add(run.id)
    run.status = 'running'
    run.error = undefined
    this.store.put('workflow_runs', run)
    this.orchestrator.resume(run.conversationId)
    try {
      for (const step of run.template.steps) {
        const state = run.steps[step.id],
          task = state.taskId ? this.currentTask(state.taskId) : undefined
        if (!task || state.status === 'completed') continue
        if (step.kind === 'integrate') {
          state.status = 'pending'
          continue
        }
        if (task.integration?.status === 'attention' && step.kind === 'task') {
          // The native turn already completed; retry only the safe checkpoint, not the agent.
          const workspace = this.store.require<Workspace>('workspaces', task.workspaceId!)
          const result = await this.controlled(run, (signal) =>
            this.orchestrator.automatic!.finish(
              this.store.require<Project>('projects', run.projectId),
              workspace,
              signal,
              undefined,
              { checkpointOnly: true },
            ),
          )
          this.assertRunning(run)
          if (result.status !== 'staged') throw new Error(result.detail)
          this.store.put('tasks', {
            ...task,
            integration: result,
            status: 'completed',
            error: undefined,
          })
        } else if (['failed', 'cancelled', 'paused', 'waiting_user'].includes(task.status)) {
          this.orchestrator.taskAction(task.id, 'resume', true)
        }
      }
      this.persist(run)
    } catch (e) {
      if (this.store.require<WorkflowRun>('workflow_runs', id).status === 'running')
        this.halt(run, 'attention', redact(String(e)))
      throw e
    } finally {
      this.resuming.delete(run.id)
      this.schedule()
    }
  }
  private currentTask(id: string): Task {
    const tasks = this.store.list<Task>('tasks'),
      byId = new Map(tasks.map((t) => [t.id, t]))
    const task = byId.get(id),
      latest = task && latestAttempt(task, byId)
    if (!latest) throw new Error('Workflow task attempt chain is missing or invalid')
    return latest
  }
  schedule(): void {
    if (this.closed) return
    for (const run of this.store.list<WorkflowRun>('workflow_runs'))
      if (
        run.status === 'running' &&
        this.store.require<Conversation>('conversations', run.conversationId).stopped
      )
        this.halt(
          run,
          'paused',
          '聊天室已停止；檢查後從工作流程繼續。Room stopped; resume through workflow controls.',
        )
    this.dirty = true
    if (this.work) return
    this.work = Promise.resolve()
      .then(async () => {
        while (this.dirty && !this.closed) {
          this.dirty = false
          for (const run of this.store
            .list<WorkflowRun>('workflow_runs')
            .filter((r) => r.status === 'running' && !this.resuming.has(r.id))) {
            try {
              await this.tick(run)
            } catch (e) {
              const current = this.store.get<WorkflowRun>('workflow_runs', run.id)
              if (current?.status === 'running') this.halt(current, 'attention', redact(String(e)))
            }
          }
        }
      })
      .finally(() => {
        this.work = undefined
        if (this.dirty && !this.closed) this.schedule()
      })
  }
  private async controlled<T>(
    run: WorkflowRun,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertRunning(run)
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    const timer = setTimeout(
      () => controller.abort(new Error('Workflow operation timeout')),
      this.store.settings().timeoutMs,
    )
    try {
      return await work(controller.signal)
    } finally {
      clearTimeout(timer)
      this.controllers.delete(run.id)
    }
  }
  private taskIds(run: WorkflowRun, step: WorkflowStep): string[] {
    return step.dependsOn.flatMap((id) =>
      run.steps[id].taskId ? [this.currentTask(run.steps[id].taskId!).id] : [],
    )
  }
  private async tick(run: WorkflowRun): Promise<void> {
    this.assertRunning(run)
    this.validateBindings(run)
    for (const step of run.template.steps) {
      const state = run.steps[step.id]
      if (state.status !== 'running' || !state.taskId || step.kind === 'integrate') continue
      const task = this.currentTask(state.taskId)
      state.taskId = task.id
      if (
        ['failed', 'cancelled', 'paused', 'waiting_user'].includes(task.status) &&
        task.waitReason !== 'approval'
      )
        throw new Error(
          `步驟需要檢查 / Step needs attention: ${step.name}\n${task.error || task.status}`,
        )
      if (task.status !== 'completed') continue
      if (step.kind === 'task') {
        if (
          step.publishArtifact &&
          !this.store
            .list<Artifact>('artifacts')
            .some(
              (a) =>
                a.taskId === task.id &&
                a.projectId === run.projectId &&
                a.revision === task.integration?.revision,
            )
        )
          throw new Error(
            `${step.name}: 尚未 publish_artifact 此完成快照的契約，未交接。No published artifact for the completed revision.`,
          )
        state.revision = task.integration?.revision
        if (!state.revision || task.integration?.status !== 'staged')
          throw new Error('Workflow task lacks a safe staged revision')
      } else {
        const review = this.store.require<Review>('reviews', state.reviewId!)
        if (!finalizedReview(review, task))
          throw new Error('Review did not finish with a structured verdict')
      }
      state.status = 'completed'
      this.persist(run)
    }
    // Wait for every review of a source before repairing that source. Old immutable reviews remain auditable.
    for (const source of run.template.steps.filter((s) => s.kind === 'task')) {
      const reviews = run.template.steps.filter(
        (s) => s.kind === 'review' && s.sourceStepId === source.id,
      )
      if (!reviews.length || !reviews.every((s) => run.steps[s.id].status === 'completed')) continue
      const rejected = reviews
        .map((s) => this.store.require<Review>('reviews', run.steps[s.id].reviewId!))
        .filter((r) => r.verdict === 'changes_requested')
      if (!rejected.length) continue
      const state = run.steps[source.id]
      if (state.fixes >= run.template.maxFixes)
        throw new Error(
          `${source.name}: 已達回修上限。Fix limit reached; inspect findings and start a revised workflow if needed.`,
        )
      const workspace = this.store.require<Workspace>(
        'workspaces',
        this.currentTask(state.taskId!).workspaceId!,
      )
      if (
        (await git(workspace.path, ['status', '--porcelain'])) ||
        (await git(workspace.path, ['rev-parse', 'HEAD'])) !== state.revision
      )
        throw new Error('Source changed after review; refusing automatic fixes')
      this.assertRunning(run)
      const description =
        this.description(run, source) +
        '\nFix the structured findings for revision ' +
        state.revision +
        '.\n' +
        JSON.stringify(
          rejected.map((r) => ({
            summary: r.summary,
            comments: r.comments.filter((c) => !c.resolved),
          })),
        ).slice(0, 24000)
      const fixed = this.orchestrator.createWorkflowTask(
        run,
        source.id,
        description,
        rejected.map((r) => r.taskId!),
        state.taskId,
      )
      state.taskId = fixed.id
      state.status = 'running'
      state.fixes++
      state.revision = undefined
      for (const review of reviews) run.steps[review.id] = { status: 'pending', fixes: 0 }
      // Invalidate downstream approvals/checkpoints without ever replaying an already merged operation.
      for (const integration of run.template.steps.filter(
        (s) => s.kind === 'integrate' && s.sourceStepId === source.id,
      ))
        if (run.steps[integration.id].status !== 'completed')
          run.steps[integration.id].status = 'pending'
      this.persist(run)
    }
    for (const step of run.template.steps) {
      const state = run.steps[step.id]
      if (
        state.status !== 'pending' ||
        !step.dependsOn.every((id) =>
          workflowHandoffReady(run, id, this.store.list('reviews'), this.store.list('tasks')),
        )
      )
        continue
      this.assertRunning(run)
      if (step.kind === 'task') {
        const task = this.orchestrator.createWorkflowTask(
          run,
          step.id,
          this.description(run, step),
          this.taskIds(run, step),
        )
        state.taskId = task.id
        state.status = 'running'
        this.persist(run)
      } else if (step.kind === 'review') {
        const source = run.steps[step.sourceStepId],
          task = this.currentTask(source.taskId!)
        const workspace = this.store.require<Workspace>('workspaces', task.workspaceId!)
        if ((await git(workspace.path, ['rev-parse', 'HEAD'])) !== source.revision)
          throw new Error('Source changed before workflow review')
        this.assertRunning(run)
        const review = await this.orchestrator.requestReview(
          workspace.id,
          run.conversationId,
          run.bindings[step.roleId],
          undefined,
          {
            runId: run.id,
            stepId: step.id,
            dependencies: this.taskIds(run, step),
            instructions: `Workflow review role: ${run.template.roles.find((r) => r.id === step.roleId)!.name}.\nUser requested outcome:\n${run.requirement}\nAdditional criteria:\n${step.instructions}`,
          },
        )
        state.reviewId = review.id
        state.taskId = review.taskId
        state.status = 'running'
        this.persist(run)
      } else await this.integrate(run, step)
    }
    if (Object.values(run.steps).every((s) => s.status === 'completed')) {
      this.assertRunning(run)
      run.status = 'completed'
      this.persist(run)
      this.message(run, `工作流程完成 / Workflow completed: ${run.template.name}`)
      this.orchestrator.changed()
    }
  }
  private description(run: WorkflowRun, step: WorkflowStep): string {
    const artifacts = step.artifactFrom.flatMap((id) => {
      const source = run.steps[id],
        task = this.currentTask(source.taskId!)
      const selected = this.store
        .list<Artifact>('artifacts')
        .filter((a) => a.taskId === task.id && a.revision === source.revision)
        .map((a) => ({ id: a.id, revision: a.revision, files: a.files.map((f) => f.path) }))
      if (!selected.length) throw new Error(`Required immutable artifacts are missing for ${id}`)
      return selected
    })
    if (step.artifactFrom.length && !artifacts.length)
      throw new Error('Required immutable artifacts are missing')
    if (artifacts.length > 32 || JSON.stringify(artifacts).length > 32000)
      throw new Error(
        'Artifact handoff catalog exceeds its bounded context limit; publish fewer contract files.',
      )
    return `Workflow ${run.id}, step ${step.id}. Role: ${run.template.roles.find((r) => r.id === step.roleId)!.name}.\nUser requirement:\n${run.requirement}\nStep instructions:\n${step.instructions}\nThis workflow is host-scheduled. Do not start/delegate extra tasks; use publish_artifact/read_artifact and report_progress as needed. Do not merge/reset/check out other worktrees.\n${step.publishArtifact ? 'REQUIRED: Write the contract files, then call structured publish_artifact. The host safely checkpoints this configured publisher step before publishing; do not run Git or shell to checkpoint, even if older template instructions mention it. No artifact means no handoff.' : ''}\nArtifact handoff catalog (immutable commit IDs; not automatic worktree synchronization): ${JSON.stringify(artifacts)}. Use read_artifact to obtain their actual contents and materialize needed files using native file tools.`
  }
  private async integrate(run: WorkflowRun, step: WorkflowStep): Promise<void> {
    if (
      run.template.steps.some(
        (s) =>
          s.kind !== 'integrate' &&
          !workflowHandoffReady(run, s.id, this.store.list('reviews'), this.store.list('tasks')),
      )
    )
      return
    const source = run.steps[step.sourceStepId],
      task = this.currentTask(source.taskId!)
    const workspace = this.store.require<Workspace>('workspaces', task.workspaceId!)
    const reviews = run.template.steps.filter(
      (s) => s.kind === 'review' && s.sourceStepId === step.sourceStepId,
    )
    if (reviews.some((s) => run.steps[s.id].status !== 'completed')) return
    const reviewerIds = [...new Set(reviews.map((s) => run.bindings[s.roleId]))]
    if (
      !source.revision ||
      !reviewerIds.length ||
      reviewerIds.some(
        (id) =>
          !reviewApproved(
            this.store.list('reviews'),
            this.store.list('tasks'),
            workspace.id,
            source.revision!,
            id,
          ),
      )
    )
      throw new Error('Integration is missing successful exact-version workflow approval')
    const state = run.steps[step.id],
      oldTaskId = state.taskId
    const hostTask: Task = {
      id: randomUUID(),
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentId: task.agentId,
      name: step.name,
      description:
        'Host workflow integration: exact snapshot tests and existing review/merge gates.',
      status: 'reviewing',
      dependencies: this.taskIds(run, step),
      createdAt: new Date().toISOString(),
      correlationId: run.id,
      depth: 0,
      workspaceId: workspace.id,
      workflow: { runId: run.id, stepId: step.id },
      integration: {
        status: 'checking',
        detail: '正在測試確切整合快照。Testing exact integration snapshot.',
      },
      ...(oldTaskId ? { retryOf: oldTaskId } : {}),
    }
    this.store.put('tasks', hostTask)
    if (oldTaskId)
      this.store.put('tasks', { ...this.currentTask(oldTaskId), supersededBy: hostTask.id })
    state.taskId = hostTask.id
    state.status = 'running'
    this.persist(run)
    try {
      const result = await this.controlled(run, (signal) =>
        this.orchestrator.automatic!.finish(
          this.store.require<Project>('projects', run.projectId),
          workspace,
          signal,
          undefined,
          { expectedRevision: source.revision, reviewerIds },
        ),
      )
      this.assertRunning(run)
      this.store.put('tasks', {
        ...hostTask,
        integration: result,
        status: result.status === 'attention' ? 'waiting_user' : 'completed',
        waitReason: result.status === 'attention' ? 'integration' : undefined,
        error: result.status === 'attention' ? result.detail : undefined,
        completedAt: new Date().toISOString(),
      })
      if (result.status === 'attention') throw new Error(result.detail)
      state.status = 'completed'
      state.revision = result.revision
      this.persist(run)
    } catch (e) {
      const current = this.store.require<Task>('tasks', hostTask.id)
      this.store.put('tasks', {
        ...current,
        status: 'waiting_user',
        waitReason: 'integration',
        integration: { status: 'attention', detail: redact(String(e)) },
        error: redact(String(e)),
      })
      throw e
    }
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.orchestrator.workflowChanged = undefined
    for (const controller of this.controllers.values()) controller.abort(new Error('App closed'))
    await this.work
  }
}
