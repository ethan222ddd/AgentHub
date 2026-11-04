import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Activity as ActivityIcon,
  ArrowUp,
  AtSign,
  Bot,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Folder,
  FolderPlus,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Reply,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Square,
  X,
  Play,
  PanelRight,
  PanelLeft,
  Pin,
  Workflow,
} from 'lucide-react'
import type { Conversation, Message, Project, Provider, Attachment } from '../shared/types'
import { useWorkspace } from './stores/workspace'
import { isTaskActive, taskStatusLabel } from '../shared/tasks'
import { Button } from './components/ui'
import { Markdown } from './components/Markdown'
import { Settings } from './features/Settings'
import { SidePanel } from './features/SidePanel'
import { version } from '../../package.json'
import { TeamEditor } from './features/TeamEditor'
import { Attachments } from './features/Attachments'
import { ModelControl } from './features/ModelControl'
import { QuotaControl } from './features/QuotaControl'
import { WorkflowEditor } from './features/WorkflowEditor'
const colors: Record<Provider, string> = {
  codex: 'codex',
  claude: 'claude',
  antigravity: 'antigravity',
}
export function App() {
  const {
    snapshot,
    conversationId,
    messages,
    pinnedIds,
    activities,
    approvals,
    error,
    set,
    refresh,
    load,
    hasMore,
    older,
  } = useWorkspace()
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [panel, setPanel] = useState('')
  const [input, setInput] = useState('')
  const [recipients, setRecipients] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [menu, setMenu] = useState('')
  const [rename, setRename] = useState<{ id: string; value: string }>()
  const [reply, setReply] = useState<Message>()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [modelSaving, setModelSaving] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)
  const en = snapshot?.settings.language === 'en'
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const conversation = snapshot?.conversations.find((c) => c.id === conversationId)
  const project = snapshot?.projects.find((p) => p.id === conversation?.projectId)
  const agents =
    snapshot?.agents.filter(
      (a) => a.enabled && (!project?.agentIds || project.agentIds.includes(a.id)),
    ) || []
  const tasks = snapshot?.tasks.filter((t) => t.conversationId === conversationId) || []
  const active = tasks.some(isTaskActive)
  const roomApprovals = approvals.filter((a) => a.conversationId === conversationId)
  const perform = useCallback(async (request: Record<string, unknown>): Promise<unknown> => {
    try {
      return await window.agenthub.invoke(request)
    } catch (e) {
      useWorkspace.getState().set({ error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }, [])
  useEffect(() => {
    void refresh().catch((e) => set({ error: String(e) }))
    let timer: ReturnType<typeof setTimeout> | undefined
    const deltas = new Map<string, string>()
    const deltaTimer = setInterval(() => {
      if (!deltas.size) return
      const state = useWorkspace.getState()
      state.set({
        messages: state.messages.map((m) =>
          deltas.has(m.id) ? { ...m, content: m.content + deltas.get(m.id)! } : m,
        ),
      })
      deltas.clear()
    }, 40)
    const unsubscribe = window.agenthub.subscribe((event) => {
      const state = useWorkspace.getState()
      if (event.type === 'changed') {
        clearTimeout(timer)
        timer = setTimeout(() => {
          deltas.clear()
          void state
            .refresh()
            .then(() => {
              const id = useWorkspace.getState().conversationId
              if (id) return state.load(id, useWorkspace.getState().search, true)
            })
            .catch((e) => state.set({ error: String(e) }))
        }, 70)
      }
      if (event.type === 'delta' && event.conversationId === state.conversationId)
        deltas.set(event.messageId, (deltas.get(event.messageId) || '') + event.delta)
      if (event.type === 'activity' && event.activity.conversationId === state.conversationId)
        state.set({ activities: [...state.activities, event.activity].slice(-200) })
      if (event.type === 'approvals') {
        state.set({ approvals: event.approvals })
        if (event.approvals.length) setPanel('activity')
      }
      if (event.type === 'notification-error') state.set({ error: event.message })
      if (event.type === 'navigate') {
        const epoch = state.reserveSelection()
        deltas.clear()
        setSettingsOpen(false)
        setTeamOpen(false)
        setWorkflowOpen(false)
        setSearchOpen(false)
        setQuery('')
        setPanel('activity')
        void state
          .refresh()
          .then(() => state.load(event.conversationId, '', false, epoch))
          .catch((e) => state.set({ error: String(e) }))
      }
    })
    void window.agenthub
      .invoke({ op: 'notifications.ready' })
      .catch((e) => set({ error: String(e) }))
    const rejected = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      set({ error: event.reason instanceof Error ? event.reason.message : String(event.reason) })
    }
    window.addEventListener('unhandledrejection', rejected)
    return () => {
      unsubscribe()
      clearInterval(deltaTimer)
      clearTimeout(timer)
      window.removeEventListener('unhandledrejection', rejected)
    }
  }, [refresh, set])
  useEffect(() => {
    const read = () => {
      if (conversationId && document.hasFocus())
        void window.agenthub
          .invoke({ op: 'notifications.read', conversationId })
          .catch((e) => set({ error: String(e) }))
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [conversationId, set])
  useEffect(() => {
    const theme = snapshot?.settings.theme || 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [snapshot?.settings.theme])
  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, conversationId])
  useEffect(() => {
    setInput('')
    setReply(undefined)
    setAttachments([])
    setQuery('')
    nearBottom.current = true
  }, [conversationId, project?.autoManaged])
  useEffect(() => {
    setRecipients(
      project?.autoManaged
        ? conversation?.mode === 'supervisor' && conversation.supervisorId
          ? [conversation.supervisorId]
          : agents.map((a) => a.id)
        : [],
    )
  }, [conversationId, project?.autoManaged, conversation?.mode, conversation?.supervisorId])
  useEffect(() => {
    if (!conversationId) return
    const timer = setTimeout(
      () => void load(conversationId, query).catch((e) => set({ error: String(e) })),
      180,
    )
    return () => clearTimeout(timer)
  }, [query, conversationId, load, set])
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if (e.key === 'Escape') {
        setPanel('')
        setSettingsOpen(false)
        setMentionOpen(false)
        setMenu('')
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const pickProject = async () => {
    const epoch = useWorkspace.getState().reserveSelection()
    const p = (await perform({ op: 'project.pick' })) as Project | null
    if (p) {
      await refresh()
      const c = useWorkspace.getState().snapshot?.conversations.find((c) => c.projectId === p.id)
      if (c) await load(c.id, '', false, epoch)
    }
  }
  const newChat = async (projectId: string) => {
    const epoch = useWorkspace.getState().reserveSelection()
    const c = (await perform({ op: 'conversation.create', projectId })) as Conversation
    await refresh()
    await load(c.id, '', false, epoch)
  }
  const send = async () => {
    if ((!input.trim() && !attachments.length) || !conversation || sending || modelSaving) return
    setSending(true)
    const epoch = useWorkspace.getState().selectionEpoch
    const sentInput = input,
      sentAttachments = new Set(attachments.map((a) => a.id)),
      sentReply = reply?.id
    try {
      let targets = [...recipients]
      const mentions = [...input.matchAll(/@([\w-]+)/g)].map((m) => m[1].toLowerCase())
      const disabledMention = snapshot?.agents.find(
        (a) =>
          !a.enabled &&
          (mentions.includes(a.provider) ||
            mentions.includes(a.name.replaceAll(' ', '').toLowerCase())),
      )
      if (disabledMention)
        throw new Error(
          `${disabledMention.name} ${text('尚未啟用，請到設定 → 代理啟用後重試。', 'is disabled. Enable it in Settings → Agents before sending.')}`,
        )
      if (mentions.includes('all')) targets = agents.map((a) => a.id)
      else {
        const mentioned = agents.filter(
          (agent) =>
            mentions.includes(agent.provider) ||
            mentions.includes(agent.id.toLowerCase()) ||
            mentions.includes(agent.name.replaceAll(' ', '').toLowerCase()),
        )
        if (mentioned.length) targets = mentioned.map((a) => a.id)
      }
      const body = [
        reply ? `Reply to ${reply.id} (${reply.senderId}): ${reply.content.slice(0, 2000)}\n` : '',
        input.trim(),
      ]
        .filter(Boolean)
        .join('\n\n')
      await perform({
        op: 'send',
        conversationId,
        content: body || text('請查看附件。', 'Please inspect the attachments.'),
        recipients: [...new Set(targets)],
        replyTo: reply?.id,
        attachmentIds: attachments.map((a) => a.id),
      })
      if (useWorkspace.getState().selectionEpoch === epoch) {
        setInput((value) => (value === sentInput ? '' : value))
        setAttachments((value) => value.filter((a) => !sentAttachments.has(a.id)))
        setReply((value) => (value?.id === sentReply ? undefined : value))
        nearBottom.current = true
        await load(conversationId, useWorkspace.getState().search, true)
      }
    } finally {
      setSending(false)
    }
  }
  const attach = async () => {
    if (!project) return
    const files = (await perform({
      op: 'attachment.pick',
      projectId: project.id,
    })) as typeof attachments
    setAttachments((prev) => [...prev, ...files].slice(0, 8))
  }
  const selectAgent = (id: string) => {
    setRecipients((prev) =>
      id === 'all'
        ? agents.map((a) => a.id)
        : prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id],
    )
    setMentionOpen(false)
    composer.current?.focus()
  }
  const filtered = messages
  const virtual = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 170,
    overscan: 6,
    getItemKey: (i) => filtered[i].id,
  })
  if (!snapshot)
    return (
      <main className="loading">
        <div className="brand-mark">a</div>
        <p>{error || 'AgentHub'}</p>
      </main>
    )
  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand-row">
          <div className="brand">
            <div className="brand-mark">a</div>
            {!collapsed && (
              <span>
                AgentHub <small>LOCAL</small>
              </span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </Button>
        </div>
        <div className="sidebar-controls">
          <button className="new-project" onClick={() => void pickProject()}>
            <FolderPlus size={17} />
            {!collapsed && text('新增專案', 'Add project')}
            {!collapsed && <Plus size={14} />}
          </button>
          <button
            className="search-button"
            title="Search · Ctrl+K"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={16} />
            {!collapsed && (
              <>
                {text('搜尋對話', 'Search conversations')}
                <kbd>⌃ K</kbd>
              </>
            )}
          </button>
        </div>
        {!collapsed && (
          <div className="sidebar-label">
            {text('工作空間', 'WORKSPACES')}
            <span>{snapshot.projects.length}</span>
          </div>
        )}
        <div className="project-list">
          {snapshot.projects.map((p) => (
            <section className="project-group" key={p.id}>
              <div className={`project-row ${project?.id === p.id ? 'current' : ''}`}>
                <button
                  title={p.path}
                  onClick={() => {
                    const c = snapshot.conversations.filter((c) => c.projectId === p.id).at(-1)
                    if (c) void load(c.id)
                    else void newChat(p.id)
                  }}
                >
                  <Folder size={16} />
                  {!collapsed && <span>{p.name}</span>}
                </button>
                {!collapsed && (
                  <>
                    <button title="New conversation" onClick={() => void newChat(p.id)}>
                      <Plus size={14} />
                    </button>
                    <button
                      title="Project options"
                      onClick={() => setMenu(menu === p.id ? '' : p.id)}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </>
                )}
                {menu === p.id && (
                  <div className="project-menu">
                    <button
                      onClick={() => {
                        setRename({ id: p.id, value: p.name })
                        setMenu('')
                      }}
                    >
                      {text('重新命名', 'Rename')}
                    </button>
                    <button
                      onClick={() => {
                        void perform({ op: 'project.open', id: p.id })
                        setMenu('')
                      }}
                    >
                      {text('開啟資料夾', 'Open folder')}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            text(
                              '移除專案捷徑與對話紀錄？專案檔案和工作區不會刪除。',
                              'Remove shortcut and chat history? Project and workspace files are preserved.',
                            ),
                          )
                        )
                          void perform({ op: 'project.remove', id: p.id }).then(async () => {
                            set({ conversationId: '', messages: [] })
                            await refresh()
                          })
                        setMenu('')
                      }}
                    >
                      {text('移除捷徑與紀錄', 'Remove shortcut & history')}
                    </button>
                  </div>
                )}
              </div>
              {!collapsed &&
                snapshot.conversations
                  .filter((c) => c.projectId === p.id)
                  .slice(-12)
                  .reverse()
                  .map((c) => (
                    <button
                      className={`conversation-row ${conversationId === c.id ? 'selected' : ''}`}
                      data-conversation-id={c.id}
                      key={c.id}
                      onClick={() => void load(c.id)}
                    >
                      <MessageSquare size={13} />
                      <span>
                        {c.name === '新對話' ? text('新對話', 'New conversation') : c.name}
                      </span>
                    </button>
                  ))}
            </section>
          ))}
          {!snapshot.projects.length && !collapsed && (
            <p className="sidebar-hint">
              {text(
                '加入本機專案，開始與代理協作。',
                'Add a local project to start collaborating.',
              )}
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={17} />
            {!collapsed && (
              <>
                {text('設定', 'Settings')}
                <span className="version">v{version}</span>
              </>
            )}
          </button>
          {!collapsed && (
            <div className="local-status">
              <span className="status-dot completed" />
              {text('本機工作空間', 'Local workspace')}
              <ShieldCheck size={12} />
            </div>
          )}
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div className="project-heading">
            <PanelLeft size={17} className="muted" />
            <div>
              <h1>{project?.name || 'AgentHub'}</h1>
              {project?.autoManaged && (
                <small title={project.setup?.detail} className="project-readiness">
                  {project.setup?.state === 'ready'
                    ? text('就緒 · 自動管理', 'Ready · automatic')
                    : project.setup?.state === 'attention'
                      ? text('需要檢查 · 發送任務可處理', 'Needs review · send a task')
                      : text('自動工作區', 'Automatic workspace')}
                </small>
              )}
              <span>
                {conversation?.name === '新對話'
                  ? text('新對話', 'New conversation')
                  : conversation?.name ||
                    text('多代理協作工作空間', 'Multi-agent coding workspace')}
              </span>
            </div>
          </div>
          <div className="header-agents">
            {agents.map((a) => {
              const running = tasks.find((t) => t.agentId === a.id && t.status === 'running')
              const last = tasks.filter((t) => t.agentId === a.id).at(-1)
              const waiting = roomApprovals.some((approval) => approval.agentId === a.id)
              return (
                <span
                  title={`${a.name} · ${waiting ? 'Waiting for approval' : running ? 'Running' : last ? taskStatusLabel(last, en) : 'Idle / connection not checked'}${last?.error ? '\n' + last.error : ''}`}
                  className={`mini-avatar ${colors[a.provider]} ${running ? 'working' : ''} ${last?.status === 'failed' ? 'failed' : ''} ${waiting ? 'waiting' : ''}`}
                  key={a.id}
                >
                  {a.name[0]}
                  <i />
                </span>
              )
            })}
          </div>
          <div className="header-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWorkflowOpen(true)}
              aria-label="Workflows"
            >
              <Workflow size={15} />
              <span>{text('流程', 'Workflows')}</span>
            </Button>
            {project && (
              <Button size="sm" variant="ghost" onClick={() => setTeamOpen(true)}>
                <Bot size={15} />
                <span>{text('團隊', 'Team')}</span>
              </Button>
            )}
            <Button
              variant={panel === 'activity' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setPanel(panel === 'activity' ? '' : 'activity')}
            >
              <ActivityIcon size={15} />
              <span>{text('活動', 'Activity')}</span>
              {!!roomApprovals.length && <b className="count">{roomApprovals.length}</b>}
            </Button>
            <Button
              variant={panel === 'changes' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setPanel(panel === 'changes' ? '' : 'changes')}
            >
              <GitBranch size={15} />
              <span>{text('變更', 'Changes')}</span>
            </Button>
          </div>
        </header>
        {snapshot.conversations
          .filter(
            (c) => c.id !== conversationId && approvals.some((a) => a.conversationId === c.id),
          )
          .map((c) => (
            <div className="approval-notice" role="status" key={c.id}>
              <ShieldCheck size={15} />
              <span>
                {text('其他聊天室正在等待批准', 'Another room is waiting for approval')}: {c.name}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void load(c.id)
                  setPanel('activity')
                }}
              >
                {text('前往批准', 'Review approval')}
              </Button>
            </div>
          ))}
        {snapshot.workflowRuns
          .filter(
            (r) =>
              r.conversationId === conversationId && !['completed', 'cancelled'].includes(r.status),
          )
          .map((run) => (
            <div className="workflow-strip" role="status" key={run.id}>
              <Workflow size={15} />
              <span>
                {run.template.name} ·{' '}
                {Object.values(run.steps).filter((s) => s.status === 'completed').length}/
                {run.template.steps.length} ·{' '}
                {run.status === 'running'
                  ? text('執行中', 'Running')
                  : text('等待檢查／繼續', 'Awaiting inspection / resume')}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setWorkflowOpen(true)}>
                {text('查看流程', 'View workflow')}
              </Button>
            </div>
          ))}
        {searchOpen && (
          <div className="search-strip">
            <Search size={16} />
            <input
              autoFocus
              placeholder={text(
                '搜尋目前對話的所有訊息',
                'Search all messages in this conversation',
              )}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setSearchOpen(false)
                setQuery('')
              }}
            >
              <X size={15} />
            </Button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => set({ error: '' })}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="chat-and-panel">
          <div className="chat-column">
            <div
              className="chat-scroll"
              ref={scroll}
              onScroll={(e) => {
                const element = e.currentTarget
                nearBottom.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 120
              }}
            >
              {!messages.length && !query ? (
                <div className="welcome">
                  <div className="welcome-symbol">
                    <Bot size={29} strokeWidth={1.4} />
                    <span />
                    <span />
                  </div>
                  <div className="eyebrow">YOUR TEAM. ONE CONVERSATION.</div>
                  <h2>{text('讓想法，成為下一個作品。', 'Good ideas deserve a great team.')}</h2>
                  <p>
                    {project
                      ? text(
                          '在同一個對話裡，與真正的 Coding Agents 一起開發。',
                          'Build alongside real coding agents, in one shared conversation.',
                        )
                      : text(
                          '選擇本機專案，建立你的 AI 開發團隊。',
                          'Choose a local project and bring your coding team together.',
                        )}
                  </p>
                  {project ? (
                    <>
                      <div className="team-roster">
                        {agents.map((a) => (
                          <button
                            key={a.id}
                            className={recipients.includes(a.id) ? 'chosen' : ''}
                            onClick={() => selectAgent(a.id)}
                          >
                            <span className={`agent-icon ${a.provider}`}>{a.name[0]}</span>
                            <strong>{a.name}</strong>
                            <small>{a.role}</small>
                            <span className="roster-state">
                              <Circle size={7} />
                              {text('原生 Runtime', 'Native runtime')}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="setup-note">
                        <GitBranch size={14} />
                        <span>
                          {project?.autoManaged
                            ? text(
                                '直接描述需求即可開始；工作區、初始快照與安全整合由 AgentHub 管理。',
                                'Describe your task to begin. AgentHub manages project snapshots, workspaces and safe integration.',
                              )
                            : text(
                                '首次使用：於「變更」建立 Git 隔離工作區，並在設定確認 Runtime。',
                                'First use: prepare isolated Git workspaces in Changes and verify runtimes in Settings.',
                              )}
                        </span>
                      </div>
                      <button
                        className="setup-link"
                        onClick={() => {
                          setInput(
                            text(
                              '請先檢查專案結構，提出實作方案，暫時不要修改程式。',
                              'Inspect the repository and propose an implementation plan before editing files.',
                            ),
                          )
                          composer.current?.focus()
                        }}
                      >
                        {text('從專案架構討論開始', 'Start with an architecture discussion')}{' '}
                        <ArrowUp size={13} />
                      </button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => void pickProject()}>
                      <FolderPlus size={16} />
                      {text('選擇專案資料夾', 'Choose project folder')}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="history-controls">
                    {hasMore && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          nearBottom.current = false
                          void older().catch((e) => set({ error: String(e) }))
                        }}
                      >
                        {text('載入更早訊息', 'Load earlier messages')}
                      </Button>
                    )}
                  </div>
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
                                {agent?.name ||
                                  (m.senderId === 'user' ? text('你', 'You') : m.senderId)}
                              </strong>
                              {m.type === 'collaboration' && (
                                <span className="message-tag">
                                  →{' '}
                                  {m.recipientIds
                                    .map(
                                      (id) => snapshot.agents.find((a) => a.id === id)?.name || id,
                                    )
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
                                  title={
                                    pinnedIds.includes(m.id) ? '取消背景釘選' : '釘選為 Agent 背景'
                                  }
                                  aria-pressed={pinnedIds.includes(m.id)}
                                  onClick={() =>
                                    void perform({
                                      op: 'context.pin',
                                      messageId: m.id,
                                      enabled: !pinnedIds.includes(m.id),
                                    })
                                  }
                                >
                                  <Pin
                                    size={12}
                                    fill={pinnedIds.includes(m.id) ? 'currentColor' : 'none'}
                                  />
                                </button>
                              )}
                            </div>
                            <Markdown content={m.content} />
                            {!!m.attachments?.length && <Attachments items={m.attachments} />}
                            {m.delivery === 'streaming' && <span className="stream-cursor" />}
                            {['failed', 'cancelled'].includes(m.delivery) && (
                              <span className="message-error">{m.delivery}</span>
                            )}
                            {m.delivery === 'failed' &&
                              m.content.includes('[WORKSPACE_NOT_READY]') && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPanel('changes')}
                                >
                                  {text('設定隔離工作區', 'Prepare isolated workspace')}
                                </Button>
                              )}
                          </div>
                        </article>
                      )
                    })}
                    {query && !filtered.length && (
                      <p className="panel-empty">
                        {text('找不到符合的訊息', 'No matching messages')}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
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
                        .then((files) =>
                          setAttachments((current) => [...current, ...files].slice(0, 8)),
                        )
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
                      Array.from(e.clipboardData.items).some((item) =>
                        item.type.startsWith('image/'),
                      )
                    ) {
                      e.preventDefault()
                      void perform({ op: 'attachment.clipboard', projectId: project.id }).then(
                        (value) =>
                          setAttachments((current) =>
                            [...current, value as Attachment].slice(0, 8),
                          ),
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMentionOpen(!mentionOpen)}
                      >
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
          </div>
          {panel && project && (
            <SidePanel
              key={project.id}
              tab={panel}
              setTab={setPanel}
              close={() => setPanel('')}
              project={project}
              workspaces={snapshot.workspaces.filter(
                (w) => w.projectId === project.id && (!w.kind || w.kind === 'agent'),
              )}
              agents={snapshot.agents.filter(
                (a) => !project.agentIds || project.agentIds.includes(a.id),
              )}
              tasks={tasks}
              tests={snapshot.tests.filter((t) => t.projectId === project.id)}
              reviews={snapshot.reviews.filter((r) => r.conversationId === conversationId)}
              artifacts={snapshot.artifacts.filter((a) => a.projectId === project.id)}
              usage={snapshot.usage.filter((u) => u.conversationId === conversationId)}
              conversationId={conversationId}
              activities={activities}
              approvals={roomApprovals}
              perform={perform}
              en={en}
            />
          )}
        </div>
      </main>
      {settingsOpen && (
        <Settings
          snapshot={snapshot}
          conversationId={conversationId}
          close={() => setSettingsOpen(false)}
          perform={perform}
        />
      )}{' '}
      {workflowOpen && (
        <WorkflowEditor
          snapshot={snapshot}
          conversationId={conversationId}
          initialRequirement={input}
          close={() => setWorkflowOpen(false)}
          perform={perform}
          started={() => {
            setWorkflowOpen(false)
            setPanel('activity')
            setInput('')
          }}
        />
      )}
      {teamOpen && project && (
        <TeamEditor
          project={project}
          agents={snapshot.agents}
          close={() => setTeamOpen(false)}
          perform={perform}
          en={en}
        />
      )}
      {rename && (
        <div className="modal-backdrop">
          <section className="rename-dialog" role="dialog" aria-label="Rename project">
            <h3>{text('重新命名專案', 'Rename project')}</h3>
            <input
              autoFocus
              value={rename.value}
              onChange={(e) => setRename({ ...rename, value: e.target.value })}
            />
            <div className="actions">
              <Button variant="ghost" onClick={() => setRename(undefined)}>
                {text('取消', 'Cancel')}
              </Button>
              <Button
                onClick={() =>
                  void perform({ op: 'project.rename', id: rename.id, name: rename.value }).then(
                    () => setRename(undefined),
                  )
                }
              >
                {text('儲存', 'Save')}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
