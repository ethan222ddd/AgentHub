import type { Dispatch, SetStateAction } from 'react'
import { Button } from '../../components/ui'
interface Props {
  text: (zh: string, eng: string) => string
  perform: (request: Record<string, unknown>) => Promise<unknown>
  setNotice: Dispatch<SetStateAction<string>>
}
export function SecuritySettings({ text, perform, setNotice }: Props) {
  return (
    <>
      <h3>{text('操作由你掌握', 'You control execution')}</h3>
      <Button
        variant="outline"
        onClick={() =>
          void perform({ op: 'permissions.clear' }).then(() =>
            setNotice(text('已撤銷記憶的工作區讀取批准', 'Scoped read permissions revoked')),
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
  )
}
