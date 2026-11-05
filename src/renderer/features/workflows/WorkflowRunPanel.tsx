import type { Dispatch, SetStateAction } from 'react'
import type { AgentProfile, Project, WorkflowRun, WorkflowTemplate } from '../../../shared/types'
import { Button } from '../../components/ui'

interface Props {
  draft: WorkflowTemplate
  t: (zh: string, eng: string) => string
  binding: (role: WorkflowTemplate['roles'][number]) => string
  setBindings: Dispatch<SetStateAction<Record<string, string>>>
  bindings: Record<string, string>
  agents: AgentProfile[]
  requirement: string
  setRequirement: Dispatch<SetStateAction<string>>
  busy: boolean
  conversationId: string
  unsaved: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
  perform: (request: Record<string, unknown>) => Promise<unknown>
  started: () => void
  project: Project | undefined
  runs: WorkflowRun[]
  statuses: {
    running: string
    paused: string
    attention: string
    completed: string
    cancelled: string
    pending: string
  }
}
export function WorkflowRunPanel({
  draft,
  t,
  binding,
  setBindings,
  bindings,
  agents,
  requirement,
  setRequirement,
  busy,
  conversationId,
  unsaved,
  act,
  perform,
  started,
  project,
  runs,
  statuses,
}: Props) {
  return (
    <>
      <h3>{draft.name}</h3>
      <p>{draft.description}</p>
      <p className="muted">
        {t(
          '執行前請先儲存編輯。未通過審查不會整合；失敗、回修上限與重啟會停止流程。整合仍受安全檢查、主專案 WIP 和全域 Review 設定限制。',
          'Save edits before running. Review rejection prevents integration; errors, fix limits and restart stop the workflow. Existing safety, primary WIP and global review gates remain.',
        )}
      </p>
      {draft.roles.map((role) => (
        <label key={role.id}>
          {role.name}
          <select
            aria-label={`Bind role ${role.id}`}
            value={binding(role)}
            onChange={(e) => setBindings({ ...bindings, [role.id]: e.target.value })}
          >
            <option value="">{t('選擇團隊成員', 'Select team member')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.provider}
              </option>
            ))}
          </select>
        </label>
      ))}
      <ol className="workflow-plan">
        {draft.steps.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong>
            <span className="muted">
              {' '}
              · {draft.roles.find((r) => r.id === s.roleId)?.name}
              {s.dependsOn.length
                ? ' ← ' +
                  s.dependsOn.map((id) => draft.steps.find((x) => x.id === id)?.name).join(' + ')
                : t(' · 可直接開始', ' · Ready to start')}
            </span>
          </li>
        ))}
      </ol>
      <label>
        {t('這次要完成的需求', 'Requirement for this run')}
        <textarea
          aria-label="Workflow requirement"
          rows={4}
          value={requirement}
          maxLength={16000}
          onChange={(e) => setRequirement(e.target.value)}
        />
      </label>
      <Button
        disabled={busy || !conversationId || !requirement.trim() || unsaved}
        onClick={() =>
          void act(async () => {
            await perform({
              op: 'workflow.start',
              templateId: draft.id,
              conversationId,
              requirement,
              bindings: Object.fromEntries(draft.roles.map((role) => [role.id, binding(role)])),
            })
            started()
          })
        }
      >
        {t('啟動工作流程', 'Start workflow')}
      </Button>
      {!project?.autoManaged && (
        <p className="muted">
          {t(
            '此專案需要先啟用自動管理工作區。',
            'Enable automatic workspace management for this project first.',
          )}
        </p>
      )}
      <h3>{t('目前聊天室的流程', 'Runs in this conversation')}</h3>
      {runs.map((run) => (
        <section className="agent-setting" key={run.id} data-workflow-run={run.id}>
          <strong>
            {run.template.name} · {statuses[run.status]}
          </strong>
          {run.error && (
            <p className="workflow-notice" role="alert">
              {run.error}
            </p>
          )}
          <ol>
            {run.template.steps.map((s) => (
              <li key={s.id}>
                {s.name} · {statuses[run.steps[s.id].status]}
                {run.steps[s.id].fixes
                  ? ` · ${t('回修', 'fixes')} ${run.steps[s.id].fixes}/${run.template.maxFixes}`
                  : ''}
              </li>
            ))}
          </ol>
          {!['completed', 'cancelled'].includes(run.status) && (
            <div className="workflow-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    perform({
                      op: 'workflow.action',
                      id: run.id,
                      action: run.status === 'running' ? 'pause' : 'resume',
                    }),
                  )
                }
              >
                {run.status === 'running'
                  ? t('暫停流程', 'Pause workflow')
                  : t('檢查後繼續', 'Resume after inspection')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() => perform({ op: 'workflow.action', id: run.id, action: 'cancel' }))
                }
              >
                {t('取消流程', 'Cancel workflow')}
              </Button>
            </div>
          )}
        </section>
      ))}
    </>
  )
}
