import { MessageSquare, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { AgentProfile, Approval, Conversation, Project } from '../../shared/types'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'
import { approvalKeyAction, waitedFor } from '../lib/approval-keys'
import { seriesSlot } from '../lib/series'

interface Props {
  approvals: Approval[]
  conversations: Conversation[]
  projects: Project[]
  agents: AgentProfile[]
  currentConversationId: string
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
  openRoom(conversationId: string): void
  close(): void
}
export function ApprovalQueue({
  approvals,
  conversations,
  projects,
  agents,
  currentConversationId,
  en,
  perform,
  openRoom,
  close,
}: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const ref = useDialog(close)
  const [resolving, setResolving] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState('')
  const [shownAt, setShownAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [hint, setHint] = useState('')
  // This room first, then the order the host asked in; resolved items leave optimistically.
  const visible = useMemo(
    () =>
      approvals
        .filter((a) => !resolving.has(a.id))
        .map((a, i) => ({ a, i }))
        .sort(
          (x, y) =>
            Number(y.a.conversationId === currentConversationId) -
              Number(x.a.conversationId === currentConversationId) || x.i - y.i,
        )
        .map((x) => x.a),
    [approvals, resolving, currentConversationId],
  )
  const current = visible.find((a) => a.id === selectedId) || visible[0]
  useEffect(() => {
    setShownAt(Date.now())
    setHint('')
  }, [current?.id])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    // Forget optimistic state once the host stops listing the request.
    setResolving((prev) => {
      const ids = new Set(approvals.map((a) => a.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [approvals])
  const room = (id: string) => conversations.find((c) => c.id === id)
  const project = (id: string) => projects.find((p) => p.id === room(id)?.projectId)
  const agent = (id: string) => agents.find((a) => a.id === id)
  const decide = async (approval: Approval, allow: boolean, remember = false) => {
    const index = visible.findIndex((a) => a.id === approval.id)
    const following = visible[index + 1] || visible[index - 1]
    setSelectedId(following?.id || '')
    setResolving((prev) => new Set(prev).add(approval.id))
    try {
      await perform({ op: 'approve', id: approval.id, allow, ...(remember ? { remember } : {}) })
    } catch {
      setResolving((prev) => {
        const next = new Set(prev)
        next.delete(approval.id)
        return next
      })
    }
  }
  const move = (step: number) => {
    if (!visible.length || !current) return
    const index = visible.findIndex((a) => a.id === current.id)
    const next = visible[(index + step + visible.length) % visible.length]
    setSelectedId(next.id)
    document.getElementById(`approval-${next.id}`)?.focus()
  }
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    const action = approvalKeyAction(
      {
        key: event.key,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        editable: ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName),
      },
      current,
      shownAt,
      Date.now(),
    )
    if (!action || action === 'close') return
    event.preventDefault()
    if (action === 'next') move(1)
    else if (action === 'prev') move(-1)
    else if (action === 'not-armed')
      setHint(
        text('請先看完這筆請求，再按一次 A。', 'Read this request first, then press A again.'),
      )
    else if (current) void decide(current, action !== 'deny', action === 'remember')
  }
  const denyAll = () => {
    if (
      !window.confirm(
        text(
          `拒絕全部 ${visible.length} 筆待批准操作？代理會收到拒絕，並依各自的 Runtime 規則繼續或停止。`,
          `Deny all ${visible.length} pending requests? Agents receive a denial and continue or stop according to their runtime.`,
        ),
      )
    )
      return
    for (const approval of visible) void decide(approval, false)
  }
  const currentAgent = current && agent(current.agentId)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section
        ref={ref}
        className="approval-queue"
        role="dialog"
        aria-modal="true"
        aria-label={text('批准佇列', 'Approval queue')}
        onKeyDown={onKey}
      >
        <header>
          <ShieldCheck size={17} />
          <h3>{text('批准佇列', 'Approval queue')}</h3>
          <span className="queue-count">{visible.length}</span>
          <Button size="icon" variant="ghost" aria-label="Close approval queue" onClick={close}>
            <X size={16} />
          </Button>
        </header>
        {!current ? (
          <div className="queue-empty">
            <ShieldCheck size={26} strokeWidth={1.4} />
            <p>{text('沒有等待你批准的操作。', 'Nothing is waiting for your approval.')}</p>
            <Button variant="outline" onClick={close}>
              {text('關閉', 'Close')}
            </Button>
          </div>
        ) : (
          <div className="queue-body">
            <ol className="queue-list" aria-label={text('待批准操作', 'Pending requests')}>
              {visible.map((a) => (
                <li key={a.id}>
                  <button
                    id={`approval-${a.id}`}
                    className={a.id === current.id ? 'selected' : ''}
                    aria-current={a.id === current.id}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <span className="queue-line">
                      <i className="agent-swatch" data-slot={seriesSlot(a.agentId, agents)} />
                      <strong>{agent(a.agentId)?.name || a.agentId}</strong>
                      <time>{waitedFor(a, now, en)}</time>
                    </span>
                    <span className="queue-tool">{a.tool}</span>
                    <span className="queue-room">
                      {a.conversationId === currentConversationId
                        ? text('目前聊天室', 'This conversation')
                        : `${project(a.conversationId)?.name || ''} / ${room(a.conversationId)?.name || ''}`}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <article className="queue-detail" aria-live="polite">
              <div className="queue-detail-head">
                <span className={`agent-icon ${currentAgent?.provider || ''}`}>
                  {currentAgent?.name[0] || '?'}
                </span>
                <div>
                  <strong>
                    {currentAgent?.name || current.agentId} {text('想要執行', 'wants to use')}{' '}
                    <code>{current.tool}</code>
                  </strong>
                  <small>
                    {project(current.conversationId)?.name} / {room(current.conversationId)?.name}
                    {current.requestedAt &&
                      text(
                        `，已等待 ${waitedFor(current, now, en)}`,
                        `, waiting ${waitedFor(current, now, en)}`,
                      )}
                  </small>
                </div>
              </div>
              <pre className="queue-command">{current.detail}</pre>
              <p className="queue-risk">{current.risk}</p>
              {hint && (
                <p className="queue-hint" role="status">
                  {hint}
                </p>
              )}
              <div className="queue-actions">
                <Button onClick={() => void decide(current, true)}>
                  {text('允許一次', 'Allow once')} <kbd>A</kbd>
                </Button>
                <Button variant="outline" onClick={() => void decide(current, false)}>
                  {text('拒絕', 'Deny')} <kbd>D</kbd>
                </Button>
                {current.canRemember && (
                  <Button variant="outline" onClick={() => void decide(current, true, true)}>
                    {text('記住此工作區的讀取', 'Remember workspace read')} <kbd>R</kbd>
                  </Button>
                )}
                {current.conversationId !== currentConversationId && (
                  <Button variant="ghost" onClick={() => openRoom(current.conversationId)}>
                    <MessageSquare size={14} />
                    {text('前往聊天室', 'Open conversation')}
                  </Button>
                )}
              </div>
            </article>
          </div>
        )}
        {current && (
          <footer>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {text('切換', 'move')}
            </span>
            <span>
              <kbd>A</kbd> {text('允許', 'allow')}
            </span>
            <span>
              <kbd>D</kbd> {text('拒絕', 'deny')}
            </span>
            <span>
              <kbd>Esc</kbd> {text('關閉', 'close')}
            </span>
            <span className="queue-note">
              {text('Shell 指令不會被記住，每次都要批准。', 'Shell commands are never remembered.')}
            </span>
            <Button size="sm" variant="ghost" onClick={denyAll}>
              {text('全部拒絕', 'Deny all')}
            </Button>
          </footer>
        )}
      </section>
    </div>
  )
}
