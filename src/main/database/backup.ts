import { DatabaseSync, backup } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, copyFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withinWorkspace } from '../permissions/paths'
export function inspectBackup(path: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()
    if (Object.values(integrity || {})[0] !== 'ok') throw new Error('Backup integrity check failed')
    const version = Number(db.prepare('SELECT max(version) AS v FROM migrations').get()?.v)
    if (!Number.isInteger(version) || version < 1 || version > 8)
      throw new Error('Unsupported backup schema version')
    const counts: Record<string, number> = {}
    for (const table of [
      'projects',
      'conversations',
      'messages',
      'agents',
      'sessions',
      'tasks',
      'workspaces',
    ]) {
      counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)
      if (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE NOT json_valid(data)`).get()?.n)
        throw new Error(`Invalid ${table} payload in backup`)
    }
    if (version >= 4) {
      counts.attachments = Number(db.prepare('SELECT count(*) AS n FROM attachments').get()?.n)
      if (db.prepare('SELECT count(*) AS n FROM attachments WHERE NOT json_valid(data)').get()?.n)
        throw new Error('Invalid attachment metadata in backup')
    }
    if (version >= 8)
      for (const table of ['workflow_templates', 'workflow_runs']) {
        counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)
        if (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE NOT json_valid(data)`).get()?.n)
          throw new Error(`Invalid ${table} payload in backup`)
      }
    return { version, counts }
  } finally {
    db.close()
  }
}
export class BackupManager {
  private previews = new Map<string, string>()
  constructor(private directory: string) {}
  async preview(source: string) {
    const id = randomUUID()
    const path = join(this.directory, 'restore-previews', id + '.sqlite')
    await mkdir(join(this.directory, 'restore-previews'), { recursive: true })
    inspectBackup(source)
    const db = new DatabaseSync(source, { readOnly: true })
    try {
      await backup(db, path)
    } finally {
      db.close()
    }
    const report = inspectBackup(path)
    this.previews.set(id, path)
    return { id, ...report }
  }
  async apply(id: string, active: DatabaseSync) {
    const path = this.previews.get(id)
    if (!path) throw new Error('Restore preview expired')
    inspectBackup(path)
    const safety = join(this.directory, `before-restore-${Date.now()}.sqlite`)
    await backup(active, safety)
    await copyFile(
      await withinWorkspace(this.directory, path),
      join(this.directory, 'pending-restore.sqlite'),
    )
    await writeFile(
      join(this.directory, 'pending-restore.json'),
      JSON.stringify({ schema: 1, requestedAt: new Date().toISOString() }),
      { mode: 0o600 },
    )
    this.previews.delete(id)
    return { restartRequired: true, safetyBackup: safety }
  }
}
export async function applyPendingRestore(directory: string) {
  const marker = join(directory, 'pending-restore.json')
  if (!existsSync(marker)) return false
  const pending = await withinWorkspace(directory, join(directory, 'pending-restore.sqlite'))
  inspectBackup(pending)
  const safety = join(directory, 'restore-safety', String(Date.now()))
  await mkdir(safety, { recursive: true })
  // Fixed, verified files inside the profile only. Preserve the old WAL and SHM for recovery.
  for (const name of ['agenthub.sqlite', 'agenthub.sqlite-wal', 'agenthub.sqlite-shm']) {
    const path = join(directory, name)
    if (existsSync(path)) await rename(await withinWorkspace(directory, path), join(safety, name))
  }
  await copyFile(pending, join(directory, 'agenthub.sqlite'))
  await unlink(marker)
  await unlink(pending)
  await writeFile(
    join(safety, 'restore.json'),
    JSON.stringify({ appliedAt: new Date().toISOString(), previousDatabasePreserved: true }),
  )
  return true
}
