import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  DesktopNotifications,
  type NotificationState,
  type NotificationSink,
} from '../src/main/app/notifications'
import { defaults, Store } from '../src/main/database/store'
import { requestSchema, settingsSchema } from '../src/shared/schemas'
import type { Approval, Task } from '../src/shared/types'

let state: NotificationState
let sink: NotificationSink
const room = randomUUID(),
  other = randomUUID()
const task = (patch: Partial<Task> = {}): Task => ({
  id: randomUUID(),
  projectId: randomUUID(),
  conversationId: room,
  name: 'private prompt',
  description: 'secret command',
  agentId: 'codex',
  status: 'running',
  dependencies: [],
  createdAt: new Date().toISOString(),
  correlationId: randomUUID(),
  depth: 0,
  ...patch,
})
const approval = (t: Task, id = randomUUID()): Approval => ({
  id,
  agentId: t.agentId,
  taskId: t.id,
  conversationId: t.conversationId,
  tool: 'Bash',
  detail: 'sensitive command',
  risk: 'sensitive risk',
})
beforeEach(() => {
  state = {
    settings: { ...defaults },
    tasks: [],
    conversations: [room, other].map((id) => ({
      id,
      projectId: 'project',
      name: 'private repository',
      mode: 'manual',
      supervisorId: '',
      createdAt: '',
      stopped: false,
    })),
  }
  sink = { show: vi.fn(), badge: vi.fn(), navigate: vi.fn(), failed: vi.fn(), dispose: vi.fn() }
})
const create = () => new DesktopNotifications(() => state, sink)

it('restores pending counts without replaying old completion, failure or integration notices', () => {
  state.tasks = [
    task({ status: 'completed' }),
    task({ status: 'failed' }),
    task({ status: 'waiting_user', integration: { status: 'attention', detail: 'private' } }),
  ]
  const service = create()
  service.accept({ type: 'changed' })
  expect(sink.show).not.toHaveBeenCalled()
  expect(sink.badge).toHaveBeenLastCalledWith(1, expect.any(String))
})

it('announces each task transition once and keeps private content out of notices', () => {
  const t = task()
  state.tasks = [t]
  const service = create()
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    t.status = status
    service.accept({ type: 'changed' })
    service.accept({ type: 'changed' })
  }
  expect(vi.mocked(sink.show).mock.calls.map(([n]) => n.kind)).toEqual(['completed', 'failed'])
  expect(JSON.stringify(vi.mocked(sink.show).mock.calls)).not.toMatch(/private|secret|sensitive/)
})

it('deduplicates repeated approval lists and counts a task once despite several requests', () => {
  const t = task({ status: 'waiting_user', waitReason: 'approval' })
  state.tasks = [t]
  const service = create(),
    requests = [approval(t), approval(t)]
  service.accept({ type: 'approvals', approvals: requests })
  service.accept({ type: 'approvals', approvals: requests })
  expect(sink.show).toHaveBeenCalledTimes(2)
  expect(sink.badge).toHaveBeenLastCalledWith(1, expect.any(String))
  t.status = 'running'
  service.accept({ type: 'approvals', approvals: [] })
  expect(sink.badge).toHaveBeenLastCalledWith(0, expect.any(String))
})

it('notifies integration attention only after it occurs, then clears counts on completion', () => {
  const t = task({ status: 'reviewing', integration: { status: 'checking', detail: '' } })
  state.tasks = [t]
  const service = create()
  t.status = 'waiting_user'
  t.integration = { status: 'attention', detail: 'private error' }
  service.accept({ type: 'changed' })
  service.accept({ type: 'changed' })
  expect(sink.show).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'integration', conversationId: room }),
  )
  expect(sink.show).toHaveBeenCalledTimes(1)
  t.status = 'completed'
  t.integration.status = 'merged'
  service.accept({ type: 'changed' })
  expect(sink.badge).toHaveBeenLastCalledWith(0, expect.any(String))
})

it.each(['off', 'approvals'] as const)(
  'honors %s immediately while preserving actionable task counts',
  (mode) => {
    const t = task()
    state.tasks = [t]
    const service = create()
    state.settings.notifications = mode
    t.status = 'failed'
    service.accept({ type: 'changed' })
    t.status = 'waiting_user'
    service.accept({ type: 'approvals', approvals: [approval(t)] })
    expect(vi.mocked(sink.show).mock.calls.map(([n]) => n.kind)).toEqual(
      mode === 'off' ? [] : ['approval'],
    )
    expect(sink.badge).toHaveBeenLastCalledWith(1, expect.any(String))
    state.settings.notifications = 'all'
    service.accept({ type: 'changed' })
    expect(sink.show).toHaveBeenCalledTimes(mode === 'off' ? 0 : 1) // no catch-up spam
  },
)

it('queues clicks until the renderer subscribes and drops deleted or unknown targets', () => {
  const service = create()
  service.activate('file:///C:/secret')
  service.activate(room)
  service.activate(other)
  expect(sink.navigate).not.toHaveBeenCalled()
  service.rendererReady()
  expect(sink.navigate).toHaveBeenCalledExactlyOnceWith(other)
  service.rendererLoading()
  service.activate(room)
  state.conversations = state.conversations.filter((c) => c.id !== room)
  service.rendererReady()
  expect(sink.navigate).toHaveBeenCalledTimes(1)
})

it('clears unread failures on viewing their conversation without dismissing unresolved approvals', () => {
  const failed = task(),
    waiting = task({ status: 'waiting_user' })
  state.tasks = [failed, waiting]
  const service = create()
  failed.status = 'failed'
  service.accept({ type: 'changed' })
  expect(sink.badge).toHaveBeenLastCalledWith(2, expect.any(String))
  service.markRead(room)
  expect(sink.badge).toHaveBeenLastCalledWith(1, expect.any(String))
  failed.supersededBy = 'retry'
  state.tasks = []
  service.accept({ type: 'changed' })
  expect(sink.badge).toHaveBeenLastCalledWith(0, expect.any(String))
})

it('isolates OS errors, never retries noisy notifications and stops processing on shutdown', () => {
  const t = task()
  state.tasks = [t]
  const service = create()
  vi.mocked(sink.show).mockImplementation(() => {
    throw new Error('OS failed')
  })
  t.status = 'failed'
  expect(() => service.accept({ type: 'changed' })).not.toThrow()
  service.accept({ type: 'changed' })
  expect(sink.failed).toHaveBeenCalledTimes(1)
  expect(sink.show).toHaveBeenCalledTimes(1)
  service.dispose()
  service.activate(room)
  service.accept({ type: 'approvals', approvals: [approval(t)] })
  expect(sink.show).toHaveBeenCalledTimes(1)
  expect(sink.dispose).toHaveBeenCalledTimes(1)
})

it('adds backward compatible settings defaults and validates the notification IPC allowlist', () => {
  const { notifications: _old, ...old } = defaults
  expect(_old).toBe('all')
  expect(settingsSchema.parse(old).notifications).toBe('all')
  expect(settingsSchema.safeParse({ ...defaults, notifications: 'anything' }).success).toBe(false)
  expect(
    requestSchema.safeParse({ op: 'notifications.read', conversationId: room, command: 'bad' })
      .success,
  ).toBe(false)
  const db = new Store(':memory:')
  try {
    db.put('settings', { id: 'general', ...old })
    expect(db.settings().notifications).toBe('all')
    db.put('settings', { id: 'general', ...defaults, notifications: 'off' })
    expect(db.settings().notifications).toBe('off')
  } finally {
    db.close()
  }
})
