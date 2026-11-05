import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentProfile, Decision, Project } from '../../../shared/types'
import { Button } from '../../components/ui'

interface Props {
  project: Project
  agents: AgentProfile[]
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
}
type Draft = { id?: string; title: string; detail: string }

export function DecisionLog({ project, agents, en, perform }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const [draft, setDraft] = useState<Draft>()
  const [showRejected, setShowRejected] = useState(false)
  const decisions = project.decisions || []
  const proposed = decisions.filter((d) => d.status === 'proposed')
  const accepted = decisions.filter((d) => d.status === 'accepted').reverse()
  const rejected = decisions.filter((d) => d.status === 'rejected').reverse()
  const who = (d: Decision) =>
    d.proposedBy === 'user'
      ? text('你', 'You')
      : agents.find((a) => a.id === d.proposedBy)?.name || d.proposedBy
  const save = (d: Partial<Decision> & Draft, status: Decision['status']) =>
    perform({
      op: 'decision.save',
      projectId: project.id,
      ...(d.id ? { id: d.id } : {}),
      title: d.title.trim(),
      detail: d.detail.trim(),
      status,
    })
  const editor = (
    <form
      className="decision-editor"
      onSubmit={(e) => {
        e.preventDefault()
        if (!draft?.title.trim()) return
        const existing = decisions.find((d) => d.id === draft.id)
        void save(draft, existing?.status || 'accepted').then(() => setDraft(undefined))
      }}
    >
      <input
        autoFocus
        aria-label={text('決策標題', 'Decision title')}
        placeholder={text('例如：金額一律用整數分儲存', 'e.g. Store money as integer cents')}
        value={draft?.title || ''}
        maxLength={200}
        onChange={(e) => setDraft({ ...draft!, title: e.target.value })}
      />
      <textarea
        aria-label={text('理由與細節', 'Rationale and details')}
        placeholder={text('為什麼這樣決定、有哪些例外', 'Why, and any exceptions')}
        value={draft?.detail || ''}
        maxLength={4000}
        rows={3}
        onChange={(e) => setDraft({ ...draft!, detail: e.target.value })}
      />
      <div className="actions">
        <Button size="sm" type="submit" disabled={!draft?.title.trim()}>
          {draft?.id ? text('儲存', 'Save') : text('新增並採用', 'Add and accept')}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(undefined)}>
          {text('取消', 'Cancel')}
        </Button>
      </div>
    </form>
  )
  const row = (d: Decision) =>
    draft?.id === d.id ? (
      <li key={d.id}>{editor}</li>
    ) : (
      <li key={d.id} className={`decision decision-${d.status}`}>
        <div className="decision-main">
          <strong>{d.title}</strong>
          {d.detail && <p>{d.detail}</p>}
          <small>
            {who(d)}
            {text('，', ', ')}
            {new Date(d.createdAt).toLocaleDateString()}
          </small>
        </div>
        <div className="decision-actions">
          {d.status === 'proposed' ? (
            <>
              <Button size="sm" onClick={() => void save(d, 'accepted')}>
                <Check size={13} />
                {text('採用', 'Accept')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void save(d, 'rejected')}>
                <X size={13} />
                {text('否決', 'Reject')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label={text('編輯', 'Edit')}
                onClick={() => setDraft({ id: d.id, title: d.title, detail: d.detail })}
              >
                <Pencil size={13} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={text('刪除', 'Delete')}
                onClick={() => {
                  if (window.confirm(text(`刪除決策「${d.title}」？`, `Delete "${d.title}"?`)))
                    void perform({ op: 'decision.delete', projectId: project.id, id: d.id })
                }}
              >
                <Trash2 size={13} />
              </Button>
            </>
          )}
        </div>
      </li>
    )
  return (
    <div className="decision-log">
      <p className="muted">
        {text(
          '已採用的決策會附在這個專案每一個新任務裡，讓不同代理、不同聊天室都遵守同一套約定。代理提議的決策要你採用後才生效。',
          'Accepted decisions are attached to every new task in this project, so every agent and room follows the same rules. Agent proposals apply only after you accept them.',
        )}
      </p>
      {!!proposed.length && (
        <>
          <h4>
            {text('待確認', 'Awaiting you')} <span>{proposed.length}</span>
          </h4>
          <ul className="decision-list">{proposed.map(row)}</ul>
        </>
      )}
      <h4>
        {text('已採用', 'Accepted')} <span>{accepted.length}</span>
      </h4>
      {draft && !draft.id ? (
        editor
      ) : (
        <Button size="sm" variant="outline" onClick={() => setDraft({ title: '', detail: '' })}>
          <Plus size={13} />
          {text('新增決策', 'Add decision')}
        </Button>
      )}
      {!accepted.length && !draft && (
        <p className="panel-empty">
          {text(
            '還沒有採用的決策。記下像「API 錯誤一律回傳 problem+json」這類約定，代理就不會各做各的。',
            'No accepted decisions yet. Record conventions like "API errors use problem+json" so agents stay consistent.',
          )}
        </p>
      )}
      <ul className="decision-list">{accepted.map(row)}</ul>
      {!!rejected.length && (
        <button className="link-button" onClick={() => setShowRejected(!showRejected)}>
          {showRejected
            ? text('隱藏已否決', 'Hide rejected')
            : text(`顯示已否決（${rejected.length}）`, `Show rejected (${rejected.length})`)}
        </button>
      )}
      {showRejected && <ul className="decision-list">{rejected.map(row)}</ul>}
    </div>
  )
}
