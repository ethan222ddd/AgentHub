import { useEffect, useState } from 'react'
import {
  X,
  RefreshCw,
  Plus,
  Shield,
  HardDrive,
  Monitor,
  Bot,
  SlidersHorizontal,
} from 'lucide-react'
import type {
  AgentProfile,
  Detection,
  Provider,
  Settings as SettingsType,
  Snapshot,
  ProcessInspection,
} from '../../shared/types'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'
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
              <>
                <h3>{text('程序與復原', 'Processes and recovery')}</h3>
                <p className="muted">
                  {text(
                    'Windows Job Object 在應用程式退出時回收受管子程序。這是程序生命週期管理；各 Runtime 的檔案、網路與工具權限仍由原生沙盒控制。異常中斷的任務重啟後須人工檢查，不會自動重跑。',
                    'Windows Job Objects reap owned descendants on exit. Runtime sandboxes still control file, network and tool permissions. Interrupted tasks require review after restart and never replay automatically.',
                  )}
                </p>
                <Button
                  variant="outline"
                  disabled={inspecting}
                  onClick={() => {
                    setInspecting(true)
                    void window.agenthub
                      .invoke<ProcessInspection>({ op: 'processes.inspect' })
                      .then(setProcesses)
                      .catch((error) => setNotice(String(error)))
                      .finally(() => setInspecting(false))
                  }}
                >
                  <RefreshCw size={14} />
                  {text('重新整理程序', 'Refresh processes')}
                </Button>
                {processes && (
                  <div aria-label="Process diagnostics">
                    <p>
                      Main PID {processes.ownerPid} · {text('守護程序', 'Guardian')}{' '}
                      {processes.appGuardPid ?? '—'}
                    </p>
                    <p className="muted">
                      {processes.closing
                        ? text('正在關閉', 'Shutting down')
                        : text('接受新工作', 'Accepting work')}{' '}
                      · {processes.processes.length} {text('個受管程序', 'owned processes')}
                    </p>
                    {processes.processes.map((process, index) => (
                      <div className="agent-config" key={`${process.pid}-${index}`}>
                        <b>
                          {process.executable} · PID {process.pid ?? '—'}
                        </b>
                        <p className="muted">
                          {[
                            process.agentId,
                            process.stage,
                            process.taskId,
                            process.ownership,
                            process.stopping ? text('停止中', 'Stopping') : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {snapshot.diagnosticsPath && (
                  <label>
                    {text('安全診斷日誌', 'Safe diagnostic log')}
                    <code className="data-path">{snapshot.diagnosticsPath}</code>
                  </label>
                )}
              </>
            )}
            {tab === 'general' && (
              <>
                <h3>{text('打造你的工作空間', 'Make yourself at home')}</h3>
                <label>
                  {text('系統通知', 'Desktop notifications')}
                  <select
                    aria-label="Desktop notifications"
                    value={settings.notifications}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: e.target.value as SettingsType['notifications'],
                      })
                    }
                  >
                    <option value="all">
                      {text(
                        '批准、完成、失敗與整合提醒',
                        'Approvals, completion, failure and integration',
                      )}
                    </option>
                    <option value="approvals">{text('只通知批准', 'Approvals only')}</option>
                    <option value="off">{text('勿擾', 'Do not disturb')}</option>
                  </select>
                </label>
                <p className="muted">
                  {text(
                    '勿擾仍保留工作列待處理數。通知不顯示程式碼或指令；點擊後開啟對應聊天室與活動面板。請先儲存設定再測試通知。',
                    'Do not disturb keeps the taskbar count. Notifications omit code and commands; clicking opens the conversation and Activity. Save settings before testing.',
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void perform({
                      op: 'notifications.test',
                      ...(conversationId ? { conversationId } : {}),
                    }).catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                  }
                >
                  {text('測試通知', 'Test notification')}
                </Button>
                <label>
                  {text('預設專案目錄', 'Default project directory')}
                  <input
                    value={settings.defaultProjectDirectory}
                    onChange={(e) =>
                      setSettings({ ...settings, defaultProjectDirectory: e.target.value })
                    }
                  />
                </label>
                <label>
                  {text('啟動方式', 'Startup')}
                  <select
                    value={settings.startupBehavior}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        startupBehavior: e.target.value as SettingsType['startupBehavior'],
                      })
                    }
                  >
                    <option value="restore">
                      {text('恢復上次對話', 'Restore last conversation')}
                    </option>
                    <option value="empty">
                      {text('先顯示專案選擇', 'Start at project selection')}
                    </option>
                  </select>
                </label>
                <label>
                  {text('外觀', 'Appearance')}
                  <select
                    aria-label="Appearance"
                    value={settings.theme}
                    onChange={(e) =>
                      setSettings({ ...settings, theme: e.target.value as SettingsType['theme'] })
                    }
                  >
                    <option value="system">{text('跟隨系統', 'System')}</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <label>
                  {text('語言', 'Language')}
                  <select
                    aria-label="Language"
                    value={settings.language}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        language: e.target.value as SettingsType['language'],
                      })
                    }
                  >
                    <option value="zh-TW">繁體中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <p className="muted">
                  {text(
                    '啟動時恢復專案與對話；未完成任務一律等待人工檢查。',
                    'Projects and conversations are restored at startup. Interrupted tasks wait for explicit review.',
                  )}
                </p>
              </>
            )}
            {tab === 'agents' && (
              <>
                <div className="section-title">
                  <h3>{text('真實的 Coding Runtimes', 'Real coding runtimes')}</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={detecting}
                    onClick={() => void detect()}
                  >
                    <RefreshCw size={13} className={detecting ? 'spin' : ''} />
                    {text('偵測與測試連線', 'Detect & test')}
                  </Button>
                </div>
                <p className="muted">
                  {text(
                    '每個代理都有獨立原生 Session。空白模型使用 Runtime 預設值。',
                    'Each agent has its own native session. Blank model uses the runtime default.',
                  )}
                </p>
                {agents.map((agent) => {
                  const d = detections.find((d) => d.agentId === agent.id)
                  return (
                    <section className="agent-setting" key={agent.id}>
                      <div className="section-title">
                        <strong>{agent.name}</strong>
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={agent.enabled}
                            onChange={(e) => update(agent.id, { enabled: e.target.checked })}
                          />
                          {text('啟用', 'Enabled')}
                        </label>
                      </div>
                      {agent.provider === 'claude' && (
                        <label>
                          {text('連接方式', 'Connection mode')}
                          <select
                            value={agent.authMode || 'native'}
                            onChange={(e) =>
                              update(agent.id, { authMode: e.target.value as 'native' | 'api' })
                            }
                          >
                            <option value="native">
                              {text(
                                '本機官方 Claude Code（自行登入／訂閱）',
                                'Official local Claude Code (own login / subscription)',
                              )}
                            </option>
                            <option value="api">
                              {text('Agent SDK（API 金鑰）', 'Agent SDK (API key)')}
                            </option>
                          </select>
                          <small className="muted">
                            {text(
                              '本機模式直接啟動未修改的官方 CLI，保留其登入與原生權限；AgentHub 不取得訂閱 Token。',
                              'Native mode launches the unmodified official CLI and retains native authentication and policy. AgentHub does not obtain subscription tokens.',
                            )}
                          </small>
                        </label>
                      )}
                      <small className="muted">
                        {agent.provider} ·{' '}
                        {d
                          ? `${d.version || (d.installed ? 'Installed' : 'Not installed')} · ${d.authenticated === true ? 'Authenticated' : d.authenticated === false ? 'Authentication required' : 'Authentication unverified'}`
                          : text('尚未偵測', 'Not checked')}
                      </small>
                      {d && <p className="runtime-detail">{d.detail}</p>}
                      <small className="muted">
                        {text(
                          '原生能力：讀寫工作區、辨識圖片、工具與指令、聯網研究。',
                          'Native capabilities: workspace files, image recognition, tools/commands and web research.',
                        )}{' '}
                        {agent.provider === 'antigravity'
                          ? text(
                              '圖片透過原生讀檔工具；指令與網域需預先列出並逐回合批准。',
                              'Images use the native file tool; commands and domains must be listed and approved per turn.',
                            )
                          : agent.provider === 'claude'
                            ? text(
                                '檔案、Shell、WebSearch／WebFetch 均逐工具批准。唯讀審查禁止改檔及 Shell。',
                                'Files, shell and WebSearch/WebFetch require tool approval. Read-only reviews disallow edits and shell.',
                              )
                            : text(
                                '原生網路搜尋逐回合批准；Shell 與額外網路存取另行批准。',
                                'Native live search is approved per turn; shell and extra network access require separate approval.',
                              )}
                      </small>
                      <div className="field-grid">
                        <label>
                          {text('名稱', 'Name')}
                          <input
                            value={agent.name}
                            onChange={(e) => update(agent.id, { name: e.target.value })}
                          />
                        </label>
                        <label>
                          {text('角色', 'Role')}
                          <input
                            value={agent.role}
                            onChange={(e) => update(agent.id, { role: e.target.value })}
                            list="roles"
                          />
                        </label>
                      </div>
                      <label>
                        {text('模型', 'Model')}
                        <input
                          placeholder={text('Runtime 預設模型', 'Runtime default')}
                          list={`models-${agent.id}`}
                          value={agent.model}
                          onChange={(e) => update(agent.id, { model: e.target.value })}
                        />
                        <datalist id={`models-${agent.id}`}>
                          {d?.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </datalist>
                      </label>
                      <label>
                        {text('代理指示', 'Agent instructions')}
                        <textarea
                          rows={2}
                          value={agent.instructions}
                          onChange={(e) => update(agent.id, { instructions: e.target.value })}
                        />
                      </label>
                      {agent.provider === 'antigravity' && (
                        <>
                          <label>
                            {text(
                              '額外的確切指令（每行一個）',
                              'Additional exact commands (one per line)',
                            )}
                            <textarea
                              rows={2}
                              value={(agent.commandAllowlist || []).join('\n')}
                              onChange={(e) =>
                                update(agent.id, {
                                  commandAllowlist: e.target.value.split('\n').filter(Boolean),
                                })
                              }
                              placeholder="npm test"
                            />
                            <small className="muted">
                              {text(
                                '每個回合仍會顯示清單並要求批准；空白時 Headless Shell 指令會拒絕。只加入你已檢查的專案指令。',
                                'Each turn still asks approval for this list. Empty means headless shell commands are denied. Add only project commands you have reviewed.',
                              )}
                            </small>
                          </label>
                          <label>
                            {text(
                              '可讀取的網域（每行一個）',
                              'Readable web domains (one per line)',
                            )}
                            <textarea
                              rows={2}
                              value={(agent.networkAllowlist || []).join('\n')}
                              onChange={(e) =>
                                update(agent.id, {
                                  networkAllowlist: e.target.value
                                    .split('\n')
                                    .map((s) => s.trim().toLowerCase())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="example.com"
                            />
                            <small className="muted">
                              {text(
                                '只填主機名稱，包含其子網域；每回合需批准。未列出的網頁與瀏覽器操作依原生政策拒絕，並顯示錯誤。',
                                'Hostnames only, including subdomains; approval is required each turn. Unlisted web pages and browser interactions are denied by native policy and reported as errors.',
                              )}
                            </small>
                          </label>
                        </>
                      )}
                    </section>
                  )
                })}
                <datalist id="roles">
                  {[
                    'Project Manager',
                    'Software Architect',
                    'Frontend Developer',
                    'Backend Developer',
                    'Full-Stack Developer',
                    'Database Engineer',
                    'QA Engineer',
                    'Security Reviewer',
                    'Code Reviewer',
                    'DevOps Engineer',
                  ].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </datalist>
                <div className="add-agent">
                  <select id="new-provider" defaultValue="codex">
                    {['codex', 'claude', 'antigravity'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const provider = (
                        document.getElementById('new-provider') as HTMLSelectElement
                      ).value as Provider
                      setAgents([
                        ...agents,
                        {
                          id: crypto.randomUUID(),
                          name: `${provider} ${agents.length + 1}`,
                          provider,
                          role: 'Developer',
                          model: '',
                          enabled: true,
                          ...(provider === 'claude' ? { authMode: 'native' as const } : {}),
                          instructions: '',
                        },
                      ])
                    }}
                  >
                    <Plus size={14} />
                    {text('新增代理實例', 'Add instance')}
                  </Button>
                </div>
                <h3>
                  {text(
                    'Claude SDK / API 模式驗證（本機訂閱模式不需要）',
                    'Claude SDK / API mode authentication (not needed for local subscription)',
                  )}
                </h3>
                <p className="muted">
                  {text(
                    '使用 Anthropic API Key，儲存於 Windows DPAPI 加密檔案。也支援啟動程式時的 ANTHROPIC_API_KEY 環境變數。不重用 claude.ai 訂閱憑證。',
                    'Use an Anthropic API key, encrypted with Windows DPAPI, or set ANTHROPIC_API_KEY before launch. Subscription credentials are not reused.',
                  )}
                </p>
                <div className="add-agent">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Anthropic API key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!key}
                    onClick={() =>
                      void perform({ op: 'credential.save', provider: 'claude', value: key }).then(
                        () => {
                          setKey('')
                          setNotice(text('金鑰已加密儲存', 'Key saved with OS encryption'))
                        },
                      )
                    }
                  >
                    {text('儲存金鑰', 'Save key')}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void perform({ op: 'credential.save', provider: 'claude', value: '' }).then(
                      () => setNotice(text('已移除儲存的金鑰', 'Saved key removed')),
                    )
                  }
                >
                  {text('移除已儲存金鑰', 'Remove saved key')}
                </Button>
              </>
            )}
            {tab === 'collaboration' && (
              <>
                <h3>{text('有邊界的協作', 'Bounded collaboration')}</h3>
                <label>
                  {text('新聊天室預設模式', 'Default room mode')}
                  <select
                    value={settings.defaultMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultMode: e.target.value as SettingsType['defaultMode'],
                      })
                    }
                  >
                    {['manual', 'collaborative', 'supervisor'].map((mode) => (
                      <option key={mode}>{mode}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {text('預設主管', 'Default supervisor')}
                  <select
                    value={settings.supervisorId}
                    onChange={(e) => setSettings({ ...settings, supervisorId: e.target.value })}
                  >
                    <option value="">—</option>
                    {agents
                      .filter((a) => a.enabled)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {text(
                    '每個聊天室 Token 預算（0 為不設上限）',
                    'Reported token budget per room (0 = no cap)',
                  )}
                  <input
                    type="number"
                    min={0}
                    value={settings.maxUsageTokens}
                    onChange={(e) =>
                      setSettings({ ...settings, maxUsageTokens: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {text(
                    '每個聊天室費用估計預算 USD（0 為不設上限）',
                    'Estimated reported USD budget per room (0 = no cap)',
                  )}
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={settings.maxCostUsd}
                    onChange={(e) =>
                      setSettings({ ...settings, maxCostUsd: Number(e.target.value) })
                    }
                  />
                </label>
                <p className="muted">
                  {text(
                    '預算依供應商回報更新，可能在通知前超出。Codex／Antigravity 沒有回報美元費用時不會捏造價格；Claude 原生費用為估計值。',
                    'Budgets use reported usage and can overshoot before notifications arrive. Missing provider USD costs are not invented; Claude native costs are estimates.',
                  )}
                </p>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={settings.automaticReview}
                    onChange={(e) =>
                      setSettings({ ...settings, automaticReview: e.target.checked })
                    }
                  />
                  {text(
                    '已提交任務完成後自動請求獨立 Review',
                    'Request independent review after committed tasks complete',
                  )}
                </label>
                <label>
                  {text('自動 Reviewer', 'Automatic reviewer')}
                  <select
                    value={settings.reviewerId}
                    onChange={(e) => setSettings({ ...settings, reviewerId: e.target.value })}
                  >
                    <option value="">—</option>
                    {agents
                      .filter((a) => a.enabled)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                {(
                  [
                    ['maxTurns', '每個需求最多代理回合', 'Agent turns per user request', 1, 100],
                    ['maxConcurrent', '同時執行代理數', 'Concurrent agents', 1, 8],
                    ['maxDepth', '最大委派深度', 'Delegation depth', 0, 8],
                    ['maxFanout', '訊息最多接收者', 'Message fanout', 1, 8],
                  ] as const
                ).map(([field, zh, eng, min, max]) => (
                  <label key={field}>
                    {text(zh, eng)}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={settings[field]}
                      onChange={(e) =>
                        setSettings({ ...settings, [field]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <label>
                  {text('任務逾時（分鐘）', 'Task timeout (minutes)')}
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.timeoutMs / 60000}
                    onChange={(e) =>
                      setSettings({ ...settings, timeoutMs: Number(e.target.value) * 60000 })
                    }
                  />
                </label>
                <p className="muted">
                  {text(
                    '初始預設為手動模式，可在此調整新聊天室設定。主管也可由聊天室上方選擇。達上限不會自動重試。',
                    'The initial default is manual. Configure new room defaults here or select a supervisor in the room header. Limits never trigger automatic retries.',
                  )}
                </p>
              </>
            )}
            {tab === 'security' && (
              <>
                <h3>{text('操作由你掌握', 'You control execution')}</h3>
                <Button
                  variant="outline"
                  onClick={() =>
                    void perform({ op: 'permissions.clear' }).then(() =>
                      setNotice(
                        text('已撤銷記憶的工作區讀取批准', 'Scoped read permissions revoked'),
                      ),
                    )
                  }
                >
                  {text('撤銷已記憶的讀取批准', 'Revoke remembered read permissions')}
                </Button>
                <p>
                  {text(
                    'Renderer 不具有 Node.js 權限。檔案、Git、子程序與認證皆由 Main Process 處理。',
                    'The renderer has no Node.js access. The host controls files, Git, child processes, and credentials.',
                  )}
                </p>
                <ul>
                  <li>
                    {text(
                      'Codex：workspace-write 沙盒與原生批准。',
                      'Codex: workspace-write sandbox and native approval requests.',
                    )}
                  </li>
                  <li>
                    {text(
                      'Claude：每次原生工具呼叫由 PreToolUse 檢查與使用者批准。Shell 批准後以目前使用者身分執行。',
                      'Claude: every native tool passes PreToolUse checks and user approval. Approved shell tools run as your OS user.',
                    )}
                  </li>
                  <li>
                    {text(
                      'Antigravity：要求原生 Sandbox，Headless 批准限制會回報失敗。請確認作業系統支援 Sandbox。',
                      'Antigravity: requests native sandbox; headless permission denials are reported. OS sandbox support is required.',
                    )}
                  </li>
                  <li>
                    {text(
                      '角色與協作模式不會授予額外系統權限。',
                      'Roles and collaboration modes do not grant OS permissions.',
                    )}
                  </li>
                </ul>
                <p className="muted">
                  {text(
                    '只有讀取工具可記住指定工作區的授權，隨時可撤銷。Shell 不會記住授權；Git 整合必須預覽、通過測試並明確合併。',
                    'Only read tools can remember workspace-scoped grants, which can be revoked. Shell grants are never remembered. Git integration requires preview, passing tests and explicit merge.',
                  )}
                </p>
              </>
            )}
            {tab === 'data' && (
              <>
                <h3>{text('資料留在本機', 'Your data stays local')}</h3>
                <Button variant="outline" onClick={() => void perform({ op: 'docs.guide' })}>
                  {text('開啟使用手冊', 'Open user guide')}
                </Button>
                <div className="actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void perform({ op: 'restore.preview' }).then((value) =>
                        setRestore(value as typeof restore),
                      )
                    }
                  >
                    {text('預覽還原 SQLite 備份', 'Preview SQLite restore')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (
                        window.confirm(
                          text(
                            '清理未修改的合併／Review 快照並捨棄其預覽？代理工作區與專案檔案會保留。',
                            'Remove clean integration/review snapshots and discard their previews? Agent workspaces and project files are preserved.',
                          ),
                        )
                      )
                        void perform({ op: 'maintenance.cleanup' }).then((value) =>
                          setNotice(JSON.stringify(value)),
                        )
                    }}
                  >
                    {text('清理暫存快照', 'Clean temporary snapshots')}
                  </Button>
                </div>
                {restore && (
                  <section className="approval">
                    <b>
                      {text('備份內容', 'Backup contents')} · schema {restore.version}
                    </b>
                    <pre>{JSON.stringify(restore.counts, null, 2)}</pre>
                    <p className="muted">
                      {text(
                        '套用會先備份目前資料。關閉並重新啟動後以此備份取代目前聊天資料；不修改任何專案檔案或憑證。',
                        'Applying first backs up current data. Close and restart to replace chat data. Project files and credentials are untouched.',
                      )}
                    </p>
                    <Button
                      onClick={() => {
                        if (
                          window.confirm(
                            text(
                              '批准於下次啟動還原這份備份？',
                              'Approve restoring this backup on next startup?',
                            ),
                          )
                        )
                          void perform({ op: 'restore.apply', previewId: restore.id }).then(() => {
                            setRestore(undefined)
                            setNotice(
                              text(
                                '已排程還原。請關閉並重新開啟 AgentHub。',
                                'Restore scheduled. Close and reopen AgentHub.',
                              ),
                            )
                          })
                      }}
                    >
                      {text('批准還原', 'Approve restore')}
                    </Button>
                  </section>
                )}
                <label>
                  SQLite<code className="data-path">{snapshot.dataPath}</code>
                </label>
                {snapshot.diagnosticsPath && (
                  <label>
                    {text('安全診斷日誌', 'Safe diagnostic log')}
                    <code className="data-path">{snapshot.diagnosticsPath}</code>
                    <span className="muted">
                      {text(
                        '僅記錄啟動路徑、路由、RPC 階段與狀態；不記錄訊息、RPC 內容或憑證。',
                        'Records launch paths, routing, RPC stages and status, without messages, RPC payloads or credentials.',
                      )}
                    </span>
                  </label>
                )}
                <p className="muted">
                  {text(
                    '備份包含聊天與 Runtime Session ID，不包含加密金鑰或工作區檔案。原生 Runtime 的 Session 檔案仍由各 Runtime 管理。',
                    'Backup includes chats and native session IDs, not keys or workspace files. Native session files remain managed by each runtime.',
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void perform({ op: 'backup' }).then((path) =>
                      setNotice(path ? `${text('備份已儲存', 'Backup saved')}: ${path}` : ''),
                    )
                  }
                >
                  {text('建立 SQLite 備份', 'Back up SQLite')}
                </Button>
              </>
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
