import { Notification, nativeImage, type BrowserWindow } from 'electron'
import type { AppEvent } from '../../shared/types'
import type { Notice, NotificationSink } from './notifications'
import { trace, traceError } from './diagnostics'

const glyphs: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  '+': '000010111010000',
}

// Small BGRA bitmap: no renderer, canvas, SVG loader or additional dependency needed.
export function badgePixels(count: number): Buffer {
  const pixels = Buffer.alloc(16 * 16 * 4)
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 64) pixels.set([72, 88, 178, 255], (y * 16 + x) * 4)
  const label = count > 99 ? '99+' : String(Math.max(0, count))
  const scale = label.length < 3 ? 2 : 1
  const left = Math.floor((16 - (label.length * 4 - 1) * scale) / 2)
  const top = Math.floor((16 - 5 * scale) / 2)
  for (let n = 0; n < label.length; n++)
    for (let i = 0; i < 15; i++)
      if (glyphs[label[n]][i] === '1')
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const x = left + (n * 4 + (i % 3)) * scale + dx
            const y = top + Math.floor(i / 3) * scale + dy
            pixels.set([255, 255, 255, 255], (y * 16 + x) * 4)
          }
  return pixels
}

export const activationPrefix = 'agenthub:conversation:'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function activationConversation(argument: string): string | undefined {
  if (!argument.startsWith(activationPrefix)) return
  const id = argument.slice(activationPrefix.length)
  return uuid.test(id) ? id : undefined
}
function xml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
}

export class WindowsNotificationSink implements NotificationSink {
  private active = new Set<Notification>()
  private reportedFailure = false
  private closed = false
  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly publish: (event: AppEvent) => void,
    private readonly activate: (conversationId: string) => void,
  ) {
    if (process.platform === 'win32')
      Notification.handleActivation((details) => {
        if (this.closed || details.type !== 'click') return
        const id = activationConversation(details.arguments)
        if (id) this.activate(id)
        else if (!details.arguments) this.focus()
      })
  }

  failed(): void {
    if (this.closed || this.reportedFailure) return
    this.reportedFailure = true
    this.publish({
      type: 'notification-error',
      message:
        'Windows 通知無法送出。請檢查 Windows 通知設定，並使用已安裝的 AgentHub 捷徑啟動。任務與批准仍保留於活動面板。 / Desktop notification failed; check Windows notification settings and launch the installed AgentHub shortcut. Tasks and approvals remain in Activity.',
    })
  }

  show(notice: Notice): void {
    if (this.closed) return
    if (!Notification.isSupported()) {
      trace('notification.unsupported')
      this.failed()
      return
    }
    const launch =
      notice.conversationId && uuid.test(notice.conversationId)
        ? activationPrefix + notice.conversationId
        : ''
    const notification = new Notification({
      title: notice.title,
      body: notice.body,
      ...(process.platform === 'win32'
        ? {
            toastXml: `<toast launch="${xml(launch)}"><visual><binding template="ToastGeneric"><text>${xml(notice.title)}</text><text>${xml(notice.body)}</text></binding></visual></toast>`,
          }
        : {}),
    })
    this.active.add(notification)
    if (this.active.size > 32) {
      const oldest = this.active.values().next().value
      oldest?.close()
      if (oldest) this.active.delete(oldest)
    }
    // Windows uses the centralized activation handler, including notifications surviving restart.
    if (process.platform !== 'win32')
      notification.on('click', () => {
        if (notice.conversationId) this.activate(notice.conversationId)
        else this.focus()
      })
    notification.on('show', () =>
      trace('notification.shown', { stage: notice.kind, conversationId: notice.conversationId }),
    )
    notification.on('failed', () => {
      trace('notification.failed', { stage: notice.kind, conversationId: notice.conversationId })
      this.active.delete(notification)
      this.failed()
    })
    notification.on('close', () => this.active.delete(notification))
    trace('notification.requested', { stage: notice.kind, conversationId: notice.conversationId })
    try {
      notification.show()
    } catch (error) {
      this.active.delete(notification)
      trace('notification.failed', traceError(error))
      this.failed()
    }
  }

  private focus(): void {
    const win = this.window()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  navigate(conversationId: string): void {
    this.focus()
    this.publish({ type: 'navigate', conversationId })
    trace('notification.activated', { conversationId })
  }

  badge(count: number, description: string): void {
    const win = this.window()
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return
    win.setOverlayIcon(
      count ? nativeImage.createFromBitmap(badgePixels(count), { width: 16, height: 16 }) : null,
      description,
    )
    trace('notification.badge', { characters: count })
  }

  dispose(): void {
    this.closed = true
    if (process.platform === 'win32') Notification.handleActivation(() => {})
    for (const notification of this.active) notification.close()
    this.active.clear()
  }
}
