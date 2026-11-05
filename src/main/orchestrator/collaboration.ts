import { createHash, randomUUID } from 'node:crypto'
import type { CollaborationInput } from '../../shared/schemas'
import type {
  Activity,
  AgentProfile,
  AppEvent,
  Conversation,
  Message,
  Project,
  Review,
  Task,
  Workspace,
} from '../../shared/types'
import { isPlanning } from '../../shared/tasks'
import { AttachmentStore } from '../attachments/store'
import { Store } from '../database/store'
import { git } from '../git/workspaces'
import { withinWorkspace } from '../permissions/paths'
import { ArtifactStore } from './artifacts'
import { ContextMemory } from './context'
import { proposeDecision } from './decisions'

export interface CollaborationHost {
  store: Store
  dedupe: Set<string>
  changed(): void
  publish(event: AppEvent): void
  turnCount(correlationId: string): number
  ask(
    task: Task,
    tool: string,
    detail: string,
    signal: AbortSignal,
    risk?: string,
  ): Promise<boolean>
  enqueue(
    c: Conversation,
    agentId: string,
    description: string,
    correlationId: string,
    depth: number,
    dependencies: string[],
    extra: Pick<Partial<Task>, 'attachmentIds'>,
  ): Task
  pump(): void
}
const planningOperations = new Set([
  'propose_decision',
  'search_context',
  'read_context',
  'read_artifact',
  'report_progress',
  'submit_plan',
])
export async function deliverCollaboration(
  host: CollaborationHost,
  task: Task,
  input: CollaborationInput,
  signal: AbortSignal,
): Promise<unknown> {
  const c = host.store.require<Conversation>('conversations', task.conversationId)
  if (signal.aborted || c.stopped) throw new Error('Task or room stopped')
  const current = host.store.get<Task>('tasks', task.id) || task
  if (isPlanning(current) && !planningOperations.has(input.operation))
    throw new Error(
      'Planning phase: only read context/artifacts, report progress and submit_plan are allowed until the user approves the plan.',
    )
  if (input.operation === 'propose_decision') {
    if (!input.decision?.title) throw new Error('propose_decision requires decision.title')
    const decision = proposeDecision(host.store, current, input.decision.title, input.content)
    host.changed()
    return {
      proposed: true,
      decisionId: decision.id,
      status: decision.status,
      note: 'Proposed only. It applies to future tasks after the user accepts it.',
    }
  }
  if (input.operation === 'submit_handoff') {
    if (current.kind === 'review')
      throw new Error('Reviews report through submit_review, not submit_handoff')
    host.store.put('tasks', {
      ...current,
      handoff: {
        summary: input.content,
        changed: input.handoff?.changed || [],
        tested: input.handoff?.tested || [],
        untested: input.handoff?.untested || [],
        questions: input.handoff?.questions || [],
        next: input.handoff?.next || [],
        submittedAt: new Date().toISOString(),
      },
    })
    host.changed()
    return {
      submitted: true,
      note: 'Handoff recorded for the user, reviewers and dependent tasks.',
    }
  }
  if (input.operation === 'submit_plan') {
    if (!isPlanning(current))
      throw new Error('submit_plan is only accepted while a plan-first task is planning')
    host.store.put('tasks', {
      ...current,
      plan: {
        ...current.plan!,
        content: input.content,
        files: input.plan?.files || [],
        steps: input.plan?.steps || [],
        risks: input.plan?.risks || [],
        verification: input.plan?.verification || '',
        structured: true,
        submittedAt: new Date().toISOString(),
      },
    })
    host.changed()
    return {
      submitted: true,
      note: 'Plan recorded. End this turn; the user will approve, edit or request revisions before any file is changed.',
    }
  }
  if (input.operation === 'search_context')
    return new ContextMemory(host.store.db).find(task.conversationId, input.content.slice(0, 500))
  if (input.operation === 'read_context')
    return new ContextMemory(host.store.db).read(task.conversationId, input.messageIds || [])
  if (input.operation === 'publish_artifact') {
    const artifact = await new ArtifactStore(host.store).publish(
      task,
      input.paths || [],
      input.content,
    )
    host.changed()
    return artifact
  }
  if (input.operation === 'read_artifact') {
    const artifact = await new ArtifactStore(host.store).read(
      input.artifactId || '',
      task.projectId,
    )
    const activity: Activity = {
      id: randomUUID(),
      agentId: task.agentId,
      taskId: task.id,
      turnId: task.id,
      conversationId: task.conversationId,
      sessionId: host.store.session(task.conversationId, task.agentId)?.nativeId || '',
      type: 'collaboration.read',
      detail: JSON.stringify({
        operation: input.operation,
        artifactId: input.artifactId,
        revision: artifact.revision,
      }),
      timestamp: new Date().toISOString(),
    }
    host.store.activity(activity)
    host.publish({ type: 'activity', activity })
    return artifact
  }
  if (input.operation === 'submit_review' && !task.reviewId) {
    // A tester/reviewer on an ordinary task reporting findings: share them with the team
    // instead of failing the whole turn (and losing its work) over the operation name.
    const findings = (input.comments || [])
      .map((c) => `- [${c.severity}] ${c.file}:${c.line} ${c.content}`)
      .join('\n')
    host.store.put('messages', {
      id: randomUUID(),
      projectId: task.projectId,
      conversationId: task.conversationId,
      senderId: task.agentId,
      recipientIds: input.recipients.length ? input.recipients : ['user'],
      content: `Review report${input.verdict ? ` (${input.verdict})` : ''}:\n${input.content}${findings ? `\n${findings}` : ''}`,
      type: 'collaboration',
      timestamp: new Date().toISOString(),
      taskId: task.id,
      correlationId: task.correlationId,
      delivery: 'completed',
    } satisfies Message)
    host.changed()
    return {
      recorded: true,
      note: 'Recorded as a review report for the team. To get fixes, assign_task the owning agent with the exact findings.',
    }
  }
  if (input.operation === 'submit_review') {
    if (!task.reviewId || !input.verdict)
      throw new Error('A structured review task and verdict are required')
    const review = host.store.require<Review>('reviews', task.reviewId)
    const workspace = host.store.require<Workspace>('workspaces', review.workspaceId)
    if (
      (await git(workspace.path, ['rev-parse', 'HEAD'])) !== review.revision ||
      (await git(workspace.path, ['status', '--porcelain']))
    )
      throw new Error('Review snapshot changed')
    for (const comment of input.comments || [])
      if (comment.file) await withinWorkspace(workspace.path, comment.file)
    host.store.put('reviews', {
      ...review,
      status: 'submitted',
      verdict: input.verdict,
      summary: input.content,
      comments: (input.comments || []).map((comment) => ({
        ...comment,
        id: randomUUID(),
        resolved: false,
      })),
    })
    host.changed()
    return { submitted: true, reviewId: review.id, revision: review.revision }
  }
  const project = host.store.require<Project>('projects', task.projectId)
  const agents = host.store
    .list<AgentProfile>('agents')
    .filter((a) => a.enabled && (!project.agentIds || project.agentIds.includes(a.id)))
  const recipients =
    input.operation === 'broadcast_message'
      ? agents.filter((a) => a.id !== task.agentId).map((a) => a.id)
      : [...new Set(input.recipients)]
  if (recipients.length > host.store.settings().maxFanout)
    throw new Error('Message fanout limit reached')
  if (recipients.some((id) => !agents.some((a) => a.id === id)))
    throw new Error('Unknown recipient')
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        task.correlationId,
        task.agentId,
        input.operation,
        recipients,
        input.content,
        input.attachmentIds || [],
      ]),
    )
    .digest('hex')
  if (host.dedupe.has(digest) || host.store.get('messages', digest))
    return { delivered: false, reason: 'Duplicate request suppressed' }
  const activates = [
    'send_message',
    'request_response',
    'broadcast_message',
    'assign_task',
    'request_review',
  ].includes(input.operation)
  if (activates && task.workflow)
    throw new Error(
      'Workflow steps are scheduled by the host template. Use publish_artifact/read_artifact/report_progress/report_completion; do not start extra agent tasks.',
    )
  if (activates && !recipients.length) throw new Error('At least one recipient is required')
  if (
    activates &&
    c.mode === 'manual' &&
    !(await host.ask(
      task,
      'Start another agent',
      JSON.stringify(input),
      signal,
      'Manual mode requires approval to activate another agent.',
    ))
  )
    throw new Error('Delegation denied')
  if (
    activates &&
    c.mode === 'supervisor' &&
    task.agentId !== c.supervisorId &&
    recipients.some((id) => id !== c.supervisorId)
  )
    throw new Error('Only the selected supervisor may delegate to team members in supervisor mode')
  // Validate the entire fanout before writing any delivery receipts.
  if (activates) {
    new AttachmentStore(host.store).resolve(task.projectId, input.attachmentIds || [])
    if (task.depth + 1 > host.store.settings().maxDepth)
      throw new Error('Delegation depth limit reached')
    if (host.turnCount(task.correlationId) + recipients.length > host.store.settings().maxTurns)
      throw new Error('Agent turn budget reached')
    for (const id of input.dependencies)
      if (host.store.require<Task>('tasks', id).conversationId !== c.id)
        throw new Error('Cross-room dependency refused')
  }
  host.dedupe.add(digest)
  const message: Message = {
    id: digest,
    projectId: c.projectId,
    conversationId: c.id,
    senderId: task.agentId,
    recipientIds: recipients,
    content: input.content,
    type: 'collaboration',
    timestamp: new Date().toISOString(),
    taskId: task.id,
    correlationId: task.correlationId,
    delivery: 'completed',
    ...(input.attachmentIds?.length
      ? {
          attachments: new AttachmentStore(host.store).metadata(
            input.attachmentIds,
            task.projectId,
          ),
        }
      : {}),
  }
  host.store.put('messages', message)
  const tasks = activates
    ? recipients.map((id) =>
        host.enqueue(
          c,
          id,
          `Structured ${input.operation} from ${task.agentId}:\n${input.content}`,
          task.correlationId,
          task.depth + 1,
          input.dependencies,
          { attachmentIds: input.attachmentIds },
        ),
      )
    : []
  host.changed()
  host.pump()
  return {
    delivered: true,
    messageId: message.id,
    taskIds: tasks.map((t) => t.id),
    note: 'Queued. A receipt is not a completed response. Use another structured request to reply.',
  }
}
