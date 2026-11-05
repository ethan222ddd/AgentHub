import {
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
  Upload,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'
import type { PullRequestPreview, Task } from '../../../shared/types'
import { Button } from '../../components/ui'

interface Props {
  task: Task
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
}
/** Open a PR from a finished task, then follow its CI and hand failures back to the agent. */
export function PullRequestBox({ task, en, perform }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const [preview, setPreview] = useState<PullRequestPreview>()
  const [busy, setBusy] = useState('')
  const run = async (label: string, request: Record<string, unknown>) => {
    setBusy(label)
    try {
      return await perform(request)
    } finally {
      setBusy('')
    }
  }
  const pr = task.pullRequest
  if (!pr) {
    if (
      task.kind === 'review' ||
      task.workflow ||
      !['completed', 'waiting_user'].includes(task.status)
    )
      return null
    if (!preview)
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            void run('prepare', { op: 'github.pr.prepare', taskId: task.id }).then((p) =>
              setPreview(p as PullRequestPreview),
            )
          }
        >
          <GitPullRequest size={13} />
          {busy === 'prepare'
            ? text('檢查中…', 'Checking…')
            : text('建立 GitHub PR', 'Open GitHub PR')}
        </Button>
      )
    return (
      <form
        className="pr-preview"
        onSubmit={(e) => {
          e.preventDefault()
          if (
            !window.confirm(
              text(
                `把分支 ${preview.branch} 推送到 ${preview.repo}，並建立 PR 到 ${preview.base}？`,
                `Push ${preview.branch} to ${preview.repo} and open a PR into ${preview.base}?`,
              ),
            )
          )
            return
          void run('create', {
            op: 'github.pr.create',
            taskId: task.id,
            title: preview.title,
            body: preview.body,
            branch: preview.branch,
          }).then(() => setPreview(undefined))
        }}
      >
        <h6>
          <GitPullRequest size={13} />
          {preview.repo} · {preview.base} ← {preview.branch}
        </h6>
        <label>
          {text('標題', 'Title')}
          <input
            value={preview.title}
            maxLength={256}
            onChange={(e) => setPreview({ ...preview, title: e.target.value })}
          />
        </label>
        <label>
          {text('分支', 'Branch')}
          <input
            value={preview.branch}
            pattern="agenthub/[A-Za-z0-9._\-]{1,80}"
            onChange={(e) => setPreview({ ...preview, branch: e.target.value })}
          />
        </label>
        <label>
          {text('說明', 'Description')}
          <textarea
            rows={6}
            value={preview.body}
            onChange={(e) => setPreview({ ...preview, body: e.target.value })}
          />
        </label>
        <details>
          <summary>
            {text(
              `${preview.commits.length} 個提交、${preview.files.length} 個檔案`,
              `${preview.commits.length} commits, ${preview.files.length} files`,
            )}
          </summary>
          <pre>{[...preview.commits, '', ...preview.files].join('\n')}</pre>
        </details>
        <div className="actions">
          <Button size="sm" type="submit" disabled={!!busy || !preview.title.trim()}>
            <Upload size={13} />
            {busy === 'create'
              ? text('推送中…', 'Pushing…')
              : text('推送並建立 PR', 'Push and open PR')}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setPreview(undefined)}>
            {text('取消', 'Cancel')}
          </Button>
        </div>
        <p className="muted">
          {text(
            '只會推送新分支，不會強制推送或合併。',
            'Pushes a new branch only; never force-pushes or merges.',
          )}
        </p>
      </form>
    )
  }
  const checks = pr.checks
  const icon =
    checks?.state === 'passing' ? (
      <CircleCheck size={13} />
    ) : checks?.state === 'failing' ? (
      <CircleX size={13} />
    ) : (
      <CircleDashed size={13} />
    )
  const label =
    checks?.state === 'passing'
      ? text('CI 通過', 'CI passing')
      : checks?.state === 'failing'
        ? text('CI 失敗', 'CI failing')
        : checks?.state === 'pending'
          ? text('CI 執行中', 'CI running')
          : checks?.state === 'none'
            ? text('沒有 CI 檢查', 'No CI checks')
            : text('尚未讀取 CI', 'CI not checked')
  const tone =
    checks?.state === 'passing' ? 'good' : checks?.state === 'failing' ? 'critical' : 'neutral'
  return (
    <section className="pr-box">
      <header>
        <GitPullRequest size={14} />
        <button
          className="pr-link"
          onClick={() => void perform({ op: 'github.open', url: pr.url })}
        >
          PR #{pr.number}
          <ExternalLink size={11} />
        </button>
        <span className="pr-state">{pr.state || 'OPEN'}</span>
        <span className={`status-chip tone-${tone}`}>
          {icon}
          {label}
        </span>
      </header>
      {checks?.state === 'failing' && (
        <p className="pr-failing">{checks.failing.map((f) => f.name).join(', ')}</p>
      )}
      <div className="actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={!!busy}
          onClick={() => void run('refresh', { op: 'github.pr.refresh', taskId: task.id })}
        >
          <RefreshCw size={12} className={busy === 'refresh' ? 'spin' : ''} />
          {text('重新整理 CI', 'Refresh CI')}
        </Button>
        {checks?.state === 'failing' && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => void run('fix', { op: 'github.ci.fix', taskId: task.id })}
          >
            <Wrench size={12} />
            {text('交給代理修正 CI', 'Ask the agent to fix CI')}
          </Button>
        )}
        {task.source?.kind === 'ci_fix' && task.status === 'completed' && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => {
              if (
                window.confirm(
                  text(
                    `把這個工作區的修正推送到 PR #${pr.number} 的分支 ${pr.branch}？`,
                    `Push this workspace's fix to ${pr.branch} (PR #${pr.number})?`,
                  ),
                )
              )
                void run('push', { op: 'github.pr.push', taskId: task.id })
            }}
          >
            <Upload size={12} />
            {text('推送修正到 PR', 'Push fix to PR')}
          </Button>
        )}
      </div>
      {checks && (
        <small className="muted">
          {text('上次檢查', 'Checked')} {new Date(checks.checkedAt).toLocaleTimeString()}
        </small>
      )}
    </section>
  )
}
