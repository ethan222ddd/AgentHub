import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { WorkspaceManager } from '../src/main/git/workspaces'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { Task } from '../src/shared/types'
import { directory, repository, until } from './helpers'

class ScriptedAdapter implements AgentAdapter {
  runs: { readOnly: boolean; prompt: string }[] = []
  constructor(private step: (ctx: RunContext, run: number) => Promise<string>) {}
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
    ctx.saveSession('fixture-session')
    this.runs.push({ readOnly: !!ctx.readOnly, prompt: ctx.prompt })
    return this.step(ctx, this.runs.length)
  }
  async dispose() {}
}
async function setup(adapter: AgentAdapter) {
  const store = new Store(':memory:')
  const repo = await repository()
  const project = store.addProject(repo, 'Repo')
  store.put('projects', { ...project, autoManaged: false })
  const c = store.snapshot().conversations[0]
  const manager = new WorkspaceManager(store, await directory('plan-'))
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
const only = (store: Store) => store.list<Task>('tasks')[0]
const submit = (ctx: RunContext) =>
  ctx.collaborate({
    operation: 'submit_plan',
    recipients: [],
    content: '## Plan\nAdd an idempotency key to payments.',
    dependencies: [],
    plan: {
      files: ['src/payments.ts'],
      steps: ['Add header parsing', 'Store keys'],
      risks: ['Duplicate charges if keys collide'],
      verification: 'npm test',
    },
  })

describe('plan-first gate', () => {
  it('plans read-only, waits for approval, then implements with the approved plan', async () => {
    const adapter = new ScriptedAdapter(async (ctx, run) => {
      if (run === 1) {
        await submit(ctx)
        return 'Plan submitted.'
      }
      return 'Implemented.'
    })
    const { store, c, o } = await setup(adapter)
    try {
      o.send(c.id, 'Make payments idempotent', ['codex'], undefined, [], true)
      await until(() => only(store)?.waitReason === 'plan')
      const waiting = only(store)
      expect(adapter.runs[0].readOnly).toBe(true)
      expect(adapter.runs[0].prompt).toContain('PLANNING PHASE')
      expect(waiting.status).toBe('waiting_user')
      expect(waiting.plan).toMatchObject({
        status: 'awaiting',
        structured: true,
        files: ['src/payments.ts'],
        verification: 'npm test',
      })
      o.planAction(waiting.id, 'approve', '## Edited plan\nOnly touch payments.ts.')
      await until(() => only(store)?.status === 'completed')
      expect(adapter.runs).toHaveLength(2)
      expect(adapter.runs[1].readOnly).toBe(false)
      expect(adapter.runs[1].prompt).toContain('IMPLEMENTATION PHASE')
      expect(adapter.runs[1].prompt).toContain('Only touch payments.ts.')
      expect(only(store).plan?.status).toBe('approved')
      expect(only(store).nativeTurns).toBe(2)
    } finally {
      await o.dispose()
    }
  })

  it('sends user feedback back for a replacement plan', async () => {
    const adapter = new ScriptedAdapter(async (ctx) => {
      await submit(ctx)
      return 'Plan submitted.'
    })
    const { store, c, o } = await setup(adapter)
    try {
      o.send(c.id, 'Refactor checkout', ['codex'], undefined, [], true)
      await until(() => only(store)?.waitReason === 'plan')
      expect(() => o.planAction(only(store).id, 'revise')).toThrow(/Describe what/)
      o.planAction(only(store).id, 'revise', undefined, 'Keep the database schema unchanged.')
      await until(() => adapter.runs.length === 2 && only(store)?.waitReason === 'plan')
      expect(adapter.runs[1].readOnly).toBe(true)
      expect(adapter.runs[1].prompt).toContain('Keep the database schema unchanged.')
      expect(adapter.runs[1].prompt).toContain('<previous-plan>')
      expect(only(store).plan?.revisions).toBe(1)
      o.planAction(only(store).id, 'cancel')
      expect(only(store).status).toBe('cancelled')
      expect(adapter.runs).toHaveLength(2)
    } finally {
      await o.dispose()
    }
  })

  it('refuses delegation while planning and falls back to prose plans', async () => {
    let refused = ''
    const adapter = new ScriptedAdapter(async (ctx) => {
      try {
        await ctx.collaborate({
          operation: 'assign_task',
          recipients: ['claude'],
          content: 'Start coding now',
          dependencies: [],
        })
      } catch (error) {
        refused = String(error)
      }
      return 'My plan in prose: change one file.'
    })
    const { store, c, o } = await setup(adapter)
    try {
      o.send(c.id, 'Plan something', ['codex'], undefined, [], true)
      await until(() => only(store)?.waitReason === 'plan')
      expect(refused).toContain('Planning phase')
      expect(store.list<Task>('tasks')).toHaveLength(1)
      expect(only(store).plan).toMatchObject({
        structured: false,
        content: 'My plan in prose: change one file.',
      })
    } finally {
      await o.dispose()
    }
  })

  it('rejects a planning turn that changed the workspace', async () => {
    const adapter = new ScriptedAdapter(async (ctx) => {
      await writeFile(join(ctx.workspace, 'sneaky.txt'), 'written during planning')
      await submit(ctx)
      return 'Plan submitted.'
    })
    const { store, c, o } = await setup(adapter)
    try {
      o.send(c.id, 'Plan only', ['codex'], undefined, [], true)
      await until(() => only(store)?.status === 'failed')
      expect(only(store).error).toContain('Planning turn changed the workspace')
      expect(only(store).waitReason).not.toBe('plan')
    } finally {
      await o.dispose()
    }
  })

  it('keeps an awaiting plan through restart recovery', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await directory('plan-recover-'), 'Repo')
    const c = store.snapshot().conversations[0]
    const base = {
      projectId: project.id,
      conversationId: c.id,
      agentId: 'codex',
      description: '',
      dependencies: [],
      createdAt: new Date().toISOString(),
      correlationId: 'x',
      depth: 0,
    }
    store.put('tasks', {
      ...base,
      id: 'awaiting',
      name: 'awaiting',
      status: 'waiting_user',
      waitReason: 'plan',
      planFirst: true,
      plan: {
        status: 'awaiting',
        content: 'plan',
        files: [],
        steps: [],
        risks: [],
        verification: '',
        structured: true,
        revisions: 0,
      },
    })
    store.put('tasks', { ...base, id: 'running', name: 'running', status: 'running' })
    store.recover()
    expect(store.require<Task>('tasks', 'awaiting').waitReason).toBe('plan')
    expect(store.require<Task>('tasks', 'running').waitReason).toBe('recovery')
  })
})
