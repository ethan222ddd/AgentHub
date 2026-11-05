import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import type {
  Activity,
  AgentProfile,
  Approval,
  Artifact,
  Project,
  Review,
  Task,
  TestRun,
  UsageRecord,
  Workspace,
} from '../../shared/types'
import { Button } from '../components/ui'
import { ActivityPanel } from './panels/ActivityPanel'
import { ChangesPanel } from './panels/ChangesPanel'
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
  return (
    <aside className="side-panel">
      <header>
        <div className="tabs">
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            {text('活動', 'Activity')}
          </button>
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            {text('變更', 'Changes')}
          </button>
          <button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>
            {text('審查', 'Reviews')}
          </button>
          <button
            className={tab === 'artifacts' ? 'active' : ''}
            onClick={() => setTab('artifacts')}
          >
            {text('契約', 'Contracts')}
          </button>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close panel" onClick={close}>
          <X size={16} />
        </Button>
      </header>
      <div className="panel-body">
        {approvals.map((a) => (
          <section className="approval" key={a.id}>
            <div>
              <AlertTriangle size={16} />
              <strong>
                {agents.find((x) => x.id === a.agentId)?.name} ·{' '}
                {text('等待批准', 'Approval needed')}
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
        {tab === 'reviews' ? (
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
          />
        )}
      </div>
    </aside>
  )
}
