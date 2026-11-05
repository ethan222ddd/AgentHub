import type { Workspace } from '../../shared/types'
import { withinWorkspace } from '../permissions/paths'

export interface LineComment {
  file: string
  line: number
  content: string
}

/**
 * Turns the user's diff line comments into one message for the workspace's agent. Every path
 * must resolve inside that workspace, so a comment cannot point the agent at other files.
 */
export async function diffFeedbackMessage(
  workspace: Workspace,
  comments: LineComment[],
  note?: string,
): Promise<string> {
  if (!comments.length) throw new Error('Add at least one comment')
  for (const comment of comments) await withinWorkspace(workspace.path, comment.file, true)
  const lines = comments.map(
    (c) => `- ${c.file.replace(/\\/g, '/')}:${c.line} — ${c.content.replace(/\s+/g, ' ').trim()}`,
  )
  return [
    `使用者對你工作區 Diff 的行內意見（分支 ${workspace.branch}）。請逐條處理，完成後在交接摘要說明每一條的處理方式。`,
    `Inline review comments from the user on your workspace diff (branch ${workspace.branch}). Address each one and explain how in your handoff.`,
    ...lines,
    note?.trim() ? `\n${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
