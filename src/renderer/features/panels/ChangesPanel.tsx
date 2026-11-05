import { Check, GitBranch, RefreshCw } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgentProfile, Project, TestRun, Workspace } from '../../../shared/types'
import { Button } from '../../components/ui'
import { InitialCommit, TestTools } from '../WorkflowControls'
import type { Diff } from './types'
interface Props {
  text: (zh: string, eng: string) => string
  busy: boolean
  refresh: () => Promise<void>
  project: Project
  perform: (request: Record<string, unknown>) => Promise<unknown>
  invoke: (request: Record<string, unknown>) => Promise<unknown>
  setDiff: Dispatch<SetStateAction<Diff | undefined>>
  setOperations: Dispatch<
    SetStateAction<
      { id: string; operation: string; status: string; detail: string; time: string }[]
    >
  >
  operations: { id: string; operation: string; status: string; detail: string; time: string }[]
  workspaces: Workspace[]
  workspaceId: string
  en: boolean
  setWorkspaceId: Dispatch<SetStateAction<string>>
  setPreview: Dispatch<
    SetStateAction<
      | {
          id: string
          target: string
          source: string
          diff: string
          integrationWorkspaceId: string
          integrationCommit: string
        }
      | undefined
    >
  >
  agents: AgentProfile[]
  setTab: (tab: string) => void
  diff: Diff | undefined
  preview:
    | {
        id: string
        target: string
        source: string
        diff: string
        integrationWorkspaceId: string
        integrationCommit: string
      }
    | undefined
  tests: TestRun[]
}
export function ChangesPanel({
  text,
  busy,
  refresh,
  project,
  perform,
  invoke,
  setDiff,
  setOperations,
  operations,
  workspaces,
  workspaceId,
  en,
  setWorkspaceId,
  setPreview,
  agents,
  setTab,
  diff,
  preview,
  tests,
}: Props) {
  return (
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
          {text('進階：主專案與 Git 操作紀錄', 'Advanced: primary project and Git operations')}
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
          <TestTools workspaceId={workspaceId || workspaces[0].id} perform={perform} en={en} />
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
                {script === 'test' ? text('執行測試', 'Run tests') : text('執行建置', 'Run build')}
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
  )
}
