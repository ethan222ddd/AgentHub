import { Pause, Play, Square } from 'lucide-react'
import { isTaskActive, latestAttempt, taskStatusLabel } from '../../../shared/tasks'
import type { Activity, AgentProfile, Task, TestRun, UsageRecord } from '../../../shared/types'
import { Button } from '../../components/ui'
import { ContextPanel } from '../ContextPanel'
import { Usage } from '../Reviews'
import { TaskForm } from '../WorkflowControls'
interface Props {
  usage: UsageRecord[]
  en: boolean
  conversationId: string
  agents: AgentProfile[]
  perform: (request: Record<string, unknown>) => Promise<unknown>
  tasks: Task[]
  text: (zh: string, eng: string) => string
  tests: TestRun[]
  activities: Activity[]
}
export function ActivityPanel({
  usage,
  en,
  conversationId,
  agents,
  perform,
  tasks,
  text,
  tests,
  activities,
}: Props) {
  return (
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
              <span className={`status-dot ${task.supersededBy ? 'superseded' : task.status}`} />
              <span>
                {task.name}
                <small>
                  {agents.find((a) => a.id === task.agentId)?.name} · {taskStatusLabel(task, en)}
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
                  {task.runtime.reasoningEffort || text('模型預設強度', 'Model default effort')}
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
                  {text('已由新嘗試取代', 'Replaced by attempt')}: {task.supersededBy.slice(0, 8)}
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
                  {text('主要專案整合', 'Primary project integration')}: {task.integration.status} ·{' '}
                  {task.integration.detail}
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
                    {text('重新嘗試整合（不重跑 Agent）', 'Retry integration (no agent rerun)')}
                  </Button>
                )}
              {task.result && <pre>{task.result.slice(-4000)}</pre>}
              {!!task.dependencies.length && (
                <p className="muted">
                  {text('依賴', 'Dependencies')}:{' '}
                  {task.dependencies.map((id) => {
                    const original = tasks.find((t) => t.id === id)
                    const latest =
                      original && latestAttempt(original, new Map(tasks.map((t) => [t.id, t])))
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
                  task.waitReason !== 'plan' &&
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
                  {run.status} · {(run.durationMs / 1000).toFixed(1)}s · {run.revision.slice(0, 12)}
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
  )
}
