import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseUnifiedDiff } from '../src/renderer/lib/diff-lines'
import { diffFeedbackMessage } from '../src/main/orchestrator/feedback'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import type { Workspace } from '../src/shared/types'
import { directory, repository } from './helpers'

const sample = [
  'diff --git a/src/pay.ts b/src/pay.ts',
  'index 1111111..2222222 100644',
  '--- a/src/pay.ts',
  '+++ b/src/pay.ts',
  '@@ -3,4 +3,5 @@ export function pay() {',
  '   const amount = 1',
  '-  charge(amount)',
  '+  const key = header()',
  '+  charge(amount, key)',
  '   return amount',
  '\\ No newline at end of file',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1 @@',
  '+hello',
].join('\n')

describe('diff review', () => {
  it('parses files, line numbers and statuses from git diff output', () => {
    const [pay, added] = parseUnifiedDiff(sample)
    expect(pay).toMatchObject({
      path: 'src/pay.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    })
    const lines = pay.lines.filter((l) => l.kind !== 'hunk' && l.kind !== 'meta')
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['ctx', 3, 3],
      ['del', 4, undefined],
      ['add', undefined, 4],
      ['add', undefined, 5],
      ['ctx', 5, 6],
    ])
    expect(pay.lines.at(-1)?.kind).toBe('meta')
    expect(added).toMatchObject({ path: 'new.md', status: 'added', additions: 1 })
    expect(added.lines.at(-1)).toMatchObject({ kind: 'add', newLine: 1, text: 'hello' })
  })

  it('formats comments for the agent and refuses paths outside the workspace', async () => {
    const root = await directory('feedback-')
    const workspace: Workspace = {
      id: 'w',
      projectId: 'p',
      agentId: 'codex',
      path: root,
      branch: 'agenthub/codex-1',
    }
    const message = await diffFeedbackMessage(
      workspace,
      [{ file: 'src\\pay.ts', line: 4, content: 'Validate the key\n  before charging' }],
      'Keep the API stable.',
    )
    expect(message).toContain('agenthub/codex-1')
    expect(message).toContain('- src/pay.ts:4 — Validate the key before charging')
    expect(message.endsWith('\nKeep the API stable.')).toBe(true)
    await expect(
      diffFeedbackMessage(workspace, [{ file: '../outside.ts', line: 1, content: 'x' }]),
    ).rejects.toThrow(/escapes/)
    await expect(diffFeedbackMessage(workspace, [])).rejects.toThrow(/at least one/)
  })

  it('diffs a workspace since a task started, including committed work', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Repo')
    const manager = new WorkspaceManager(store, await directory('diff-since-'))
    await manager.prepare(project, false)
    const workspace = store.list<Workspace>('workspaces').find((w) => w.agentId === 'codex')!
    const start = await git(workspace.path, ['rev-parse', 'HEAD'])
    await writeFile(join(workspace.path, 'README.md'), '# Changed by the task\n')
    await git(workspace.path, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@local.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qam',
      'task commit',
    ])
    expect((await manager.diff(workspace)).diff).toBe('')
    const since = await manager.diff(workspace, start)
    expect(since.since).toBe(start)
    expect(parseUnifiedDiff(since.diff)[0]).toMatchObject({ path: 'README.md', additions: 1 })
    await expect(manager.diff(workspace, 'HEAD; rm -rf')).rejects.toThrow(/Invalid revision/)
  })
})
