import { RefreshCw } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProcessInspection, Snapshot } from '../../../shared/types'
import { Button } from '../../components/ui'
interface Props {
  text: (zh: string, eng: string) => string
  inspecting: boolean
  setInspecting: Dispatch<SetStateAction<boolean>>
  setProcesses: Dispatch<SetStateAction<ProcessInspection | undefined>>
  setNotice: Dispatch<SetStateAction<string>>
  processes: ProcessInspection | undefined
  snapshot: Snapshot
}
export function DiagnosticsSettings({
  text,
  inspecting,
  setInspecting,
  setProcesses,
  setNotice,
  processes,
  snapshot,
}: Props) {
  return (
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
  )
}
