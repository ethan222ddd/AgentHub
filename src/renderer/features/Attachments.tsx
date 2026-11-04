import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Attachment } from '../../shared/types'
import { useDialog } from '../components/useDialog'
import { Button } from '../components/ui'
function Viewer({ item, close }: { item: Attachment; close(): void }) {
  const ref = useDialog(close)
  const [data, setData] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.agenthub
      .invoke<{ dataUrl: string }>({ op: 'attachment.get', id: item.id })
      .then((value) => {
        if (alive) setData(value.dataUrl)
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
  }, [item.id])
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Image attachment"
        className="image-viewer"
      >
        <header>
          <span>
            {item.name} · {item.width} × {item.height}
          </span>
          <Button variant="ghost" onClick={close}>
            Close / 關閉
          </Button>
        </header>
        {error ? (
          <p role="alert">{error}</p>
        ) : data ? (
          <img src={data} alt={item.name} />
        ) : (
          <p>Loading / 載入中…</p>
        )}
        <small>SHA-256 {item.sha256}</small>
      </section>
    </div>,
    document.body,
  )
}
export function Attachments({ items }: { items: Attachment[] }) {
  const [selected, setSelected] = useState<Attachment>()
  return (
    <>
      <div className="message-attachments">
        {items.map((item) => (
          <button
            key={item.id}
            title={`${item.name} · ${item.bytes} B · ${item.sha256}`}
            onClick={() => {
              if (item.kind === 'image') setSelected(item)
            }}
          >
            {item.kind === 'image' && item.preview ? (
              <img src={item.preview} alt={item.name} />
            ) : (
              <span>📄</span>
            )}
            <small>{item.name}</small>
          </button>
        ))}
      </div>
      {selected && (
        <Viewer key={selected.id} item={selected} close={() => setSelected(undefined)} />
      )}
    </>
  )
}
