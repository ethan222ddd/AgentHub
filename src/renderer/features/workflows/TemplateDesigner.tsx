import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { Provider, Snapshot, WorkflowStep, WorkflowTemplate } from '../../../shared/types'
import { builtinWorkflows } from '../../../shared/workflows'
import { Button } from '../../components/ui'

interface Props {
  t: (zh: string, eng: string) => string
  draft: WorkflowTemplate
  setDraft: Dispatch<SetStateAction<WorkflowTemplate>>
  move: (index: number, delta: number) => void
  updateStep: (id: string, patch: Partial<WorkflowStep>) => void
  issues: string[]
  busy: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
  perform: (request: Record<string, unknown>) => Promise<unknown>
  setNotice: Dispatch<SetStateAction<string>>
  fresh: (copy?: boolean) => void
  snapshot: Snapshot
  deleting: boolean
  setDeleting: Dispatch<SetStateAction<boolean>>
}
export function TemplateDesigner({
  t,
  draft,
  setDraft,
  move,
  updateStep,
  issues,
  busy,
  act,
  perform,
  setNotice,
  fresh,
  snapshot,
  deleting,
  setDeleting,
}: Props) {
  return (
    <>
      <label>
        {t('範本名稱', 'Template name')}
        <input
          aria-label="Template name"
          value={draft.name}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        {t('說明', 'Description')}
        <textarea
          rows={2}
          value={draft.description}
          maxLength={2000}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <label>
        {t('每個實作步驟的自動回修上限', 'Maximum fixes per task step')}
        <input
          aria-label="Maximum fixes"
          type="number"
          min={0}
          max={5}
          value={draft.maxFixes}
          onChange={(e) => setDraft({ ...draft, maxFixes: Number(e.target.value) })}
        />
      </label>
      <h3>{t('角色', 'Roles')}</h3>
      {draft.roles.map((role) => (
        <div className="workflow-role" key={role.id}>
          <input
            aria-label={`Role ${role.id}`}
            value={role.name}
            maxLength={100}
            onChange={(e) =>
              setDraft({
                ...draft,
                roles: draft.roles.map((r) =>
                  r.id === role.id ? { ...r, name: e.target.value } : r,
                ),
              })
            }
          />
          <select
            aria-label={`Default provider ${role.id}`}
            value={role.provider}
            onChange={(e) =>
              setDraft({
                ...draft,
                roles: draft.roles.map((r) =>
                  r.id === role.id ? { ...r, provider: e.target.value as Provider } : r,
                ),
              })
            }
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
            <option value="antigravity">Antigravity</option>
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove role ${role.id}`}
            disabled={draft.roles.length === 1 || draft.steps.some((s) => s.roleId === role.id)}
            onClick={() =>
              setDraft({ ...draft, roles: draft.roles.filter((r) => r.id !== role.id) })
            }
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        disabled={draft.roles.length >= 16}
        onClick={() =>
          setDraft({
            ...draft,
            roles: [
              ...draft.roles,
              {
                id: 'role-' + crypto.randomUUID().slice(0, 8),
                name: t('新角色', 'New role'),
                provider: 'codex',
              },
            ],
          })
        }
      >
        <Plus size={14} />
        {t('新增角色', 'Add role')}
      </Button>
      <h3>{t('步驟與交接條件', 'Steps and handoff conditions')}</h3>
      {draft.steps.map((step, index) => (
        <section className="agent-setting workflow-step" key={step.id} data-step-id={step.id}>
          <div className="workflow-actions">
            <strong>
              {index + 1}. {step.name}
            </strong>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move up ${step.id}`}
              disabled={!index}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move down ${step.id}`}
              disabled={index === draft.steps.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove step ${step.id}`}
              disabled={draft.steps.length === 1}
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: draft.steps
                    .filter((s) => s.id !== step.id)
                    .map((s) => ({
                      ...s,
                      dependsOn: s.dependsOn.filter((id) => id !== step.id),
                      artifactFrom: s.artifactFrom.filter((id) => id !== step.id),
                      sourceStepId: s.sourceStepId === step.id ? '' : s.sourceStepId,
                    })),
                })
              }
            >
              <Trash2 size={13} />
            </Button>
          </div>
          <label>
            {t('步驟名稱', 'Step name')}
            <input
              value={step.name}
              maxLength={100}
              onChange={(e) => updateStep(step.id, { name: e.target.value })}
            />
          </label>
          <div className="workflow-role">
            <label>
              {t('類型', 'Type')}
              <select
                aria-label={`Step type ${step.id}`}
                value={step.kind}
                onChange={(e) =>
                  updateStep(step.id, {
                    kind: e.target.value as WorkflowStep['kind'],
                    publishArtifact: false,
                    artifactFrom: [],
                    sourceStepId: '',
                    instructions: e.target.value === 'integrate' ? '' : step.instructions,
                  })
                }
              >
                <option value="task">
                  {t('代理任務／規格／實作', 'Agent task / spec / implementation')}
                </option>
                <option value="review">
                  {t('唯讀審查（退件可回修）', 'Read-only review with bounded fixes')}
                </option>
                <option value="integrate">{t('測試通過後整合', 'Test and integrate')}</option>
              </select>
            </label>
            <label>
              {t('角色', 'Role')}
              <select
                aria-label={`Step role ${step.id}`}
                disabled={step.kind === 'integrate'}
                value={step.roleId}
                onChange={(e) => updateStep(step.id, { roleId: e.target.value })}
              >
                {draft.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {step.kind !== 'integrate' && (
            <label>
              {t('額外指示（不會提升權限）', 'Instructions (no extra permissions)')}
              <textarea
                rows={2}
                value={step.instructions}
                maxLength={8000}
                onChange={(e) => updateStep(step.id, { instructions: e.target.value })}
              />
            </label>
          )}
          {step.kind === 'integrate' && (
            <p className="muted">
              {t(
                '由主程序執行既有測試、指定版本審查與安全整合；不執行額外 Shell 或自然語言條件。',
                'The host uses existing test, exact-version review and safe integration gates. No additional shell or natural-language conditions are executed.',
              )}
            </p>
          )}
          {step.kind !== 'task' && (
            <label>
              {t('審查／整合的實作來源', 'Source task to review / integrate')}
              <select
                aria-label={`Source step ${step.id}`}
                value={step.sourceStepId}
                onChange={(e) =>
                  updateStep(step.id, {
                    sourceStepId: e.target.value,
                    ...(step.kind === 'integrate' && e.target.value
                      ? {
                          roleId: draft.steps.find((s) => s.id === e.target.value)!.roleId,
                        }
                      : {}),
                    dependsOn: [
                      ...new Set([...step.dependsOn, ...(e.target.value ? [e.target.value] : [])]),
                    ],
                  })
                }
              >
                <option value="">{t('選擇來源', 'Select source')}</option>
                {draft.steps
                  .filter((s) => s.kind === 'task' && s.id !== step.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend>{t('開始前必須完成', 'Must complete before starting')}</legend>
            {draft.steps
              .filter((s) => s.id !== step.id)
              .map((s) => (
                <label className="inline" key={s.id}>
                  <input
                    type="checkbox"
                    checked={step.dependsOn.includes(s.id)}
                    onChange={(e) =>
                      updateStep(step.id, {
                        dependsOn: e.target.checked
                          ? [...step.dependsOn, s.id]
                          : step.dependsOn.filter((id) => id !== s.id),
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
          </fieldset>
          {step.kind === 'task' && (
            <>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={step.publishArtifact}
                  onChange={(e) => updateStep(step.id, { publishArtifact: e.target.checked })}
                />
                {t(
                  '交接前必須 publish_artifact 完成版本',
                  'Require publish_artifact at the completed revision',
                )}
              </label>
              {!!draft.steps.filter((s) => s.id !== step.id && s.publishArtifact).length && (
                <fieldset>
                  <legend>{t('必須收到的契約產物', 'Required artifact handoffs')}</legend>
                  {draft.steps
                    .filter((s) => s.id !== step.id && s.publishArtifact)
                    .map((s) => (
                      <label className="inline" key={s.id}>
                        <input
                          type="checkbox"
                          checked={step.artifactFrom.includes(s.id)}
                          onChange={(e) =>
                            updateStep(step.id, {
                              artifactFrom: e.target.checked
                                ? [...step.artifactFrom, s.id]
                                : step.artifactFrom.filter((id) => id !== s.id),
                              dependsOn: e.target.checked
                                ? [...new Set([...step.dependsOn, s.id])]
                                : step.dependsOn,
                            })
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                </fieldset>
              )}
            </>
          )}
        </section>
      ))}
      <Button
        variant="outline"
        disabled={draft.steps.length >= 24}
        onClick={() =>
          setDraft({
            ...draft,
            steps: [
              ...draft.steps,
              {
                id: 'step-' + crypto.randomUUID().slice(0, 8),
                name: t('新步驟', 'New step'),
                roleId: draft.roles[0].id,
                kind: 'task',
                instructions: '',
                dependsOn: [],
                artifactFrom: [],
                publishArtifact: false,
                sourceStepId: '',
              },
            ],
          })
        }
      >
        <Plus size={14} />
        {t('新增步驟', 'Add step')}
      </Button>
      {!!issues.length && (
        <ul className="workflow-notice">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="workflow-actions">
        <Button
          disabled={busy || !!issues.length}
          onClick={() =>
            void act(async () => {
              await perform({ op: 'workflow.save', template: draft })
              setNotice(
                t(
                  '範本已儲存；執行中的流程不受影響。',
                  'Template saved; active runs are unchanged.',
                ),
              )
            })
          }
        >
          {t('儲存範本', 'Save template')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => fresh(true)}>
          <Copy size={14} />
          {t('另存副本', 'Duplicate')}
        </Button>
        {snapshot.workflowTemplates.some((s) => s.id === draft.id) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!deleting) {
                setDeleting(true)
                return
              }
              void act(async () => {
                await perform({ op: 'workflow.delete', id: draft.id })
                setDraft(
                  structuredClone(
                    snapshot.workflowTemplates.find((s) => s.id !== draft.id) || {
                      ...builtinWorkflows[0],
                      id: crypto.randomUUID(),
                    },
                  ),
                )
                setDeleting(false)
                setNotice(
                  t('範本已刪除；執行紀錄仍保留。', 'Template deleted; run history retained.'),
                )
              })
            }}
          >
            <Trash2 size={14} />
            {deleting ? t('確認刪除此範本', 'Confirm deletion') : t('刪除範本', 'Delete template')}
          </Button>
        )}
      </div>
    </>
  )
}
