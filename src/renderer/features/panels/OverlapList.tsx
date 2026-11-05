import { GitMerge, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { AgentProfile, ProjectOverlaps } from '../../../shared/types'
import { Button } from '../../components/ui'
import { seriesSlot } from '../../lib/series'

interface Props {
  overlaps?: ProjectOverlaps
  projectId: string
  allAgents: AgentProfile[]
  en: boolean
  perform(request: Record<string, unknown>): Promise<unknown>
}
/** Files two or more agents are changing before integration: the likely merge conflicts. */
export function OverlapList({ overlaps, projectId, allAgents, en, perform }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const [busy, setBusy] = useState(false)
  const files = overlaps?.files || []
  const name = (id: string) => allAgents.find((a) => a.id === id)?.name || id
  const rescan = async () => {
    setBusy(true)
    try {
      await perform({ op: 'overlaps.scan', projectId })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={`overlaps ${files.length ? 'has-overlaps' : ''}`}>
      <header>
        <GitMerge size={15} />
        <h5>
          {files.length
            ? text(`${files.length} 個檔案可能衝突`, `${files.length} files may conflict`)
            : text('沒有偵測到檔案衝突', 'No file overlaps detected')}
        </h5>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void rescan()}
          aria-label={text('重新檢查衝突', 'Rescan for overlaps')}
        >
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
          {text('重新檢查', 'Rescan')}
        </Button>
      </header>
      {!!files.length && (
        <>
          <p className="muted">
            {text(
              '這些檔案在多位代理的工作區都有尚未整合的修改。建議先整合其中一方，再讓另一位同步後繼續，避免整合時衝突。',
              'Several agents have unintegrated changes to these files. Integrate one side first, then let the other sync and continue.',
            )}
          </p>
          <ul className="overlap-files">
            {files.slice(0, 30).map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span className="overlap-agents">
                  {file.agents.map((a) => (
                    <span key={a.agentId}>
                      <i className="agent-swatch" data-slot={seriesSlot(a.agentId, allAgents)} />
                      {name(a.agentId)}
                      {a.uncommitted && <em>{text('未提交', 'uncommitted')}</em>}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {files.length > 30 && (
            <p className="muted">
              {text(
                `另有 ${files.length - 30} 個檔案未列出。`,
                `${files.length - 30} more not shown.`,
              )}
            </p>
          )}
        </>
      )}
      {overlaps && (
        <small className="overlap-meta">
          {text('上次檢查', 'Last checked')} {new Date(overlaps.scannedAt).toLocaleTimeString()}
          {!!overlaps.skipped &&
            text(
              `，${overlaps.skipped} 個工作區無法讀取`,
              `, ${overlaps.skipped} workspaces could not be read`,
            )}
        </small>
      )}
    </section>
  )
}
