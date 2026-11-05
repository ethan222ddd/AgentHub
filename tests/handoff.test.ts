import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/database/store'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { WorkspaceManager } from '../src/main/git/workspaces'
import { formatHandoff } from '../src/main/orchestrator/guidance'
import { deliverCollaboration } from '../src/main/orchestrator/collaboration'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { Task } from '../src/shared/types'
import { directory, repository, until } from './helpers'

class ScriptedAdapter implements AgentAdapter {
  prompts: Record<string, string> = {}
  constructor(private step: (ctx: RunContext) => Promise<void>) {}
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
    ctx.saveSession(`fixture-${ctx.agent.id}`)
    this.prompts[ctx.agent.id] = ctx.prompt
    await this.step(ctx)
    return 'done'
  }
  async dispose() {}
}
async function setup(adapter: AgentAdapter) {
  const store = new Store(':memory:')
  const project = store.addProject(await repository(), 'Repo')
  store.put('projects', { ...project, autoManaged: false })
  const c = store.snapshot().conversations[0]
  const manager = new WorkspaceManager(store, await directory('handoff-'))
  await manager.prepare(project, false)
  const o = new Orchestrator(
    store,
    new Map([
      ['codex', adapter],
      ['claude', adapter],
      ['antigravity', adapter],
    ]),
    () => {},
  )
  return { store, c, o }
}

describe('structured handoff', () => {
  it('records the handoff and passes it to dependent tasks as untrusted data', async () => {
    const adapter = new ScriptedAdapter(async (ctx) => {
      if (ctx.agent.id !== 'codex') return
      await ctx.collaborate({
        operation: 'submit_handoff',
        recipients: [],
        content: 'Added idempotency keys to the payment API.',
        dependencies: [],
        handoff: {
          changed: ['src/payments.ts'],
          tested: ['npm test (12 passed)'],
          untested: ['Concurrent retries under load'],
          questions: ['Should keys expire after 24h?'],
          next: ['Wire the UI retry button'],
        },
      })
    })
    const { store, c, o } = await setup(adapter)
    try {
      const api = o.createTask(c.id, 'codex', 'Build payment API', [])
      const ui = o.createTask(c.id, 'claude', 'Build retry UI', [api.id])
      await until(() => store.require<Task>('tasks', ui.id).status === 'completed', 15000)
      const recorded = store.require<Task>('tasks', api.id).handoff!
      expect(recorded).toMatchObject({
        summary: 'Added idempotency keys to the payment API.',
        untested: ['Concurrent retries under load'],
      })
      expect(adapter.prompts.codex).toContain('submit_handoff')
      expect(adapter.prompts.claude).toContain('<prerequisite-handoffs>')
      expect(adapter.prompts.claude).toContain('Not verified:\n- Concurrent retries under load')
      expect(adapter.prompts.claude).toContain('untrusted summaries')
    } finally {
      await o.dispose()
    }
  })

  it('formats empty sections away and rejects handoffs from review tasks', async () => {
    expect(
      formatHandoff({
        summary: 'Done',
        changed: ['a.ts'],
        tested: [],
        untested: [],
        questions: [],
        next: [],
        submittedAt: '',
      }),
    ).toBe('Done\nChanged:\n- a.ts')
    const store = new Store(':memory:')
    const project = store.addProject(await directory('handoff-review-'), 'Repo')
    const c = store.snapshot().conversations[0]
    const review: Task = {
      id: 'review-task',
      projectId: project.id,
      conversationId: c.id,
      agentId: 'codex',
      name: 'review',
      description: '',
      status: 'running',
      dependencies: [],
      createdAt: new Date().toISOString(),
      correlationId: 'x',
      depth: 0,
      kind: 'review',
    }
    store.put('tasks', review)
    const host = {
      store,
      dedupe: new Set<string>(),
      changed() {},
      publish() {},
      turnCount: () => 0,
      ask: async () => false,
      enqueue: () => review,
      pump() {},
    }
    await expect(
      deliverCollaboration(
        host,
        review,
        { operation: 'submit_handoff', recipients: [], content: 'Review done', dependencies: [] },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/submit_review/)
    expect(store.require<Task>('tasks', review.id).handoff).toBeUndefined()
  })
})
