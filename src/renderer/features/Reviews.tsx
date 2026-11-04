import { useState } from 'react'
import type {
  AgentProfile,
  Artifact,
  Review,
  UsageRecord,
  Workspace,
  Task,
} from '../../shared/types'
import { Button } from '../components/ui'
import { finalizedReview } from '../../shared/reviews'
export function Reviews({
  reviews,
  tasks,
  workspaces,
  agents,
  conversationId,
  perform,
  en,
}: {
  reviews: Review[]
  tasks: Task[]
  workspaces: Workspace[]
  agents: AgentProfile[]
  conversationId: string
  perform(request: Record<string, unknown>): Promise<unknown>
  en: boolean
}) {
  const [source, setSource] = useState(workspaces[0]?.id || '')
  const [reviewer, setReviewer] = useState(agents.find((a) => a.enabled)?.id || '')
  const [context, setContext] = useState('')
  return (
    <>
      <h4>{en ? 'Independent code review' : '獨立程式碼審查'}</h4>
      <p className="muted">
        {en
          ? 'Review a clean committed snapshot. Source edits are isolated. Findings refer to exact files and lines in that revision.'
          : '審查乾淨且已提交的快照。審查工作與來源修改隔離，評論綁定確切版本、檔案及行號。'}
      </p>
      <label>
        {en ? 'Source workspace' : '來源工作區'}
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {agents.find((a) => a.id === w.agentId)?.name} · {w.branch}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reviewer
        <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          {agents
            .filter((a) => a.enabled)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <Button
        variant="outline"
        disabled={!source || !reviewer}
        onClick={() =>
          void perform({
            op: 'review.request',
            workspaceId: source,
            conversationId,
            reviewerId: reviewer,
          })
        }
      >
        {en ? 'Request review' : '請求 Review'}
      </Button>
      {reviews
        .slice()
        .reverse()
        .map((review) => (
          <section className="review-record" key={review.id}>
            <div className="section-title">
              <b>{agents.find((a) => a.id === review.reviewerId)?.name}</b>
              <small>{review.status}</small>
            </div>
            <code>{review.revision.slice(0, 12)}</code>
            <p>
              {review.status === 'submitted' &&
              tasks.find((t) => t.id === review.taskId)?.status !== 'completed'
                ? en
                  ? 'Verifying reviewer completion'
                  : '正在確認審查回合完成'
                : review.status === 'failed'
                  ? en
                    ? 'Review failed; no valid approval'
                    : '審查失敗，沒有有效批准'
                  : review.verdict || (en ? 'Awaiting verdict' : '等待審查結論')}
            </p>
            <p className="muted">{review.summary}</p>
            {review.comments.map((comment) => (
              <div
                className={`review-comment ${comment.resolved ? 'resolved' : ''}`}
                key={comment.id}
              >
                <button
                  title="Read reviewed code"
                  onClick={() =>
                    void perform({
                      op: 'review.context',
                      reviewId: review.id,
                      commentId: comment.id,
                    }).then((value) => setContext(String(value)))
                  }
                >
                  <code>
                    {comment.file}:{comment.line}
                  </code>
                </button>
                <small>{comment.severity}</small>
                <p>{comment.content}</p>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={comment.resolved}
                    onChange={(e) =>
                      void perform({
                        op: 'review.resolve',
                        reviewId: review.id,
                        commentId: comment.id,
                        resolved: e.target.checked,
                      })
                    }
                  />
                  {en ? 'Resolved' : '已處理'}
                </label>
              </div>
            ))}
            <div className="actions">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !!tasks.find((t) => t.id === review.taskId)?.workflow ||
                  !finalizedReview(
                    review,
                    tasks.find((t) => t.id === review.taskId),
                  )
                }
                onClick={() => void perform({ op: 'review.fix', reviewId: review.id })}
              >
                {en ? 'Request fixes' : '請求修正'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void perform({
                    op: 'review.request',
                    workspaceId: review.sourceWorkspaceId,
                    conversationId,
                    reviewerId: review.reviewerId,
                  })
                }
              >
                {en ? 'Review again' : '重新審查'}
              </Button>
            </div>
          </section>
        ))}
      {context && (
        <section>
          <h4>{en ? 'Reviewed code' : '受審查程式碼'}</h4>
          <pre>{context}</pre>
          <Button size="sm" variant="ghost" onClick={() => setContext('')}>
            {en ? 'Close' : '關閉'}
          </Button>
        </section>
      )}
    </>
  )
}
export function Artifacts({
  artifacts,
  perform,
  en,
}: {
  artifacts: Artifact[]
  perform(request: Record<string, unknown>): Promise<unknown>
  en: boolean
}) {
  const [content, setContent] = useState('')
  return (
    <>
      <h4>{en ? 'Shared specifications & contracts' : '共享規格與契約'}</h4>
      <p className="muted">
        {en
          ? 'Agents publish committed files with SHA-256 and read them through structured tools. Reading a contract does not copy it into another branch.'
          : '代理以結構化工具發布已提交檔案與 SHA-256，其他成員可明確讀取。讀取契約不會自動複製到另一個分支。'}
      </p>
      {!artifacts.length && (
        <p className="panel-empty">
          {en
            ? 'Ask an agent to publish_artifact after checkpointing its contract.'
            : '契約提交後，可請代理使用 publish_artifact 發布。'}
        </p>
      )}
      {artifacts
        .slice()
        .reverse()
        .map((a) => (
          <section className="review-record" key={a.id}>
            <b>{a.name}</b>
            <p>
              <code>{a.revision.slice(0, 12)}</code> · {a.agentId}
            </p>
            {a.files.map((f) => (
              <p className="muted" key={f.path}>
                {f.path}
                <br />
                <code>
                  {f.sha256.slice(0, 16)} · {f.bytes} B
                </code>
              </p>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void perform({ op: 'artifact.read', id: a.id }).then((value) =>
                  setContent(JSON.stringify(value, null, 2)),
                )
              }
            >
              {en ? 'Inspect immutable artifact' : '檢視不可變契約'}
            </Button>
          </section>
        ))}
      {content && <pre>{content}</pre>}
    </>
  )
}
export function Usage({ usage, en }: { usage: UsageRecord[]; en: boolean }) {
  const tokens = usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0)
  const costs = usage.filter((u) => u.costUsd !== undefined)
  return (
    <section className="usage-summary">
      <span>
        {en ? 'Reported tokens' : '已回報 Token'} <b>{tokens.toLocaleString()}</b>
      </span>
      <span>
        {en ? 'Estimated USD' : '已回報估計 USD'}{' '}
        <b>
          {costs.length
            ? '$' + costs.reduce((sum, u) => sum + (u.costUsd || 0), 0).toFixed(4)
            : '—'}
        </b>
      </span>
      <small>
        {en
          ? 'Missing provider usage is not counted as verified zero. Updates may arrive after spend.'
          : '供應商未回報時不視為已驗證的零用量；通知可能在產生用量後才到達。'}
      </small>
    </section>
  )
}
