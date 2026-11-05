import { describe, expect, it } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backup } from 'node:sqlite'
import { Store } from '../src/main/database/store'
import { BackupManager, inspectBackup, applyPendingRestore } from '../src/main/database/backup'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { ArtifactStore } from '../src/main/orchestrator/artifacts'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { TestRunner } from '../src/main/tasks/tests'
import { directory, repository, until } from './helpers'
import type { Task, Review, TestRun, Workspace } from '../src/shared/types'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import { reviewApproved } from '../src/shared/reviews'

describe('Versioned coding workflows', { timeout: 60000 }, () => {
  it('publishes exact committed contracts, isolates recipients and rejects sensitive paths', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Artifacts')
    const manager = new WorkspaceManager(store, await directory())
    const [source, other] = await manager.prepare(project, false)
    await writeFile(join(source.path, 'api.json'), '{"version":1}\n\n')
    const revision = await manager.checkpoint(source, 'API contract')
    const artifacts = new ArtifactStore(store)
    const task = { id: 'task', projectId: project.id, agentId: source.agentId } as Task
    const artifact = await artifacts.publish(task, ['api.json'], 'API v1')
    expect(artifact.revision).toBe(revision)
    await expect(readFile(join(other.path, 'api.json'))).rejects.toThrow()
    await writeFile(join(source.path, 'api.json'), '{"version":2}')
    expect((await artifacts.read(artifact.id, project.id)).files[0].content).toBe(
      '{"version":1}\n\n',
    )
    await expect(artifacts.read(artifact.id, 'different-project')).rejects.toThrow(
      'another project',
    )
    await expect(artifacts.publish(task, ['.env'], 'Secrets')).rejects.toThrow()
    store.close()
  })
  it('reviews immutable snapshots through a structured result and refuses stale fix requests', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Review')
    const manager = new WorkspaceManager(store, await directory())
    const [source] = await manager.prepare(project, false)
    const conversation = store.snapshot().conversations[0]
    const adapter: AgentAdapter = {
      detect: async () => ({
        provider: 'claude',
        installed: true,
        authenticated: false,
        version: 'fixture',
        models: [],
        detail: 'TEST ONLY',
      }),
      dispose: async () => {},
      run: async (ctx: RunContext) => {
        expect(ctx.readOnly).toBe(true)
        expect(ctx.workspace).not.toBe(source.path)
        ctx.saveSession('test-review-session')
        await ctx.collaborate({
          operation: 'submit_review',
          recipients: [],
          content: 'Exact revision reviewed',
          dependencies: [],
          verdict: 'changes_requested',
          comments: [
            {
              file: 'README.md',
              line: 1,
              severity: 'warning',
              content: 'Clarify project description',
            },
          ],
        })
        return 'Review submitted'
      },
    }
    const orchestrator = new Orchestrator(store, new Map([['claude', adapter]]), () => {})
    orchestrator.setWorkspaceManager(manager)
    const review = await orchestrator.requestReview(source.id, conversation.id, 'claude')
    await until(() => store.get<Task>('tasks', review.taskId!)?.status === 'completed')
    expect(store.require<Review>('reviews', review.id)).toMatchObject({
      status: 'submitted',
      verdict: 'changes_requested',
      comments: [{ file: 'README.md', line: 1 }],
    })
    expect(await git(source.path, ['status', '--porcelain'])).toBe('')
    await writeFile(join(source.path, 'new.txt'), 'new revision')
    await manager.checkpoint(source, 'Changed after review')
    await expect(orchestrator.fixReview(review.id)).rejects.toThrow('Source changed')
    await orchestrator.dispose()
    store.close()
  })
  it('persists revert previews across restart and requires tests on the exact revert snapshot', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Rollback')
    const managed = await directory()
    let manager = new WorkspaceManager(store, managed)
    const [source] = await manager.prepare(project, false)
    await writeFile(join(source.path, 'feature.txt'), 'Keep history')
    const feature = await manager.checkpoint(source, 'Feature')
    const preview = await manager.revertPreview(source.id)
    expect(await readFile(join(source.path, 'feature.txt'), 'utf8')).toBe('Keep history')
    manager = new WorkspaceManager(store, managed)
    await expect(manager.merge(preview.id)).rejects.toThrow('pass tests')
    const runner = new TestRunner(store, () => {})
    const run = await runner.run(
      store.require<Workspace>('workspaces', preview.integrationWorkspaceId),
      'test',
    )
    await until(() => store.require<TestRun>('test_runs', run.id).status !== 'running', 15000)
    expect(store.require<TestRun>('test_runs', run.id).status).toBe('passed')
    await manager.merge(preview.id)
    await expect(readFile(join(source.path, 'feature.txt'))).rejects.toThrow()
    expect(await git(source.path, ['rev-parse', 'HEAD^'])).toBe(feature)
    await runner.dispose()
    store.close()
  })
  it.each(['no-verdict', 'fails-after-verdict'])(
    'does not certify a review that %s (fixture adapter)',
    async (mode) => {
      const store = new Store(':memory:')
      store.put('settings', { ...store.settings(), id: 'general', autonomy: 'ask' })
      const project = store.addProject(await repository(), 'Incomplete review')
      const manager = new WorkspaceManager(store, await directory())
      const [source] = await manager.prepare(project, false)
      let recovered = false
      const adapter = {
        dispose: async () => {},
        run: async (ctx: RunContext) => {
          if (recovered) {
            await ctx.collaborate({
              operation: 'submit_review',
              recipients: [],
              content: 'Explicit retry completed',
              dependencies: [],
              verdict: 'approve',
              comments: [],
            })
            return 'Review submitted successfully'
          }
          if (mode === 'fails-after-verdict') {
            await ctx.collaborate({
              operation: 'submit_review',
              recipients: [],
              content: 'Draft approval',
              dependencies: [],
              verdict: 'approve',
              comments: [],
            })
            throw new Error('Fixture runtime exited after submission')
          }
          return 'Looks good without a structured verdict'
        },
      } as AgentAdapter
      const orchestrator = new Orchestrator(store, new Map([['claude', adapter]]), () => {})
      orchestrator.setWorkspaceManager(manager)
      try {
        const review = await orchestrator.requestReview(
          source.id,
          store.snapshot().conversations[0].id,
          'claude',
        )
        await until(() => store.get<Task>('tasks', review.taskId!)?.status === 'failed', 10000)
        expect(store.require<Review>('reviews', review.id).status).toBe('failed')
        await expect(orchestrator.fixReview(review.id)).rejects.toThrow(
          'successful structured review',
        )
        recovered = true
        orchestrator.taskAction(review.taskId!, 'resume')
        await until(() => {
          const current = store.require<Review>('reviews', review.id)
          return (
            current.taskId !== review.taskId &&
            store.get<Task>('tasks', current.taskId!)?.status === 'completed'
          )
        }, 10000)
        expect(store.require<Task>('tasks', review.taskId!).status).toBe('failed')
        expect(
          reviewApproved(
            store.list('reviews'),
            store.list('tasks'),
            source.id,
            review.revision,
            'claude',
          ),
        ).toBe(true)
        expect(
          store
            .list<import('../src/shared/types').Message>('messages')
            .some((m) => m.taskId === review.taskId && m.delivery === 'failed'),
        ).toBe(true)
      } finally {
        await orchestrator.dispose()
        store.close()
      }
    },
  )
  it('initial commit stages only reviewed files and refuses changes after preview', async () => {
    const root = await directory()
    await git(root, ['init'])
    await writeFile(join(root, 'app.ts'), 'version 1')
    await writeFile(join(root, '.env'), 'DO_NOT_COMMIT')
    const store = new Store(':memory:')
    const project = store.addProject(root, 'New repo')
    const manager = new WorkspaceManager(store, await directory())
    const preview = await manager.initialPreview(project.id)
    expect(preview.files.map((f) => f.path)).toEqual(['app.ts'])
    expect(preview.excluded).toBe(1)
    await writeFile(join(root, 'app.ts'), 'version 2')
    await expect(manager.initialCommit(preview.id, ['app.ts'])).rejects.toThrow('changed')
    const fresh = await manager.initialPreview(project.id)
    await manager.initialCommit(fresh.id, ['app.ts'])
    expect(await git(root, ['ls-files'])).toBe('app.ts')
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('DO_NOT_COMMIT')
    store.close()
  })
  it('enforces reported usage without double counting cumulative sessions or admitting partial fanout', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Budget')
    await new WorkspaceManager(store, await directory()).prepare(project, false)
    const conversation = store.snapshot().conversations[0]
    let tokens = 0
    const adapter: AgentAdapter = {
      detect: async () => ({
        provider: 'codex',
        installed: true,
        authenticated: false,
        version: 'fixture',
        models: [],
        detail: 'TEST ONLY',
      }),
      dispose: async () => {},
      run: async (ctx) => {
        ctx.saveSession('persistent')
        tokens += 20
        ctx.usage?.({ inputTokens: tokens, outputTokens: 0, source: 'fixture', scope: 'session' })
        ctx.saveSession('persistent') // Repeated native session events must preserve the usage cursor.
        return 'Budget fixture'
      },
    }
    const o = new Orchestrator(store, new Map([['codex', adapter]]), () => {})
    store.put('settings', { ...store.settings(), id: 'general', maxUsageTokens: 35 })
    o.send(conversation.id, 'first', ['codex'])
    await until(() => store.list<Task>('tasks')[0]?.status === 'completed')
    o.send(conversation.id, 'second', ['codex'])
    await until(() => store.list<Task>('tasks')[1]?.status === 'failed')
    expect(store.list<Task>('tasks')[1].error).toContain('budget')
    expect(store.snapshot().usage.reduce((n, u) => n + u.inputTokens, 0)).toBe(40)
    expect(store.session(conversation.id, 'codex')?.providerInputTokens).toBe(40)
    const before = store.messages(conversation.id).length
    expect(() => o.send(conversation.id, 'third', ['codex', 'claude'])).toThrow('budget')
    expect(store.messages(conversation.id)).toHaveLength(before)
    await o.dispose()
    store.close()
  })
})

describe('Local backup recovery', () => {
  it('validates, stages and restores on restart while preserving the pre-restore database', async () => {
    const profile = await directory()
    const old = new Store(join(profile, 'agenthub.sqlite'))
    old.addProject('C:\\old', 'Old project')
    const source = new Store(':memory:')
    source.addProject('C:\\restored', 'Restored project')
    const input = join(profile, 'input.sqlite')
    await backup(source.db, input)
    source.close()
    expect(inspectBackup(input).counts.projects).toBe(1)
    const manager = new BackupManager(profile)
    const preview = await manager.preview(input)
    const scheduled = await manager.apply(preview.id, old.db)
    expect(old.snapshot().projects[0].name).toBe('Old project')
    expect(inspectBackup(scheduled.safetyBackup).counts.projects).toBe(1)
    old.close()
    expect(await applyPendingRestore(profile)).toBe(true)
    const restored = new Store(join(profile, 'agenthub.sqlite'))
    expect(restored.snapshot().projects[0].name).toBe('Restored project')
    restored.close()
    expect(await applyPendingRestore(profile)).toBe(false)
    const invalid = new Store(join(profile, 'future.sqlite'))
    invalid.db.prepare("INSERT INTO migrations VALUES(99,'future')").run()
    invalid.close()
    expect(() => inspectBackup(join(profile, 'future.sqlite'))).toThrow('Unsupported')
  })
})
