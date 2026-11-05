import { ClipboardCheck, ListChecks, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import type {
  Activity,
  AgentProfile,
  Approval,
  Artifact,
  Conversation,
  Project,
  ProjectOverlaps,
  Review,
  Task,
  TestRun,
  UsageRecord,
  Workspace,
} from '../../shared/types'
import { Button } from '../components/ui'
import { ActivityPanel } from './panels/ActivityPanel'
import { ChangesPanel } from './panels/ChangesPanel'
import { PlanReview } from './panels/PlanReview'
import { DecisionLog } from './panels/DecisionLog'
import { TaskMap } from './panels/TaskMap'
import { UsageTrends } from './panels/UsageTrends'
import type { Diff } from './panels/types'
import { Artifacts, Reviews } from './Reviews'

export function SidePanel({
  tab,
  setTab,
  close,
  project,
  workspaces,
  agents,
  tasks,
  tests,
  reviews,
  artifacts,
  usage,
  conversationId,
  activities,
  approvals,
  perform,
  en,
  allAgents,
  allUsage,
  allTasks,
  conversations,
  openQueue,
  overlaps,
}: {
  tab: string
  setTab(tab: string): void
  close(): void
  project: Project
  workspaces: Workspace[]
  agents: AgentProfile[]
  tasks: Task[]
  tests: TestRun[]
  reviews: Review[]
  artifacts: Artifact[]
  usage: UsageRecord[]
  conversationId: string
  activities: Activity[]
  approvals: Approval[]
  perform(request: Record<string, unknown>): Promise<unknown>
  en: boolean
  allAgents: AgentProfile[]
  allUsage: UsageRecord[]
  allTasks: Task[]
  conversations: Conversation[]
  openQueue(): void
  overlaps?: ProjectOverlaps
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '')
  const [diff, setDiff] = useState<Diff>()
  const [preview, setPreview] = useState<{
    id: string
    target: string
    source: string
    diff: string
    integrationWorkspaceId: string
    integrationCommit: string
  }>()
  const [busy, setBusy] = useState(false)
  const [operations, setOperations] = useState<
    { id: string; operation: string; status: string; detail: string; time: string }[]
  >([])
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const proposedDecisions = (project.decisions || []).filter((d) => d.status === 'proposed').length
  const plans = tasks.filter(
    (t) => !t.supersededBy && t.status === 'waiting_user' && t.waitReason === 'plan' && t.plan,
  )
  const invoke = async (request: Record<string, unknown>) => {
    setBusy(true)
    try {
      return await perform(request)
    } finally {
      setBusy(false)
    }
  }
  const refresh = async () => {
    const id = workspaceId || workspaces[0]?.id
    if (id) setDiff((await invoke({ op: 'git.diff', workspaceId: id })) as Diff)
  }
  // Graph and board need room to breathe; open the task where its actions live.
  const openTask = (id: string) => {
    setTab('activity')
    setTimeout(() => {
      const element = document.getElementById(`task-${id}`) as HTMLDetailsElement | null
      if (element) {
        element.open = true
        element.scrollIntoView({ block: 'center' })
        element.querySelector('summary')?.focus()
      }
    }, 60)
  }
  const tabs: [string, string][] = [
    ['activity', text('活動', 'Activity')],
    ['tasks', text('任務', 'Tasks')],
    ['usage', text('用量', 'Usage')],
    ['changes', text('變更', 'Changes')],
    ['reviews', text('審查', 'Reviews')],
    ['artifacts', text('契約', 'Contracts')],
    ['decisions', text('決策', 'Decisions')],
  ]
  return (
    <aside className={`side-panel ${['tasks', 'usage', 'changes'].includes(tab) ? 'wide' : ''}`}>
      <header>
        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'decisions' && !!proposedDecisions && (
                <b className="count">{proposedDecisions}</b>
              )}
            </button>
          ))}
        </div>
        <Button size="icon" variant="ghost" aria-label="Close panel" onClick={close}>
          <X size={16} />
        </Button>
      </header>
      <div className="panel-body">
        {(approvals.length > 1 || (approvals.length > 0 && tab !== 'activity')) && (
          <button className="queue-banner" onClick={openQueue}>
            <ListChecks size={15} />
            <span>
              {text(
                `${approvals.length} 筆操作等待批准`,
                `${approvals.length} ${approvals.length > 1 ? 'requests are' : 'request is'} waiting`,
              )}
            </span>
            <span className="queue-banner-action">
              {text('逐筆處理', 'Review')} <kbd>Ctrl</kbd>
              <kbd>Shift</kbd>
              <kbd>A</kbd>
            </span>
          </button>
        )}
        {tab === 'activity' &&
          plans.map((task) => (
            <PlanReview key={task.id} task={task} agents={agents} en={en} perform={perform} />
          ))}
        {tab !== 'activity' && !!plans.length && (
          <button className="queue-banner plan-banner" onClick={() => setTab('activity')}>
            <ClipboardCheck size={15} />
            <span>
              {text(`${plans.length} 份計畫等待批准`, `${plans.length} plans await approval`)}
            </span>
            <span className="queue-banner-action">{text('前往審核', 'Review')}</span>
          </button>
        )}
        {/* Full cards live in Activity; maps and charts keep their space with the banner. */}
        {tab === 'activity' &&
          approvals.map((a) => (
            <section className="approval" key={a.id}>
              <div>
                <ShieldAlert size={15} />
                <strong>
                  {agents.find((x) => x.id === a.agentId)?.name}{' '}
                  {text('等待批准', 'needs approval')}
                </strong>
              </div>
              <b>{a.tool}</b>
              <pre>{a.detail}</pre>
              <small>{a.risk}</small>
              <div className="actions">
                <Button
                  size="sm"
                  onClick={() => void perform({ op: 'approve', id: a.id, allow: true })}
                >
                  {text('允許一次', 'Allow once')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void perform({ op: 'approve', id: a.id, allow: false })}
                >
                  {text('拒絕', 'Deny')}
                </Button>
                {a.canRemember && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void perform({ op: 'approve', id: a.id, allow: true, remember: true })
                    }
                  >
                    {text('記憶本工作區讀取批准', 'Remember workspace read')}
                  </Button>
                )}
              </div>
            </section>
          ))}
        {tab === 'tasks' ? (
          <TaskMap
            tasks={tasks}
            agents={agents}
            allAgents={allAgents}
            en={en}
            openTask={openTask}
            overlaps={overlaps}
            projectId={project.id}
            perform={perform}
          />
        ) : tab === 'usage' ? (
          <UsageTrends
            usage={allUsage}
            tasks={allTasks}
            conversations={conversations}
            allAgents={allAgents}
            conversationId={conversationId}
            projectId={project.id}
            en={en}
          />
        ) : tab === 'decisions' ? (
          <DecisionLog project={project} agents={allAgents} en={en} perform={perform} />
        ) : tab === 'reviews' ? (
          <Reviews
            reviews={reviews}
            tasks={tasks}
            workspaces={workspaces}
            agents={agents}
            conversationId={conversationId}
            perform={perform}
            en={en}
          />
        ) : tab === 'artifacts' ? (
          <Artifacts artifacts={artifacts} perform={perform} en={en} />
        ) : tab === 'activity' ? (
          <ActivityPanel
            usage={usage}
            en={en}
            conversationId={conversationId}
            agents={agents}
            perform={perform}
            tasks={tasks}
            text={text}
            tests={tests}
            activities={activities}
          />
        ) : (
          <ChangesPanel
            text={text}
            busy={busy}
            refresh={refresh}
            project={project}
            perform={perform}
            invoke={invoke}
            setDiff={setDiff}
            setOperations={setOperations}
            operations={operations}
            workspaces={workspaces}
            workspaceId={workspaceId}
            en={en}
            setWorkspaceId={setWorkspaceId}
            setPreview={setPreview}
            agents={agents}
            setTab={setTab}
            diff={diff}
            preview={preview}
            tests={tests}
            tasks={tasks}
            conversationId={conversationId}
          />
        )}
      </div>
    </aside>
  )
}
