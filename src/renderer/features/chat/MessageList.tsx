import { Pin, Reply } from 'lucide-react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ReactVirtualizer } from '@tanstack/react-virtual'
import type { Attachment, Message, Snapshot } from '../../../shared/types'
import { Markdown } from '../../components/Markdown'
import { Button } from '../../components/ui'
import { Attachments } from '../Attachments'
interface Props {
  virtual: ReactVirtualizer<HTMLDivElement, Element>
  filtered: Message[]
  snapshot: Snapshot
  text: (zh: string, eng: string) => string
  setReply: Dispatch<SetStateAction<Message | undefined>>
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  composer: RefObject<HTMLTextAreaElement | null>
  pinnedIds: string[]
  perform: (request: Record<string, unknown>) => Promise<unknown>
  setPanel: Dispatch<SetStateAction<string>>
  query: string
}
export function MessageList({
  virtual,
  filtered,
  snapshot,
  text,
  setReply,
  setAttachments,
  composer,
  pinnedIds,
  perform,
  setPanel,
  query,
}: Props) {
  return (
    <div
      className="message-list virtual-messages"
      style={{ height: virtual.getTotalSize(), position: 'relative' }}
    >
      {virtual.getVirtualItems().map((item) => {
        const m = filtered[item.index]
        const agent = snapshot.agents.find((a) => a.id === m.senderId)
        return (
          <article
            className={`message ${m.senderId === 'user' ? 'user-message' : ''}`}
            key={m.id}
            ref={virtual.measureElement}
            data-index={item.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
            }}
            data-testid="message"
          >
            <div className={`message-avatar ${agent?.provider || 'user'}`}>
              {agent ? agent.name[0] : m.senderId === 'user' ? 'Y' : '•'}
            </div>
            <div className="message-body">
              <div className="message-meta">
                <strong>
                  {agent?.name || (m.senderId === 'user' ? text('你', 'You') : m.senderId)}
                </strong>
                {m.type === 'collaboration' && (
                  <span className="message-tag">
                    →{' '}
                    {m.recipientIds
                      .map((id) => snapshot.agents.find((a) => a.id === id)?.name || id)
                      .join(', ') || 'room'}
                  </span>
                )}
                <time>
                  {new Date(m.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <button
                  title="Reply"
                  onClick={() => {
                    setReply(m)
                    if (m.attachments?.length)
                      setAttachments((current) =>
                        [
                          ...new Map(
                            [...current, ...m.attachments!].map((a) => [a.id, a]),
                          ).values(),
                        ].slice(0, 8),
                      )
                    composer.current?.focus()
                  }}
                >
                  <Reply size={13} />
                </button>
                {m.delivery === 'completed' && m.type !== 'system' && (
                  <button
                    title={pinnedIds.includes(m.id) ? '取消背景釘選' : '釘選為 Agent 背景'}
                    aria-pressed={pinnedIds.includes(m.id)}
                    onClick={() =>
                      void perform({
                        op: 'context.pin',
                        messageId: m.id,
                        enabled: !pinnedIds.includes(m.id),
                      })
                    }
                  >
                    <Pin size={12} fill={pinnedIds.includes(m.id) ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
              <Markdown content={m.content} />
              {!!m.attachments?.length && <Attachments items={m.attachments} />}
              {m.delivery === 'streaming' && <span className="stream-cursor" />}
              {['failed', 'cancelled'].includes(m.delivery) && (
                <span className="message-error">{m.delivery}</span>
              )}
              {m.delivery === 'failed' && m.content.includes('[WORKSPACE_NOT_READY]') && (
                <Button variant="outline" size="sm" onClick={() => setPanel('changes')}>
                  {text('設定隔離工作區', 'Prepare isolated workspace')}
                </Button>
              )}
            </div>
          </article>
        )
      })}
      {query && !filtered.length && (
        <p className="panel-empty">{text('找不到符合的訊息', 'No matching messages')}</p>
      )}
    </div>
  )
}
