import {
  Activity as ActivityIcon,
  Bot,
  GitBranch,
  Network,
  PanelLeft,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { taskStatusLabel } from '../../../shared/tasks'
import type {
  AgentProfile,
  Approval,
  Conversation,
  Project,
  Provider,
  Task,
} from '../../../shared/types'
import { Button } from '../../components/ui'
interface Props {
  project: Project | undefined
  text: (zh: string, eng: string) => string
  conversation: Conversation | undefined
  agents: AgentProfile[]
  tasks: Task[]
  roomApprovals: Approval[]
  en: boolean
  colors: Record<Provider, string>
  setWorkflowOpen: Dispatch<SetStateAction<boolean>>
  setTeamOpen: Dispatch<SetStateAction<boolean>>
  panel: string
  setPanel: Dispatch<SetStateAction<string>>
  pendingApprovals: number
  openQueue(): void
}
export function WorkspaceHeader({
  project,
  text,
  conversation,
  agents,
  tasks,
  roomApprovals,
  en,
  colors,
  setWorkflowOpen,
  setTeamOpen,
  panel,
  setPanel,
  pendingApprovals,
  openQueue,
}: Props) {
  return (
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
              : conversation?.name || text('多代理協作工作空間', 'Multi-agent coding workspace')}
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
              <span className="sr-only">{a.name}</span>
            </span>
          )
        })}
      </div>
      <div className="header-actions">
        {!!pendingApprovals && (
          <Button
            size="sm"
            variant="outline"
            className="approval-trigger"
            onClick={openQueue}
            title={text('批准佇列（Ctrl+Shift+A）', 'Approval queue (Ctrl+Shift+A)')}
          >
            <ShieldCheck size={15} />
            <span>{text('待批准', 'Approvals')}</span>
            <b className="count">{pendingApprovals}</b>
          </Button>
        )}
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
          variant={panel === 'tasks' ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => setPanel(panel === 'tasks' ? '' : 'tasks')}
        >
          <Network size={15} />
          <span>{text('任務', 'Tasks')}</span>
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
  )
}
