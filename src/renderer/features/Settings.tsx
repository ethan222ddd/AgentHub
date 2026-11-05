import { Bot, HardDrive, Monitor, RefreshCw, Shield, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  AgentProfile,
  Detection,
  ProcessInspection,
  Settings as SettingsType,
  Snapshot,
} from '../../shared/types'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'
import { AgentSettings } from './settings/AgentSettings'
import { CollaborationSettings } from './settings/CollaborationSettings'
import { DataSettings } from './settings/DataSettings'
import { DiagnosticsSettings } from './settings/DiagnosticsSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { SecuritySettings } from './settings/SecuritySettings'
export function Settings({
  snapshot,
  conversationId,
  close,
  perform,
}: {
  snapshot: Snapshot
  conversationId?: string
  close(): void
  perform(request: Record<string, unknown>): Promise<unknown>
}) {
  const [tab, setTab] = useState('agents')
  const dialogRef = useDialog(close)
  const [settings, setSettings] = useState<SettingsType>(snapshot.settings)
  const [agents, setAgents] = useState(snapshot.agents)
  const [detections, setDetections] = useState<Detection[]>([])
  const [detecting, setDetecting] = useState(false)
  const [key, setKey] = useState('')
  const [notice, setNotice] = useState('')
  const [processes, setProcesses] = useState<ProcessInspection>()
  const [inspecting, setInspecting] = useState(false)
  const [restore, setRestore] = useState<{
    id: string
    version: number
    counts: Record<string, number>
  }>()
  const en = settings.language === 'en'
  useEffect(
    () =>
      window.agenthub.subscribe((event) => {
        if (event.type === 'notification-error') setNotice(event.message)
      }),
    [],
  )
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const update = (id: string, patch: Partial<AgentProfile>) =>
    setAgents(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const save = async () => {
    await perform({ op: 'settings.save', settings })
    for (const agent of agents) await perform({ op: 'agent.save', agent })
    setNotice(text('設定已儲存', 'Settings saved'))
  }
  const detect = async () => {
    setDetecting(true)
    try {
      setDetections(await window.agenthub.invoke<Detection[]>({ op: 'agents.detect' }))
    } catch (e) {
      setNotice(String(e))
    } finally {
      setDetecting(false)
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header>
          <h2>{text('設定', 'Settings')}</h2>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close settings">
            <X size={18} />
          </Button>
        </header>
        <div className="settings-layout">
          <nav>
            {[
              ['general', Monitor, text('一般', 'General')],
              ['agents', Bot, text('代理', 'Agents')],
              ['collaboration', SlidersHorizontal, text('協作', 'Collaboration')],
              ['security', Shield, text('安全', 'Security')],
              ['data', HardDrive, text('資料', 'Data')],
              ['diagnostics', RefreshCw, text('診斷', 'Diagnostics')],
            ].map(([id, Icon, label]) => {
              const I = Icon as typeof Monitor
              return (
                <button
                  key={String(id)}
                  className={tab === id ? 'selected' : ''}
                  onClick={() => setTab(String(id))}
                >
                  <I size={16} />
                  {String(label)}
                </button>
              )
            })}
          </nav>
          <div className="settings-content">
            {tab === 'diagnostics' && (
              <DiagnosticsSettings
                text={text}
                inspecting={inspecting}
                setInspecting={setInspecting}
                setProcesses={setProcesses}
                setNotice={setNotice}
                processes={processes}
                snapshot={snapshot}
              />
            )}
            {tab === 'general' && (
              <GeneralSettings
                text={text}
                settings={settings}
                setSettings={setSettings}
                perform={perform}
                conversationId={conversationId}
                setNotice={setNotice}
              />
            )}
            {tab === 'agents' && (
              <AgentSettings
                text={text}
                detecting={detecting}
                detect={detect}
                agents={agents}
                detections={detections}
                update={update}
                setAgents={setAgents}
                credentialValue={key}
                setKey={setKey}
                perform={perform}
                setNotice={setNotice}
              />
            )}
            {tab === 'collaboration' && (
              <CollaborationSettings
                text={text}
                settings={settings}
                setSettings={setSettings}
                agents={agents}
              />
            )}
            {tab === 'security' && (
              <SecuritySettings text={text} perform={perform} setNotice={setNotice} />
            )}
            {tab === 'data' && (
              <DataSettings
                text={text}
                perform={perform}
                setRestore={setRestore}
                restore={restore}
                setNotice={setNotice}
                snapshot={snapshot}
              />
            )}
          </div>
        </div>
        <footer>
          <span className="muted" role="status">
            {notice}
          </span>
          <Button onClick={() => void save()}>{text('儲存設定', 'Save settings')}</Button>
        </footer>
      </section>
    </div>
  )
}
