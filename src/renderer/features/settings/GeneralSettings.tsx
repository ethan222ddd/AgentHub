import type { Dispatch, SetStateAction } from 'react'
import type { Settings as SettingsType } from '../../../shared/types'
import { Button } from '../../components/ui'
interface Props {
  text: (zh: string, eng: string) => string
  settings: SettingsType
  setSettings: Dispatch<SetStateAction<SettingsType>>
  perform: (request: Record<string, unknown>) => Promise<unknown>
  conversationId: string | undefined
  setNotice: Dispatch<SetStateAction<string>>
}
export function GeneralSettings({
  text,
  settings,
  setSettings,
  perform,
  conversationId,
  setNotice,
}: Props) {
  return (
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
            {text('批准、完成、失敗與整合提醒', 'Approvals, completion, failure and integration')}
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
          onChange={(e) => setSettings({ ...settings, defaultProjectDirectory: e.target.value })}
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
          <option value="restore">{text('恢復上次對話', 'Restore last conversation')}</option>
          <option value="empty">{text('先顯示專案選擇', 'Start at project selection')}</option>
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
  )
}
