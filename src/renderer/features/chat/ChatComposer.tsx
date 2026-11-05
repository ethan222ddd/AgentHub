import {
  ArrowUp,
  AtSign,
  Bot,
  ChevronDown,
  ClipboardCheck,
  MessageSquare,
  PanelRight,
  Paperclip,
  Play,
  Plus,
  Reply,
  ShieldCheck,
  Square,
  X,
  Zap,
} from 'lucide-react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { isTaskActive, taskStatusLabel } from '../../../shared/tasks'
import type {
  Activity,
  AgentProfile,
  Attachment,
  Conversation,
  Message,
  Project,
  Snapshot,
  Task,
} from '../../../shared/types'
import { Button } from '../../components/ui'
import type { WorkspaceState } from '../../stores/workspace'
import { ModelControl } from '../ModelControl'
import { QuotaControl } from '../QuotaControl'
interface Props {
  active: boolean
  tasks: Task[]
  snapshot: Snapshot
  activities: Activity[]
  text: (zh: string, eng: string) => string
  en: boolean
  setPanel: Dispatch<SetStateAction<string>>
  agents: AgentProfile[]
  conversation: Conversation | undefined
  conversationId: string
  project: Project | undefined
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  set: (patch: Partial<WorkspaceState>) => void
  reply: Message | undefined
  setReply: Dispatch<SetStateAction<Message | undefined>>
  attachments: Attachment[]
  perform: (request: Record<string, unknown>) => Promise<unknown>
  composer: RefObject<HTMLTextAreaElement | null>
  input: string
  setInput: Dispatch<SetStateAction<string>>
  setMentionOpen: Dispatch<SetStateAction<boolean>>
  mentionOpen: boolean
  send: () => Promise<void>
  attach: () => Promise<void>
  recipients: string[]
  selectAgent: (id: string) => void
  setRecipients: Dispatch<SetStateAction<string[]>>
  setModelSaving: Dispatch<SetStateAction<boolean>>
  sending: boolean
  modelSaving: boolean
  planFirst: boolean
  setPlanFirst: Dispatch<SetStateAction<boolean>>
}
export function ChatComposer({
  active,
  tasks,
  snapshot,
  activities,
  text,
  en,
  setPanel,
  agents,
  conversation,
  conversationId,
  project,
  setAttachments,
  set,
  reply,
  setReply,
  attachments,
  perform,
  composer,
  input,
  setInput,
  setMentionOpen,
  mentionOpen,
  send,
  attach,
  recipients,
  selectAgent,
  setRecipients,
  setModelSaving,
  sending,
  modelSaving,
  planFirst,
  setPlanFirst,
}: Props) {
  return (
    <div className="composer-wrap">
      {active && (
        <div className="live-status">
          <span className="pulse-dot" />
          {tasks
            .filter(isTaskActive)
            .map(
              (t) =>
                `${snapshot.agents.find((a) => a.id === t.agentId)?.name} · ${t.status === 'running' ? activities.filter((a) => a.taskId === t.id).at(-1)?.type || text('處理中', 'Working') : taskStatusLabel(t, en)}`,
            )
            .join(' · ') || text('任務排程中', 'Tasks queued')}
          <button onClick={() => setPanel('activity')}>
            <PanelRight size={12} />
          </button>
        </div>
      )}
      <QuotaControl
        agents={agents}
        completedTurns={tasks
          .filter((t) => ['completed', 'failed', 'cancelled'].includes(t.status))
          .map((t) => `${t.id}:${t.status}`)
          .join('|')}
        en={!!en}
      />
      <div
        className={`composer ${conversation?.stopped ? 'stopped' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files.length) {
            if (project)
              void window.agenthub
                .attachFiles(project.id, Array.from(e.dataTransfer.files).slice(0, 8))
                .then((files) => setAttachments((current) => [...current, ...files].slice(0, 8)))
                .catch((error) => set({ error: String(error) }))
          }
        }}
      >
        {reply && (
          <div className="reply-bar">
            <Reply size={13} />
            <span>{reply.content.slice(0, 100)}</span>
            <button onClick={() => setReply(undefined)}>
              <X size={13} />
            </button>
          </div>
        )}
        {!!attachments.length && (
          <div className="attachments">
            {attachments.map((a, i) => (
              <span key={i}>
                {a.preview && <img src={a.preview} alt={a.name} />}
                <Paperclip size={12} />
                {a.name}
                <button
                  onClick={() => {
                    void perform({ op: 'attachment.discard', id: a.id }).then(() =>
                      setAttachments((current) => current.filter((_, j) => i !== j)),
                    )
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.some((a) => a.kind === 'image') && (
          <small className="attachment-help">
            {text(
              '三家均可辨識圖片；Antigravity 使用原生本機讀圖工具。最多 4 張，每張 5 MiB。',
              'All three support images; Antigravity uses its native local image tool. Up to 4 images, 5 MiB each.',
            )}
          </small>
        )}
        <textarea
          ref={composer}
          aria-label="Message"
          rows={3}
          onPaste={(e) => {
            if (
              project &&
              Array.from(e.clipboardData.items).some((item) => item.type.startsWith('image/'))
            ) {
              e.preventDefault()
              void perform({ op: 'attachment.clipboard', projectId: project.id }).then((value) =>
                setAttachments((current) => [...current, value as Attachment].slice(0, 8)),
              )
            }
          }}
          disabled={!conversation || conversation.stopped}
          placeholder={
            !project
              ? text('選擇專案後開始對話…', 'Choose a project to begin…')
              : conversation?.stopped
                ? text(
                    '工作已停止，按繼續以接受新任務。',
                    'Work stopped. Resume to accept new tasks.',
                  )
                : text(
                    '描述你的想法，使用 @ 指派代理…',
                    'Describe what you want to build. Use @ to bring in an agent…',
                  )
          }
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setMentionOpen(e.target.value.endsWith('@'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (!mentionOpen) void send()
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-left">
            <Button
              size="icon"
              variant="ghost"
              title={text('附加專案檔案', 'Attach project files')}
              disabled={!project}
              onClick={() => void attach()}
            >
              <Plus size={19} />
            </Button>
            <div className="mention-container">
              <Button size="sm" variant="ghost" onClick={() => setMentionOpen(!mentionOpen)}>
                <AtSign size={14} />
                <span>
                  {recipients.length
                    ? recipients
                        .map((id) => agents.find((a) => a.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')
                    : text('本機筆記', 'Local note')}
                </span>
                <ChevronDown size={12} />
              </Button>
              {mentionOpen && (
                <div className="mention-menu">
                  <small>{text('指派接收者', 'RECIPIENTS')}</small>
                  <button onClick={() => selectAgent('all')}>
                    <Bot size={15} />
                    @All <span>{text('所有代理', 'All agents')}</span>
                  </button>
                  {agents.map((a) => (
                    <button key={a.id} onClick={() => selectAgent(a.id)}>
                      <span className={`tiny-dot ${a.provider}`} />
                      {a.name}
                      <span>{recipients.includes(a.id) ? '✓' : ''}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setRecipients([])
                      setMentionOpen(false)
                    }}
                  >
                    <MessageSquare size={14} />
                    {text('僅儲存筆記', 'Save note only')}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="composer-right">
            <Button
              size="sm"
              variant={snapshot.settings.autonomy === 'auto' ? 'outline' : 'ghost'}
              className={`plan-toggle autonomy-toggle ${snapshot.settings.autonomy === 'auto' ? 'on' : ''}`}
              aria-pressed={snapshot.settings.autonomy === 'auto'}
              title={text(
                '全自動：依安全規則自動批准，代理分工做到完成；關閉後每個工具請求都等你批准',
                'Autonomous: host policy approves and the team works to completion; off = every tool request waits for you',
              )}
              onClick={() => {
                const { id: _id, ...settings } = snapshot.settings as typeof snapshot.settings & {
                  id?: string
                }
                void _id
                void perform({
                  op: 'settings.save',
                  settings: {
                    ...settings,
                    autonomy: snapshot.settings.autonomy === 'auto' ? 'ask' : 'auto',
                  },
                })
              }}
            >
              <Zap size={14} />
              <span>{text('全自動', 'Autonomous')}</span>
            </Button>
            <Button
              size="sm"
              variant={planFirst ? 'outline' : 'ghost'}
              className={`plan-toggle ${planFirst ? 'on' : ''}`}
              aria-pressed={planFirst}
              disabled={!recipients.length}
              title={text(
                '代理先在唯讀模式提出計畫，你批准後才開始改檔',
                'Agents propose a plan read-only; files change only after you approve',
              )}
              onClick={() => setPlanFirst(!planFirst)}
            >
              <ClipboardCheck size={14} />
              <span>{text('先提計畫', 'Plan first')}</span>
            </Button>
            {conversation && (
              <ModelControl
                key={conversation.id}
                conversation={conversation}
                agents={agents}
                recipients={recipients}
                perform={perform}
                pending={setModelSaving}
                en={!!en}
              />
            )}
            {conversation && (
              <>
                <select
                  aria-label="Collaboration mode"
                  value={conversation.mode}
                  disabled={active}
                  onChange={(e) =>
                    void perform({
                      op: 'conversation.configure',
                      id: conversation.id,
                      mode: e.target.value,
                      supervisorId: conversation.supervisorId || agents[0]?.id || '',
                    })
                  }
                >
                  <option value="manual">{text('手動', 'Manual')}</option>
                  <option value="collaborative">{text('協作', 'Collaborative')}</option>
                  <option value="supervisor">{text('主管', 'Supervisor')}</option>
                </select>
                {conversation.mode === 'supervisor' && (
                  <select
                    aria-label="Supervisor"
                    disabled={active}
                    value={conversation.supervisorId}
                    onChange={(e) =>
                      void perform({
                        op: 'conversation.configure',
                        id: conversation.id,
                        mode: 'supervisor',
                        supervisorId: e.target.value,
                      })
                    }
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            {conversation?.stopped ? (
              <Button
                size="icon"
                title="Resume"
                onClick={() => void perform({ op: 'resume', conversationId })}
              >
                <Play size={15} />
              </Button>
            ) : (
              <>
                {active && (
                  <Button
                    size="icon"
                    variant="danger"
                    title="Stop agents"
                    onClick={() => void perform({ op: 'stop', conversationId })}
                  >
                    <Square size={13} fill="currentColor" />
                  </Button>
                )}
                <Button
                  size="icon"
                  title="Send"
                  aria-label="Send"
                  disabled={
                    !conversation ||
                    (!input.trim() && !attachments.length) ||
                    sending ||
                    modelSaving
                  }
                  onClick={() => void send()}
                >
                  <ArrowUp size={19} />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="composer-caption">
        <span>
          <ShieldCheck size={11} />
          {text(
            '本機優先 · 原生代理 · 操作可審核',
            'Local first · Native agents · Reviewable actions',
          )}
        </span>
        <span>Shift ↵ {text('換行', 'new line')}</span>
      </div>
    </div>
  )
}
