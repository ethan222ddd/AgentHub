import type { Dispatch, SetStateAction } from 'react'
import type { Snapshot } from '../../../shared/types'
import { Button } from '../../components/ui'
interface Props {
  text: (zh: string, eng: string) => string
  perform: (request: Record<string, unknown>) => Promise<unknown>
  setRestore: Dispatch<
    SetStateAction<{ id: string; version: number; counts: Record<string, number> } | undefined>
  >
  restore: { id: string; version: number; counts: Record<string, number> } | undefined
  setNotice: Dispatch<SetStateAction<string>>
  snapshot: Snapshot
}
export function DataSettings({ text, perform, setRestore, restore, setNotice, snapshot }: Props) {
  return (
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
  )
}
