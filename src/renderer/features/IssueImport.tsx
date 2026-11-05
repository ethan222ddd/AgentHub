import { CircleDot, ExternalLink, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AgentProfile,
  Conversation,
  GitHubIssue,
  GitHubStatus,
  Project,
} from '../../shared/types'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'

interface Props {
  project: Project
  conversation: Conversation
  agents: AgentProfile[]
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
  close(): void
  imported(): void
}
/** Pick an open GitHub issue and hand it to agents as a task, plan-first by default. */
export function IssueImport({
  project,
  conversation,
  agents,
  en,
  perform,
  close,
  imported,
}: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const ref = useDialog(close)
  const [status, setStatus] = useState<GitHubStatus>()
  const [issues, setIssues] = useState<GitHubIssue[]>()
  const [selected, setSelected] = useState<number>()
  const [recipients, setRecipients] = useState<string[]>(agents[0] ? [agents[0].id] : [])
  const [planFirst, setPlanFirst] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    setIssues(undefined)
    try {
      const next = (await perform({ op: 'github.status', projectId: project.id })) as GitHubStatus
      setStatus(next)
      if (next.authenticated && next.repo)
        setIssues((await perform({ op: 'github.issues', projectId: project.id })) as GitHubIssue[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [perform, project.id])
  useEffect(() => {
    void load()
  }, [load])
  const start = async () => {
    if (!selected || !recipients.length) return
    setBusy(true)
    try {
      await perform({
        op: 'github.issue.import',
        conversationId: conversation.id,
        number: selected,
        recipients,
        planFirst,
      })
      imported()
    } finally {
      setBusy(false)
    }
  }
  const guidance = !status
    ? text('正在讀取 GitHub 狀態…', 'Checking GitHub…')
    : !status.available
      ? text(
          '找不到 GitHub CLI。請安裝 gh（winget install --id GitHub.cli），再執行 gh auth login。',
          'GitHub CLI not found. Install gh (winget install --id GitHub.cli), then run gh auth login.',
        )
      : !status.authenticated
        ? text(
            '尚未登入 GitHub。請在終端機執行 gh auth login，完成後按重新整理。',
            'Not logged in. Run gh auth login in a terminal, then refresh.',
          )
        : !status.repo
          ? text(
              '這個專案資料夾沒有 GitHub 遠端（origin）。',
              'This project folder has no GitHub remote (origin).',
            )
          : ''
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section
        ref={ref}
        className="issue-import"
        role="dialog"
        aria-modal="true"
        aria-label={text('從 GitHub Issue 派工', 'Assign a GitHub issue')}
      >
        <header>
          <CircleDot size={17} />
          <h3>{text('從 GitHub Issue 派工', 'Assign a GitHub issue')}</h3>
          {status?.repo && <code>{status.repo.nameWithOwner}</code>}
          <Button
            size="icon"
            variant="ghost"
            aria-label={text('重新整理', 'Refresh')}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Close issue import" onClick={close}>
            <X size={16} />
          </Button>
        </header>
        <div className="issue-body">
          {(guidance || error) && <p className="issue-guidance">{error || guidance}</p>}
          {issues && !issues.length && (
            <p className="panel-empty">{text('沒有開啟中的 Issue。', 'No open issues.')}</p>
          )}
          {!!issues?.length && (
            <ul
              className="issue-list"
              role="listbox"
              aria-label={text('開啟中的 Issue', 'Open issues')}
            >
              {issues.map((issue) => (
                <li key={issue.number}>
                  <button
                    role="option"
                    aria-selected={selected === issue.number}
                    className={selected === issue.number ? 'selected' : ''}
                    onClick={() => setSelected(issue.number)}
                  >
                    <span className="issue-number">#{issue.number}</span>
                    <span className="issue-title">{issue.title}</span>
                    <span className="issue-meta">
                      {issue.labels.slice(0, 3).map((l) => (
                        <em key={l}>{l}</em>
                      ))}
                      {issue.author && <span>@{issue.author}</span>}
                    </span>
                  </button>
                  <button
                    className="issue-open"
                    aria-label={text(
                      `在 GitHub 開啟 #${issue.number}`,
                      `Open #${issue.number} on GitHub`,
                    )}
                    onClick={() => void perform({ op: 'github.open', url: issue.url })}
                  >
                    <ExternalLink size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer>
          <fieldset>
            <legend>{text('交給', 'Assign to')}</legend>
            {agents.map((a) => (
              <label key={a.id} className="inline">
                <input
                  type="checkbox"
                  checked={recipients.includes(a.id)}
                  onChange={(e) =>
                    setRecipients(
                      e.target.checked
                        ? [...recipients, a.id]
                        : recipients.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </fieldset>
          <label className="inline">
            <input
              type="checkbox"
              checked={planFirst}
              onChange={(e) => setPlanFirst(e.target.checked)}
            />
            {text('先提計畫，批准後才改檔', 'Plan first; change files only after approval')}
          </label>
          <Button disabled={!selected || !recipients.length || busy} onClick={() => void start()}>
            {text('派工', 'Assign')}
          </Button>
        </footer>
      </section>
    </div>
  )
}
