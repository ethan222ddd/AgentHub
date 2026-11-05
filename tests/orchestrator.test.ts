import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/database/store'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { WorkspaceManager } from '../src/main/git/workspaces'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { AppEvent, Conversation, Task } from '../src/shared/types'
import { directory, repository, until } from './helpers'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
class FixtureAdapter implements AgentAdapter {
  active = 0
  peak = 0
  calls: string[] = []
  constructor(private action?: (ctx: RunContext) => Promise<void>) {}
  async detect() {
    return {
      provider: 'codex' as const,
      installed: true,
      authenticated: false,
      detail: 'TEST FIXTURE ONLY',
      version: '',
      models: [],
    }
  }
  async run(ctx: RunContext) {
    this.active++
    this.peak = Math.max(this.peak, this.active)
    this.calls.push(ctx.agent.id)
    try {
      ctx.saveSession(`fixture-${ctx.agent.id}`)
      await this.action?.(ctx)
      await new Promise((resolve) => setTimeout(resolve, 40))
      ctx.delta('fixture result')
      return 'fixture result'
    } finally {
      this.active--
    }
  }
  async dispose() {}
}
async function setup(adapter: AgentAdapter, events: AppEvent[] = []) {
  const store = new Store(':memory:')
  store.put('settings', { ...store.settings(), id: 'general', autonomy: 'ask' })
  const p = store.addProject(await repository(), 'Repo')
  const c = store.snapshot().conversations[0]
  const manager = new WorkspaceManager(store, await directory('orchestrator-'))
  await manager.prepare(p, false)
  const o = new Orchestrator(
    store,
    new Map([
      ['codex', adapter],
      ['claude', adapter],
      ['antigravity', adapter],
    ]),
    (e) => events.push(e),
  )
  return { store, c, o }
}
describe('Orchestrator — test adapters, no paid API required', () => {
  it('persists continuation charges and includes them in the shared delegation turn budget', async () => {
    const adapter = new FixtureAdapter(async (ctx) => {
      ctx.beforeContinuation?.()
      await ctx.collaborate({
        operation: 'request_response',
        recipients: ['claude'],
        content: 'Must not be scheduled',
        dependencies: [],
      })
    })
    const { store, c, o } = await setup(adapter)
    store.put('settings', { ...store.settings(), id: 'general', maxTurns: 2 })
    store.put('conversations', { ...c, mode: 'collaborative' })
    try {
      o.createTask(c.id, 'codex', 'Continuation budget fixture', [])
      await until(() => store.list<Task>('tasks')[0]?.status === 'failed')
      const tasks = store.list<Task>('tasks')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].nativeTurns).toBe(2)
      expect(tasks[0].error).toContain('turn budget')
      expect(adapter.calls).toEqual(['codex'])
    } finally {
      await o.dispose()
      store.close()
    }
  })
  it('stops another continuation when the configured turn count is exhausted', async () => {
    const adapter = new FixtureAdapter(async (ctx) => {
      ctx.beforeContinuation?.()
      ctx.beforeContinuation?.()
    })
    const { store, c, o } = await setup(adapter)
    store.put('settings', { ...store.settings(), id: 'general', maxTurns: 2 })
    try {
      o.createTask(c.id, 'codex', 'Bound native turns', [])
      await until(() => store.list<Task>('tasks')[0]?.status === 'failed')
      expect(store.list<Task>('tasks')[0]).toMatchObject({ nativeTurns: 2, status: 'failed' })
    } finally {
      await o.dispose()
      store.close()
    }
  })
  it('freezes per-chat model/effort choices when queued instead of reading later edits', async () => {
    const seen: unknown[] = []
    const adapter = new FixtureAdapter(async (ctx) => {
      seen.push([ctx.agent.model, ctx.agent.reasoningEffort])
    })
    const { store, c, o } = await setup(adapter)
    store.put('conversations', {
      ...c,
      runtimeOverrides: { codex: { model: 'model-a', reasoningEffort: 'high' } },
    })
    o.createTask(c.id, 'codex', 'First', [])
    store.put('conversations', {
      ...c,
      runtimeOverrides: { codex: { model: 'model-b', reasoningEffort: 'medium' } },
    })
    o.createTask(c.id, 'codex', 'Second', [])
    store.put('conversations', {
      ...c,
      runtimeOverrides: { codex: { model: 'model-c', reasoningEffort: 'low' } },
    })
    await until(
      () => store.list<Task>('tasks').filter((t) => t.status === 'completed').length === 2,
    )
    expect(seen).toEqual([
      ['model-a', 'high'],
      ['model-b', 'medium'],
    ])
    await o.dispose()
    store.close()
  })
  it('preserves failed attempts and usage while downstream tasks follow an explicit retry', async () => {
    let codexTurns = 0
    const adapter = new FixtureAdapter(async (ctx) => {
      ctx.usage?.({ inputTokens: 10, outputTokens: 5, source: 'fixture' })
      if (ctx.agent.id === 'codex') {
        if (++codexTurns === 1) {
          await writeFile(join(ctx.workspace, 'partial.txt'), 'keep')
          throw new Error('Fixture crash after partial edit')
        }
        expect(await readFile(join(ctx.workspace, 'partial.txt'), 'utf8')).toBe('keep')
      }
    })
    const { store, c, o } = await setup(adapter)
    const first = o.createTask(c.id, 'codex', 'Build API', [])
    const consumer = o.createTask(c.id, 'claude', 'Consume API', [first.id])
    await until(() => store.require<Task>('tasks', consumer.id).status === 'blocked')
    expect(adapter.calls).toEqual(['codex'])
    expect(store.require<Task>('tasks', consumer.id).blockedBy).toEqual([first.id])
    o.taskAction(first.id, 'resume')
    const retry = store.list<Task>('tasks').find((t) => t.retryOf === first.id)!
    expect(retry.id).not.toBe(first.id)
    expect(store.require<Task>('tasks', first.id)).toMatchObject({
      status: 'failed',
      supersededBy: retry.id,
      error: expect.stringContaining('partial edit'),
    })
    expect(() => o.taskAction(first.id, 'resume')).toThrow('replaced')
    await until(() => store.require<Task>('tasks', consumer.id).status === 'completed')
    expect(store.require<Task>('tasks', retry.id).startedAt).toBeTruthy()
    expect(store.list('usage_records')).toHaveLength(3)
    expect(adapter.calls).toEqual(['codex', 'codex', 'claude'])
    await o.dispose()
    store.close()
  })
  it('uses the new assignee workspace without moving partial files or mutating the old attempt', async () => {
    const roots: string[] = []
    const adapter = new FixtureAdapter(async (ctx) => {
      roots.push(ctx.workspace)
      if (ctx.agent.id === 'codex') throw new Error('Needs handoff')
    })
    const { store, c, o } = await setup(adapter)
    const first = o.createTask(c.id, 'codex', 'Original work', [])
    await until(() => store.require<Task>('tasks', first.id).status === 'failed')
    o.reassign(first.id, 'claude')
    const next = store.list<Task>('tasks').find((t) => t.retryOf === first.id)!
    await until(() => store.require<Task>('tasks', next.id).status === 'completed')
    expect(next.agentId).toBe('claude')
    expect(next.name).toBe(first.name)
    expect(roots[0]).not.toBe(roots[1])
    expect(store.require<Task>('tasks', first.id).agentId).toBe('codex')
    expect(next.description).toContain('NOT transferred')
    await o.dispose()
    store.close()
  })
  it('shows approval waiting and cancellation works while native tools wait for a user', async () => {
    const adapter = new FixtureAdapter(async (ctx) => {
      await ctx.approve('Read', '{}')
    })
    const events: AppEvent[] = []
    const { store, c, o } = await setup(adapter, events)
    const task = o.createTask(c.id, 'codex', 'Approval test', [])
    await until(() => store.require<Task>('tasks', task.id).waitReason === 'approval')
    expect(store.require<Task>('tasks', task.id).status).toBe('waiting_user')
    expect(() => o.reassign(task.id, 'claude')).toThrow('Pause or cancel')
    o.taskAction(task.id, 'cancel')
    await until(() => store.require<Task>('tasks', task.id).status === 'cancelled')
    expect(events.filter((e) => e.type === 'approvals').at(-1)).toEqual({
      type: 'approvals',
      approvals: [],
    })
    await o.dispose()
    store.close()
  })
  it('marks timeouts failed with a recoverable cause instead of calling them user cancellation', async () => {
    const adapter = new FixtureAdapter(async (ctx) => {
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    })
    const { store, c, o } = await setup(adapter)
    store.put('settings', { ...store.settings(), id: 'general', timeoutMs: 500 })
    const task = o.createTask(c.id, 'codex', 'Wait for timeout', [])
    await until(() => store.require<Task>('tasks', task.id).status === 'failed')
    expect(store.require<Task>('tasks', task.id)).toMatchObject({
      failureKind: 'timeout',
      error: expect.stringContaining('Task timeout'),
    })
    await o.dispose()
    store.close()
  })
  it('blocks missing dependency records visibly without breaking scheduling for other agents', async () => {
    const { store, c, o } = await setup(new FixtureAdapter())
    const prerequisite = o.createTask(c.id, 'codex', 'First', [])
    await until(() => store.require<Task>('tasks', prerequisite.id).status === 'completed')
    const dependent = {
      ...prerequisite,
      id: 'restored-dependent',
      agentId: 'claude',
      status: 'pending' as const,
      dependencies: ['missing-record'],
    }
    store.put('tasks', dependent)
    o.createTask(c.id, 'antigravity', 'Independent', [])
    await until(() =>
      store
        .list<Task>('tasks')
        .some((t) => t.agentId === 'antigravity' && t.status === 'completed'),
    )
    expect(store.require<Task>('tasks', dependent.id).status).toBe('blocked')
    expect(store.messages(c.id).some((m) => m.taskId === dependent.id && m.type === 'system')).toBe(
      true,
    )
    await o.dispose()
    store.close()
  })
  it('persists an actionable agent error in the chat when preflight fails before launching any runtime', async () => {
    const store = new Store(':memory:')
    store.put('settings', { ...store.settings(), id: 'general', autonomy: 'ask' })
    const p = store.addProject('C:\\not-used', 'Missing workspace')
    const c = store.snapshot().conversations.find((c) => c.projectId === p.id)!
    const adapter = new FixtureAdapter()
    const o = new Orchestrator(store, new Map([['codex', adapter]]), () => {})
    o.send(c.id, 'Reply OK', ['codex'])
    await until(() => store.list<Task>('tasks')[0]?.status === 'failed')
    expect(adapter.calls).toHaveLength(0)
    expect(store.messages(c.id).at(-1)).toMatchObject({
      senderId: 'codex',
      delivery: 'failed',
      content: expect.stringContaining('WORKSPACE_NOT_READY'),
    })
    await o.dispose()
    store.close()
  })
  it('rejects an over-budget user fanout before storing or partially enqueueing work', async () => {
    const { store, c, o } = await setup(new FixtureAdapter())
    store.put('settings', { ...store.settings(), id: 'general', maxTurns: 1 })
    expect(() => o.send(c.id, 'over budget', ['codex', 'claude'])).toThrow('budget')
    expect(store.list<Task>('tasks')).toHaveLength(0)
    expect(store.messages(c.id)).toHaveLength(0)
    await o.dispose()
    store.close()
  })
  it('bounds circular agent delegation with a persisted per-request turn budget', async () => {
    let sequence = 0
    const adapter = new FixtureAdapter(async (ctx) => {
      await ctx.collaborate({
        operation: 'request_response',
        recipients: [ctx.agent.id === 'codex' ? 'claude' : 'codex'],
        content: `Reply ${++sequence} from ${ctx.agent.id}`,
        dependencies: [],
      })
    })
    const { store, c, o } = await setup(adapter)
    store.put('settings', { ...store.settings(), id: 'general', maxTurns: 3 })
    store.put('conversations', { ...c, mode: 'collaborative' } satisfies Conversation)
    o.send(c.id, 'bounded discussion', ['codex'])
    await until(() => store.list<Task>('tasks').some((t) => t.status === 'failed'))
    expect(store.list<Task>('tasks')).toHaveLength(3)
    expect(store.list<Task>('tasks').find((t) => t.status === 'failed')?.error).toContain('budget')
    await o.dispose()
    store.close()
  })
  it('runs independent agents in parallel but serializes each assigned workspace', async () => {
    const adapter = new FixtureAdapter()
    const { store, c, o } = await setup(adapter)
    o.send(c.id, 'one', ['codex', 'claude'])
    o.send(c.id, 'two', ['codex'])
    await until(
      () => store.list<Task>('tasks').filter((t) => t.status === 'completed').length === 3,
    )
    expect(adapter.peak).toBe(2)
    expect(adapter.calls.filter((id) => id === 'codex')).toHaveLength(2)
    expect(store.session(c.id, 'codex')?.nativeId).toBe('fixture-codex')
    await o.dispose()
    store.close()
  })
  it('routes actual structured requests, deduplicates and enforces delegation depth', async () => {
    const adapter = new FixtureAdapter(async (ctx) => {
      if (ctx.agent.id === 'codex') {
        const request = {
          operation: 'request_response' as const,
          recipients: ['claude'],
          content: 'Review contract',
          dependencies: [],
        }
        await ctx.collaborate(request)
        await ctx.collaborate(request)
      }
    })
    const { store, c, o } = await setup(adapter)
    store.put('conversations', { ...c, mode: 'collaborative' } satisfies Conversation)
    o.send(c.id, 'plan', ['codex'])
    await until(
      () => store.list<Task>('tasks').filter((t) => t.status === 'completed').length === 2,
    )
    expect(adapter.calls).toEqual(['codex', 'claude'])
    expect(store.messages(c.id).filter((m) => m.type === 'collaboration')).toHaveLength(1)
    await o.dispose()
    store.close()
  })
  it('requires manual-mode delegation approval and cancellation denies pending tools', async () => {
    const events: AppEvent[] = []
    const adapter = new FixtureAdapter(async (ctx) => {
      await ctx.collaborate({
        operation: 'request_response',
        recipients: ['claude'],
        content: 'Help',
        dependencies: [],
      })
    })
    const { store, c, o } = await setup(adapter, events)
    o.send(c.id, 'plan', ['codex'])
    await until(() => events.some((e) => e.type === 'approvals' && e.approvals.length > 0))
    o.stop(c.id)
    await until(() => store.list<Task>('tasks')[0].status === 'cancelled')
    expect(adapter.calls).toEqual(['codex'])
    expect(() => o.send(c.id, 'more', ['codex'])).toThrow('stopped')
    await o.dispose()
    store.close()
  })
})
