import type { Dispatch, SetStateAction } from 'react'
import type { AgentProfile, Settings as SettingsType } from '../../../shared/types'
interface Props {
  text: (zh: string, eng: string) => string
  settings: SettingsType
  setSettings: Dispatch<SetStateAction<SettingsType>>
  agents: AgentProfile[]
}
export function CollaborationSettings({ text, settings, setSettings, agents }: Props) {
  return (
    <>
      <h3>{text('有邊界的協作', 'Bounded collaboration')}</h3>
      <label>
        {text('代理工具請求', 'Agent tool requests')}
        <select
          aria-label={text('自主程度', 'Autonomy')}
          value={settings.autonomy}
          onChange={(e) =>
            setSettings({ ...settings, autonomy: e.target.value as SettingsType['autonomy'] })
          }
        >
          <option value="auto">
            {text(
              '全自動：依安全規則自動批准，一次 prompt 跑到完成',
              'Autonomous: host policy approves; one prompt runs to completion',
            )}
          </option>
          <option value="ask">
            {text('逐筆批准：每個工具請求都等我', 'Ask me: every tool request waits for me')}
          </option>
        </select>
      </label>
      <p className="muted">
        {text(
          '全自動仍會拒絕推送、改寫 Git 歷史、碰觸憑證、變更系統與刪除工作區外檔案；每筆自動決定都記在活動紀錄。傳給多位代理時，由一位領導代理先定介面再分工；整合失敗會自動交回負責代理修正（最多 2 次）。',
          'Autonomous mode still denies pushes, Git history rewrites, credentials, system changes and deletes outside the workspace, and logs every decision in Activity. A prompt to several agents goes to a lead who defines the contract and assigns the rest; failed integrations go back to the owning agent (up to 2 fixes).',
        )}
      </p>
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
          onChange={(e) => setSettings({ ...settings, maxUsageTokens: Number(e.target.value) })}
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
          onChange={(e) => setSettings({ ...settings, maxCostUsd: Number(e.target.value) })}
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
          onChange={(e) => setSettings({ ...settings, automaticReview: e.target.checked })}
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
            onChange={(e) => setSettings({ ...settings, [field]: Number(e.target.value) })}
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
          onChange={(e) => setSettings({ ...settings, timeoutMs: Number(e.target.value) * 60000 })}
        />
      </label>
      <p className="muted">
        {text(
          '初始預設為手動模式，可在此調整新聊天室設定。主管也可由聊天室上方選擇。達上限不會自動重試。',
          'The initial default is manual. Configure new room defaults here or select a supervisor in the room header. Limits never trigger automatic retries.',
        )}
      </p>
    </>
  )
}
