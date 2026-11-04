import { createHash, randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { relative } from 'node:path'
import { imageSize } from 'image-size'
import { Store } from '../database/store'
import { withinWorkspace } from '../permissions/paths'
import type { Attachment, Project, RuntimeImage } from '../../shared/types'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_TURN_BYTES = 12 * 1024 * 1024
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
export class AttachmentStore {
  constructor(
    private store: Store,
    private thumbnail?: (data: Buffer) => string | Promise<string>,
  ) {}
  async importFiles(projectId: string, paths: string[]) {
    const project = this.store.require<Project>('projects', projectId)
    if (!paths.length || paths.length > 8) throw new Error('Choose between 1 and 8 attachments')
    const prepared: { meta: Attachment; data: Buffer }[] = []
    for (const file of paths) {
      const path = await withinWorkspace(project.path, file)
      const handle = await open(path, 'r')
      let data: Buffer
      try {
        if ((await handle.stat()).size > MAX_IMAGE_BYTES)
          throw new Error('Attachment exceeds 5 MiB')
        await withinWorkspace(project.path, path)
        const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1)
        let length = 0
        while (length < buffer.length) {
          const read = await handle.read(buffer, length, buffer.length - length, length)
          if (!read.bytesRead) break
          length += read.bytesRead
        }
        if (length > MAX_IMAGE_BYTES) throw new Error('Attachment exceeds 5 MiB')
        data = Buffer.from(buffer.subarray(0, length))
      } finally {
        await handle.close()
      }
      prepared.push(await this.prepare(projectId, relative(project.path, path), data))
      this.validateTotals(prepared.map((p) => p.meta))
    }
    this.validateTotals(prepared.map((p) => p.meta))
    return this.persist(prepared)
  }
  async importImage(projectId: string, name: string, data: Buffer) {
    this.store.require('projects', projectId)
    return this.persist([await this.prepare(projectId, name, data, true)])[0]
  }
  private async prepare(projectId: string, name: string, data: Buffer, forceImage = false) {
    if (!data.length || data.length > MAX_IMAGE_BYTES)
      throw new Error('Attachment must be non-empty and no larger than 5 MiB')
    const imageExt = /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(name)
    let dimensions: ReturnType<typeof imageSize> | undefined
    try {
      const supportedMagic =
        data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (data[0] === 255 && data[1] === 216 && data[2] === 255) ||
        (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
      if (supportedMagic) dimensions = imageSize(data)
    } catch {
      /* A UTF-8 text attachment is allowed below. */
    }
    let meta: Attachment = {
      id: randomUUID(),
      projectId,
      name: name.replace(/[\r\n\0]/g, '').slice(0, 1024),
      kind: 'text',
      mime: 'text/plain',
      bytes: data.length,
      sha256: digest(data),
      createdAt: new Date().toISOString(),
    }
    if (forceImage || imageExt || dimensions) {
      if (!dimensions || !['png', 'jpg', 'webp'].includes(dimensions.type || ''))
        throw new Error('Only static PNG, JPEG and WebP images are supported')
      if (
        dimensions.width > 4096 ||
        dimensions.height > 4096 ||
        dimensions.width * dimensions.height > 8_000_000
      )
        throw new Error('Image exceeds 4096 px per side or 8 megapixels')
      if (dimensions.type === 'png')
        for (let offset = 8; offset + 12 <= data.length;) {
          const length = data.readUInt32BE(offset)
          const type = data.toString('ascii', offset + 4, offset + 8)
          if (type === 'acTL') throw new Error('Animated images are not supported')
          if (length > data.length - offset - 12) throw new Error('Truncated PNG image')
          offset += 12 + length
        }
      if (dimensions.type === 'webp')
        for (let offset = 12; offset + 8 <= data.length;) {
          const type = data.toString('ascii', offset, offset + 4)
          const length = data.readUInt32LE(offset + 4)
          if (type === 'ANIM' || type === 'ANMF')
            throw new Error('Animated images are not supported')
          if (length > data.length - offset - 8) throw new Error('Truncated WebP image')
          offset += 8 + length + (length % 2)
        }
      const mime = dimensions.type === 'jpg' ? 'image/jpeg' : `image/${dimensions.type}`
      meta = {
        ...meta,
        kind: 'image',
        mime,
        width: dimensions.width,
        height: dimensions.height,
        preview: await this.thumbnail?.(data),
      }
      if (meta.preview && meta.preview.length > 150000)
        throw new Error('Thumbnail exceeds the preview limit')
    } else {
      if (data.length > 128000 || data.includes(0))
        throw new Error('Only UTF-8 text up to 128 KB or supported images may be attached')
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      } catch {
        throw new Error('Text attachment is not valid UTF-8')
      }
      meta.content = `Project attachment: ${meta.name}\n<untrusted-file>\n${text}\n</untrusted-file>`
    }
    return { meta, data }
  }
  private persist(items: { meta: Attachment; data: Buffer }[]) {
    this.store.transaction(() => {
      for (const { meta, data } of items)
        this.store.db
          .prepare('INSERT INTO attachments(id,project_id,data,bytes) VALUES(?,?,?,?)')
          .run(meta.id, meta.projectId, JSON.stringify(meta), data)
    })
    return items.map((p) => p.meta)
  }
  get(id: string, projectId?: string) {
    const row = this.store.db.prepare('SELECT data,bytes FROM attachments WHERE id=?').get(id)
    if (!row) throw new Error('Attachment no longer exists')
    const meta = JSON.parse(String(row.data)) as Attachment
    if (projectId && meta.projectId !== projectId)
      throw new Error('Attachment belongs to another project')
    const data = Buffer.from(row.bytes as Uint8Array)
    if (digest(data) !== meta.sha256 || data.length !== meta.bytes)
      throw new Error('Attachment integrity check failed')
    return { meta, data }
  }
  resolve(projectId: string, ids: string[]) {
    if (ids.length > 8 || new Set(ids).size !== ids.length)
      throw new Error('Invalid attachment selection')
    const values = ids.map((id) => this.get(id, projectId))
    this.validateTotals(values.map((v) => v.meta))
    return values
  }
  private validateTotals(items: Attachment[]) {
    if (
      items.filter((a) => a.kind === 'image').length > 4 ||
      items.reduce((n, a) => n + a.bytes, 0) > MAX_TURN_BYTES
    )
      throw new Error('A message supports at most 4 images and 12 MiB of attachments')
  }
  images(projectId: string, ids: string[]): RuntimeImage[] {
    return this.resolve(projectId, ids)
      .filter((a) => a.meta.kind === 'image')
      .map(({ meta, data }) => ({
        id: meta.id,
        name: meta.name,
        mime: meta.mime as RuntimeImage['mime'],
        data: data.toString('base64'),
      }))
  }
  metadata(ids: string[], projectId?: string) {
    return ids.map((id) => {
      const { meta } = this.get(id, projectId)
      const value = { ...meta }
      delete value.content
      return value
    })
  }
  discard(id: string) {
    return (
      Number(
        this.store.db
          .prepare(
            "DELETE FROM attachments WHERE id=? AND NOT EXISTS(SELECT 1 FROM messages,json_each(json_extract(messages.data,'$.attachments')) AS a WHERE json_extract(a.value,'$.id')=?) AND NOT EXISTS(SELECT 1 FROM tasks,json_each(json_extract(tasks.data,'$.attachmentIds')) AS a WHERE a.value=?)",
          )
          .run(id, id, id).changes,
      ) > 0
    )
  }
  cleanupDrafts() {
    let removed = 0
    for (const row of this.store.db
      .prepare("SELECT id FROM attachments WHERE json_extract(data,'$.createdAt')<?")
      .all(new Date(Date.now() - 86400000).toISOString()))
      if (this.discard(String(row.id))) removed++
    return removed
  }
}
