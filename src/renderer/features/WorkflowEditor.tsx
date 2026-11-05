import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { Snapshot, WorkflowStep, WorkflowTemplate } from '../../shared/types'
import { builtinWorkflows, workflowIssues } from '../../shared/workflows'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'
import { TemplateDesigner } from './workflows/TemplateDesigner'
import { WorkflowRunPanel } from './workflows/WorkflowRunPanel'

export function WorkflowEditor({
  snapshot,
  conversationId,
  initialRequirement,
  close,
  perform,
  started,
}: {
  snapshot: Snapshot
  conversationId: string
  initialRequirement: string
  close(): void
  perform(request: Record<string, unknown>): Promise<unknown>
  started(): void
}) {
  const en = snapshot.settings.language === 'en',
    t = (zh: string, eng: string) => (en ? eng : zh)
  const dialog = useDialog(close)
  const [draft, setDraft] = useState<WorkflowTemplate>(() =>
    structuredClone(snapshot.workflowTemplates[0] || builtinWorkflows[0]),
  )
  const [tab, setTab] = useState<'run' | 'edit'>('run')
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [requirement, setRequirement] = useState(initialRequirement)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const conversation = snapshot.conversations.find((c) => c.id === conversationId)
  const project = snapshot.projects.find((p) => p.id === conversation?.projectId)
  const agents = snapshot.agents.filter(
    (a) => a.enabled && (!project?.agentIds || project.agentIds.includes(a.id)),
  )
  const runs = snapshot.workflowRuns
    .filter((r) => r.conversationId === conversationId)
    .slice(-10)
    .reverse()
  const issues = workflowIssues(draft)
  const unsaved =
    JSON.stringify(snapshot.workflowTemplates.find((template) => template.id === draft.id)) !==
    JSON.stringify(draft)
  const binding = (role: WorkflowTemplate['roles'][number]) =>
    bindings[role.id] ?? agents.find((a) => a.provider === role.provider)?.id ?? ''
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setNotice('')
    try {
      await work()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const updateStep = (id: string, patch: Partial<WorkflowStep>) =>
    setDraft({ ...draft, steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const fresh = (copy = false) => {
    setDraft({
      ...structuredClone(copy ? draft : builtinWorkflows[0]),
      id: crypto.randomUUID(),
      name: copy ? draft.name + t(' 副本', ' copy') : t('自訂工作流程', 'Custom workflow'),
    })
    setTab('edit')
    setNotice('')
    setDeleting(false)
  }
  const move = (index: number, delta: number) => {
    const steps = [...draft.steps],
      other = index + delta
    if (other < 0 || other >= steps.length) return
    ;[steps[index], steps[other]] = [steps[other], steps[index]]
    setDraft({ ...draft, steps })
  }
  const statuses = {
    running: t('執行中', 'Running'),
    paused: t('已暫停', 'Paused'),
    attention: t('需要處理', 'Needs attention'),
    completed: t('已完成', 'Completed'),
    cancelled: t('已取消', 'Cancelled'),
    pending: t('尚未開始', 'Pending'),
  }
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        className="settings-modal workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Workflows"
      >
        <header>
          <h2>{t('工作流程範本', 'Workflow templates')}</h2>
          <Button variant="ghost" size="icon" aria-label="Close workflows" onClick={close}>
            <X size={18} />
          </Button>
        </header>
        <div className="settings-layout">
          <nav aria-label="Workflow templates">
            <Button variant="ghost" onClick={() => fresh()}>
              <Plus size={14} />
              {t('新增範本', 'New template')}
            </Button>
            {snapshot.workflowTemplates.map((template) => (
              <button
                key={template.id}
                className={draft.id === template.id ? 'selected' : ''}
                onClick={() => {
                  setDraft(structuredClone(template))
                  setBindings({})
                  setNotice('')
                  setDeleting(false)
                }}
              >
                {template.name}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <div className="workflow-actions">
              <Button variant={tab === 'run' ? 'outline' : 'ghost'} onClick={() => setTab('run')}>
                {t('套用與進度', 'Run and progress')}
              </Button>
              <Button variant={tab === 'edit' ? 'outline' : 'ghost'} onClick={() => setTab('edit')}>
                {t('編輯範本', 'Edit template')}
              </Button>
            </div>
            <p className="muted">
              {t(
                '團隊設定定義「誰」，範本定義「怎麼做」。步驟依賴決定順序；沒有相互依賴的步驟可平行執行，仍受並發與回合預算限制。',
                'The team defines who; templates define how. Dependencies determine order; independent steps can run in parallel within existing concurrency and turn budgets.',
              )}
            </p>
            {notice && (
              <p className="workflow-notice" role="alert">
                {notice}
              </p>
            )}
            {tab === 'edit' ? (
              <TemplateDesigner
                t={t}
                draft={draft}
                setDraft={setDraft}
                move={move}
                updateStep={updateStep}
                issues={issues}
                busy={busy}
                act={act}
                perform={perform}
                setNotice={setNotice}
                fresh={fresh}
                snapshot={snapshot}
                deleting={deleting}
                setDeleting={setDeleting}
              />
            ) : (
              <WorkflowRunPanel
                draft={draft}
                t={t}
                binding={binding}
                setBindings={setBindings}
                bindings={bindings}
                agents={agents}
                requirement={requirement}
                setRequirement={setRequirement}
                busy={busy}
                conversationId={conversationId}
                unsaved={unsaved}
                act={act}
                perform={perform}
                started={started}
                project={project}
                runs={runs}
                statuses={statuses}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
