import { describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { GitHubCli, summarizeChecks } from '../src/main/github/gh'
import { GitHubService } from '../src/main/github/service'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import type { AgentAdapter } from '../src/main/agents/adapter'
import { requestSchema } from '../src/shared/schemas'
import type { Message, Task, Workspace } from '../src/shared/types'
import { directory, repository, until } from './helpers'

const identity = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@local.invalid',
  '-c',
  'commit.gpgsign=false',
]
async function fakeGitHub() {
  const state = await directory('fake-gh-')
  const cli = new GitHubCli(async () => ({
    file: process.execPath,
    prefix: [resolve('tests/fixtures/fake-gh.mjs'), state],
  }))
  const calls = async () =>
    (await readFile(join(state, 'calls.jsonl'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; body?: string })
  return { state, cli, calls }
}
async function setup() {
  const store = new Store(':memory:')
  const repo = await repository()
  const bare = await directory('origin-')
  await git(bare, ['init', '--bare', '-q'])
  await git(repo, ['remote', 'add', 'origin', bare])
  await git(repo, ['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  const project = store.addProject(repo, 'Shop')
  store.put('projects', { ...project, autoManaged: false })
  const c = store.snapshot().conversations[0]
  const manager = new WorkspaceManager(store, await directory('github-ws-'))
  await manager.prepare(project, false)
  const workspace = store.list<Workspace>('workspaces').find((w) => w.agentId === 'codex')!
  const sent: { content: string; recipients: string[]; planFirst?: boolean }[] = []
  const created: Task[] = []
  const task = (patch: Partial<Task>): Task => ({
    id: crypto.randomUUID(),
    projectId: project.id,
    conversationId: c.id,
    agentId: 'codex',
    name: 'Add coupons',
    description: 'Implement coupon codes',
    status: 'completed',
    dependencies: [],
    createdAt: new Date().toISOString(),
    correlationId: 'x',
    depth: 0,
    ...patch,
  })
  const orchestrator = {
    send(
      conversationId: string,
      content: string,
      recipients: string[],
      replyTo?: string,
      attachmentIds: string[] = [],
      planFirst = false,
    ) {
      expect(replyTo).toBeUndefined()
      expect(attachmentIds).toEqual([])
      sent.push({ content, recipients, planFirst })
      const message = { id: crypto.randomUUID(), conversationId } as Message
      for (const agentId of recipients)
        store.put('tasks', task({ agentId, correlationId: message.id, status: 'pending' }))
      return message
    },
    createTask(_c: string, agentId: string, description: string) {
      const t = task({ agentId, description, status: 'pending' })
      store.put('tasks', t)
      created.push(t)
      return t
    },
    changed() {},
  }
  return { store, c, project, bare, workspace, sent, created, task, orchestrator }
}

describe('GitHub delivery', () => {
  it('summarizes mixed check runs and status contexts', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/acme/shop/actions/runs/99/job/1',
        },
        { __typename: 'StatusContext', context: 'deploy', state: 'SUCCESS' },
      ]),
    ).toMatchObject({ state: 'failing', failing: [{ name: 'unit', runId: '99' }] })
    expect(summarizeChecks([{ name: 'x', status: 'IN_PROGRESS' }]).state).toBe('pending')
    expect(summarizeChecks([{ context: 'ci', state: 'PENDING' }]).state).toBe('pending')
    expect(summarizeChecks([{ name: 'x', status: 'COMPLETED', conclusion: 'SUCCESS' }]).state).toBe(
      'passing',
    )
    expect(summarizeChecks([]).state).toBe('none')
  })

  it('reports a missing login and imports an issue as fenced, untrusted work', async () => {
    const gh = await fakeGitHub()
    const env = await setup()
    const service = new GitHubService(env.store, env.orchestrator, gh.cli)
    await writeFile(join(gh.state, 'logged-out'), '1')
    expect(await service.status(env.project.id, true)).toMatchObject({
      available: true,
      authenticated: false,
    })
    await expect(service.issues(env.project.id)).rejects.toThrow(/gh auth login/)
    await writeFile(join(gh.state, 'logged-out'), '')
    expect(await service.status(env.project.id, true)).toMatchObject({
      authenticated: true,
      account: 'tester',
      repo: { nameWithOwner: 'acme/shop', defaultBranch: 'main' },
    })
    expect(await service.issues(env.project.id)).toEqual([
      expect.objectContaining({ number: 7, labels: ['feature'], author: 'pm' }),
    ])
    await service.importIssue(env.c.id, 7, ['codex'], true)
    expect(env.sent[0]).toMatchObject({ recipients: ['codex'], planFirst: true })
    expect(env.sent[0].content).toMatch(/<github-issue trust="untrusted/)
    expect(env.sent[0].content).toContain('Max one coupon per order.')
    const imported = env.store.list<Task>('tasks').find((t) => t.source?.kind === 'github_issue')!
    expect(imported.name).toBe('#7 Add coupon codes')
  }, 60000)

  it('opens a PR by pushing a new branch, then routes CI failures back to the agent', async () => {
    const gh = await fakeGitHub()
    const env = await setup()
    const service = new GitHubService(env.store, env.orchestrator, gh.cli)
    await writeFile(join(env.workspace.path, 'coupon.ts'), 'export const coupon = 1\n')
    await git(env.workspace.path, ['add', 'coupon.ts'])
    await git(env.workspace.path, [...identity, 'commit', '-qm', 'Add coupon'])
    const done = env.task({
      workspaceId: env.workspace.id,
      workspace: env.workspace.path,
      source: {
        kind: 'github_issue',
        number: 7,
        url: 'https://github.com/acme/shop/issues/7',
        title: 'Add coupon codes',
      },
      handoff: {
        summary: 'Coupons added',
        changed: ['coupon.ts'],
        tested: [],
        untested: ['Tax rounding'],
        questions: [],
        next: [],
        submittedAt: '',
      },
    })
    env.store.put('tasks', done)
    await writeFile(join(env.workspace.path, 'dirty.txt'), 'uncommitted')
    await expect(service.preparePr(done.id)).rejects.toThrow(/checkpoint/)
    await git(env.workspace.path, ['clean', '-fq'])
    const preview = await service.preparePr(done.id)
    expect(preview).toMatchObject({ repo: 'acme/shop', base: 'main', files: ['coupon.ts'] })
    expect(preview.commits).toHaveLength(1)
    expect(preview.body).toContain('Not verified:\n- Tax rounding')
    expect(preview.body).toContain('Closes #7')

    const link = await service.createPr(
      done.id,
      preview.title,
      preview.body,
      preview.branch,
      preview.id,
    )
    expect(link).toMatchObject({ number: 12, branch: preview.branch, state: 'OPEN' })
    // The branch really reached the remote, without force.
    expect(await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])).toBe(
      await git(env.workspace.path, ['rev-parse', 'HEAD']),
    )
    const create = (await gh.calls()).find((c) => c.args[0] === 'pr' && c.args[1] === 'create')!
    expect(create.args).toEqual(
      expect.arrayContaining(['--base', 'main', '--head', preview.branch]),
    )
    expect(create.body).toContain('Closes #7')
    expect(env.store.require<Task>('tasks', done.id).pullRequest?.url).toBe(
      'https://github.com/acme/shop/pull/12',
    )
    await expect(service.createPr(done.id, 't', 'b', preview.branch, preview.id)).rejects.toThrow(
      /already/,
    )

    await writeFile(
      join(gh.state, 'pr.json'),
      JSON.stringify({
        state: 'OPEN',
        statusCheckRollup: [
          {
            name: 'unit',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
            detailsUrl: 'https://github.com/acme/shop/actions/runs/99/job/1',
          },
        ],
      }),
    )
    const refreshed = await service.refresh(done.id)
    expect(refreshed.checks).toMatchObject({
      state: 'failing',
      failing: [{ name: 'unit', runId: '99' }],
    })
    expect(
      env.store.list<Message>('messages').filter((m) => m.content.includes('CI 失敗')),
    ).toHaveLength(1)
    await service.refresh(done.id)
    expect(
      env.store.list<Message>('messages').filter((m) => m.content.includes('CI 失敗')),
    ).toHaveLength(1)
    const fix = await service.fixCi(done.id)
    expect(env.created[0].description).toContain('expected 90 to be 80')
    expect(env.created[0].description).toMatch(/<ci-logs trust="untrusted/)
    expect(env.created[0].description).toContain('Do not push')
    expect(env.store.require<Task>('tasks', fix.id)).toMatchObject({
      pullRequest: { url: 'https://github.com/acme/shop/pull/12' },
      source: { kind: 'ci_fix' },
    })

    // The fix commits and the user pushes it to the same PR branch (fast-forward only).
    await writeFile(join(env.workspace.path, 'coupon.ts'), 'export const coupon = 2\n')
    await git(env.workspace.path, [...identity, 'commit', '-qam', 'Fix coupon'])
    env.store.put('tasks', {
      ...env.store.require<Task>('tasks', fix.id),
      status: 'completed',
      workspaceId: env.workspace.id,
      workspace: env.workspace.path,
    })
    await writeFile(
      join(gh.state, 'pr.json'),
      JSON.stringify({ state: 'OPEN', statusCheckRollup: [] }),
    )
    const update = await service.preparePr(fix.id)
    const published = await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])
    await writeFile(join(env.workspace.path, 'coupon.ts'), 'export const coupon = 3\n')
    await git(env.workspace.path, [...identity, 'commit', '-qam', 'Later fix'])
    await expect(service.pushUpdate(fix.id, update.id)).rejects.toThrow(/changed/)
    expect(await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])).toBe(published)
    const approved = await service.preparePr(fix.id)
    await service.pushUpdate(fix.id, approved.id)
    expect(await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])).toBe(
      await git(env.workspace.path, ['rev-parse', 'HEAD']),
    )
    expect(env.store.require<Task>('tasks', done.id).pullRequest?.checks?.state).toBe('none')
  }, 60000)

  it('requires a host-issued preview and refuses a changed or replayed revision', async () => {
    expect(
      requestSchema.safeParse({
        op: 'github.pr.create',
        taskId: 't',
        title: 't',
        body: '',
        branch: 'agenthub/test',
      }).success,
    ).toBe(false)
    expect(requestSchema.safeParse({ op: 'github.pr.push', taskId: 't' }).success).toBe(false)
    const gh = await fakeGitHub()
    const env = await setup()
    const service = new GitHubService(env.store, env.orchestrator, gh.cli)
    await writeFile(join(env.workspace.path, 'previewed.ts'), 'export const value = 1\n')
    await git(env.workspace.path, ['add', '.'])
    await git(env.workspace.path, [...identity, 'commit', '-qm', 'Previewed'])
    const done = env.task({ workspaceId: env.workspace.id, workspace: env.workspace.path })
    env.store.put('tasks', done)
    const preview = await service.preparePr(done.id)
    const other = env.task({ workspaceId: env.workspace.id, workspace: env.workspace.path })
    env.store.put('tasks', other)
    await expect(service.createPr(other.id, 't', 'b', preview.branch, preview.id)).rejects.toThrow(
      /preview/,
    )
    const expired = await service.preparePr(done.id)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000)
    try {
      await expect(service.createPr(done.id, 't', 'b', expired.branch, expired.id)).rejects.toThrow(
        /expired/,
      )
    } finally {
      clock.mockRestore()
    }
    await writeFile(join(env.workspace.path, 'later.ts'), 'export const value = 2\n')
    await git(env.workspace.path, ['add', '.'])
    await git(env.workspace.path, [...identity, 'commit', '-qm', 'Not previewed'])
    await expect(service.createPr(done.id, 't', 'b', preview.branch, preview.id)).rejects.toThrow(
      /changed/,
    )
    await expect(
      git(env.bare, ['rev-parse', '--verify', `refs/heads/${preview.branch}`]),
    ).rejects.toThrow()
    expect((await gh.calls()).some((c) => c.args[0] === 'pr')).toBe(false)
    await expect(service.createPr(done.id, 't', 'b', preview.branch, preview.id)).rejects.toThrow(
      /preview/,
    )
    const fresh = await service.preparePr(done.id)
    const results = await Promise.allSettled([
      service.createPr(done.id, 't', 'b', fresh.branch, fresh.id),
      service.createPr(done.id, 't', 'b', fresh.branch, fresh.id),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      (await gh.calls()).filter((c) => c.args[0] === 'pr' && c.args[1] === 'create'),
    ).toHaveLength(1)
    expect(await git(env.bare, ['rev-parse', `refs/heads/${fresh.branch}`])).toBe(fresh.revision)
    env.store.close()
  }, 60000)

  it('pushes the approved SHA even if HEAD advances immediately before the push', async () => {
    const gh = await fakeGitHub()
    const env = await setup()
    const service = new GitHubService(env.store, env.orchestrator, gh.cli)
    await writeFile(join(env.workspace.path, 'previewed.ts'), 'export const value = 1\n')
    await git(env.workspace.path, ['add', '.'])
    await git(env.workspace.path, [...identity, 'commit', '-qm', 'Previewed'])
    const done = env.task({ workspaceId: env.workspace.id, workspace: env.workspace.path })
    env.store.put('tasks', done)
    const preview = await service.preparePr(done.id)
    const boundary = service as unknown as {
      approvedWorkspace: (task: Task, preview: unknown) => Promise<Workspace>
    }
    const validate = boundary.approvedWorkspace.bind(service)
    vi.spyOn(boundary, 'approvedWorkspace').mockImplementationOnce(async (task, frozen) => {
      const ws = await validate(task, frozen)
      await writeFile(join(ws.path, 'later.ts'), 'export const later = 2\n')
      await git(ws.path, ['add', '.'])
      await git(ws.path, [...identity, 'commit', '-qm', 'Concurrent turn'])
      return ws
    })
    await service.createPr(done.id, preview.title, preview.body, preview.branch, preview.id)
    expect(await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])).toBe(
      preview.revision,
    )
    expect(await git(env.workspace.path, ['rev-parse', 'HEAD'])).not.toBe(preview.revision)
    env.store.close()
  }, 60000)

  it('keeps CI and issue metadata through eager execution and automatic retries', async () => {
    const gh = await fakeGitHub()
    const env = await setup()
    let runs = 0
    const adapter: AgentAdapter = {
      async detect() {
        throw new Error('Not used by this fixture')
      },
      async run(ctx) {
        ctx.saveSession('fixture-only')
        if (++runs === 1) throw new Error('Transient fixture failure')
        return 'Fixture completed'
      },
      async dispose() {},
    }
    const orchestrator = new Orchestrator(env.store, new Map([['codex', adapter]]), () => {})
    const service = new GitHubService(env.store, orchestrator, gh.cli)
    try {
      const parent = env.task({
        pullRequest: {
          url: 'https://github.com/acme/shop/pull/12',
          number: 12,
          repo: 'acme/shop',
          branch: 'agenthub/ci-fix',
          base: 'main',
          createdAt: new Date().toISOString(),
          state: 'OPEN',
          checks: {
            state: 'failing',
            failing: [{ name: 'unit' }],
            checkedAt: new Date().toISOString(),
          },
        },
      })
      env.store.put('tasks', parent)
      const fix = await service.fixCi(parent.id)
      expect(fix.pullRequest?.number).toBe(12)
      await until(
        () =>
          env.store
            .list<Task>('tasks')
            .some((t) => t.retryOf === fix.id && t.status === 'completed'),
        15000,
      )
      for (const t of env.store
        .list<Task>('tasks')
        .filter((t) => t.id === fix.id || t.retryOf === fix.id)) {
        expect(t.pullRequest?.number).toBe(12)
        expect(t.source).toEqual({ kind: 'ci_fix', prUrl: parent.pullRequest!.url })
        expect(t.name).toBe('修正 PR #12 的 CI')
      }
      const message = await service.importIssue(env.c.id, 7, ['codex'])
      await until(
        () =>
          env.store
            .list<Task>('tasks')
            .some((t) => t.correlationId === message.id && t.status === 'completed'),
        15000,
      )
      const imported = env.store.list<Task>('tasks').find((t) => t.correlationId === message.id)!
      expect(imported.source).toMatchObject({ kind: 'github_issue', number: 7 })
      expect(imported.name).toBe('#7 Add coupon codes')
    } finally {
      await orchestrator.dispose()
      service.dispose()
      env.store.close()
    }
  }, 60000)
})
