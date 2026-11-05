import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import { applyPendingRestore } from '../src/main/database/backup'
import type { Message } from '../src/shared/types'
import { directory } from './helpers'

describe('release storage fault recovery with real SQLite and files', () => {
  it('preserves committed history after an actual SQLITE_FULL write failure', async () => {
    const root = await directory('sqlite-capacity-'),
      path = join(root, 'state.sqlite')
    const store = new Store(path)
    const p = store.addProject(root, 'Capacity fixture'),
      c = store.snapshot().conversations[0]
    const message: Message = {
      id: 'preserved',
      projectId: p.id,
      conversationId: c.id,
      senderId: 'user',
      recipientIds: [],
      content: 'Committed history survives',
      type: 'user',
      timestamp: new Date().toISOString(),
      taskId: null,
      correlationId: 'fixture',
      delivery: 'completed',
    }
    store.put('messages', message)
    const pages = Number(store.db.prepare('PRAGMA page_count').get()!.page_count)
    store.db.exec(`PRAGMA max_page_count=${pages}`)
    expect(() =>
      store.put('messages', { ...message, id: 'too-large', content: 'x'.repeat(2_000_000) }),
    ).toThrow(/full/i)
    expect(store.get('messages', 'too-large')).toBeUndefined()
    expect(store.require<Message>('messages', 'preserved').content).toBe(message.content)
    expect(Object.values(store.db.prepare('PRAGMA integrity_check').get()!)[0]).toBe('ok')
    store.close()
    const reopened = new Store(path)
    try {
      expect(reopened.require<Message>('messages', 'preserved')).toEqual(message)
    } finally {
      reopened.close()
    }
  })

  it('rejects a corrupt pending backup before moving the current database', async () => {
    const root = await directory('corrupt-restore-'),
      path = join(root, 'agenthub.sqlite')
    const store = new Store(path)
    const project = store.addProject(root, 'Original project')
    store.close()
    const original = await readFile(path)
    await writeFile(join(root, 'pending-restore.sqlite'), 'not a SQLite database')
    await writeFile(join(root, 'pending-restore.json'), '{}')
    await expect(applyPendingRestore(root)).rejects.toThrow()
    expect(await readFile(path)).toEqual(original)
    const reopened = new Store(path)
    try {
      expect(reopened.require<{ id: string; name: string }>('projects', project.id).name).toBe(
        'Original project',
      )
    } finally {
      reopened.close()
    }
  })

  it('reports an unwritable database location without altering the blocking file', async () => {
    const root = await directory('storage-io-'),
      blocker = join(root, 'not-a-directory')
    await writeFile(blocker, 'Preserve user-owned bytes')
    expect(() => new Store(join(blocker, 'state.sqlite'))).toThrow()
    expect(await readFile(blocker, 'utf8')).toBe('Preserve user-owned bytes')
  })
})
