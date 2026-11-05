import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { GitHubCli, summarizeChecks } from '../src/main/github/gh'
import { GitHubService } from '../src/main/github/service'
import type { Message, Task, Workspace } from '../src/shared/types'
import { directory, repository } from './helpers'

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
  })

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

    const link = await service.createPr(done.id, preview.title, preview.body, preview.branch)
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
    await expect(service.createPr(done.id, 't', 'b', preview.branch)).rejects.toThrow(/already/)

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
    await service.pushUpdate(fix.id)
    expect(await git(env.bare, ['rev-parse', `refs/heads/${preview.branch}`])).toBe(
      await git(env.workspace.path, ['rev-parse', 'HEAD']),
    )
    expect(env.store.require<Task>('tasks', done.id).pullRequest?.checks?.state).toBe('none')
  }, 60000)
})
