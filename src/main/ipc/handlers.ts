import { app, dialog, shell, clipboard, type BrowserWindow } from 'electron'
import sharp from 'sharp'
import { backup } from 'node:sqlite'
import { basename, join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { requestSchema } from '../../shared/schemas'
import type { AgentProfile, Conversation, Project, Workspace } from '../../shared/types'
import { Store } from '../database/store'
import { Orchestrator } from '../orchestrator/orchestrator'
import { WorkspaceManager } from '../git/workspaces'
import { Credentials } from '../app/credentials'
import { validateRoot } from '../permissions/paths'
import { AttachmentStore } from '../attachments/store'
import { TestRunner } from '../tasks/tests'
import { trace, diagnosticsPath } from '../app/diagnostics'
import { BackupManager } from '../database/backup'
import { ArtifactStore } from '../orchestrator/artifacts'
import { ContextMemory } from '../orchestrator/context'
import { deleteDecision, saveDecision } from '../orchestrator/decisions'
import type { Review } from '../../shared/types'
import { git } from '../git/workspaces'
import { QuotaService } from '../agents/quota-service'
import { processSupervisor } from '../agents/process-owner'
import type { DesktopNotifications } from '../app/notifications'
import type { WorkflowService } from '../workflows/service'
import type { OverlapMonitor } from '../git/overlaps'

export function makeHandler(
  store: Store,
  orchestrator: Orchestrator,
  workspaces: WorkspaceManager,
  credentials: Credentials,
  tests: TestRunner,
  window: () => BrowserWindow,
  notifications?: DesktopNotifications,
  workflows?: WorkflowService,
  overlaps?: OverlapMonitor,
) {
  const backups = new BackupManager(app.getPath('userData'))
  const quotas = new QuotaService(orchestrator.adapters)
  const attachments = new AttachmentStore(store, async (data) => {
    const image = sharp(data, { limitInputPixels: 8_000_000, failOn: 'error', animated: false })
    const meta = await image.metadata()
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages || 1) > 1
    )
      throw new Error('Unsupported image dimensions or animation')
    const thumbnail = await image
      .rotate()
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()
    return 'data:image/jpeg;base64,' + thumbnail.toString('base64')
  })
  const idle = (projectId: string) => {
    if (
      orchestrator.isBusy(projectId) ||
      orchestrator.workflowBusy(projectId) ||
      tests.busy(projectId)
    )
      throw new Error('Stop all project tasks/tests before changing workspaces or Git history.')
  }
  let closing = false
  const pending = new Set<Promise<unknown>>()
  const handle = async (raw: unknown): Promise<unknown> => {
    if (closing) throw new Error('Application is shutting down')
    const request = requestSchema.parse(raw)
    switch (request.op) {
      case 'workflow.save':
        if (!workflows) throw new Error('Workflow service unavailable')
        workflows.save(request.template)
        return null
      case 'decision.save':
        return saveDecision(store, request.projectId, request)
      case 'decision.delete':
        deleteDecision(store, request.projectId, request.id)
        break
      case 'workflow.delete':
        if (!workflows) throw new Error('Workflow service unavailable')
        workflows.delete(request.id)
        return null
      case 'workflow.start':
        if (!workflows) throw new Error('Workflow service unavailable')
        if (
          tests.busy(store.require<Conversation>('conversations', request.conversationId).projectId)
        )
          throw new Error('Wait for project tests to finish')
        return workflows.start(
          request.templateId,
          request.conversationId,
          request.requirement,
          request.bindings,
        )
      case 'workflow.action':
        if (!workflows) throw new Error('Workflow service unavailable')
        return workflows.action(request.id, request.action)
      case 'notifications.ready':
        notifications?.rendererReady()
        return null
      case 'notifications.read':
        store.require<Conversation>('conversations', request.conversationId)
        notifications?.markRead(request.conversationId)
        return null
      case 'notifications.test':
        if (request.conversationId)
          store.require<Conversation>('conversations', request.conversationId)
        notifications?.test(request.conversationId)
        return null
      case 'processes.inspect':
        return processSupervisor.inspect()
      case 'snapshot':
        return {
          ...store.snapshot(),
          diagnosticsPath: diagnosticsPath(),
          overlaps: overlaps?.all() || {},
        }
      case 'overlaps.scan':
        store.require<Project>('projects', request.projectId)
        if (!overlaps) throw new Error('Overlap monitor unavailable')
        return overlaps.scan(request.projectId)
      case 'docs.guide': {
        const path = app.isPackaged
          ? join(process.resourcesPath, 'docs', 'USER_GUIDE.html')
          : resolve('docs/USER_GUIDE.html')
        const error = await shell.openPath(path)
        if (error)
          throw new Error(
            '無法開啟離線手冊。請確認安裝包含 docs/USER_GUIDE.html，或從發行目錄直接開啟手冊。',
          )
        return null
      }
      case 'quotas.read':
        return Promise.all(
          [...new Set(request.agentIds)].map((id) => {
            const agent = store.require<AgentProfile>('agents', id)
            if (!agent.enabled) throw new Error('Agent is not enabled')
            return quotas.read(agent, request.refresh)
          }),
        )
      case 'project.pick': {
        const result = await dialog.showOpenDialog(window(), {
          properties: ['openDirectory'],
          title: '選擇 AgentHub 專案資料夾',
          defaultPath: store.settings().defaultProjectDirectory || undefined,
        })
        if (result.canceled) return null
        const path = await validateRoot(result.filePaths[0])
        const project = store.addProject(path, basename(path))
        store.put('projects', { ...project, autoManaged: true })
        try {
          await orchestrator.automatic?.prepare(project)
        } catch {
          /* setup attention is persisted and visible */
        }
        orchestrator.changed()
        return store.require<Project>('projects', project.id)
      }
      case 'project.rename': {
        const p = store.require<Project>('projects', request.id)
        store.put('projects', { ...p, name: request.name })
        break
      }
      case 'project.remove': {
        idle(request.id)
        // Only remove sidebar/history links; never delete a user's project or worktree files.
        store.remove('projects', request.id)
        break
      }
      case 'project.open':
        return shell.openPath(store.require<Project>('projects', request.id).path)
      case 'project.team': {
        idle(request.id)
        const project = store.require<Project>('projects', request.id)
        for (const id of request.agentIds) store.require('agents', id)
        store.put('projects', {
          ...project,
          agentIds: request.agentIds,
          agentOverrides: request.overrides,
        })
        break
      }
      case 'conversation.create': {
        const c = store.createConversation(request.projectId)
        orchestrator.changed()
        return c
      }
      case 'conversation.runtime': {
        const c = store.require<Conversation>('conversations', request.conversationId)
        const project = store.require<Project>('projects', c.projectId)
        const agent = store.require<AgentProfile>('agents', request.agentId)
        if (!agent.enabled || (project.agentIds && !project.agentIds.includes(agent.id)))
          throw new Error('Agent is not enabled in this team')
        store.put('conversations', {
          ...c,
          runtimeOverrides: {
            ...c.runtimeOverrides,
            [agent.id]: { model: request.model.trim(), reasoningEffort: request.reasoningEffort },
          },
        })
        break
      }
      case 'conversation.configure': {
        const c = store.require<Conversation>('conversations', request.id)
        idle(c.projectId)
        if (request.mode === 'supervisor') {
          const a = store.require<AgentProfile>('agents', request.supervisorId)
          if (!a.enabled) throw new Error('Supervisor must be enabled.')
        }
        store.put('conversations', { ...c, mode: request.mode, supervisorId: request.supervisorId })
        break
      }
      case 'messages':
        return {
          pinnedIds: new ContextMemory(store.db).pins(request.conversationId),
          ...store.page(request.conversationId, request.search, request.before),
          activities: store
            .list<import('../../shared/types').Activity>('activities')
            .filter((a) => a.conversationId === request.conversationId)
            .slice(-200),
        }
      case 'send': {
        trace('routing.received', {
          conversationId: request.conversationId,
          recipients: request.recipients,
          characters: request.content.length,
        })
        const c = store.require<Conversation>('conversations', request.conversationId)
        if (tests.busy(c.projectId) && request.recipients.length)
          throw new Error('Wait for snapshot tests to finish before starting agents.')
        return orchestrator.send(
          request.conversationId,
          request.content,
          request.recipients,
          request.replyTo,
          request.attachmentIds,
          request.planFirst,
        )
      }
      case 'task.plan':
        return orchestrator.planAction(
          request.id,
          request.action,
          request.content,
          request.feedback,
        )
      case 'stop':
        orchestrator.stop(request.conversationId)
        return null
      case 'resume':
        orchestrator.resume(request.conversationId)
        return null
      case 'task.action':
        orchestrator.taskAction(request.id, request.action)
        return null
      case 'task.integrate':
        return orchestrator.retryIntegration(request.id)
      case 'project.operations':
        store.require<Project>('projects', request.projectId)
        return store.db
          .prepare(
            'SELECT data FROM workspace_operations WHERE project_id=? ORDER BY rowid DESC LIMIT 100',
          )
          .all(request.projectId)
          .map((row) => JSON.parse(String(row.data)))
      case 'project.inspect': {
        const project = store.require<Project>('projects', request.projectId)
        return workspaces.diff({
          id: `project:${project.id}`,
          projectId: project.id,
          agentId: 'user',
          path: project.path,
          branch: await git(project.path, ['symbolic-ref', '--short', 'HEAD']),
        })
      }
      case 'project.checkpoint': {
        idle(request.projectId)
        if (!orchestrator.automatic) throw new Error('Automatic project manager unavailable')
        return orchestrator.automatic.savePrimary(store.require('projects', request.projectId))
      }
      case 'project.automation': {
        idle(request.projectId)
        const project = store.require<Project>('projects', request.projectId)
        store.put('projects', { ...project, autoManaged: request.enabled })
        break
      }
      case 'task.create':
        return orchestrator.createTask(
          request.conversationId,
          request.agentId,
          request.description,
          request.dependencies,
        )
      case 'task.reassign':
        orchestrator.reassign(request.id, request.agentId)
        return null
      case 'approve':
        orchestrator.resolveApproval(request.id, request.allow, request.remember)
        return null
      case 'permissions.clear':
        for (const permission of store.list<{ id: string }>('permissions'))
          store.remove('permissions', permission.id)
        return null
      case 'context.pin':
        new ContextMemory(store.db).pin(request.messageId, request.enabled)
        orchestrator.changed()
        return null
      case 'context.receipts':
        store.require<Conversation>('conversations', request.conversationId)
        return store.db
          .prepare(
            'SELECT data FROM context_receipts WHERE conversation_id=? ORDER BY rowid DESC LIMIT 12',
          )
          .all(request.conversationId)
          .map((row) => JSON.parse(String(row.data)))
      case 'context.read':
        store.require<Conversation>('conversations', request.conversationId)
        return new ContextMemory(store.db).read(request.conversationId, request.messageIds)
      case 'agents.detect':
        return Promise.all(
          store.list<AgentProfile>('agents').map(async (profile) => {
            const adapter = orchestrator.adapters.get(profile.provider)
            if (!adapter)
              return {
                agentId: profile.id,
                provider: profile.provider,
                installed: false,
                authenticated: false,
                version: '',
                models: [],
                detail: 'No runtime adapter registered',
              }
            return { ...(await adapter.detect(profile)), agentId: profile.id }
          }),
        )
      case 'agent.save': {
        if (store.snapshot().projects.some((p) => orchestrator.isBusy(p.id)))
          throw new Error('Stop tasks before editing the agent registry.')
        const old = store.get<AgentProfile>('agents', request.agent.id)
        if (old && old.provider !== request.agent.provider)
          throw new Error('Provider of an existing agent cannot change; add another instance.')
        store.put('agents', request.agent)
        break
      }
      case 'settings.save':
        store.put('settings', { ...request.settings, id: 'general' })
        break
      case 'credential.save':
        credentials.save(request.value)
        return null
      case 'workspace.prepare': {
        idle(request.projectId)
        const value = await workspaces.prepare(
          store.require<Project>('projects', request.projectId),
          request.initialize,
        )
        orchestrator.changed()
        return value
      }
      case 'git.initial.preview':
        idle(request.projectId)
        return workspaces.initialPreview(request.projectId)
      case 'git.initial.commit': {
        const value = await workspaces.initialCommit(request.previewId, request.files)
        orchestrator.changed()
        return value
      }
      case 'git.ignore':
        idle(request.projectId)
        await workspaces.addDefaultIgnore(request.projectId)
        return null
      case 'git.diff':
        return workspaces.diff(store.require<Workspace>('workspaces', request.workspaceId))
      case 'git.checkpoint': {
        const w = store.require<Workspace>('workspaces', request.workspaceId)
        idle(w.projectId)
        return workspaces.checkpoint(w, request.message)
      }
      case 'git.preview': {
        const w = store.require<Workspace>('workspaces', request.workspaceId)
        idle(w.projectId)
        const preview = await workspaces.preview(w, request.direction)
        orchestrator.changed()
        return preview
      }
      case 'git.merge': {
        if (store.snapshot().projects.some((p) => orchestrator.isBusy(p.id) || tests.busy(p.id)))
          throw new Error('Stop tasks/tests before merge.')
        return workspaces.merge(request.previewId)
      }
      case 'git.revert.preview': {
        const w = store.require<Workspace>('workspaces', request.workspaceId)
        idle(w.projectId)
        const preview = await workspaces.revertPreview(w.id)
        orchestrator.changed()
        return preview
      }
      case 'git.project.revert.preview': {
        idle(request.projectId)
        const preview = await workspaces.revertProject(request.projectId)
        orchestrator.changed()
        return preview
      }
      case 'git.preview.discard': {
        if (store.snapshot().projects.some((p) => orchestrator.isBusy(p.id) || tests.busy(p.id)))
          throw new Error('Stop tasks and tests before discarding snapshots')
        await workspaces.discard(request.previewId)
        orchestrator.changed()
        return null
      }
      case 'maintenance.cleanup': {
        if (store.snapshot().projects.some((p) => orchestrator.isBusy(p.id) || tests.busy(p.id)))
          throw new Error('Stop tasks and tests before cleanup')
        const result = await workspaces.cleanup()
        orchestrator.changed()
        return { ...result, removedDraftAttachments: attachments.cleanupDrafts() }
      }
      case 'test.run': {
        const w = store.require<Workspace>('workspaces', request.workspaceId)
        idle(w.projectId)
        return tests.run(w, request.script)
      }
      case 'test.cancel':
        await tests.cancel(request.id)
        return null
      case 'review.request': {
        const w = store.require<Workspace>('workspaces', request.workspaceId)
        idle(w.projectId)
        return orchestrator.requestReview(w.id, request.conversationId, request.reviewerId)
      }
      case 'review.resolve': {
        const review = store.require<Review>('reviews', request.reviewId)
        store.put('reviews', {
          ...review,
          comments: review.comments.map((c) =>
            c.id === request.commentId ? { ...c, resolved: request.resolved } : c,
          ),
        })
        break
      }
      case 'review.fix':
        return orchestrator.fixReview(request.reviewId)
      case 'review.context': {
        const review = store.require<Review>('reviews', request.reviewId)
        const comment = review.comments.find((c) => c.id === request.commentId)
        if (!comment) throw new Error('Review comment no longer exists')
        const source = store.require<Workspace>('workspaces', review.sourceWorkspaceId)
        const lines = (
          await git(
            source.path,
            ['show', `${review.revision}:${comment.file.replaceAll('\\', '/')}`],
            false,
          )
        ).split('\n')
        const start = Math.max(0, comment.line - 6)
        return lines
          .slice(start, comment.line + 5)
          .map((line, index) => `${start + index + 1}  ${line}`)
          .join('\n')
      }
      case 'artifact.read':
        return new ArtifactStore(store).read(request.id)
      case 'export': {
        const c = store.require<Conversation>('conversations', request.conversationId)
        const messages = store
          .list<import('../../shared/types').Message>('messages')
          .filter((m) => m.conversationId === c.id)
        const result = await dialog.showSaveDialog(window(), {
          defaultPath: `AgentHub-${c.id}.${request.format === 'json' ? 'json' : 'md'}`,
        })
        if (result.canceled || !result.filePath) return null
        const metas = [
          ...new Map(messages.flatMap((m) => m.attachments || []).map((a) => [a.id, a])).values(),
        ]
        if (metas.reduce((total, a) => total + a.bytes, 0) > 32 * 1024 * 1024)
          throw new Error(
            'Attachment export exceeds 32 MiB. Use SQLite Backup for the complete history including images.',
          )
        const binary = metas.map((a) => attachments.get(a.id, c.projectId))
        const content =
          request.format === 'json'
            ? JSON.stringify(
                {
                  schemaVersion: 1,
                  conversation: c,
                  messages,
                  attachments: binary.map(({ meta, data }) => ({
                    ...meta,
                    data: data.toString('base64'),
                  })),
                },
                null,
                2,
              )
            : `# ${c.name}\n\n` +
              messages
                .map(
                  (m) =>
                    `## ${m.senderId} · ${m.timestamp}\n\n${m.content}\n` +
                    (m.attachments || [])
                      .map((a) => {
                        const item = binary.find((b) => b.meta.id === a.id)!
                        return a.kind === 'image'
                          ? `\n![${a.name.replace(/[[\]\r\n]/g, '')}](data:${a.mime};base64,${item.data.toString('base64')})\n`
                          : `\nAttachment: ${a.name} · SHA-256 ${a.sha256}\n`
                      })
                      .join(''),
                )
                .join('\n')
        await writeFile(result.filePath, content, 'utf8')
        return result.filePath
      }
      case 'backup': {
        const result = await dialog.showSaveDialog(window(), {
          defaultPath: join(app.getPath('documents'), 'AgentHub-backup.sqlite'),
        })
        if (result.canceled || !result.filePath) return null
        if (result.filePath === store.path)
          throw new Error('Backup destination must differ from the active database')
        await backup(store.db, result.filePath)
        return result.filePath
      }
      case 'restore.preview': {
        const result = await dialog.showOpenDialog(window(), {
          properties: ['openFile'],
          filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }],
        })
        return result.canceled ? null : backups.preview(result.filePaths[0])
      }
      case 'restore.apply': {
        if (store.snapshot().projects.some((p) => orchestrator.isBusy(p.id) || tests.busy(p.id)))
          throw new Error('Stop all tasks and tests before restoring data')
        const result = await backups.apply(request.previewId, store.db)
        return result
      }
      case 'history.clear': {
        const c = store.require<Conversation>('conversations', request.conversationId)
        idle(c.projectId)
        store.clearConversation(c.id)
        break
      }
      case 'docs.open': {
        const urls = {
          codex: 'https://developers.openai.com/codex/cli/',
          claude: 'https://code.claude.com/docs/en/authentication',
          antigravity: 'https://antigravity.google/docs/getting-started/',
        }
        await shell.openExternal(urls[request.provider])
        return null
      }
      case 'attachment.pick':
      case 'attachment.read': {
        const project = store.require<Project>('projects', request.projectId)
        const result =
          request.op === 'attachment.read'
            ? { canceled: false, filePaths: request.paths }
            : await dialog.showOpenDialog(window(), {
                defaultPath: project.path,
                properties: ['openFile', 'multiSelections'],
              })
        if (result.canceled) return []
        return attachments.importFiles(project.id, result.filePaths.slice(0, 8))
      }
      case 'attachment.get': {
        const { meta, data } = attachments.get(request.id)
        return {
          ...meta,
          ...(meta.kind === 'image'
            ? { dataUrl: `data:${meta.mime};base64,${data.toString('base64')}` }
            : { content: data.toString('utf8') }),
        }
      }
      case 'attachment.discard':
        return { deleted: attachments.discard(request.id) }
      case 'attachment.clipboard': {
        for (const item of await clipboard.read()) {
          const mime = item.types.find((type) =>
            ['image/png', 'image/jpeg', 'image/webp'].includes(type),
          )
          if (!mime) continue
          const blob = await item.getType(mime)
          if (!('size' in blob) || blob.size > 5 * 1024 * 1024)
            throw new Error('Clipboard image exceeds 5 MiB')
          return attachments.importImage(
            request.projectId,
            `clipboard.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`,
            Buffer.from(await blob.arrayBuffer()),
          )
        }
        throw new Error('Clipboard does not contain a supported image')
      }
    }
    orchestrator.changed()
    return null
  }
  const invoke = (raw: unknown) => {
    if (closing) return Promise.reject(new Error('Application is shutting down'))
    const request = handle(raw)
    pending.add(request)
    void request.then(
      () => pending.delete(request),
      () => pending.delete(request),
    )
    return request
  }
  return Object.assign(invoke, {
    dispose: async () => {
      closing = true
      await quotas.dispose()
      await Promise.allSettled([...pending])
    },
  })
}
