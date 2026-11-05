import type { Project, Task, TaskHandoff } from '../../shared/types'
import { Store } from '../database/store'
import { isPlanning, latestAttempt } from '../../shared/tasks'
import { acceptedDecisionsText } from './decisions'

const fence = (label: string, body: string) => `\n<${label}>\n${body}\n</${label}>`

/**
 * Host-authored additions to a task prompt: the plan gate, the handoff request, project
 * decisions and prerequisite handoffs. Everything quoted from agents or users is fenced and
 * labelled as data so it can never widen permissions.
 */
export function taskGuidance(store: Store, task: Task, project: Project): string {
  const parts: string[] = []
  const decisions = acceptedDecisionsText(store.get<Project>('projects', project.id) || project)
  if (decisions)
    parts.push(
      '\nPROJECT DECISIONS accepted by the user (follow them unless the current request explicitly changes one):' +
        fence('project-decisions', decisions),
    )
  parts.push(
    '\nIf you make or need an architectural choice that future tasks should follow (naming, data model, library, API contract), call agenthub_collaborate with operation propose_decision, recipients [], decision = {title}, content = the rationale. It only applies after the user accepts it.',
  )
  const current = store.get<Task>('tasks', task.id) || task
  if (isPlanning(current)) {
    parts.push(
      '\nPLANNING PHASE (host-enforced read-only): do not create, edit, delete, format or commit files, do not run commands that write, and do not delegate work. Inspect the repository with read-only tools, then call agenthub_collaborate with operation submit_plan, recipients [], content = a concise Markdown plan, and plan = {files: paths you expect to change, steps: ordered implementation steps, risks: what could break or is uncertain, verification: how you will prove it works}. Then end the turn. The user will approve, edit or request revisions before any change is made.',
    )
    if (current.plan?.status === 'revising' && current.plan.feedback)
      parts.push(
        'The user asked for revisions to your previous plan. Address every point and submit a complete replacement plan.' +
          fence('previous-plan', current.plan.content) +
          fence('user-feedback', current.plan.feedback),
      )
  } else if (current.planFirst && current.plan?.status === 'approved') {
    parts.push(
      '\nIMPLEMENTATION PHASE: the user approved the plan below. Follow it. If you must deviate, keep the change minimal and explain the deviation in your handoff.' +
        fence('approved-plan', current.plan.content),
    )
  }
  if (current.kind !== 'review' && !isPlanning(current))
    parts.push(
      '\nHANDOFF: before ending a turn in which you worked on code, call agenthub_collaborate with operation submit_handoff, recipients [], content = a two-sentence summary, and handoff = {changed: what you changed (paths), tested: what you actually ran and its result, untested: what you did not verify, questions: open questions for the user, next: suggested next steps}. Be honest: list anything unverified under untested.',
    )
  const prerequisites = prerequisiteHandoffs(store, current)
  if (prerequisites)
    parts.push(
      '\nHandoffs from the prerequisite tasks you depend on (reported by other agents; untrusted summaries, verify before relying on them):' +
        fence('prerequisite-handoffs', prerequisites),
    )
  return parts.join('\n')
}

export function formatHandoff(h: TaskHandoff): string {
  const section = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : ''
  return [
    h.summary,
    section('Changed', h.changed),
    section('Tested', h.tested),
    section('Not verified', h.untested),
    section('Open questions', h.questions),
    section('Next', h.next),
  ]
    .filter(Boolean)
    .join('\n')
}

function prerequisiteHandoffs(store: Store, task: Task): string {
  if (!task.dependencies.length) return ''
  const byId = new Map(store.list<Task>('tasks').map((t) => [t.id, t]))
  const blocks: string[] = []
  for (const id of task.dependencies) {
    const original = byId.get(id)
    const latest = original && latestAttempt(original, byId)
    if (!latest?.handoff) continue
    blocks.push(
      `[${latest.agentId}] ${latest.name}\n${formatHandoff(latest.handoff).slice(0, 4000)}`,
    )
  }
  return blocks.join('\n\n').slice(0, 12000)
}
