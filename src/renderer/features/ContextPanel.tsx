import { useState } from 'react'
import type { AgentProfile, ContextReceipt } from '../../shared/types'
import { Button } from '../components/ui'
export function ContextPanel({
  conversationId,
  agents,
  perform,
  en,
}: {
  conversationId: string
  agents: AgentProfile[]
  perform(request: Record<string, unknown>): Promise<unknown>
  en: boolean
}) {
  const [receipts, setReceipts] = useState<ContextReceipt[]>([])
  const [error, setError] = useState('')
  const [source, setSource] =
    useState<{ messageId: string; excerpt: string; truncated: boolean }[]>()
  const refresh = async () => {
    try {
      setReceipts((await perform({ op: 'context.receipts', conversationId })) as ContextReceipt[])
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <details
      className="context-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void refresh()
      }}
    >
      <summary>{en ? 'Agent background sources' : 'Agent 背景與來源'}</summary>
      <p className="muted">
        {en
          ? 'Local excerpts and full-text retrieval, not model-written summaries. At most 24k characters per delivery; original private runtime context is separate.'
          : '本機節錄與全文檢索，並非模型產生的摘要。每次背景最多 24k 字元；原生私有 Session 另行管理。'}
      </p>
      <Button size="sm" variant="ghost" onClick={() => void refresh()}>
        {en ? 'Refresh' : '重新整理'}
      </Button>
      {!receipts.length && (
        <p className="muted">
          {en
            ? 'No background has been prepared in this room yet.'
            : '此聊天室尚無已準備的背景紀錄。'}
        </p>
      )}
      {receipts.map((r) => (
        <details key={r.id}>
          <summary>
            {agents.find((a) => a.id === r.agentId)?.name || r.agentId} ·{' '}
            {r.characters.toLocaleString()} {en ? 'characters' : '字元'} · {r.sources.length}{' '}
            {en ? 'sources' : '來源'}
          </summary>
          <small className="muted">
            {r.createdAt} · {en ? 'Cursor' : '游標'} {r.cursorBefore} → {r.cursor} ·{' '}
            {en ? 'Omitted/redundant recent' : '省略／原生已知的近期訊息'}: {r.omittedRecent}
          </small>
          {r.sources.map((s) => (
            <section key={s.messageId}>
              <small>
                {s.kind} · {s.senderId} · {s.timestamp}
              </small>
              <pre>{s.excerpt}</pre>
              {s.truncated && (
                <small className="muted">{en ? 'Excerpt truncated' : '此為截短節錄'}</small>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void perform({ op: 'context.read', conversationId, messageIds: [s.messageId] })
                    .then((value) => setSource(value as typeof source))
                    .catch((e) => setError(String(e)))
                }}
              >
                {en ? 'Read source' : '讀取來源'}
              </Button>
            </section>
          ))}
        </details>
      ))}
      {source && (
        <section>
          <Button size="sm" variant="ghost" onClick={() => setSource(undefined)}>
            {en ? 'Close source' : '關閉來源'}
          </Button>
          {source.map((s) => (
            <pre key={s.messageId}>
              {s.excerpt}
              {s.truncated ? '\n… (4000 character source preview)' : ''}
            </pre>
          ))}
        </section>
      )}
      {error && <p className="error-text">{error}</p>}
    </details>
  )
}
