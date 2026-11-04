import { describe, it, expect } from 'vitest'
import { Store } from '../src/main/database/store'
import { ContextMemory } from '../src/main/orchestrator/context'
import type { Message } from '../src/shared/types'

function setup() {
  const store = new Store(':memory:')
  store.addProject('C:/generated', 'Generated')
  const c = store.snapshot().conversations[0]
  const memory = new ContextMemory(store.db)
  const put = (id: string, content: string, extra: Partial<Message> = {}) => {
    const m: Message = {
      id,
      content,
      conversationId: c.id,
      projectId: c.projectId,
      senderId: 'user',
      recipientIds: [],
      type: 'user',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: '',
      delivery: 'completed',
      ...extra,
    }
    store.put('messages', m)
    return m
  }
  return { store, c, memory, put }
}
describe('Local context index and provenance', () => {
  it('removes pinned context when a provisional successful result is invalidated', () => {
    const { store, c, memory, put } = setup()
    const m = put('review-result', 'provisional result')
    memory.pin(m.id, true)
    store.put('messages', { ...m, delivery: 'failed' })
    expect(memory.pins(c.id)).toHaveLength(0)
    expect(memory.build(c.id, 0).content).toBe('')
    store.close()
  })
  it('retrieves Traditional Chinese sources older than the old 1000-message scan window', () => {
    const { store, c, memory, put } = setup()
    put('contract', '登入驗證規格：必須啟用兩階段驗證，驗收碼 ZEBRA_OLD_SOURCE。')
    store.transaction(() => {
      for (let n = 0; n < 1500; n++) put(`filler-${n}`, `Unrelated note ${n}`)
    })
    const found = memory.find(c.id, '登入驗證規格')
    expect(found[0].messageId).toBe('contract')
    const plan = memory.build(c.id, 0, '登入驗證規格')
    expect(plan.content).toContain('ZEBRA_OLD_SOURCE')
    expect(plan.characters).toBeLessThanOrEqual(24000)
    expect(new Set(plan.sources.map((s) => s.messageId)).size).toBe(plan.sources.length)
    store.close()
  })
  it('delivers late-completing parallel replies even when their message row predates the cursor', () => {
    const { store, c, memory, put } = setup()
    const slow = put('slow', 'not yet', {
      senderId: 'claude',
      type: 'agent',
      delivery: 'streaming',
    })
    put('fast', 'fast complete')
    const before = memory.build(c.id, 0)
    expect(before.content).not.toContain('not yet')
    store.put('messages', { ...slow, content: 'late public result', delivery: 'completed' })
    const after = memory.build(c.id, before.cursor)
    expect(after.content).toContain('late public result')
    expect(after.cursor).toBeGreaterThan(before.cursor)
    expect(memory.build(c.id, after.cursor).sources).toHaveLength(0)
    store.close()
  })
  it('pins only successful public messages, keeps pins within the budget and deletes them with history', () => {
    const { store, c, memory, put } = setup()
    for (let i = 0; i < 12; i++) {
      put(`pin-${i}`, 'Pinned contract '.repeat(1000))
      memory.pin(`pin-${i}`, true)
    }
    put('extra', 'too many')
    expect(() => memory.pin('extra', true)).toThrow('12')
    put('failed', 'failure secret', { delivery: 'failed' })
    expect(() => memory.pin('failed', true)).toThrow('completed')
    const plan = memory.build(c.id, 0, 'Pinned contract')
    expect(plan.sources.some((s) => s.kind === 'pinned')).toBe(true)
    expect(plan.characters).toBeLessThanOrEqual(24000)
    store.clearConversation(c.id)
    expect(memory.pins(c.id)).toEqual([])
    expect(memory.find(c.id, 'Pinned contract')).toEqual([])
    store.close()
  })
  it('refuses foreign-room sources and treats FTS syntax as search data', () => {
    const { store, c, memory, put } = setup()
    const other = store.createConversation(c.projectId)
    put('private-room', 'foreign special', { conversationId: other.id })
    put('local', 'special local')
    expect(() => memory.read(c.id, ['private-room'])).toThrow('not found')
    expect(
      memory.find(c.id, '" OR * special NEAR(').every((s) => s.messageId !== 'private-room'),
    ).toBe(true)
    store.close()
  })
  it('does not index streaming deltas and updates final/cancelled records transactionally', () => {
    const { store, c, memory, put } = setup()
    const stream = put('stream', 'first', { delivery: 'streaming', type: 'agent' })
    for (let n = 0; n < 20; n++) store.put('messages', { ...stream, content: `delta ${n}` })
    expect(store.db.prepare('SELECT count(*) AS n FROM message_search').get()?.n).toBe(0)
    store.put('messages', { ...stream, content: 'finished indexproof', delivery: 'completed' })
    expect(memory.find(c.id, 'indexproof')).toHaveLength(1)
    store.put('messages', { ...stream, content: 'failed indexproof', delivery: 'failed' })
    expect(memory.find(c.id, 'indexproof')).toHaveLength(0)
    store.close()
  })
})
