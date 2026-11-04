import { useState } from 'react'
import { X, RefreshCw, GitBranch, Check, AlertTriangle, Square, Play, Pause } from 'lucide-react'
import type {
  Activity,
  AgentProfile,
  Approval,
  Project,
  Task,
  TestRun,
  Workspace,
  Review,
  Artifact,
  UsageRecord,
} from '../../shared/types'
import { Button } from '../components/ui'
import { Reviews, Artifacts, Usage } from './Reviews'
import { TaskForm, InitialCommit, TestTools } from './WorkflowControls'
import { isTaskActive, latestAttempt, taskStatusLabel } from '../../shared/tasks'
import { ContextPanel } from './ContextPanel'
interface Diff {
  status: string
  diff: string
  revision: string
  path: string
  branch: string
}
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
          <>
            <Usage usage={usage} en={en} />
            <ContextPanel
              key={conversationId}
              conversationId={conversationId}
              agents={agents}
              perform={perform}
              en={en}
            />
            <TaskForm
              tasks={tasks}
              agents={agents}
              conversationId={conversationId}
              perform={perform}
              en={en}
            />
            <h4>
              {text('任務', 'Tasks')} <span>{tasks.length}</span>
            </h4>
            {!tasks.length && (
              <p className="panel-empty">
                {text('指派工作後，任務會顯示於此。', 'Assigned work will appear here.')}
              </p>
            )}
            {tasks
              .slice(-60)
              .reverse()
              .map((task) => (
                <details className="task" key={task.id} id={`task-${task.id}`}>
                  <summary>
                    <span
                      className={`status-dot ${task.supersededBy ? 'superseded' : task.status}`}
                    />
                    <span>
                      {task.name}
                      <small>
                        {agents.find((a) => a.id === task.agentId)?.name} ·{' '}
                        {taskStatusLabel(task, en)}
                      </small>
                    </span>
                  </summary>
                  <div className="task-detail">
                    {task.workflow && (
                      <p className="muted">
                        {text(
                          '此任務由工作流程管理。請從上方「流程」檢查進度、暫停、繼續或取消，避免單獨重跑步驟。',
                          'Managed by a workflow. Use Workflows above to inspect, pause, resume or cancel the run instead of replaying one step.',
                        )}
                      </p>
                    )}
                    <p>{task.description}</p>
                    {task.runtime && (
                      <p className="muted">
                        {task.runtime.model || text('Runtime 預設模型', 'Runtime default model')} ·{' '}
                        {task.runtime.reasoningEffort ||
                          text('模型預設強度', 'Model default effort')}
                      </p>
                    )}
                    {task.retryOf && (
                      <p className="muted">
                        {text('新嘗試，保留先前紀錄', 'New attempt; prior history retained')}:{' '}
                        {task.retryOf.slice(0, 8)}
                      </p>
                    )}
                    {(task.nativeTurns || 1) > 1 && (
                      <p className="muted">
                        {text(
                          '原生回合預算（含 Host 資料續接）',
                          'Native turn budget (including host-read continuations)',
                        )}
                        : {task.nativeTurns}
                      </p>
                    )}
                    {task.supersededBy && (
                      <p className="muted">
                        {text('已由新嘗試取代', 'Replaced by attempt')}:{' '}
                        {task.supersededBy.slice(0, 8)}
                      </p>
                    )}
                    {task.waitReason === 'recovery' && (
                      <p className="muted">
                        {text(
                          '重啟前的執行結果尚未確認。請先檢查 Diff；App 沒有重跑此工作。',
                          'Pre-restart results are unconfirmed. Inspect the diff first; this work was not replayed.',
                        )}
                      </p>
                    )}
                    {task.status === 'blocked' && (
                      <p className="muted">
                        {text(
                          '請處理下列上游任務。原排程會追蹤使用者批准的新嘗試，完成後才繼續。',
                          'Resolve the prerequisites below. This queued task follows user-approved retry attempts and proceeds only after they complete.',
                        )}
                      </p>
                    )}
                    {task.revision && <code>{task.revision.slice(0, 12)}</code>}
                    {task.error && <pre className="error-text">{task.error}</pre>}
                    {task.integration && (
                      <p className="muted">
                        {text('主要專案整合', 'Primary project integration')}:{' '}
                        {task.integration.status} · {task.integration.detail}
                      </p>
                    )}
                    {!task.workflow &&
                      task.integration?.status === 'attention' &&
                      ['waiting_user', 'paused', 'cancelled', 'failed'].includes(task.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (
                              window.confirm(
                                text(
                                  '已檢查工作區 Diff？這只會重新檢查並測試整合目前變更，不會重跑 Agent。',
                                  'Reviewed the workspace diff? Retry safety checks and tested integration of current changes without rerunning the agent?',
                                ),
                              )
                            )
                              void perform({ op: 'task.integrate', id: task.id })
                          }}
                        >
                          {text(
                            '重新嘗試整合（不重跑 Agent）',
                            'Retry integration (no agent rerun)',
                          )}
                        </Button>
                      )}
                    {task.result && <pre>{task.result.slice(-4000)}</pre>}
                    {!!task.dependencies.length && (
                      <p className="muted">
                        {text('依賴', 'Dependencies')}:{' '}
                        {task.dependencies.map((id) => {
                          const original = tasks.find((t) => t.id === id)
                          const latest =
                            original &&
                            latestAttempt(original, new Map(tasks.map((t) => [t.id, t])))
                          return (
                            <button
                              key={id}
                              onClick={() => {
                                const element = document.getElementById(
                                  `task-${latest?.id || id}`,
                                ) as HTMLDetailsElement | null
                                if (element) {
                                  element.open = true
                                  element.scrollIntoView({ block: 'nearest' })
                                }
                              }}
                            >
                              {latest ? `${latest.name} · ${taskStatusLabel(latest, en)}` : id}
                            </button>
                          )
                        })}
                      </p>
                    )}
                    {!task.workflow &&
                      !task.supersededBy &&
                      !['running', 'completed', 'reviewing'].includes(task.status) &&
                      task.waitReason !== 'approval' && (
                        <label>
                          {text('重新指派', 'Reassign')}
                          <select
                            value={task.agentId}
                            onChange={(e) =>
                              void perform({
                                op: 'task.reassign',
                                id: task.id,
                                agentId: e.target.value,
                              })
                            }
                          >
                            {agents
                              .filter((a) => a.enabled)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                    <div className="actions">
                      {!task.workflow &&
                        !task.supersededBy &&
                        (isTaskActive(task) || task.status === 'blocked') && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void perform({ op: 'task.action', id: task.id, action: 'pause' })
                              }
                            >
                              <Pause size={12} />
                              {text('暫停', 'Pause')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void perform({ op: 'task.action', id: task.id, action: 'cancel' })
                              }
                            >
                              <Square size={12} />
                              {text('取消', 'Cancel')}
                            </Button>
                          </>
                        )}
                      {!task.workflow &&
                        !task.supersededBy &&
                        task.waitReason !== 'approval' &&
                        task.waitReason !== 'integration' &&
                        ['paused', 'failed', 'cancelled', 'waiting_user'].includes(task.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (
                                window.confirm(
                                  text(
                                    '請先檢查部分變更。繼續會保留原紀錄並建立新嘗試；原本等待此依賴的任務會在新嘗試完成後解鎖。是否繼續？',
                                    'Inspect partial changes first. A new attempt preserves the old history and unlocks already queued dependents after success. Continue?',
                                  ),
                                )
                              )
                                void perform({ op: 'task.action', id: task.id, action: 'resume' })
                            }}
                          >
                            <Play size={12} />
                            {text('檢查後繼續', 'Resume after review')}
                          </Button>
                        )}
                    </div>
                  </div>
                </details>
              ))}
            <h4>{text('測試結果', 'Test results')}</h4>
            {!tests.length && (
              <p className="panel-empty">
                {text(
                  '於變更面板執行已提交版本的測試。',
                  'Run tests on a committed workspace from Changes.',
                )}
              </p>
            )}
            {tests
              .slice(-20)
              .reverse()
              .map((run) => (
                <details className="task" key={run.id}>
                  <summary>
                    <span
                      className={`status-dot ${run.status === 'passed' ? 'completed' : run.status}`}
                    />
                    <span>
                      {run.name}
                      <small>
                        {run.status} · {(run.durationMs / 1000).toFixed(1)}s ·{' '}
                        {run.revision.slice(0, 12)}
                      </small>
                    </span>
                  </summary>
                  <pre>
                    {run.error}
                    {'\n'}
                    {run.logs || 'Running…'}
                  </pre>
                  {run.status === 'running' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void perform({ op: 'test.cancel', id: run.id })}
                    >
                      {text('取消測試', 'Cancel test')}
                    </Button>
                  )}
                </details>
              ))}
            <div className="actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void perform({ op: 'export', conversationId, format: 'markdown' })}
              >
                {text('匯出 Markdown', 'Export Markdown')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void perform({ op: 'export', conversationId, format: 'json' })}
              >
                JSON
              </Button>
            </div>
            <h4>{text('執行紀錄', 'Runtime activity')}</h4>
            {!activities.length && (
              <p className="panel-empty">
                {text('工具活動與診斷將即時顯示。', 'Tool activity and diagnostics appear live.')}
              </p>
            )}
            {activities
              .slice(-100)
              .reverse()
              .map((a) => (
                <details className="activity" key={a.id}>
                  <summary>
                    <span className="activity-line" />
                    <span>
                      {agents.find((x) => x.id === a.agentId)?.name}
                      <small>
                        {a.type} · {new Date(a.timestamp).toLocaleTimeString()}
                      </small>
                    </span>
                  </summary>
                  <pre>{a.detail}</pre>
                </details>
              ))}
          </>
        ) : (
          <>
            <div className="section-title">
              <h4>
                <GitBranch size={14} />
                {text('隔離工作區', 'Isolated workspaces')}
              </h4>
              <Button
                variant="ghost"
                size="icon"
                title="Refresh diff"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} />
              </Button>
            </div>
            <p className="muted">
              {project.autoManaged &&
                text(
                  '自動管理已啟用：直接發送任務即可。工作區會按需建立及重用，通過安全檢查與快照測試後自動整合到原資料夾。以下為進階檢查／手動處理工具。',
                  'Automatic management is enabled. Send work directly; workspaces are created and reused on demand, with tested safe results integrated into the original folder. Advanced controls follow.',
                )}
            </p>
            <label className="inline">
              <input
                type="checkbox"
                checked={!!project.autoManaged}
                onChange={(e) =>
                  void perform({
                    op: 'project.automation',
                    projectId: project.id,
                    enabled: e.target.checked,
                  })
                }
              />
              {text('自動管理與測試整合', 'Automatic management and tested integration')}
            </label>
            {project.setup?.detail && <p>{project.setup.detail}</p>}
            {!!project.setup?.excluded?.length && (
              <details>
                <summary>{text('初始快照排除項目', 'Initial snapshot omissions')}</summary>
                <pre>{project.setup.excluded.join('\n')}</pre>
              </details>
            )}
            <details>
              <summary>
                {text(
                  '進階：主專案與 Git 操作紀錄',
                  'Advanced: primary project and Git operations',
                )}
              </summary>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void invoke({ op: 'project.inspect', projectId: project.id }).then((value) =>
                    setDiff(value as Diff),
                  )
                }
              >
                {text('檢視主專案變更', 'Inspect primary changes')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      text(
                        '已檢查主專案 Diff？批准將目前一般檔案保存為 Git 快照，敏感／不明內容會拒絕，既有暫存項目保留。',
                        'After reviewing the primary diff, save a safe snapshot? Sensitive/unknown files are refused and existing staged entries are preserved.',
                      ),
                    )
                  )
                    void invoke({ op: 'project.checkpoint', projectId: project.id })
                }}
              >
                {text('保存主專案安全快照', 'Save primary safe snapshot')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void perform({ op: 'project.operations', projectId: project.id }).then((value) =>
                    setOperations(value as typeof operations),
                  )
                }
              >
                {text('更新 Git 操作紀錄', 'Refresh Git operation log')}
              </Button>
              {operations.map((entry) => (
                <details key={entry.id}>
                  <summary>
                    {entry.operation} · {entry.status} · {new Date(entry.time).toLocaleTimeString()}
                  </summary>
                  <pre>{entry.detail}</pre>
                </details>
              ))}
            </details>
            <p className="muted">
              {text(
                '每個代理使用獨立分支。原專案的未提交檔案不會自動出現在 Worktree。',
                'Each agent has a branch. Uncommitted files in the original project are not copied to worktrees.',
              )}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void invoke({ op: 'workspace.prepare', projectId: project.id, initialize: false })
              }
            >
              {text('建立 Git 隔離工作區', 'Prepare Git workspaces')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    text(
                      '允許在此資料夾執行 git init？不會自動加入檔案或建立初始 Commit。',
                      'Allow git init in this folder? Files will not be staged or committed automatically.',
                    ),
                  )
                )
                  void invoke({ op: 'workspace.prepare', projectId: project.id, initialize: true })
              }}
            >
              {text('非 Git 專案：批准初始化', 'Non-Git project: approve initialization')}
            </Button>
            {!!workspaces.length && (
              <>
                <TestTools
                  workspaceId={workspaceId || workspaces[0].id}
                  perform={perform}
                  en={en}
                />
                <select
                  aria-label="Workspace"
                  value={workspaceId || workspaces[0]?.id}
                  onChange={(e) => {
                    setWorkspaceId(e.target.value)
                    setDiff(undefined)
                    setPreview(undefined)
                  }}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {agents.find((a) => a.id === w.agentId)?.name} · {w.branch}
                    </option>
                  ))}
                </select>
                <div className="actions">
                  {(['test', 'build'] as const).map((script) => (
                    <Button
                      key={script}
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            text(
                              `以目前使用者身分在此已提交工作區執行 npm run ${script}？專案腳本可執行任意程式碼。`,
                              `Run npm run ${script} in this committed workspace as your OS user? Project scripts can execute arbitrary code.`,
                            ),
                          )
                        )
                          void invoke({
                            op: 'test.run',
                            workspaceId: workspaceId || workspaces[0].id,
                            script,
                          }).then(() => setTab('activity'))
                      }}
                    >
                      {script === 'test'
                        ? text('執行測試', 'Run tests')
                        : text('執行建置', 'Run build')}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          text(
                            '將此工作區所有變更加入 Git 並建立 Commit？請先檢查 Diff 與未追蹤檔案。',
                            'Stage all workspace changes and create a commit? Inspect diff and untracked files first.',
                          ),
                        )
                      )
                        void invoke({
                          op: 'git.checkpoint',
                          workspaceId: workspaceId || workspaces[0].id,
                          message: 'AgentHub reviewed checkpoint',
                        }).then(() => refresh())
                    }}
                  >
                    <Check size={12} />
                    {text('建立檢查點', 'Checkpoint')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void invoke({
                        op: 'git.preview',
                        workspaceId: workspaceId || workspaces[0].id,
                      }).then((p) => setPreview(p as typeof preview))
                    }
                  >
                    {text('合併預覽', 'Merge preview')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void invoke({
                        op: 'git.preview',
                        workspaceId: workspaceId || workspaces[0].id,
                        direction: 'sync',
                      }).then((p) => setPreview(p as typeof preview))
                    }
                  >
                    {text('同步主專案預覽', 'Preview sync from project')}
                  </Button>
                </div>
              </>
            )}
            <InitialCommit projectId={project.id} perform={perform} en={en} />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void invoke({ op: 'git.project.revert.preview', projectId: project.id }).then((p) =>
                  setPreview(p as typeof preview),
                )
              }
            >
              {text('回滾主專案最新 Commit 預覽', 'Preview project latest commit revert')}
            </Button>
            {!!workspaces.length && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void invoke({
                    op: 'git.revert.preview',
                    workspaceId: workspaceId || workspaces[0].id,
                  }).then((p) => setPreview(p as typeof preview))
                }
              >
                {text('回滾最新 Commit 預覽', 'Preview latest commit revert')}
              </Button>
            )}
            {diff && (
              <>
                <code className="data-path">{diff.path}</code>
                <small className="muted">HEAD {diff.revision.slice(0, 12)}</small>
                <pre className="git-status">
                  {diff.status || text('工作區乾淨', 'Working tree clean')}
                </pre>
                <p className="muted">
                  {text(
                    '未追蹤檔案僅列出名稱；內容未包含在下方 Diff。',
                    'Untracked files are listed above; their content is absent from this diff.',
                  )}
                </p>
                <pre className="diff-view">
                  {diff.diff || text('無已追蹤檔案變更', 'No tracked changes')}
                </pre>
              </>
            )}
            {preview && (
              <section className="merge-preview">
                <h4>{text('合併預覽', 'Merge preview')}</h4>
                <code>
                  {preview.target.slice(0, 12)} ← {preview.source.slice(0, 12)}
                </code>
                <pre className="diff-view">{preview.diff || text('無變更', 'No changes')}</pre>
                <p className="muted">
                  {text(
                    '已建立整合後的獨立快照，必須在此版本通過所選測試才能批准整合。其他代理透過同步預覽取得已整合契約。',
                    'An isolated integrated snapshot is ready. Pass a test runner on this exact version before approving integration. Other agents receive integrated contracts through sync preview.',
                  )}
                </p>
                <TestTools workspaceId={preview.integrationWorkspaceId} perform={perform} en={en} />
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        text(
                          '批准在合併快照執行專案 npm test 腳本？',
                          'Approve running the project npm test script in the integration snapshot?',
                        ),
                      )
                    )
                      void invoke({
                        op: 'test.run',
                        workspaceId: preview.integrationWorkspaceId,
                        script: 'test',
                      })
                  }}
                >
                  {text('測試此合併快照', 'Test this merged snapshot')}
                </Button>
                <Button
                  disabled={
                    busy ||
                    !tests.some(
                      (t) =>
                        t.workspaceId === preview.integrationWorkspaceId &&
                        t.revision === preview.integrationCommit &&
                        t.status === 'passed' &&
                        (t.kind === 'test' || t.name === 'npm run test'),
                    )
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        text(
                          '批准將預覽中的確切 Commit 合併到原專案目前分支？',
                          'Approve merging these exact commits into the current project branch?',
                        ),
                      )
                    )
                      void invoke({ op: 'git.merge', previewId: preview.id }).then(() => {
                        setPreview(undefined)
                        void refresh()
                      })
                  }}
                >
                  {text('批准並合併', 'Approve & merge')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void invoke({ op: 'git.preview.discard', previewId: preview.id }).then(() =>
                      setPreview(undefined),
                    )
                  }
                >
                  {text('捨棄預覽快照', 'Discard preview snapshot')}
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
