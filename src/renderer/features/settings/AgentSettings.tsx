import { Plus, RefreshCw } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgentProfile, Detection, Provider } from '../../../shared/types'
import { Button } from '../../components/ui'
interface Props {
  text: (zh: string, eng: string) => string
  detecting: boolean
  detect: () => Promise<void>
  agents: AgentProfile[]
  detections: Detection[]
  update: (id: string, patch: Partial<AgentProfile>) => void
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>
  credentialValue: string
  setKey: Dispatch<SetStateAction<string>>
  perform: (request: Record<string, unknown>) => Promise<unknown>
  setNotice: Dispatch<SetStateAction<string>>
}
export function AgentSettings({
  text,
  detecting,
  detect,
  agents,
  detections,
  update,
  setAgents,
  credentialValue,
  setKey,
  perform,
  setNotice,
}: Props) {
  return (
    <>
      <div className="section-title">
        <h3>{text('真實的 Coding Runtimes', 'Real coding runtimes')}</h3>
        <Button size="sm" variant="outline" disabled={detecting} onClick={() => void detect()}>
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
                  {text('額外的確切指令（每行一個）', 'Additional exact commands (one per line)')}
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
                  {text('可讀取的網域（每行一個）', 'Readable web domains (one per line)')}
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
            const provider = (document.getElementById('new-provider') as HTMLSelectElement)
              .value as Provider
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
          value={credentialValue}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!credentialValue}
          onClick={() =>
            void perform({
              op: 'credential.save',
              provider: 'claude',
              value: credentialValue,
            }).then(() => {
              setKey('')
              setNotice(text('金鑰已加密儲存', 'Key saved with OS encryption'))
            })
          }
        >
          {text('儲存金鑰', 'Save key')}
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void perform({ op: 'credential.save', provider: 'claude', value: '' }).then(() =>
            setNotice(text('已移除儲存的金鑰', 'Saved key removed')),
          )
        }
      >
        {text('移除已儲存金鑰', 'Remove saved key')}
      </Button>
    </>
  )
}
