import { useEffect, useRef } from 'react'
export function useDialog(close: () => void) {
  const ref = useRef<HTMLElement>(null)
  const onClose = useRef(close)
  onClose.current = close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    const focusable = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ) || []),
      ].filter((e) => e.getClientRects().length)
    focusable()[0]?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (!items.length) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        items.at(-1)?.focus()
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault()
        items[0].focus()
      }
    }
    dialog?.addEventListener('keydown', key)
    return () => {
      dialog?.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  return ref
}
