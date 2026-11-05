import { describe, expect, it } from 'vitest'
import { autoDecision, maxDepth } from '../src/main/orchestrator/autonomy'
import { envelopeFromText } from '../src/main/agents/antigravity'
import { ApprovalQueue } from '../src/main/orchestrator/approvals'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { Store } from '../src/main/database/store'
import { WorkspaceManager } from '../src/main/git/workspaces'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { Activity, Message, Task } from '../src/shared/types'
import { directory, repository, until } from './helpers'

const root = 'C:\\Users\\me\\AgentHubData\\workspaces\\p\\codex'
const project = 'C:\\Users\\me\\Desktop\\shop'

describe('autonomous approval policy', () => {
  it('allows routine development and denies risky operations', () => {
    const allow = (tool: string, detail: string) =>
      autoDecision(tool, detail, [root, project]).allow
    expect(allow('Bash', '{"command":"npm install && npm test"}')).toBe(true)
    expect(allow('Write', `{"file_path":"${root.replace(/\\/g, '\\\\')}\\\\src\\\\App.tsx"}`)).toBe(
      true,
    )
    expect(allow('Bash', '{"command":"git commit -m \\"ui\\""}')).toBe(true)
    expect(allow('Bash', `{"command":"rm -rf ${root.replace(/\\/g, '/')}/dist"}`)).toBe(true)
    expect(allow('Codex live web search', 'Enable the native web_search tool')).toBe(true)
    expect(allow('Bash', '{"command":"git push origin main"}')).toBe(false)
    expect(allow('Bash', '{"command":"git reset --hard HEAD~1"}')).toBe(false)
    expect(allow('Bash', '{"command":"cat ~/.ssh/id_rsa"}')).toBe(false)
    expect(allow('Bash', '{"command":"npm publish"}')).toBe(false)
    expect(allow('Bash', '{"command":"Remove-Item -Recurse C:\\\\Users\\\\me\\\\Documents"}')).toBe(
      false,
    )
    expect(allow('Bash', '{"command":"rm -rf ../other-project"}')).toBe(false)
    expect(allow('Bash', '{"command":"reg add HKLM\\\\Software\\\\x"}')).toBe(false)
  })

  it('decides immediately with an audit entry in auto mode and waits in ask mode', async () => {
    const store = new Store(':memory:')
    const p = store.addProject(project, 'Shop')
    const c = store.snapshot().conversations[0]
    const task: Task = {
      id: 't1',
      projectId: p.id,
      conversationId: c.id,
      agentId: 'codex',
      name: 't',
      description: '',
      status: 'running',
      dependencies: [],
      createdAt: new Date().toISOString(),
      correlationId: 'x',
      depth: 0,
    }
    store.put('tasks', task)
    const events: string[] = []
    const queue = new ApprovalQueue(store, {
      isClosing: () => false,
      isRunning: () => true,
      publish: (e) => events.push(e.type),
      changed: () => {},
    })
    const signal = new AbortController().signal
    expect(await queue.request(task, 'Bash', '{"command":"npm test"}', signal)).toBe(true)
    expect(await queue.request(task, 'Bash', '{"command":"git push"}', signal)).toBe(false)
    const audit = store.list<Activity>('activities').map((a) => a.type)
    expect(audit).toEqual(['approval.auto-allowed', 'approval.auto-denied'])
    expect(events).not.toContain('approvals')

    store.put('settings', { ...store.settings(), id: 'general', autonomy: 'ask' })
    let settled = false
    void queue.request(task, 'Bash', '{"command":"npm test"}', signal).then(() => (settled = true))
    await new Promise((r) => setTimeout(r, 30))
    expect(settled).toBe(false)
    expect(events).toContain('approvals')
    queue.denyAll()
  })
})

class TeamAdapter implements AgentAdapter {
  prompts = new Map<string, string>()
  order: string[] = []
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
    this.prompts.set(ctx.agent.id, ctx.prompt)
    this.order.push(ctx.agent.id)
    if (ctx.prompt.includes('TEAM LEAD PROTOCOL')) {
      const own = /Task ID: ([\w-]+)/.exec(ctx.prompt)![1]
      await ctx.collaborate({
        operation: 'assign_task',
        recipients: ['claude'],
        content: 'Build the UI on top of my scaffold.',
        dependencies: [own],
      })
    }
    return 'done'
  }
  async dispose() {}
}

describe('autonomous team run', () => {
  it('sends a multi-agent prompt to one lead who assigns teammates after its foundation', async () => {
    const store = new Store(':memory:')
    const p = store.addProject(await repository(), 'Repo')
    store.put('projects', { ...p, autoManaged: false })
    const c = store.snapshot().conversations[0]
    store.put('conversations', { ...c, mode: 'collaborative' })
    await new WorkspaceManager(store, await directory('team-')).prepare(p, false)
    const adapter = new TeamAdapter()
    const o = new Orchestrator(
      store,
      new Map([
        ['codex', adapter],
        ['claude', adapter],
        ['antigravity', adapter],
      ]),
      () => {},
    )
    try {
      o.send(c.id, 'Build a to-do app', ['codex', 'claude', 'antigravity'])
      const first = store.list<Task>('tasks')
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({
        agentId: 'codex',
        team: { lead: 'codex', members: ['codex', 'claude', 'antigravity'] },
      })
      await until(
        () => store.list<Task>('tasks').filter((t) => t.status === 'completed').length === 2,
        15000,
      )
      expect(adapter.order).toEqual(['codex', 'claude'])
      expect(adapter.prompts.get('codex')).toContain('- antigravity (Antigravity)')
      expect(adapter.prompts.get('codex')).toContain('AUTONOMOUS ROOM')
      expect(adapter.prompts.get('claude')).not.toContain('TEAM LEAD PROTOCOL')
      expect(adapter.prompts.get('claude')).toContain('AUTONOMOUS ROOM')
      // Without autonomy, the same prompt is delivered to each recipient separately.
      store.put('settings', { ...store.settings(), id: 'general', autonomy: 'ask' })
      o.send(c.id, 'Say hi', ['codex', 'claude'])
      expect(store.list<Task>('tasks').filter((t) => t.description === 'Say hi')).toHaveLength(2)
    } finally {
      await o.dispose()
    }
  })

  it('turns a failed integration into at most two automatic fix attempts', async () => {
    const store = new Store(':memory:')
    const p = store.addProject(await directory('autofix-'), 'Repo')
    const c = store.snapshot().conversations[0]
    store.put('conversations', { ...c, stopped: true })
    const o = new Orchestrator(store, new Map(), () => {})
    const failed: Task = {
      id: 'orig',
      projectId: p.id,
      conversationId: c.id,
      agentId: 'codex',
      name: 'API',
      description: 'Build the API',
      status: 'waiting_user',
      waitReason: 'integration',
      dependencies: [],
      createdAt: new Date().toISOString(),
      correlationId: 'run',
      depth: 1,
    }
    store.put('tasks', failed)
    store.put('conversations', { ...c, stopped: false })
    o.autoFix(failed, 'Integration snapshot tests failed')
    const fix = store.list<Task>('tasks').find((t) => t.retryOf === 'orig')!
    expect(fix).toMatchObject({ autoFix: 1, agentId: 'codex', correlationId: 'run', depth: 1 })
    expect(fix.description).toContain('AUTOMATIC FIX 1/2')
    expect(store.require<Task>('tasks', 'orig').supersededBy).toBe(fix.id)
    o.autoFix({ ...fix, autoFix: 2 }, 'still failing')
    expect(
      store.list<Message>('messages').some((m) => m.content.includes('自動修正已嘗試 2 次')),
    ).toBe(true)
    o.autoFix(failed, '主要專案有使用者未提交或暫存變更，未覆寫。')
    expect(store.list<Task>('tasks').filter((t) => t.retryOf === 'orig')).toHaveLength(1)
    await o.dispose()
  })
})

describe('review findings from an ordinary task', () => {
  it('are shared as a review report instead of failing the turn', async () => {
    const { deliverCollaboration } = await import('../src/main/orchestrator/collaboration')
    const store = new Store(':memory:')
    const p = store.addProject(await directory('review-report-'), 'Repo')
    const c = store.snapshot().conversations[0]
    const task: Task = {
      id: 'qa',
      projectId: p.id,
      conversationId: c.id,
      agentId: 'antigravity',
      name: 'QA',
      description: '',
      status: 'running',
      dependencies: [],
      createdAt: new Date().toISOString(),
      correlationId: 'x',
      depth: 1,
    }
    store.put('tasks', task)
    const host = {
      store,
      dedupe: new Set<string>(),
      changed() {},
      publish() {},
      turnCount: () => 0,
      ask: async () => true,
      enqueue: () => task,
      pump() {},
    }
    const result = await deliverCollaboration(
      host,
      task,
      {
        operation: 'submit_review',
        recipients: ['codex'],
        content: 'Storage ignores corrupt JSON correctly.',
        dependencies: [],
        verdict: 'changes_requested',
        comments: [
          { file: 'src/App.tsx', line: 12, severity: 'warning', content: 'Missing label' },
        ],
      },
      new AbortController().signal,
    )
    expect(result).toMatchObject({ recorded: true })
    const report = store.list<Message>('messages').find((m) => m.senderId === 'antigravity')!
    expect(report.recipientIds).toEqual(['codex'])
    expect(report.content).toContain('[warning] src/App.tsx:12 Missing label')
  })
})

describe('autonomous limits and Antigravity output recovery', () => {
  it('gives autonomous teams a deeper delegation chain without lowering a larger setting', () => {
    expect(maxDepth({ maxDepth: 3, autonomy: 'ask' })).toBe(3)
    expect(maxDepth({ maxDepth: 3, autonomy: 'auto' })).toBe(8)
    expect(maxDepth({ maxDepth: 12, autonomy: 'auto' })).toBe(12)
  })

  it('recovers a text envelope and treats plain text as a reply without requests', () => {
    const fenced =
      '```json\n{"message":"done","requests":[{"operation":"report_progress","recipients":[],"content":"ok"}]}\n```'
    expect(envelopeFromText(fenced).requests).toHaveLength(1)
    expect(envelopeFromText(fenced).message).toBe('done')
    expect(envelopeFromText('All tests pass.')).toEqual({ message: 'All tests pass.', requests: [] })
    expect(envelopeFromText('{not json')).toEqual({ message: '{not json', requests: [] })
  })
})
