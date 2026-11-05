import { useWorkspaceEvents } from './hooks/useWorkspaceEvents'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowUp,
  Bot,
  Circle,
  FolderPlus,
  GitBranch,
  GitMerge,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isTaskActive } from '../shared/tasks'
import type { Attachment, Conversation, Message, Project, Provider } from '../shared/types'
import { Button } from './components/ui'
import { ChatComposer } from './features/chat/ChatComposer'
import { MessageList } from './features/chat/MessageList'
import { Sidebar } from './features/chat/Sidebar'
import { WorkspaceHeader } from './features/chat/WorkspaceHeader'
import { ApprovalQueue } from './features/ApprovalQueue'
import { Settings } from './features/Settings'
import { SidePanel } from './features/SidePanel'
import { TeamEditor } from './features/TeamEditor'
import { WorkflowEditor } from './features/WorkflowEditor'
import { useWorkspace } from './stores/workspace'
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
  const [queueOpen, setQueueOpen] = useState(false)
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
  const [planFirst, setPlanFirst] = useState(false)
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
  const openActivity = useCallback(() => setPanel('activity'), [])
  const navigateFromNotification = useCallback(() => {
    setSettingsOpen(false)
    setTeamOpen(false)
    setWorkflowOpen(false)
    setSearchOpen(false)
    setQuery('')
    setPanel('activity')
  }, [])
  useWorkspaceEvents(
    conversationId,
    snapshot?.settings.theme,
    navigateFromNotification,
    openActivity,
  )

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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setQueueOpen(true)
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
        ...(planFirst && targets.length ? { planFirst: true } : {}),
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
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        pickProject={pickProject}
        text={text}
        setSearchOpen={setSearchOpen}
        searchOpen={searchOpen}
        snapshot={snapshot}
        project={project}
        load={load}
        newChat={newChat}
        setMenu={setMenu}
        menu={menu}
        setRename={setRename}
        perform={perform}
        set={set}
        refresh={refresh}
        conversationId={conversationId}
        setSettingsOpen={setSettingsOpen}
      />
      <main className="workspace">
        <WorkspaceHeader
          project={project}
          text={text}
          conversation={conversation}
          agents={agents}
          tasks={tasks}
          roomApprovals={roomApprovals}
          en={en}
          colors={colors}
          setWorkflowOpen={setWorkflowOpen}
          setTeamOpen={setTeamOpen}
          panel={panel}
          setPanel={setPanel}
          pendingApprovals={approvals.length}
          openQueue={() => setQueueOpen(true)}
        />
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
        {project && !!snapshot.overlaps?.[project.id]?.files.length && panel !== 'tasks' && (
          <div className="overlap-strip" role="status">
            <GitMerge size={15} />
            <span>
              {text(
                `可能的合併衝突：${snapshot.overlaps[project.id].files.length} 個檔案同時被多位代理修改`,
                `Possible merge conflict: ${snapshot.overlaps[project.id].files.length} files changed by several agents`,
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPanel('tasks')}>
              {text('查看檔案', 'View files')}
            </Button>
          </div>
        )}
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
                  <MessageList
                    virtual={virtual}
                    filtered={filtered}
                    snapshot={snapshot}
                    text={text}
                    setReply={setReply}
                    setAttachments={setAttachments}
                    composer={composer}
                    pinnedIds={pinnedIds}
                    perform={perform}
                    setPanel={setPanel}
                    query={query}
                  />
                </>
              )}
            </div>
            <ChatComposer
              active={active}
              tasks={tasks}
              snapshot={snapshot}
              activities={activities}
              text={text}
              en={en}
              setPanel={setPanel}
              agents={agents}
              conversation={conversation}
              conversationId={conversationId}
              project={project}
              setAttachments={setAttachments}
              set={set}
              reply={reply}
              setReply={setReply}
              attachments={attachments}
              perform={perform}
              composer={composer}
              input={input}
              setInput={setInput}
              setMentionOpen={setMentionOpen}
              mentionOpen={mentionOpen}
              send={send}
              attach={attach}
              recipients={recipients}
              selectAgent={selectAgent}
              setRecipients={setRecipients}
              setModelSaving={setModelSaving}
              sending={sending}
              modelSaving={modelSaving}
              planFirst={planFirst}
              setPlanFirst={setPlanFirst}
            />
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
              allAgents={snapshot.agents}
              allUsage={snapshot.usage}
              allTasks={snapshot.tasks}
              conversations={snapshot.conversations}
              openQueue={() => setQueueOpen(true)}
              overlaps={snapshot.overlaps?.[project.id]}
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
      {queueOpen && (
        <ApprovalQueue
          approvals={approvals}
          conversations={snapshot.conversations}
          projects={snapshot.projects}
          agents={snapshot.agents}
          currentConversationId={conversationId}
          en={en}
          perform={perform}
          openRoom={(id) => {
            setQueueOpen(false)
            void load(id).then(() => setPanel('activity'))
          }}
          close={() => setQueueOpen(false)}
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
