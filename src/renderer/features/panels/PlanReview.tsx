import { ClipboardCheck, FilePen, MessageSquareWarning, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentProfile, Task } from '../../../shared/types'
import { Markdown } from '../../components/Markdown'
import { Button } from '../../components/ui'

interface Props {
  task: Task
  agents: AgentProfile[]
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
}
/** One plan awaiting the user: approve as-is, approve an edited copy, ask for revisions or cancel. */
export function PlanReview({ task, agents, en, perform }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const plan = task.plan!
  const [mode, setMode] = useState<'view' | 'edit' | 'revise'>('view')
  const [draft, setDraft] = useState(plan.content)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const agent = agents.find((a) => a.id === task.agentId)?.name || task.agentId
  const act = async (request: Record<string, unknown>) => {
    setBusy(true)
    try {
      await perform({ op: 'task.plan', id: task.id, ...request })
    } finally {
      setBusy(false)
    }
  }
  const list = (title: string, items: string[]) =>
    !!items.length && (
      <div className="plan-list">
        <h6>{title}</h6>
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    )
  return (
    <section className="plan-review" aria-label={text('計畫審核', 'Plan review')}>
      <header>
        <ClipboardCheck size={16} />
        <div>
          <strong>
            {text(`${agent} 的實作計畫`, `${agent}'s implementation plan`)}
            {plan.revisions > 0 && (
              <span className="plan-version">
                {text(`第 ${plan.revisions + 1} 版`, `v${plan.revisions + 1}`)}
              </span>
            )}
          </strong>
          <small>{task.name}</small>
        </div>
      </header>
      {!plan.structured && (
        <p className="plan-note">
          {text(
            '代理沒有用結構化格式提交，以下是它的回覆原文；檔案與風險清單可能不完整。',
            'The agent replied in prose instead of the structured plan tool; file and risk lists may be incomplete.',
          )}
        </p>
      )}
      {mode === 'edit' ? (
        <textarea
          className="plan-editor"
          aria-label={text('編輯計畫', 'Edit plan')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
        />
      ) : (
        <div className="plan-body">
          <Markdown content={plan.content || text('（計畫內容為空）', '(Empty plan)')} />
          {list(text('預計修改的檔案', 'Files to change'), plan.files)}
          {list(text('步驟', 'Steps'), plan.steps)}
          {list(text('風險與不確定', 'Risks'), plan.risks)}
          {plan.verification && (
            <div className="plan-list">
              <h6>{text('驗證方式', 'Verification')}</h6>
              <p>{plan.verification}</p>
            </div>
          )}
        </div>
      )}
      {mode === 'revise' && (
        <textarea
          className="plan-editor"
          aria-label={text('需要修改的地方', 'What should change')}
          placeholder={text(
            '例如：不要改資料表結構，改用現有的 orders 表。',
            'e.g. Keep the schema; reuse the existing orders table.',
          )}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
        />
      )}
      <div className="actions">
        {mode === 'revise' ? (
          <>
            <Button
              size="sm"
              disabled={busy || !feedback.trim()}
              onClick={() => void act({ action: 'revise', feedback: feedback.trim() })}
            >
              {text('送出修改意見', 'Send revision request')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
              {text('返回', 'Back')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy || (mode === 'edit' && !draft.trim())}
              onClick={() =>
                void act({
                  action: 'approve',
                  ...(mode === 'edit' && draft.trim() !== plan.content
                    ? { content: draft.trim() }
                    : {}),
                })
              }
            >
              {mode === 'edit'
                ? text('批准修改後的計畫', 'Approve edited plan')
                : text('批准並開始實作', 'Approve and start')}
            </Button>
            {mode === 'view' ? (
              <Button size="sm" variant="outline" onClick={() => setMode('edit')}>
                <FilePen size={13} />
                {text('編輯', 'Edit')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                {text('取消編輯', 'Discard edits')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setMode('revise')}>
              <MessageSquareWarning size={13} />
              {text('要求修改', 'Request changes')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    text(
                      '取消這個任務？代理不會開始實作。',
                      'Cancel this task? The agent will not implement it.',
                    ),
                  )
                )
                  void act({ action: 'cancel' })
              }}
            >
              <X size={13} />
              {text('取消任務', 'Cancel task')}
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
