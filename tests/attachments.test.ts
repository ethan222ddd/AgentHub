import { describe, it, expect } from 'vitest'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { Store } from '../src/main/database/store'
import { AttachmentStore, MAX_IMAGE_BYTES } from '../src/main/attachments/store'
import { localImageInputs, claudeImageContent } from '../src/main/agents/images'
import { BackupManager, applyPendingRestore } from '../src/main/database/backup'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { directory } from './helpers'
import type { Message } from '../src/shared/types'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2X8AAAAASUVORK5CYII=',
  'base64',
)
describe('Immutable binary attachments', () => {
  it('retains original bytes after source deletion and SQLite restore; detects tampering', async () => {
    const profile = await directory()
    const store = new Store(join(profile, 'agenthub.sqlite'))
    const root = await directory()
    const p = store.addProject(root, 'Images')
    const c = store.snapshot().conversations[0]
    const path = join(root, 'screen.png')
    await writeFile(path, png)
    const assets = new AttachmentStore(store)
    const [image] = await assets.importFiles(p.id, [path])
    await unlink(path)
    expect(image).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      width: 1,
      height: 1,
      bytes: png.length,
    })
    expect(assets.get(image.id, p.id).data.equals(png)).toBe(true)
    const o = new Orchestrator(store, new Map(), () => {})
    o.send(c.id, 'Visual note', [], undefined, [image.id])
    expect(store.messages(c.id)[0].attachments?.[0].sha256).toBe(image.sha256)
    const input = join(profile, 'backup.sqlite')
    await backup(store.db, input)
    store.db
      .prepare('UPDATE attachments SET bytes=? WHERE id=?')
      .run(Buffer.from('corrupted'), image.id)
    expect(() => assets.get(image.id, p.id)).toThrow('integrity')
    const manager = new BackupManager(profile)
    const preview = await manager.preview(input)
    expect(preview.counts.attachments).toBe(1)
    await manager.apply(preview.id, store.db)
    await o.dispose()
    store.close()
    await applyPendingRestore(profile)
    const restored = new Store(join(profile, 'agenthub.sqlite'))
    expect(new AttachmentStore(restored).get(image.id).data.equals(png)).toBe(true)
    expect(restored.messages(c.id)[0].attachments?.[0].id).toBe(image.id)
    restored.close()
  })
  it('rejects traversal, wrong project, unsupported formats, oversized images and partial import batches', async () => {
    const store = new Store(':memory:')
    const root = await directory()
    const p = store.addProject(root, 'P')
    const other = store.addProject(await directory(), 'Other')
    const assets = new AttachmentStore(store)
    await writeFile(join(root, 'one.png'), png)
    const outside = join(await directory(), 'outside.png')
    await writeFile(outside, png)
    await expect(assets.importFiles(p.id, [outside])).rejects.toThrow('escapes')
    await writeFile(join(root, 'bad.png'), Buffer.from('not a PNG'))
    await expect(
      assets.importFiles(p.id, [join(root, 'one.png'), join(root, 'bad.png')]),
    ).rejects.toThrow('supported')
    expect(store.db.prepare('SELECT count(*) as n FROM attachments').get()?.n).toBe(0)
    await expect(
      assets.importImage(p.id, 'giant.png', Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    ).rejects.toThrow('5 MiB')
    const large = Buffer.from(png)
    large.writeUInt32BE(99999, 16)
    await expect(assets.importImage(p.id, 'bomb.png', large)).rejects.toThrow('pixel')
    const [image] = await assets.importFiles(p.id, [join(root, 'one.png')])
    expect(() => assets.resolve(other.id, [image.id])).toThrow('another project')
    expect(() => assets.resolve(p.id, [image.id, image.id])).toThrow('selection')
    store.close()
  })
  it('routes immutable images to all three native image paths and retains referenced bytes', async () => {
    const store = new Store(':memory:')
    const p = store.addProject(await directory(), 'P')
    const c = store.snapshot().conversations[0]
    const image = await new AttachmentStore(store).importImage(p.id, 'screen.png', png)
    const o = new Orchestrator(store, new Map(), () => {})
    o.send(c.id, 'Inspect this', ['codex', 'claude', 'antigravity'], undefined, [image.id])
    expect(store.messages(c.id)[0].attachments?.[0].id).toBe(image.id)
    expect(store.snapshot().tasks).toHaveLength(3)
    expect(store.snapshot().tasks.every((t) => t.attachmentIds?.includes(image.id))).toBe(true)
    o.send(c.id, 'Save locally', [], undefined, [image.id])
    expect(store.messages(c.id)[0].attachments).toHaveLength(1)
    expect(new AttachmentStore(store).discard(image.id)).toBe(false)
    const draft = await new AttachmentStore(store).importImage(p.id, 'draft.png', png)
    expect(new AttachmentStore(store).discard(draft.id)).toBe(true)
    store.clearConversation(c.id)
    expect(() => new AttachmentStore(store).get(image.id)).toThrow('no longer exists')
    await o.dispose()
    store.close()
  })
  it('uses actual native image payloads and deletes only its own temporary files', async () => {
    const image = {
      id: 'fixture',
      name: 'screen.png',
      mime: 'image/png' as const,
      data: png.toString('base64'),
    }
    const local = await localImageInputs([image])
    expect(local.inputs[0].type).toBe('localImage')
    expect((await readFile(local.inputs[0].path)).equals(png)).toBe(true)
    await local.dispose()
    await expect(readFile(local.inputs[0].path)).rejects.toThrow()
    expect(claudeImageContent('Read screenshot', [image])).toEqual([
      { type: 'text', text: 'Read screenshot' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } },
    ])
  })
  it('migrates an existing schema-3 database without losing messages', async () => {
    const path = join(await directory(), 'old.sqlite')
    const legacy = new DatabaseSync(path)
    const p = { id: 'old-project', path: 'C:\\fixture', name: 'P', createdAt: '' }
    const c = {
      id: 'old-room',
      projectId: p.id,
      name: 'Old room',
      mode: 'manual',
      supervisorId: '',
      createdAt: '',
      stopped: false,
    }
    try {
      legacy.exec(await readFile(new URL('./fixtures/schema-3.sql', import.meta.url), 'utf8'))
      legacy.prepare('INSERT INTO projects VALUES(?,?)').run(p.id, JSON.stringify(p))
      legacy.prepare('INSERT INTO conversations VALUES(?,?,?)').run(c.id, p.id, JSON.stringify(c))
      const message: Message = {
        id: 'old-note',
        conversationId: c.id,
        projectId: p.id,
        content: 'Preserved',
        senderId: 'user',
        recipientIds: [],
        type: 'user',
        timestamp: '',
        taskId: null,
        correlationId: '',
        delivery: 'completed',
      }
      legacy
        .prepare('INSERT INTO messages VALUES(?,?,?)')
        .run(message.id, c.id, JSON.stringify(message))
    } finally {
      legacy.close()
    }
    const store = new Store(path)
    try {
      expect(store.messages(c.id)[0].content).toBe('Preserved')
      expect(store.db.prepare('SELECT count(*) as n FROM attachments').get()?.n).toBe(0)
      expect(store.snapshot().workflowTemplates).toHaveLength(2)
    } finally {
      store.close()
    }
  })
})
