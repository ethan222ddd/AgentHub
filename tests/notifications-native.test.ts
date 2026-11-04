import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { Notification } from 'electron'
import {
  activationConversation,
  activationPrefix,
  badgePixels,
  WindowsNotificationSink,
} from '../src/main/app/notifications-native'
import type { Notice } from '../src/main/app/notifications'

const fixture = vi.hoisted(() => ({
  supported: true,
  activation: undefined as ((details: { type: string; arguments: string }) => void) | undefined,
  notices: [] as {
    emitter: EventEmitter
    options: { toastXml: string }
    close: ReturnType<typeof vi.fn>
  }[],
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Notification: class extends EventEmitter {
      static isSupported() {
        return fixture.supported
      }
      static handleActivation(cb: typeof fixture.activation) {
        fixture.activation = cb
      }
      close = vi.fn(() => this.emit('close'))
      show = vi.fn(() => this.emit('show'))
      constructor(options: { toastXml: string }) {
        super()
        fixture.notices.push({ emitter: this, options, close: this.close })
      }
    },
    nativeImage: { createFromBitmap: vi.fn((pixels: Buffer) => pixels) },
  }
})
beforeEach(() => {
  fixture.supported = true
  fixture.notices = []
  fixture.activation = undefined
})
function setup() {
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setOverlayIcon: vi.fn(),
  }
  const publish = vi.fn(),
    activate = vi.fn()
  const sink = new WindowsNotificationSink(
    () => window as unknown as Electron.BrowserWindow,
    publish,
    activate,
  )
  return { sink, window, publish, activate }
}
const notice = (id = randomUUID()): Notice => ({
  title: 'AgentHub <approval>',
  body: 'Open & review',
  kind: 'approval',
  conversationId: id,
})

it('uses escaped toast XML and routes only recognized UUID activation arguments', () => {
  const { sink, activate } = setup(),
    n = notice()
  sink.show(n)
  expect(fixture.notices[0].options.toastXml).toContain('&lt;approval&gt;')
  expect(fixture.notices[0].options.toastXml).toContain('Open &amp; review')
  fixture.activation!({ type: 'click', arguments: activationPrefix + n.conversationId })
  expect(activate).toHaveBeenCalledExactlyOnceWith(n.conversationId)
  for (const argument of [
    'file:///C:/secret',
    activationPrefix + '../bad',
    activationPrefix + n.conversationId + ' command',
  ])
    fixture.activation!({ type: 'click', arguments: argument })
  fixture.activation!({ type: 'reply', arguments: activationPrefix + n.conversationId })
  expect(activate).toHaveBeenCalledTimes(1)
  expect(activationConversation(activationPrefix + n.conversationId)).toBe(n.conversationId)
  sink.dispose()
})

it('restores and focuses the window before routing, and clears overlays at zero', () => {
  const { sink, window, publish } = setup()
  sink.navigate('room')
  expect(window.restore).toHaveBeenCalledTimes(1)
  expect(window.show).toHaveBeenCalledTimes(1)
  expect(window.focus).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledWith({ type: 'navigate', conversationId: 'room' })
  sink.badge(123, '123 pending tasks')
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith(expect.any(Buffer), '123 pending tasks')
  sink.badge(0, '0 pending tasks')
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, '0 pending tasks')
  for (const count of [1, 9, 10, 99, 100]) {
    const pixels = badgePixels(count)
    expect(pixels.length).toBe(1024)
    expect(pixels.includes(Buffer.from([255, 255, 255, 255]))).toBe(true)
  }
  sink.dispose()
})

it('shows a visible notification error once and never leaks native error payloads', () => {
  const { sink, publish } = setup()
  sink.show(notice())
  fixture.notices[0].emitter.emit('failed', {}, 'private token or command')
  fixture.supported = false
  sink.show(notice())
  expect(publish).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notification-error' }))
  expect(JSON.stringify(publish.mock.calls)).not.toContain('private token')
  expect(Notification.isSupported()).toBe(false)
  sink.dispose()
})

it('bounds native object retention and disables click handling on shutdown', () => {
  const { sink, activate } = setup()
  for (let i = 0; i < 40; i++) sink.show(notice())
  expect(fixture.notices.slice(0, 8).every((n) => n.close.mock.calls.length === 1)).toBe(true)
  const handler = fixture.activation!
  sink.dispose()
  handler({ type: 'click', arguments: activationPrefix + randomUUID() })
  expect(activate).not.toHaveBeenCalled()
  expect(fixture.notices.every((n) => n.close.mock.calls.length === 1)).toBe(true)
})
