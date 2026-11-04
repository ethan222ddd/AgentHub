import { useEffect, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { AgentProfile, Conversation, Detection, RuntimeSelection } from '../../shared/types'
import { Button } from '../components/ui'

export function ModelControl({
  conversation,
  agents,
  recipients,
  perform,
  pending,
  en,
}: {
  conversation: Conversation
  agents: AgentProfile[]
  recipients: string[]
  perform(request: Record<string, unknown>): Promise<unknown>
  pending(value: boolean): void
  en: boolean
}) {
  const [catalog, setCatalog] = useState<Detection[]>([])
  const [drafts, setDrafts] = useState<Record<string, RuntimeSelection>>({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (root.current?.open && !root.current.contains(e.target as Node)) root.current.open = false
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && root.current?.open) {
        root.current.open = false
        root.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  const selected = recipients.length ? agents.filter((a) => recipients.includes(a.id)) : agents
  const selection = (a: AgentProfile) =>
    drafts[a.id] ||
    conversation.runtimeOverrides?.[a.id] || {
      model: a.model,
      reasoningEffort: a.reasoningEffort || '',
    }
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const detect = async () => {
    setBusy(true)
    setError('')
    try {
      setCatalog((await perform({ op: 'agents.detect' })) as Detection[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoaded(true)
      setBusy(false)
    }
  }
  const save = async (agent: AgentProfile, config: RuntimeSelection) => {
    setBusy(true)
    pending(true)
    setError('')
    try {
      await perform({
        op: 'conversation.runtime',
        conversationId: conversation.id,
        agentId: agent.id,
        ...config,
      })
      setDrafts((old) => ({ ...old, [agent.id]: config }))
    } catch (e) {
      setError(String(e))
    } finally {
      pending(false)
      setBusy(false)
    }
  }
  const current = selected.length === 1 ? selection(selected[0]) : undefined
  const name = current
    ? catalog.find((d) => d.agentId === selected[0].id)?.models.find((m) => m.id === current.model)
        ?.name ||
      current.model ||
      text('預設模型', 'Default model')
    : text('模型與思考', 'Models & reasoning')
  return (
    <details
      className="model-control"
      ref={root}
      onToggle={(event) => {
        if (event.currentTarget.open && !catalog.length && !busy) void detect()
      }}
    >
      <summary aria-label="Models and reasoning">
        <SlidersHorizontal size={13} />
        <span>
          {name}
          {current?.reasoningEffort ? ` · ${current.reasoningEffort}` : ''}
        </span>
        <ChevronDown size={12} />
      </summary>
      <div className="model-menu">
        <div className="section-title">
          <strong>{text('本聊天室的模型與思考強度', 'Models & reasoning for this chat')}</strong>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void detect()}>
            {text('重新偵測', 'Refresh')}
          </Button>
        </div>
        <small className="muted">
          {text(
            '套用至下一個任務；執行中及已排程的任務保留原設定。模型不支援的強度會顯示原生錯誤。',
            'Applies to the next task. Running and queued work keep their settings. Unsupported effort levels produce native errors.',
          )}
        </small>
        {selected.map((agent) => {
          const config = selection(agent),
            detected = catalog.find((d) => d.agentId === agent.id)
          const model =
            detected?.models.find((m) => m.id === config.model) ||
            (!config.model ? detected?.models.find((m) => m.isDefault) : undefined)
          const efforts = model?.reasoningEfforts || detected?.reasoningEfforts || []
          return (
            <section key={agent.id}>
              <strong>{agent.name}</strong>
              <label>
                {text('模型', 'Model')}
                {detected?.models.length ? (
                  <select
                    aria-label={`Model ${agent.id}`}
                    disabled={busy || !loaded}
                    value={config.model}
                    onChange={(e) =>
                      void save(agent, { model: e.target.value, reasoningEffort: '' })
                    }
                  >
                    <option value="">{text('Runtime 預設', 'Runtime default')}</option>
                    {!detected.models.some((m) => m.id === config.model) && config.model && (
                      <option value={config.model}>{config.model}</option>
                    )}
                    {detected.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={`Model ${agent.id}`}
                    defaultValue={config.model}
                    key={`${agent.id}-${config.model}`}
                    disabled={busy || !loaded}
                    placeholder={text('模型 ID；空白使用預設', 'Model ID; blank for default')}
                    onBlur={(e) => {
                      if (e.target.value !== config.model)
                        void save(agent, { ...config, model: e.target.value.trim() })
                    }}
                  />
                )}
              </label>
              {!detected?.models.length && (
                <small className="muted">
                  {text(
                    '此 Runtime 未提供可用清單；輸入帳號支援的模型 ID。',
                    'This runtime has no model catalog; enter an account-supported model ID.',
                  )}
                </small>
              )}
              <label>
                {text('思考強度', 'Reasoning effort')}
                <select
                  aria-label={`Reasoning ${agent.id}`}
                  disabled={busy || !loaded || !efforts.length}
                  value={config.reasoningEffort}
                  onChange={(e) => void save(agent, { ...config, reasoningEffort: e.target.value })}
                >
                  <option value="">
                    {text('模型預設', 'Model default')}
                    {model?.defaultReasoningEffort ? ` (${model.defaultReasoningEffort})` : ''}
                  </option>
                  {config.reasoningEffort && !efforts.includes(config.reasoningEffort) && (
                    <option value={config.reasoningEffort}>{config.reasoningEffort}</option>
                  )}
                  {efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          )
        })}
        {busy && <small className="muted">{text('讀取／儲存中…', 'Loading / saving…')}</small>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </details>
  )
}
