import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type {
  AgentProfile,
  FileOverlap,
  Message,
  Project,
  ProjectOverlaps,
  Task,
  Workspace,
} from '../../shared/types'
import { trace, traceError } from '../app/diagnostics'
import { Store } from '../database/store'
import { git } from './workspaces'

export interface WorkspaceChanges {
  workspaceId: string
  agentId: string
  files: Map<string, boolean>
}

/** Paths from `git status --porcelain=v1 -z`; a rename contributes its new path. */
export function parsePorcelain(output: string): string[] {
  const entries = output.split('\0')
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return paths
}

/**
 * Files an agent has changed but not yet integrated: commits since the last primary revision the
 * workspace was synced to (or the merge base), plus anything uncommitted. Read-only Git only.
 */
export async function workspaceChanges(
  project: Project,
  workspace: Workspace,
): Promise<WorkspaceChanges> {
  const files = new Map<string, boolean>()
  let base = ''
  if (workspace.syncedHead)
    base = await git(workspace.path, ['merge-base', '--is-ancestor', workspace.syncedHead, 'HEAD'])
      .then(() => workspace.syncedHead!)
      .catch(() => '')
  if (!base) {
    const primary = await git(project.path, ['rev-parse', 'HEAD']).catch(() => '')
    if (primary) base = await git(workspace.path, ['merge-base', 'HEAD', primary]).catch(() => '')
  }
  if (base)
    for (const path of (
      await git(workspace.path, ['diff', '--name-only', '-z', base, 'HEAD'], false)
    )
      .split('\0')
      .filter(Boolean))
      files.set(path, false)
  for (const path of parsePorcelain(
    await git(workspace.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], false),
  ))
    files.set(path, true)
  return { workspaceId: workspace.id, agentId: workspace.agentId, files }
}

export function findOverlaps(changes: WorkspaceChanges[]): FileOverlap[] {
  const byPath = new Map<string, FileOverlap['agents']>()
  for (const change of changes)
    for (const [path, uncommitted] of change.files) {
      const list = byPath.get(path) || []
      if (!list.some((a) => a.agentId === change.agentId))
        list.push({ agentId: change.agentId, workspaceId: change.workspaceId, uncommitted })
      byPath.set(path, list)
    }
  return [...byPath]
    .filter(([, agents]) => agents.length > 1)
    .map(([path, agents]) => ({ path, agents }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Watches agent worktrees for files that two agents are changing at once, so the user hears
 * about a likely merge conflict while there is still time to sequence the work.
 */
export class OverlapMonitor {
  private results = new Map<string, ProjectOverlaps>()
  private reported = new Map<string, Set<string>>()
  private signatures = new Map<string, string>()
  private timers = new Map<string, NodeJS.Timeout>()
  private scanning = new Map<string, Promise<ProjectOverlaps>>()
  private interval?: NodeJS.Timeout
  private closed = false

  constructor(
    private store: Store,
    private changed: () => void,
  ) {}

  start(intervalMs = 30000): void {
    this.interval = setInterval(() => {
      for (const project of this.store.list<Project>('projects'))
        if (
          this.store
            .list<Task>('tasks')
            .some((t) => t.projectId === project.id && t.status === 'running')
        )
          this.schedule(project.id, 0)
    }, intervalMs)
    this.interval.unref?.()
  }

  /** Call on host 'changed' events: rescans a project when its tasks start or finish. */
  observe(): void {
    if (this.closed) return
    const byProject = new Map<string, string[]>()
    for (const t of this.store.list<Task>('tasks'))
      (byProject.get(t.projectId) || byProject.set(t.projectId, []).get(t.projectId)!).push(
        `${t.id}:${t.status}`,
      )
    for (const [projectId, parts] of byProject) {
      const signature = parts.join('|')
      if (this.signatures.get(projectId) === signature) continue
      this.signatures.set(projectId, signature)
      this.schedule(projectId)
    }
  }

  schedule(projectId: string, delay = 1500): void {
    if (this.closed) return
    clearTimeout(this.timers.get(projectId))
    const timer = setTimeout(() => {
      this.timers.delete(projectId)
      void this.scan(projectId).catch(() => {})
    }, delay)
    timer.unref?.()
    this.timers.set(projectId, timer)
  }

  all(): Record<string, ProjectOverlaps> {
    return Object.fromEntries(this.results)
  }

  scan(projectId: string): Promise<ProjectOverlaps> {
    const inFlight = this.scanning.get(projectId)
    if (inFlight) return inFlight
    const run = this.inspect(projectId).finally(() => this.scanning.delete(projectId))
    this.scanning.set(projectId, run)
    return run
  }

  private async inspect(projectId: string): Promise<ProjectOverlaps> {
    const project = this.store.get<Project>('projects', projectId)
    if (!project) {
      this.results.delete(projectId)
      return { files: [], scannedAt: new Date().toISOString(), skipped: 0 }
    }
    const workspaces = this.store
      .list<Workspace>('workspaces')
      .filter(
        (w) => w.projectId === projectId && (!w.kind || w.kind === 'agent') && w.agentId !== 'user',
      )
    let skipped = 0
    const changes: WorkspaceChanges[] = []
    for (const workspace of workspaces) {
      if (!existsSync(workspace.path)) {
        skipped++
        continue
      }
      try {
        changes.push(await workspaceChanges(project, workspace))
      } catch (error) {
        skipped++
        trace('overlaps.skipped', { workspaceId: workspace.id, ...traceError(error) })
      }
    }
    const result: ProjectOverlaps = {
      files: findOverlaps(changes),
      scannedAt: new Date().toISOString(),
      skipped,
    }
    const previous = JSON.stringify(this.results.get(projectId)?.files || [])
    this.results.set(projectId, result)
    this.announce(project, result.files)
    if (previous !== JSON.stringify(result.files)) this.changed()
    return result
  }

  /** One system message per newly overlapping path set, in the rooms where those agents work. */
  private announce(project: Project, files: FileOverlap[]): void {
    const seen = this.reported.get(project.id) || new Set<string>()
    const current = new Set(files.map((f) => `${f.path}:${f.agents.map((a) => a.agentId).sort()}`))
    const fresh = files.filter(
      (f) => !seen.has(`${f.path}:${f.agents.map((a) => a.agentId).sort()}`),
    )
    this.reported.set(project.id, current)
    if (!fresh.length) return
    const agents = this.store.list<AgentProfile>('agents')
    const name = (id: string) => agents.find((a) => a.id === id)?.name || id
    const involved = new Set(fresh.flatMap((f) => f.agents.map((a) => a.agentId)))
    const rooms = new Map<string, Task>()
    for (const task of this.store.list<Task>('tasks'))
      if (task.projectId === project.id && involved.has(task.agentId))
        rooms.set(task.conversationId, task)
    const lines = fresh
      .slice(0, 5)
      .map(
        (f) =>
          `- ${f.path}：${f.agents.map((a) => `${name(a.agentId)}${a.uncommitted ? '（未提交）' : ''}`).join('、')}`,
      )
    const content = [
      `可能的合併衝突：${fresh.length} 個檔案同時被多位代理修改，整合時可能衝突。建議先整合其中一方，再讓另一位代理同步後繼續。`,
      ...lines,
      fresh.length > 5 ? `…另有 ${fresh.length - 5} 個檔案，請到「任務」查看。` : '',
      'Possible merge conflict: several agents are changing the same files.',
    ]
      .filter(Boolean)
      .join('\n')
    for (const [conversationId, task] of rooms)
      this.store.put('messages', {
        id: randomUUID(),
        projectId: project.id,
        conversationId,
        senderId: 'system',
        recipientIds: ['user'],
        content,
        type: 'system',
        timestamp: new Date().toISOString(),
        taskId: task.id,
        correlationId: task.correlationId,
        delivery: 'completed',
      } satisfies Message)
  }

  dispose(): void {
    this.closed = true
    clearInterval(this.interval)
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
