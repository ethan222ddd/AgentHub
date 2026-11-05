import { randomUUID } from 'node:crypto'
import type { Decision, Message, Project, Task } from '../../shared/types'
import { Store } from '../database/store'
import { redact } from '../permissions/paths'

export const MAX_DECISIONS = 100
/** Accepted decisions injected into a prompt are bounded so a long log cannot crowd out the task. */
const PROMPT_BUDGET = 6000

/** An agent's proposal: adopted at once in autonomous mode, otherwise waits for the user. */
export function proposeDecision(store: Store, task: Task, title: string, detail: string): Decision {
  const project = store.require<Project>('projects', task.projectId)
  const decisions = project.decisions || []
  const clean = redact(title).trim()
  const duplicate = decisions.find(
    (d) => d.status !== 'rejected' && d.title.toLowerCase() === clean.toLowerCase(),
  )
  if (duplicate) return duplicate
  if (decisions.length >= MAX_DECISIONS)
    throw new Error('Decision log is full. Ask the user to archive old decisions first.')
  // Autonomous rooms adopt the team's contract at once; the user can still edit or reject it.
  const autonomous = store.settings().autonomy === 'auto'
  const now = new Date().toISOString()
  const decision: Decision = {
    id: randomUUID(),
    title: clean,
    detail: redact(detail).trim().slice(0, 4000),
    status: autonomous ? 'accepted' : 'proposed',
    proposedBy: task.agentId,
    taskId: task.id,
    createdAt: now,
    ...(autonomous ? { decidedAt: now } : {}),
  }
  store.put('projects', { ...project, decisions: [...decisions, decision] })
  store.put('messages', {
    id: randomUUID(),
    projectId: task.projectId,
    conversationId: task.conversationId,
    senderId: 'system',
    recipientIds: ['user'],
    content: autonomous
      ? `${task.agentId} 記錄了專案決策（全自動模式直接採用，可在「決策」修改或否決）：${decision.title}\n${task.agentId} recorded a project decision (adopted automatically).`
      : `${task.agentId} 提議專案決策，等待你確認：${decision.title}\n${task.agentId} proposed a project decision for your confirmation.`,
    type: 'system',
    timestamp: decision.createdAt,
    taskId: task.id,
    correlationId: task.correlationId,
    delivery: 'completed',
  } satisfies Message)
  return decision
}

export function saveDecision(
  store: Store,
  projectId: string,
  input: { id?: string; title: string; detail: string; status: Decision['status'] },
): Decision {
  const project = store.require<Project>('projects', projectId)
  const decisions = project.decisions || []
  const now = new Date().toISOString()
  const existing = input.id ? decisions.find((d) => d.id === input.id) : undefined
  if (input.id && !existing) throw new Error('Decision not found')
  if (!existing && decisions.length >= MAX_DECISIONS)
    throw new Error('Decision log is full. Delete old decisions first.')
  const decision: Decision = existing
    ? {
        ...existing,
        title: input.title,
        detail: input.detail,
        status: input.status,
        decidedAt: input.status !== existing.status ? now : existing.decidedAt,
      }
    : {
        id: randomUUID(),
        title: input.title,
        detail: input.detail,
        status: input.status,
        proposedBy: 'user',
        createdAt: now,
        decidedAt: input.status === 'proposed' ? undefined : now,
      }
  store.put('projects', {
    ...project,
    decisions: existing
      ? decisions.map((d) => (d.id === decision.id ? decision : d))
      : [...decisions, decision],
  })
  return decision
}

export function deleteDecision(store: Store, projectId: string, id: string): void {
  const project = store.require<Project>('projects', projectId)
  if (!(project.decisions || []).some((d) => d.id === id)) throw new Error('Decision not found')
  store.put('projects', { ...project, decisions: project.decisions!.filter((d) => d.id !== id) })
}

/** Newest accepted decisions first, until the prompt budget is spent. */
export function acceptedDecisionsText(project: Project): string {
  const accepted = (project.decisions || []).filter((d) => d.status === 'accepted').reverse()
  const lines: string[] = []
  let used = 0
  for (const d of accepted) {
    const line = `- ${d.title}${d.detail ? `: ${d.detail.replace(/\s+/g, ' ')}` : ''}`
    if (used + line.length > PROMPT_BUDGET) break
    lines.push(line)
    used += line.length
  }
  const omitted = accepted.length - lines.length
  return lines.join('\n') + (omitted ? `\n(${omitted} older accepted decisions omitted)` : '')
}
