import { expect, it, describe } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { AutomaticProjects } from '../src/main/git/automatic'
import { scanFiles } from '../src/main/git/safe-snapshot'
import { TestRunner } from '../src/main/tasks/tests'
import type { AgentProfile, Project } from '../src/shared/types'
import { directory, repository } from './helpers'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import type { AgentAdapter } from '../src/main/agents/adapter'
import { until } from './helpers'
import { JsonProcess } from '../src/main/agents/process'
async function setup(path?: string) {
  const base = await directory('auto-中文 '),
    root = path || join(base, '新專案 with spaces')
  await mkdir(root, { recursive: true })
  await mkdir(join(base, 'app-data'), { recursive: true })
  const store = new Store(join(base, 'app-data', 'data.sqlite'))
  const project: Project = { ...store.addProject(root, 'Automatic'), autoManaged: true }
  store.put('projects', project)
  const manager = new WorkspaceManager(store, join(base, 'managed'))
  const tests = new TestRunner(
    store,
    () => {},
    (cwd) =>
      new JsonProcess(process.execPath, [resolve('tests/fixtures/command-sandbox.mjs')], cwd),
  )
  const auto = new AutomaticProjects(store, manager, tests, () => {})
  const agent = store.require<AgentProfile>('agents', 'codex')
  const signal = new AbortController().signal
  const workspace = (a = agent) => auto.workspace(project, a, async () => true, signal)
  return { base, root, store, project, manager, auto, agent, tests, signal, workspace }
}
// Each case invokes many real guarded Git processes, rather than an in-memory Git mock.
describe('Automatic project lifecycle', { timeout: 60000 }, () => {
  it('automatically initializes an empty Chinese/space path and integrates a static Hello World into that folder', async () => {
    const s = await setup()
    try {
      await s.auto.prepare(s.project)
      expect(await git(s.root, ['branch', '--show-current'])).toBe('main')
      expect(await git(s.root, ['show', '-s', '--format=%an <%ae>'])).toBe(
        'AgentHub <local@agenthub.invalid>',
      )
      const w = await s.workspace()
      await writeFile(
        join(w.path, 'index.html'),
        '<!doctype html><html><body>Hello World</body></html>',
      )
      const result = await s.auto.finish(s.project, w, s.signal)
      expect(result.status, result.detail).toBe('merged')
      expect(await readFile(join(s.root, 'index.html'), 'utf8')).toContain('Hello World')
      expect(await git(s.root, ['status', '--porcelain'])).toBe('')
      expect(
        s.store
          .snapshot()
          .tests.some((t) => t.name.startsWith('Static site') && t.status === 'passed'),
      ).toBe(true)
    } finally {
      await s.tests.dispose()
      s.store.close()
    }
  })
  it('snapshots existing source but excludes .env and certificates without deleting originals', async () => {
    const s = await setup()
    try {
      await writeFile(join(s.root, 'index.html'), '<html><body>Existing code</body></html>')
      await writeFile(join(s.root, '.env'), 'API_KEY=PRIVATE_SENTINEL')
      await writeFile(join(s.root, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nPRIVATE_SENTINEL')
      await s.auto.prepare(s.project)
      const w = await s.workspace()
      expect(await readFile(join(w.path, 'index.html'), 'utf8')).toContain('Existing code')
      expect(existsSync(join(w.path, '.env'))).toBe(false)
      expect(existsSync(join(w.path, 'private.pem'))).toBe(false)
      expect(await readFile(join(s.root, '.env'), 'utf8')).toContain('PRIVATE_SENTINEL')
      expect(await git(s.root, ['ls-tree', '-r', '--name-only', 'HEAD'])).not.toMatch(
        /\.env|private.pem/,
      )
    } finally {
      s.store.close()
    }
  })
  it('requests in-app review for a secret embedded in ordinary source and omits it from the initial snapshot', async () => {
    const s = await setup()
    try {
      await writeFile(join(s.root, 'index.html'), '<html>Safe</html>')
      await writeFile(join(s.root, 'config.ts'), `export const api_key = 'sk-${'X'.repeat(40)}'`)
      await expect(s.auto.prepare(s.project)).rejects.toThrow('初始快照需要檢查')
      expect(s.store.require<Project>('projects', s.project.id).setup?.state).toBe('attention')
      const w = await s.workspace()
      expect(existsSync(join(w.path, 'config.ts'))).toBe(false)
      expect(existsSync(join(s.root, 'config.ts'))).toBe(true)
    } finally {
      s.store.close()
    }
  })
  it('preserves an unborn repository branch, original staged blob and working-file version', async () => {
    const s = await setup()
    try {
      await git(s.root, ['init', '-b', 'existing-branch'])
      await writeFile(join(s.root, 'readme.txt'), 'staged version')
      await git(s.root, ['add', '--', 'readme.txt'])
      const staged = await git(s.root, ['rev-parse', ':readme.txt'])
      await writeFile(join(s.root, 'readme.txt'), 'working version')
      await expect(s.auto.prepare(s.project)).rejects.toThrow('初始快照需要檢查')
      await s.auto.prepare(s.project, async () => true)
      expect(await git(s.root, ['branch', '--show-current'])).toBe('existing-branch')
      expect(await git(s.root, ['rev-parse', ':readme.txt'])).toBe(staged)
      expect(await readFile(join(s.root, 'readme.txt'), 'utf8')).toBe('working version')
    } finally {
      s.store.close()
    }
  })
  it('reuses independent agent worktrees under concurrent requests and across a new manager instance', async () => {
    const s = await setup()
    try {
      const [a, again, b, c] = await Promise.all([
        s.workspace(),
        s.workspace(),
        s.workspace(s.store.require('agents', 'claude')),
        s.workspace(s.store.require('agents', 'antigravity')),
      ])
      expect(a.path).toBe(again.path)
      expect(new Set([a.path, b.path, c.path]).size).toBe(3)
      await writeFile(join(a.path, 'partial.txt'), 'unfinished')
      const restarted = new AutomaticProjects(s.store, s.manager, s.tests, () => {})
      expect((await restarted.workspace(s.project, s.agent, async () => true, s.signal)).path).toBe(
        a.path,
      )
      expect(await readFile(join(a.path, 'partial.txt'), 'utf8')).toBe('unfinished')
      expect(existsSync(join(b.path, 'partial.txt'))).toBe(false)
    } finally {
      s.store.close()
    }
  })
  it('recovers a moved registered worktree and its dirty files without deleting or recreating them', async () => {
    const s = await setup()
    try {
      const w = await s.workspace(),
        moved = w.path + '-moved'
      await writeFile(join(w.path, 'partial.txt'), 'preserve')
      await git(s.root, ['worktree', 'move', w.path, moved])
      expect((await s.workspace()).path).toBe(moved)
      expect(await readFile(join(moved, 'partial.txt'), 'utf8')).toBe('preserve')
    } finally {
      s.store.close()
    }
  })
  it('blocks integration on user edits and allows a pure integration retry after those edits are preserved', async () => {
    const s = await setup(await repository())
    try {
      const w = await s.workspace()
      await writeFile(join(w.path, 'agent.txt'), 'agent change')
      await writeFile(join(s.root, 'README.md'), 'user edit')
      const blocked = await s.auto.finish(s.project, w, s.signal)
      expect(blocked.status).toBe('attention')
      expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('user edit')
      expect(existsSync(join(s.root, 'agent.txt'))).toBe(false)
      await git(s.root, ['add', '--', 'README.md'])
      await git(s.root, [
        '-c',
        'user.name=User',
        '-c',
        'user.email=user@local.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'Preserve user edit',
      ])
      const retry = await s.auto.finish(s.project, w, s.signal)
      expect(retry.status, retry.detail).toBe('merged')
      expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('user edit')
      expect(await readFile(join(s.root, 'agent.txt'), 'utf8')).toBe('agent change')
    } finally {
      await s.tests.dispose()
      s.store.close()
    }
  })
  it('serializes independent integrations and automatically syncs clean workspaces before the next turn', async () => {
    const s = await setup()
    try {
      const a = await s.workspace(),
        b = await s.workspace(s.store.require('agents', 'claude'))
      await writeFile(join(a.path, 'backend.txt'), 'backend')
      await writeFile(join(b.path, 'frontend.txt'), 'frontend')
      const results = await Promise.all([
        s.auto.finish(s.project, a, s.signal),
        s.auto.finish(s.project, b, s.signal),
      ])
      expect(
        results.map((r) => r.status),
        JSON.stringify(results),
      ).toEqual(['merged', 'merged'])
      await writeFile(join(a.path, 'unfinished.txt'), 'keep unfinished changes')
      const synced = await s.workspace()
      expect(await readFile(join(synced.path, 'frontend.txt'), 'utf8')).toBe('frontend')
      expect(await readFile(join(synced.path, 'unfinished.txt'), 'utf8')).toBe(
        'keep unfinished changes',
      )
      expect(existsSync(join(s.root, 'unfinished.txt'))).toBe(false)
    } finally {
      s.store.close()
    }
  })
  it('syncs the actual primary merge before a second turn from the same agent, even with stale seen-head metadata', async () => {
    const s = await setup()
    try {
      const first = await s.workspace()
      await writeFile(join(first.path, 'first.txt'), 'first delivery')
      const result = await s.auto.finish(s.project, first, s.signal)
      expect(result.status, result.detail).toBe('merged')
      // Reproduce the old cache: primary merge is recorded, but not yet in the agent branch.
      s.store.put('workspaces', { ...first, syncedHead: result.revision })
      const second = await s.workspace()
      expect(await git(second.path, ['rev-parse', 'HEAD'])).toBe(result.revision)
      await writeFile(join(second.path, 'second.txt'), 'second delivery')
      const next = await s.auto.finish(s.project, second, s.signal)
      expect(next.status, next.detail).toBe('merged')
      expect(await readFile(join(s.root, 'first.txt'), 'utf8')).toBe('first delivery')
      expect(await readFile(join(s.root, 'second.txt'), 'utf8')).toBe('second delivery')
    } finally {
      await s.tests.dispose()
      s.store.close()
    }
  })
  it('keeps a failing integration snapshot and does not publish failed code to the primary folder', async () => {
    const s = await setup(await repository())
    try {
      const w = await s.workspace()
      await writeFile(
        join(w.path, 'package.json'),
        JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }),
      )
      const result = await s.auto.finish(s.project, w, s.signal)
      expect(result.status).toBe('attention')
      expect(result.previewId).toBeTruthy()
      expect(await readFile(join(s.root, 'package.json'), 'utf8')).toContain('fixture-test-pass')
      expect(s.store.snapshot().tests.some((t) => t.status === 'failed')).toBe(true)
    } finally {
      await s.tests.dispose()
      s.store.close()
    }
  })
  it('detects merge conflicts, wrong branches and enclosing repositories without discarding files', async () => {
    const s = await setup(await repository())
    try {
      const w = await s.workspace()
      await writeFile(join(w.path, 'README.md'), 'agent conflict')
      await writeFile(join(s.root, 'README.md'), 'user conflict')
      await git(s.root, ['add', '--', 'README.md'])
      await git(s.root, [
        '-c',
        'user.name=User',
        '-c',
        'user.email=u@local.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'User change',
      ])
      expect((await s.auto.finish(s.project, w, s.signal)).status).toBe('attention')
      expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('user conflict')
      await git(w.path, ['switch', '-c', 'external-branch'])
      await expect(s.workspace()).rejects.toThrow('branch changed')
      const child = join(s.root, 'nested')
      await mkdir(child)
      const nested = s.store.addProject(child, 'Nested')
      await expect(s.auto.prepare(nested)).rejects.toThrow('Repository 根目錄')
      expect(existsSync(join(child, '.git'))).toBe(false)
    } finally {
      s.store.close()
    }
  })
  it('flags oversized and unknown files for review rather than silently staging them', async () => {
    const root = await directory('scan-')
    await writeFile(join(root, 'large.txt'), Buffer.alloc(5 * 1024 * 1024 + 1))
    await writeFile(join(root, 'unknown.bin'), 'unknown')
    const result = await scanFiles(root, ['large.txt', 'unknown.bin'])
    expect(result.review).toHaveLength(2)
    expect(result.files).toHaveLength(0)
  })
  it('recovers a missing clean directory from its saved branch without pruning or deleting other worktrees', async () => {
    const s = await setup()
    try {
      const w = await s.workspace()
      const target = resolve(w.path),
        intended = resolve(s.manager.directory)
      if (!target.startsWith(intended + '\\'))
        throw new Error('Refusing test deletion outside owned managed directory')
      expect(await git(target, ['status', '--porcelain'])).toBe('')
      await rm(target, { recursive: true })
      const recovered = await s.workspace()
      expect(recovered.path).not.toBe(w.path)
      expect(existsSync(join(recovered.path, '.gitignore'))).toBe(true)
      expect(await git(s.root, ['rev-parse', `refs/heads/${w.branch}`])).toBeTruthy()
    } finally {
      s.store.close()
    }
  })
  it('refuses a colliding managed path without changing existing contents', async () => {
    const s = await setup()
    try {
      const existing = await s.workspace(),
        path = existing.path
      s.store.remove('workspaces', existing.id)
      await writeFile(join(path, 'owned.txt'), 'keep')
      await expect(s.workspace()).rejects.toThrow('already contains data')
      expect(await readFile(join(path, 'owned.txt'), 'utf8')).toBe('keep')
    } finally {
      s.store.close()
    }
  })
  it('accepts ordinary CRLF normalization without treating it as a content race', async () => {
    const s = await setup()
    try {
      await git(s.root, ['init', '-b', 'main'])
      await git(s.root, ['config', 'core.autocrlf', 'true'])
      await writeFile(join(s.root, 'readme.txt'), 'Hello\r\nWorld\r\n')
      await s.auto.prepare(s.project)
      expect(await readFile(join(s.root, 'readme.txt'), 'utf8')).toBe('Hello\r\nWorld\r\n')
      expect(await git(s.root, ['show', 'HEAD:readme.txt'], false)).toBe('Hello\nWorld\n')
    } finally {
      s.store.close()
    }
  })
  it('marks pending integration as review-only after restart and retries without invoking the adapter twice', async () => {
    const s = await setup(await repository())
    let calls = 0
    const adapter: AgentAdapter = {
      detect: async () => ({
        provider: 'codex',
        installed: true,
        authenticated: true,
        version: 'fixture',
        detail: 'fixture',
        models: [],
      }),
      dispose: async () => {},
      run: async (ctx) => {
        calls++
        await writeFile(join(ctx.workspace, 'agent.txt'), 'work')
        return 'Created file (unit fixture)'
      },
    }
    const orch = new Orchestrator(s.store, new Map([['codex', adapter]]), () => {})
    orch.setWorkspaceManager(s.manager)
    orch.automatic = s.auto
    try {
      await s.auto.prepare(s.project)
      await writeFile(join(s.root, 'README.md'), 'Uncommitted user edit')
      const room = s.store.snapshot().conversations[0]
      orch.send(room.id, 'Unit fixture task', ['codex'])
      await until(() => s.store.snapshot().tasks[0]?.integration?.status === 'attention', 15000)
      await until(() => !orch.isBusy(s.project.id), 15000)
      const task = s.store.snapshot().tasks[0]
      expect(calls).toBe(1)
      s.store.recover()
      expect(s.store.snapshot().tasks[0].waitReason).toBe('integration')
      expect(() => orch.taskAction(task.id, 'resume')).toThrow('Agent 已完成')
      await s.auto.savePrimary(s.project)
      await orch.retryIntegration(task.id)
      expect(calls).toBe(1)
      expect(s.store.snapshot().tasks[0].status).toBe('completed')
      expect(await readFile(join(s.root, 'README.md'), 'utf8')).toBe('Uncommitted user edit')
      expect(await readFile(join(s.root, 'agent.txt'), 'utf8')).toBe('work')
    } finally {
      await orch.dispose()
      await s.tests.dispose()
      s.store.close()
    }
  })
  it('publishes leftover edits as agent work in autonomous mode', async () => {
    const s = await setup()
    try {
      const w = await s.workspace()
      await writeFile(join(w.path, 'carried.txt'), 'finished by the agent')
      const before = await s.auto.capture(w)
      const result = await s.auto.finish(s.project, w, s.signal, before)
      expect(result.status).toBe('merged')
      expect(await readFile(join(s.root, 'carried.txt'), 'utf8')).toBe('finished by the agent')
    } finally {
      s.store.close()
    }
  })
  it('keeps prior unfinished edits unpublished when the next turn only reads them', async () => {
    const s = await setup()
    try {
      const w = await s.workspace()
      s.store.put('settings', { ...s.store.settings(), id: 'general', autonomy: 'ask' })
      await writeFile(join(w.path, 'unfinished.txt'), 'not ready for publishing')
      const before = await s.auto.capture(w)
      const result = await s.auto.finish(s.project, w, s.signal, before)
      expect(result.status).toBe('unchanged')
      expect(await readFile(join(w.path, 'unfinished.txt'), 'utf8')).toBe(
        'not ready for publishing',
      )
      expect(existsSync(join(s.root, 'unfinished.txt'))).toBe(false)
      expect(await git(w.path, ['status', '--porcelain'])).toContain('unfinished.txt')
    } finally {
      s.store.close()
    }
  })
  it('allocates a different branch on a name collision without resetting the existing branch', async () => {
    const s = await setup()
    try {
      await s.auto.prepare(s.project)
      await git(s.root, ['branch', 'agenthub/codex-collision'])
      const head = await git(s.root, ['rev-parse', 'agenthub/codex-collision'])
      const names = ['collision', 'available']
      const auto = new AutomaticProjects(
        s.store,
        s.manager,
        s.tests,
        () => {},
        () => names.shift() || 'fallback',
      )
      const w = await auto.workspace(s.project, s.agent, async () => true, s.signal)
      expect(w.branch).toBe('agenthub/codex-available')
      expect(await git(s.root, ['rev-parse', 'agenthub/codex-collision'])).toBe(head)
    } finally {
      s.store.close()
    }
  })
  it('does not execute repository clean filters during automatic snapshot creation', async () => {
    const s = await setup()
    try {
      await git(s.root, ['init', '-b', 'main'])
      await git(s.root, [
        'config',
        'filter.unsafe.clean',
        "node -e \"require('fs').writeFileSync('filter-ran.txt','bad')\"",
      ])
      await writeFile(join(s.root, '.gitattributes'), '*.txt filter=unsafe\n')
      await writeFile(join(s.root, 'readme.txt'), 'ordinary source')
      await expect(s.auto.prepare(s.project)).rejects.toThrow('filter requires explicit review')
      expect(existsSync(join(s.root, 'filter-ran.txt'))).toBe(false)
      expect(await readFile(join(s.root, 'readme.txt'), 'utf8')).toBe('ordinary source')
    } finally {
      s.store.close()
    }
  })
  it.each(['', 'codex', 'claude'])(
    'holds automatic integration without a final exact review from configured reviewer %s',
    async (reviewerId) => {
      const s = await setup()
      try {
        const w = await s.workspace()
        s.store.put('settings', {
          ...s.store.settings(),
          id: 'general',
          automaticReview: true,
          reviewerId,
        })
        await writeFile(join(w.path, 'index.html'), '<html>Review this</html>')
        const result = await s.auto.finish(s.project, w, s.signal)
        expect(result.status).toBe('attention')
        expect(result.detail).toContain('Review')
        expect(existsSync(join(s.root, 'index.html'))).toBe(false)
      } finally {
        s.store.close()
      }
    },
  )
})
