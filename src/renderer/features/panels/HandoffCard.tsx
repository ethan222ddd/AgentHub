import { FileCheck2 } from 'lucide-react'
import type { Task } from '../../../shared/types'

/** The agent's own end-of-task report. "Not verified" is emphasised: that is where risk lives. */
export function HandoffCard({ task, en }: { task: Task; en: boolean }) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const h = task.handoff
  if (!h) {
    if (task.status !== 'completed' || task.kind === 'review') return null
    return (
      <p className="handoff-missing">
        {text(
          '代理沒有提交交接摘要；請直接檢查 Diff 與測試結果。',
          'No handoff was submitted; check the diff and test results directly.',
        )}
      </p>
    )
  }
  const block = (title: string, items: string[], tone = '') =>
    !!items.length && (
      <div className={`handoff-block ${tone}`}>
        <h6>{title}</h6>
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    )
  return (
    <section className="handoff" aria-label={text('交接摘要', 'Handoff')}>
      <header>
        <FileCheck2 size={14} />
        <strong>{text('交接摘要', 'Handoff')}</strong>
        <time>{new Date(h.submittedAt).toLocaleString()}</time>
      </header>
      {h.summary && <p className="handoff-summary">{h.summary}</p>}
      {block(text('改了什麼', 'Changed'), h.changed)}
      {block(text('測了什麼', 'Tested'), h.tested)}
      {block(text('沒有驗證', 'Not verified'), h.untested, 'risk')}
      {block(text('待確認的問題', 'Open questions'), h.questions)}
      {block(text('建議下一步', 'Next steps'), h.next)}
      {!h.untested.length && (
        <p className="handoff-note">
          {text(
            '代理沒有列出未驗證的項目，這是它的自我回報，不代表 Host 已驗證。',
            'The agent listed nothing unverified. This is self-reported, not host-verified.',
          )}
        </p>
      )}
    </section>
  )
}
