import {
  ChevronsLeft,
  ChevronsRight,
  Folder,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { version } from '../../../../package.json'
import type { Project, Snapshot } from '../../../shared/types'
import { Button } from '../../components/ui'
import type { WorkspaceState } from '../../stores/workspace'
interface Props {
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
  pickProject: () => Promise<void>
  text: (zh: string, eng: string) => string
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  searchOpen: boolean
  snapshot: Snapshot
  project: Project | undefined
  load: (id: string, search?: string, merge?: boolean, expectedEpoch?: number) => Promise<void>
  newChat: (projectId: string) => Promise<void>
  setMenu: Dispatch<SetStateAction<string>>
  menu: string
  setRename: Dispatch<SetStateAction<{ id: string; value: string } | undefined>>
  perform: (request: Record<string, unknown>) => Promise<unknown>
  set: (patch: Partial<WorkspaceState>) => void
  refresh: () => Promise<void>
  conversationId: string
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
}
export function Sidebar({
  collapsed,
  setCollapsed,
  pickProject,
  text,
  setSearchOpen,
  searchOpen,
  snapshot,
  project,
  load,
  newChat,
  setMenu,
  menu,
  setRename,
  perform,
  set,
  refresh,
  conversationId,
  setSettingsOpen,
}: Props) {
  return (
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
                    <span>{c.name === '新對話' ? text('新對話', 'New conversation') : c.name}</span>
                  </button>
                ))}
          </section>
        ))}
        {!snapshot.projects.length && !collapsed && (
          <p className="sidebar-hint">
            {text('加入本機專案，開始與代理協作。', 'Add a local project to start collaborating.')}
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
  )
}
