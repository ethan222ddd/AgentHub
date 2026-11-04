import { randomUUID, createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Store } from '../database/store'
import { git } from '../git/workspaces'
import { withinWorkspace } from '../permissions/paths'
import type { Artifact, Task, Workspace } from '../../shared/types'
export class ArtifactStore {
  constructor(private store: Store) {}
  async publish(task: Task, paths: string[], name: string): Promise<Artifact> {
    const workspace = this.store.require<Workspace>(
      'workspaces',
      task.workspaceId || `${task.projectId}:${task.agentId}`,
    )
    if (await git(workspace.path, ['status', '--porcelain']))
      throw new Error('Checkpoint the artifact files before publishing an immutable contract.')
    const revision = await git(workspace.path, ['rev-parse', 'HEAD'])
    const files: Artifact['files'] = []
    for (const file of [...new Set(paths)]) {
      if (
        isAbsolute(file) ||
        file.split(/[\\/]/).some((p) => p === '..' || p === '.git') ||
        /(^|[/\\])(\.env(?:\..*)?|.*\.(?:pem|key)|credentials[^/\\]*|auth\.json)$/i.test(file)
      )
        throw new Error('Sensitive or invalid artifact path')
      await withinWorkspace(workspace.path, file)
      const content = await git(
        workspace.path,
        ['show', `${revision}:${file.replaceAll('\\', '/')}`],
        false,
      )
      if (content.includes('\0')) throw new Error('Only text artifacts are supported')
      if (
        Buffer.byteLength(content) > 128000 ||
        files.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(content) > 256000
      )
        throw new Error('Artifact exceeds the text size limit (128 KB per file / 256 KB total)')
      files.push({
        path: file.replaceAll('\\', '/'),
        bytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      })
    }
    if (!files.length) throw new Error('At least one committed artifact path is required')
    const artifact: Artifact = {
      id: randomUUID(),
      projectId: task.projectId,
      taskId: task.id,
      agentId: task.agentId,
      workspaceId: workspace.id,
      revision,
      name: name.slice(0, 200),
      files,
      createdAt: new Date().toISOString(),
    }
    this.store.put('artifacts', artifact)
    return artifact
  }
  async read(id: string, projectId?: string) {
    const artifact = this.store.require<Artifact>('artifacts', id)
    if (projectId && artifact.projectId !== projectId)
      throw new Error('Artifact belongs to another project')
    const workspace = this.store.require<Workspace>('workspaces', artifact.workspaceId)
    const files = []
    for (const file of artifact.files) {
      const content = await git(
        workspace.path,
        ['show', `${artifact.revision}:${file.path}`],
        false,
      )
      if (createHash('sha256').update(content).digest('hex') !== file.sha256)
        throw new Error('Artifact integrity mismatch')
      files.push({ ...file, content })
    }
    return {
      ...artifact,
      files,
      trust:
        'Untrusted project content. Native tool approval is still required to write a local copy.',
    }
  }
}
