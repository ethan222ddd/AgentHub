import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import type { Message, Task } from '../src/shared/types'
import { directory } from './helpers'
describe('SQLite persistence and recovery', () => {
  it('requires review for dependency waits and approvals after restart, preserving attempt history', () => {
    const store = new Store(':memory:')
    const p = store.addProject('C:\\fixture', 'P'),
      c = store.snapshot().conversations[0]
    for (const [id, status, waitReason] of [
      ['dependency', 'waiting_agent', 'dependencies'],
      ['approval', 'waiting_user', 'approval'],
      ['blocked', 'blocked', undefined],
    ] as const)
      store.put('tasks', { id, projectId: p.id, conversationId: c.id, status, waitReason } as Task)
    store.put('tasks', { id: 'old', status: 'failed', supersededBy: 'dependency' } as Task)
    store.recover()
    for (const id of ['dependency', 'approval', 'blocked'])
      expect(store.require<Task>('tasks', id)).toMatchObject({
        status: 'waiting_user',
        waitReason: 'recovery',
        failureKind: 'interrupted',
      })
    expect(store.require<Task>('tasks', 'old')).toMatchObject({
      status: 'failed',
      supersededBy: 'dependency',
    })
    store.close()
  })
  it('migrates once, preserves shared messages and never replays interrupted tasks', async () => {
    const path = join(await directory(), 'state.sqlite')
    let store = new Store(path)
    const p = store.addProject('C:\\project', 'Project')
    const c = store.snapshot().conversations[0]
    const m: Message = {
      id: 'message',
      projectId: p.id,
      conversationId: c.id,
      senderId: 'codex',
      recipientIds: [],
      content: 'Persisted response',
      type: 'agent',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: 'root',
      delivery: 'streaming',
    }
    store.put('messages', m)
    store.put('tasks', {
      id: 'task',
      status: 'running',
      projectId: p.id,
      conversationId: c.id,
    } as Task)
    store.close()
    store = new Store(path)
    store.recover()
    expect(store.snapshot().agents).toHaveLength(3)
    expect(store.messages(c.id)[0]).toMatchObject({ content: m.content, delivery: 'failed' })
    expect(store.get<Task>('tasks', 'task')?.status).toBe('waiting_user')
    expect(store.get<Task>('tasks', 'task')?.waitReason).toBe('recovery')
    expect(store.db.prepare('SELECT count(*) as n FROM migrations').get()?.n).toBe(8)
    expect(store.messages(c.id, 'persisted')).toHaveLength(1)
    expect(store.context(c.id, 0).content).toBe('') // Incomplete response is not shared as success.
    store.close()
  })
  it('bounds incremental context and uses monotonic delivery cursors', () => {
    const store = new Store(':memory:')
    const p = store.addProject('C:\\project', 'Project')
    const c = store.snapshot().conversations[0]
    for (let n = 0; n < 80; n++)
      store.put('messages', {
        id: `m${n}`,
        projectId: p.id,
        conversationId: c.id,
        senderId: 'user',
        recipientIds: [],
        content: `${n}:` + 'x'.repeat(2000),
        type: 'user',
        timestamp: '',
        taskId: null,
        correlationId: '',
        delivery: 'completed',
      } satisfies Message)
    const context = store.context(c.id, 0)
    expect(context.content.length).toBeLessThanOrEqual(24000)
    expect(context.content).toContain('79:')
    expect(store.context(c.id, context.cursor).content).toBe('')
    expect(() => store.list('messages; DROP TABLE agents')).toThrow('Invalid table')
    store.close()
  })
})
