import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/database/store'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { WorkspaceManager } from '../src/main/git/workspaces'
import {
  acceptedDecisionsText,
  deleteDecision,
  saveDecision,
} from '../src/main/orchestrator/decisions'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { Message, Project, Task } from '../src/shared/types'
import { directory, repository, until } from './helpers'

class ScriptedAdapter implements AgentAdapter {
  prompts: string[] = []
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
    ctx.saveSession('fixture')
    this.prompts.push(ctx.prompt)
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
  const manager = new WorkspaceManager(store, await directory('decisions-'))
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
  return { store, c, o, projectId: project.id }
}
const decisionsOf = (store: Store, id: string) =>
  store.require<Project>('projects', id).decisions || []

describe('project decision log', () => {
  it('keeps agent proposals out of prompts until the user accepts them', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async (ctx) => {
      if (calls++ === 0) {
        await ctx.collaborate({
          operation: 'propose_decision',
          recipients: [],
          content: 'All money values are integer cents to avoid float rounding.',
          dependencies: [],
          decision: { title: 'Store money as integer cents' },
        })
        // A repeat proposal with the same title is merged, not duplicated.
        await ctx.collaborate({
          operation: 'propose_decision',
          recipients: [],
          content: 'again',
          dependencies: [],
          decision: { title: 'store money as INTEGER cents' },
        })
      }
    })
    const { store, c, o, projectId } = await setup(adapter)
    try {
      const first = o.createTask(c.id, 'codex', 'Price calculation', [])
      await until(() => store.require<Task>('tasks', first.id).status === 'completed')
      const [proposal] = decisionsOf(store, projectId)
      expect(decisionsOf(store, projectId)).toHaveLength(1)
      expect(proposal).toMatchObject({ status: 'proposed', proposedBy: 'codex' })
      expect(
        store
          .list<Message>('messages')
          .some((m) => m.type === 'system' && m.content.includes('Store money as integer cents')),
      ).toBe(true)
      const second = o.createTask(c.id, 'claude', 'Invoice totals', [])
      await until(() => store.require<Task>('tasks', second.id).status === 'completed')
      expect(adapter.prompts[1]).not.toContain('<project-decisions>')

      saveDecision(store, projectId, { ...proposal, status: 'accepted' })
      const third = o.createTask(c.id, 'claude', 'Refunds', [])
      await until(() => store.require<Task>('tasks', third.id).status === 'completed')
      expect(adapter.prompts[2]).toContain('<project-decisions>')
      expect(adapter.prompts[2]).toContain('- Store money as integer cents: All money values')
    } finally {
      await o.dispose()
    }
  })

  it('lets the user add, edit, reject and delete decisions within a prompt budget', () => {
    const store = new Store(':memory:')
    const project = store.addProject('C:\\fixture', 'Repo')
    const added = saveDecision(store, project.id, {
      title: 'Use problem+json for API errors',
      detail: '',
      status: 'accepted',
    })
    expect(added).toMatchObject({ proposedBy: 'user', status: 'accepted' })
    expect(added.decidedAt).toBeTruthy()
    saveDecision(store, project.id, { ...added, detail: 'RFC 9457', status: 'accepted' })
    expect(acceptedDecisionsText(store.require<Project>('projects', project.id))).toBe(
      '- Use problem+json for API errors: RFC 9457',
    )
    saveDecision(store, project.id, { ...added, status: 'rejected' })
    expect(acceptedDecisionsText(store.require<Project>('projects', project.id))).toBe('')
    for (let i = 0; i < 40; i++)
      saveDecision(store, project.id, {
        title: `Rule ${i}`,
        detail: 'x'.repeat(300),
        status: 'accepted',
      })
    const text = acceptedDecisionsText(store.require<Project>('projects', project.id))
    expect(text.length).toBeLessThan(6500)
    expect(text.startsWith('- Rule 39')).toBe(true)
    expect(text).toMatch(/older accepted decisions omitted/)
    deleteDecision(store, project.id, added.id)
    expect(decisionsOf(store, project.id).some((d) => d.id === added.id)).toBe(false)
    expect(() => deleteDecision(store, project.id, added.id)).toThrow(/not found/)
  })
})
