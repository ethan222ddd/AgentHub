import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import { git, WorkspaceManager } from '../src/main/git/workspaces'
import { directory, repository, until } from './helpers'
import { TestRunner } from '../src/main/tasks/tests'
import type { TestRun, Workspace } from '../src/shared/types'
async function testSnapshot(store: Store, preview: { integrationWorkspaceId: string }) {
  const runner = new TestRunner(store, () => {})
  const run = await runner.run(
    store.require<Workspace>('workspaces', preview.integrationWorkspaceId),
    'test',
  )
  await until(() => store.get<TestRun>('test_runs', run.id)?.status !== 'running', 10000)
  expect(store.get<TestRun>('test_runs', run.id)?.status).toBe('passed')
  await runner.dispose()
}
// Real guarded Git commands incur process startup overhead on Windows. This
// suite creates, tests and merges several complete worktrees per assertion.
describe('Git worktree isolation and reviewed integration', { timeout: 120000 }, () => {
  it('isolates changes, previews exact snapshots, merges and rejects stale previews', async () => {
    const root = await repository()
    const store = new Store(':memory:')
    const project = store.addProject(root, 'Repo')
    const manager = new WorkspaceManager(store, await directory('worktrees-'))
    const [a, b] = await manager.prepare(project, false)
    await writeFile(join(a.path, 'backend.txt'), 'isolated')
    await expect(readFile(join(b.path, 'backend.txt'))).rejects.toThrow()
    await expect(readFile(join(root, 'backend.txt'))).rejects.toThrow()
    const source = await manager.checkpoint(a, 'Backend checkpoint')
    const preview = await manager.preview(a)
    expect(preview.source).toBe(source)
    expect(preview.diff).toContain('+isolated')
    await writeFile(join(root, 'dirty.txt'), 'preserve me')
    await expect(manager.merge(preview.id)).rejects.toThrow('Uncommitted')
    await git(root, ['add', '.'])
    await git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@local.invalid',
      'commit',
      '-m',
      'User change',
    ])
    await expect(manager.merge(preview.id)).rejects.toThrow('changed since preview')
    const fresh = await manager.preview(a)
    await expect(manager.merge(fresh.id)).rejects.toThrow('pass tests')
    await testSnapshot(store, fresh)
    await manager.merge(fresh.id)
    expect(await readFile(join(root, 'backend.txt'), 'utf8')).toBe('isolated')
    expect(await readFile(join(root, 'dirty.txt'), 'utf8')).toBe('preserve me')
    await expect(readFile(join(b.path, 'backend.txt'))).rejects.toThrow()
    const rollback = await manager.revertProject(project.id)
    await expect(manager.merge(rollback.id)).rejects.toThrow('pass tests')
    await testSnapshot(store, rollback)
    await manager.merge(rollback.id)
    await expect(readFile(join(root, 'backend.txt'))).rejects.toThrow()
    expect(await readFile(join(root, 'dirty.txt'), 'utf8')).toBe('preserve me')
    store.close()
  })
  it('detects conflicts without modifying either branch', async () => {
    const root = await repository()
    const store = new Store(':memory:')
    const project = store.addProject(root, 'Repo')
    const manager = new WorkspaceManager(store, await directory('worktrees-'))
    const [a, b] = await manager.prepare(project, false)
    await writeFile(join(a.path, 'README.md'), 'A\n')
    await manager.checkpoint(a, 'A')
    await writeFile(join(b.path, 'README.md'), 'B\n')
    await manager.checkpoint(b, 'B')
    const preview = await manager.preview(a)
    await testSnapshot(store, preview)
    await manager.merge(preview.id)
    const before = await git(root, ['rev-parse', 'HEAD'])
    await expect(manager.preview(b)).rejects.toThrow()
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(before)
    expect(await git(root, ['status', '--porcelain'])).toBe('')
    store.close()
  })
})
