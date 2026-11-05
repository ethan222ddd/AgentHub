import type { Project, Task } from '../../shared/types'
import { Store } from '../database/store'
import { isPlanning } from '../../shared/tasks'

const fence = (label: string, body: string) => `\n<${label}>\n${body}\n</${label}>`

/**
 * Host-authored additions to a task prompt: the plan gate, plus (in later sections) handoff,
 * project decisions and prerequisite summaries. Everything quoted from agents or users is
 * fenced and labelled as data so it can never widen permissions.
 */
export function taskGuidance(store: Store, task: Task, project: Project): string {
  void project
  const parts: string[] = []
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
      '\nIMPLEMENTATION PHASE: the user approved the plan below. Follow it. If you must deviate, keep the change minimal and explain the deviation in your final report.' +
        fence('approved-plan', current.plan.content),
    )
  }
  return parts.join('\n')
}
