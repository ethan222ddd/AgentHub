import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { OverlapMonitor, findOverlaps, parsePorcelain } from '../src/main/git/overlaps'
import type { Message, Task, Workspace } from '../src/shared/types'
import { directory, repository } from './helpers'

const commit = (cwd: string, message: string) =>
  git(cwd, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qam',
    message,
  ])

describe('file overlap early warning', () => {
  it('parses porcelain -z output including renames', () => {
    expect(parsePorcelain(' M src/a.ts\0?? new file.ts\0R  b2.ts\0b.ts\0')).toEqual([
      'src/a.ts',
      'new file.ts',
      'b2.ts',
    ])
    expect(
      findOverlaps([
        { workspaceId: 'w1', agentId: 'codex', files: new Map([['x', false]]) },
        {
          workspaceId: 'w2',
          agentId: 'claude',
          files: new Map([
            ['x', true],
            ['y', true],
          ]),
        },
      ]),
    ).toEqual([
      {
        path: 'x',
        agents: [
          { agentId: 'codex', workspaceId: 'w1', uncommitted: false },
          { agentId: 'claude', workspaceId: 'w2', uncommitted: true },
        ],
      },
    ])
  })

  it('finds files two agents changed before integration and announces each set once', async () => {
    const store = new Store(':memory:')
    const project = store.addProject(await repository(), 'Repo')
    store.put('projects', { ...project, autoManaged: false })
    const c = store.snapshot().conversations[0]
    const manager = new WorkspaceManager(store, await directory('overlaps-'))
    await manager.prepare(project, false)
    const ws = (agentId: string) =>
      store.list<Workspace>('workspaces').find((w) => w.agentId === agentId)!
    // Codex commits a change; Claude edits the same file without committing.
    await writeFile(join(ws('codex').path, 'README.md'), '# Codex change\n')
    await commit(ws('codex').path, 'codex edit')
    await writeFile(join(ws('claude').path, 'README.md'), '# Claude change\n')
    await writeFile(join(ws('claude').path, 'only-claude.txt'), 'solo\n')
    for (const agentId of ['codex', 'claude'])
      store.put('tasks', {
        id: `t-${agentId}`,
        projectId: project.id,
        conversationId: c.id,
        agentId,
        name: agentId,
        description: '',
        status: 'running',
        dependencies: [],
        createdAt: new Date().toISOString(),
        correlationId: 'x',
        depth: 0,
      } satisfies Task)
    let changes = 0
    const monitor = new OverlapMonitor(store, () => changes++)
    try {
      const result = await monitor.scan(project.id)
      expect(result.files).toEqual([
        {
          path: 'README.md',
          agents: [
            { agentId: 'codex', workspaceId: ws('codex').id, uncommitted: false },
            { agentId: 'claude', workspaceId: ws('claude').id, uncommitted: true },
          ],
        },
      ])
      expect(monitor.all()[project.id].files).toHaveLength(1)
      expect(changes).toBe(1)
      const warnings = () =>
        store.list<Message>('messages').filter((m) => m.content.startsWith('可能的合併衝突'))
      expect(warnings()).toHaveLength(1)
      expect(warnings()[0].content).toContain('README.md')
      await monitor.scan(project.id)
      expect(warnings()).toHaveLength(1)
      // Once Claude discards its edit the overlap clears without another message.
      await git(ws('claude').path, ['checkout', '--', 'README.md'])
      expect((await monitor.scan(project.id)).files).toEqual([])
      expect(warnings()).toHaveLength(1)
    } finally {
      monitor.dispose()
    }
  })
})
