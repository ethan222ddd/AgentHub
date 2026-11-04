import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { TestRunner } from '../src/main/tasks/tests'
import type { TestRun } from '../src/shared/types'
import { directory, repository, until } from './helpers'
describe('Version-specific project test execution', () => {
  it('records real process output and rejects success claims after tracked files mutate', async () => {
    const root = await repository()
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'node -e "console.log(\'fixture-pass\')"',
          build: "node -e \"require('fs').writeFileSync('README.md','changed')\"",
        },
      }),
    )
    await git(root, ['add', '.'])
    await git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@local.invalid',
      'commit',
      '-m',
      'Test scripts',
    ])
    const store = new Store(':memory:')
    const project = store.addProject(root, 'Repo')
    const [workspace] = await new WorkspaceManager(
      store,
      await directory('test-workspaces-'),
    ).prepare(project, false)
    const runner = new TestRunner(store, () => {})
    const first = await runner.run(workspace, 'test')
    await until(() => store.get<TestRun>('test_runs', first.id)?.status !== 'running', 10000)
    expect(store.get<TestRun>('test_runs', first.id)).toMatchObject({
      status: 'passed',
      revision: await git(workspace.path, ['rev-parse', 'HEAD']),
    })
    expect(store.get<TestRun>('test_runs', first.id)?.logs).toContain('fixture-pass')
    const second = await runner.run(workspace, 'build')
    await until(() => store.get<TestRun>('test_runs', second.id)?.status !== 'running', 10000)
    expect(store.get<TestRun>('test_runs', second.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Workspace changed'),
    })
    await runner.dispose()
    store.close()
  })
})
