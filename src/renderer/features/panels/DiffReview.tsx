import { MessageSquarePlus, Send, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { AgentProfile, Task, Workspace } from '../../../shared/types'
import { Button } from '../../components/ui'
import { parseUnifiedDiff } from '../../lib/diff-lines'
import type { Diff } from './types'

interface Comment {
  file: string
  line: number
  content: string
}
interface Props {
  workspace: Workspace
  diff: Diff | undefined
  tasks: Task[]
  agents: AgentProfile[]
  conversationId: string
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
}
/**
 * Reads a workspace diff line by line. Clicking a new-version line opens a comment; queued
 * comments go to the workspace's agent as one message, which starts a normal task.
 */
export function DiffReview({ workspace, diff, tasks, agents, conversationId, en, perform }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const agentName = agents.find((a) => a.id === workspace.agentId)?.name || workspace.agentId
  const candidates = tasks
    .filter((t) => t.workspace === workspace.path && t.revision && !t.supersededBy)
    .slice(-10)
    .reverse()
  const [base, setBase] = useState('')
  const [since, setSince] = useState<Diff>()
  const [comments, setComments] = useState<Comment[]>([])
  const [open, setOpen] = useState<{ file: string; line: number }>()
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setComments([])
    setOpen(undefined)
    setBase('')
    setSince(undefined)
  }, [workspace.id])
  useEffect(() => {
    if (!base) return setSince(undefined)
    let live = true
    void perform({ op: 'git.diff', workspaceId: workspace.id, taskId: base }).then((d) => {
      if (live) setSince(d as Diff)
    })
    return () => {
      live = false
    }
  }, [base, workspace.id, perform])
  const shown = base ? since : diff
  const files = useMemo(() => parseUnifiedDiff(shown?.diff || ''), [shown?.diff])
  const at = (file: string, line: number) =>
    comments.filter((c) => c.file === file && c.line === line)
  const add = () => {
    if (!open || !draft.trim()) return
    setComments([...comments, { ...open, content: draft.trim() }])
    setDraft('')
    setOpen(undefined)
  }
  const submit = async () => {
    setBusy(true)
    try {
      await perform({
        op: 'diff.feedback',
        conversationId,
        workspaceId: workspace.id,
        comments,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setSent(
        text(
          `已把 ${comments.length} 則意見交給 ${agentName}，會建立一個新任務。`,
          `Sent ${comments.length} comments to ${agentName} as a new task.`,
        ),
      )
      setComments([])
      setNote('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="diff-review">
      <div className="diff-review-bar">
        <label className="inline">
          {text('比較基準', 'Compare')}
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">{text('尚未提交的變更', 'Uncommitted changes')}</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {text('任務開始以來：', 'Since task: ')}
                {t.name.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        <small className="muted">{text('點任一行新增意見', 'Click a line to comment')}</small>
      </div>
      {shown?.status && !base && <pre className="git-status">{shown.status}</pre>}
      {!files.length ? (
        <p className="panel-empty">
          {base
            ? text('這個任務開始以來沒有檔案變更。', 'No changes since this task started.')
            : text(
                '沒有尚未提交的變更。自動管理的專案會在任務完成時提交，請把比較基準改成某個任務。',
                'No uncommitted changes. Automatic projects commit when a task finishes; compare against a task instead.',
              )}
        </p>
      ) : (
        files.map((file) => (
          <details className="diff-file" key={file.path} open={files.length <= 6}>
            <summary>
              <code>{file.path}</code>
              <span className="diff-stat">
                <b className="add">+{file.additions}</b> <b className="del">−{file.deletions}</b>
              </span>
            </summary>
            <table className="diff-table">
              <tbody>
                {file.lines.map((line, i) => (
                  <Fragment key={i}>
                    <tr
                      className={`diff-${line.kind} ${line.newLine ? 'commentable' : ''}`}
                      onClick={() =>
                        line.newLine && setOpen({ file: file.path, line: line.newLine })
                      }
                    >
                      <td className="ln">{line.oldLine ?? ''}</td>
                      <td className="ln">{line.newLine ?? ''}</td>
                      <td className="code">
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                        {line.text}
                      </td>
                    </tr>
                    {line.newLine &&
                      at(file.path, line.newLine).map((c, k) => (
                        <tr className="diff-comment" key={`c${k}`}>
                          <td colSpan={3}>
                            <div className="diff-comment-row">
                              <span>{c.content}</span>
                              <button
                                aria-label={text('移除意見', 'Remove comment')}
                                onClick={() => setComments(comments.filter((x) => x !== c))}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {open && open.file === file.path && open.line === line.newLine && (
                      <tr className="diff-comment-editor">
                        <td colSpan={3}>
                          <textarea
                            autoFocus
                            rows={2}
                            aria-label={text('行內意見', 'Line comment')}
                            placeholder={text(
                              `第 ${line.newLine} 行：哪裡要改、為什麼`,
                              `Line ${line.newLine}: what to change and why`,
                            )}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add()
                              if (e.key === 'Escape') setOpen(undefined)
                            }}
                          />
                          <div className="actions">
                            <Button size="sm" disabled={!draft.trim()} onClick={add}>
                              <MessageSquarePlus size={13} />
                              {text('加入意見', 'Add comment')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setOpen(undefined)}>
                              {text('取消', 'Cancel')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </details>
        ))
      )}
      {!!comments.length && (
        <div className="diff-review-send">
          <strong>
            {text(`${comments.length} 則意見待送出`, `${comments.length} comments pending`)}
          </strong>
          <textarea
            rows={2}
            aria-label={text('整體說明', 'Overall note')}
            placeholder={text('整體說明（選填）', 'Overall note (optional)')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            <Send size={13} />
            {text(`交給 ${agentName} 修改`, `Send to ${agentName}`)}
          </Button>
        </div>
      )}
      {sent && (
        <p className="diff-sent" role="status">
          {sent}
        </p>
      )}
    </section>
  )
}
