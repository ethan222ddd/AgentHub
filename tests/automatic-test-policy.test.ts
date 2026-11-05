import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/database/store'
import { AutomaticProjects } from '../src/main/git/automatic'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import type { TestRunner } from '../src/main/tasks/tests'
import type { AgentProfile, TestRun, Workspace } from '../src/shared/types'
import { directory, repository } from './helpers'

// Only the test executor is a fixture; checkpoint, preview, merge gates and Git are real.
describe('automatic integration test policy', { timeout: 60000 }, () => {
  it.each(['EPERM', 'FAIL 1 assertion; fixture title: No test files found'])(
    'keeps a failed snapshot isolated when its output contains %s',
    async (logs) => {
      const store = new Store(':memory:')
      const project = {
        ...store.addProject(await repository(), 'Policy fixture'),
        autoManaged: true,
      }
      store.put('projects', project)
      const primary = await git(project.path, ['rev-parse', 'HEAD'])
      const manager = new WorkspaceManager(store, await directory('test-policy-'))
      const calls: boolean[] = []
      const executor = {
        async run(workspace: Workspace, kind: string, sandboxed: boolean) {
          calls.push(sandboxed)
          const run: TestRun = {
            id: randomUUID(),
            projectId: project.id,
            workspaceId: workspace.id,
            revision: await git(workspace.path, ['rev-parse', 'HEAD']),
            kind: 'test',
            execution: 'native-sandbox',
            name: `fixture ${kind}`,
            status: 'failed',
            logs,
            error: 'Sandboxed process exited (1)',
            startedAt: new Date().toISOString(),
            durationMs: 1,
          }
          store.put('test_runs', run)
          return run
        },
        async wait() {},
        async cancel() {},
      }
      const auto = new AutomaticProjects(
        store,
        manager,
        executor as unknown as TestRunner,
        () => {},
      )
      try {
        const signal = new AbortController().signal
        const workspace = await auto.workspace(
          project,
          store.require<AgentProfile>('agents', 'codex'),
          async () => true,
          signal,
        )
        await writeFile(join(workspace.path, 'README.md'), 'Changed in the agent workspace\n')
        const result = await auto.finish(project, workspace, signal)
        expect(result.status).toBe('attention')
        expect(calls).toEqual([true])
        expect(store.list<TestRun>('test_runs').map((r) => r.status)).toEqual(['failed'])
        expect(await git(project.path, ['rev-parse', 'HEAD'])).toBe(primary)
      } finally {
        store.close()
      }
    },
  )
})
