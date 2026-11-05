import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { git } from './command'
import { assertSafeGitAttributes } from './safe-snapshot'
import { Store } from '../database/store'
import { assertAssignedRoot, withinWorkspace } from '../permissions/paths'
import type { AgentProfile, Project, TestRun, Workspace } from '../../shared/types'
export { git } from './command'
interface Preview {
  mode?: 'merge' | 'revert'
  id: string
  workspaceId: string
  target: string
  targetRef: string
  source: string
  branch: string
  projectPath: string
  diff: string
  tree: string
  sourcePath: string
  integrationWorkspaceId: string
  integrationCommit: string
}
export class WorkspaceManager {
  private previews = new Map<string, Preview>()
  private initialPreviews = new Map<
    string,
    { projectId: string; files: { path: string; sha256: string; bytes: number }[] }
  >()
  constructor(
    private store: Store,
    readonly directory: string,
  ) {
    for (const preview of store.list<Preview>('merge_previews'))
      this.previews.set(preview.id, preview)
  }
  async initialPreview(projectId: string) {
    const project = this.store.require<Project>('projects', projectId)
    await assertAssignedRoot(project.path)
    try {
      await git(project.path, ['rev-parse', 'HEAD'])
      throw new Error('Repository already has a commit')
    } catch (e) {
      if ((e as Error).message.includes('already has')) throw e
    }
    const top = await git(project.path, ['rev-parse', '--show-toplevel'])
    if (
      top.replaceAll('\\', '/').toLowerCase() !== project.path.replaceAll('\\', '/').toLowerCase()
    )
      throw new Error('Select the Git repository root')
    if (await git(project.path, ['diff', '--cached', '--name-only']))
      throw new Error(
        'Existing staged files detected. Review or unstage them in Git before using the initial-commit flow.',
      )
    const paths = (
      await git(project.path, ['ls-files', '--others', '--exclude-standard', '-z'], false)
    )
      .split('\0')
      .filter(Boolean)
    if (paths.length > 1000)
      throw new Error('More than 1000 files. Add ignore rules before reviewing the initial commit.')
    const files = []
    for (const path of paths) {
      if (/(^|\/)(\.env(?:\..*)?|credentials[^/]*|auth\.json|.*\.(?:pem|key))$/i.test(path))
        continue
      const canonical = await withinWorkspace(project.path, path)
      const data = await readFile(canonical)
      files.push({
        path,
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      })
    }
    const id = randomUUID()
    this.initialPreviews.set(id, { projectId, files })
    return { id, files, excluded: paths.length - files.length }
  }
  async initialCommit(id: string, files: string[]) {
    const preview = this.initialPreviews.get(id)
    if (!preview) throw new Error('Initial preview expired')
    const project = this.store.require<Project>('projects', preview.projectId)
    await assertAssignedRoot(project.path)
    try {
      await git(project.path, ['rev-parse', 'HEAD'])
      throw new Error('Repository changed since preview')
    } catch (e) {
      if ((e as Error).message.includes('changed since')) throw e
    }
    if (await git(project.path, ['diff', '--cached', '--name-only']))
      throw new Error('Staging area changed since preview')
    for (const path of files) {
      const file = preview.files.find((f) => f.path === path)
      if (!file) throw new Error('File was not in the reviewed preview')
      if (
        createHash('sha256')
          .update(await readFile(await withinWorkspace(project.path, path)))
          .digest('hex') !== file.sha256
      )
        throw new Error('File changed since preview')
    }
    await git(project.path, ['add', '--', ...files])
    await git(project.path, [
      '-c',
      'user.name=AgentHub',
      '-c',
      'user.email=local@agenthub.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Initial reviewed project snapshot',
    ])
    this.initialPreviews.delete(id)
    return git(project.path, ['rev-parse', 'HEAD'])
  }
  async addDefaultIgnore(projectId: string) {
    const project = this.store.require<Project>('projects', projectId)
    const path = await withinWorkspace(project.path, '.gitignore', true)
    let content = ''
    try {
      content = await readFile(path, 'utf8')
    } catch {
      /* new ignore */
    }
    const patterns = [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '.next/',
      '.nuxt/',
      '.cache/',
      '*.log',
      '.DS_Store',
      'Thumbs.db',
      '.venv/',
      '__pycache__/',
      'target/',
      'bin/',
      'obj/',
      '.env',
      '.env.*',
      '*.pem',
      '*.key',
      '*.p12',
      '*.pfx',
      '*.sqlite',
      '*.sqlite3',
      '*.sqlite-*',
      '*.db',
      '.npmrc',
      '.pypirc',
      'credentials.*',
      'secrets.*',
      'secret.*',
      'service-account*.json',
      '*.tsbuildinfo',
    ]
    const existing = new Set(content.split(/\r?\n/))
    const additions = patterns.filter((p) => !existing.has(p))
    if (additions.length)
      await writeFile(
        path,
        content +
          '\n# AgentHub local build and credential exclusions\n' +
          additions.join('\n') +
          '\n',
      )
  }
  async snapshot(
    source: Workspace,
    revision: string,
    kind: 'integration' | 'review',
  ): Promise<Workspace> {
    const project = this.store.require<Project>('projects', source.projectId)
    await assertAssignedRoot(source.path)
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Invalid snapshot revision')
    const id = randomUUID()
    const path = join(this.directory, project.id, kind + 's', id)
    await mkdir(join(this.directory, project.id, kind + 's'), { recursive: true })
    await git(project.path, ['worktree', 'add', '--detach', path, revision])
    const workspace: Workspace = {
      id: `${kind}:${id}`,
      projectId: project.id,
      agentId: kind,
      path,
      branch: `${kind}/${id}`,
      kind,
    }
    this.store.put('workspaces', workspace)
    return workspace
  }
  async prepare(project: Project, initialize: boolean): Promise<Workspace[]> {
    await assertAssignedRoot(project.path)
    let repo = false
    try {
      repo = await git(project.path, ['rev-parse', '--show-toplevel']).then(
        (root) =>
          root.replaceAll('\\', '/').toLowerCase() ===
          project.path.replaceAll('\\', '/').toLowerCase(),
      )
    } catch {
      /* not a repository */
    }
    if (!repo) {
      if (!initialize)
        throw new Error('Select a Git repository root, or explicitly approve initialization.')
      // Do not mutate an enclosing repository by accidentally nesting/initializing it.
      try {
        await git(project.path, ['rev-parse', '--show-toplevel'])
        throw new Error('Selected directory is inside another Git repository. Select its root.')
      } catch (e) {
        if ((e as Error).message.includes('Selected directory')) throw e
      }
      await git(project.path, ['init'])
    }
    try {
      await git(project.path, ['rev-parse', 'HEAD'])
    } catch {
      if (initialize) return [] // Explicit initialization succeeded; review an initial commit next.
      throw new Error(
        'Repository needs an initial commit. Review files and commit using Git before creating agent worktrees.',
      )
    }
    const items: Workspace[] = []
    for (const agent of this.store
      .list<AgentProfile>('agents')
      .filter((a) => a.enabled && (!project.agentIds || project.agentIds.includes(a.id)))) {
      const id = `${project.id}:${agent.id}`
      const existing = this.store.get<Workspace>('workspaces', id)
      if (existing) {
        await assertAssignedRoot(existing.path)
        items.push(existing)
        continue
      }
      const folder = join(this.directory, project.id, agent.id.replace(/[^a-zA-Z0-9-]/g, '_'))
      await mkdir(join(this.directory, project.id), { recursive: true })
      const branch = `agenthub/${agent.provider}-${randomUUID().slice(0, 8)}`
      await git(project.path, ['worktree', 'add', '-b', branch, folder, 'HEAD'])
      const workspace: Workspace = {
        id,
        projectId: project.id,
        agentId: agent.id,
        path: folder,
        branch,
      }
      this.store.put('workspaces', workspace)
      items.push(workspace)
    }
    return items
  }
  /** Working tree against HEAD, or against an earlier revision (a task's start) when given. */
  async diff(workspace: Workspace, since = 'HEAD') {
    await assertAssignedRoot(workspace.path)
    if (since !== 'HEAD' && !/^[0-9a-f]{7,64}$/i.test(since)) throw new Error('Invalid revision')
    return {
      status: await git(workspace.path, ['status', '--short']),
      diff: await git(workspace.path, ['diff', '--no-ext-diff', '--no-textconv', since, '--']),
      since,
      revision: await git(workspace.path, ['rev-parse', 'HEAD']),
      path: workspace.path,
      branch: workspace.branch,
    }
  }
  async checkpoint(workspace: Workspace, message: string): Promise<string> {
    await assertAssignedRoot(workspace.path)
    await git(workspace.path, ['add', '--all', '--', '.'])
    await git(workspace.path, [
      '-c',
      'user.name=AgentHub',
      '-c',
      'user.email=local@agenthub.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message,
    ])
    const revision = await git(workspace.path, ['rev-parse', 'HEAD'])
    this.store.put('checkpoints', {
      id: randomUUID(),
      workspaceId: workspace.id,
      revision,
      timestamp: new Date().toISOString(),
    } as { id: string })
    return revision
  }
  async preview(
    workspace: Workspace,
    direction: 'integrate' | 'sync' = 'integrate',
  ): Promise<Preview> {
    const project = this.store.require<Project>('projects', workspace.projectId)
    await assertAssignedRoot(project.path)
    await assertAssignedRoot(workspace.path)
    if (await git(project.path, ['status', '--porcelain']))
      throw new Error('Project has uncommitted files. Preserve them before merging.')
    if (await git(workspace.path, ['status', '--porcelain']))
      throw new Error('Checkpoint agent changes before merge preview.')
    const targetPath = direction === 'integrate' ? project.path : workspace.path
    const sourcePath = direction === 'integrate' ? workspace.path : project.path
    const target = await git(targetPath, ['rev-parse', 'HEAD'])
    const source = await git(sourcePath, ['rev-parse', 'HEAD'])
    const tree = await git(project.path, ['merge-tree', '--write-tree', target, source])
    const id = randomUUID()
    const integrationCommit = await git(project.path, [
      '-c',
      'user.name=AgentHub',
      '-c',
      'user.email=local@agenthub.invalid',
      'commit-tree',
      tree.split('\n')[0],
      '-p',
      target,
      '-p',
      source,
      '-m',
      'AgentHub integration preview snapshot',
    ])
    const integrationPath = join(this.directory, project.id, 'previews', id)
    await mkdir(join(this.directory, project.id, 'previews'), { recursive: true })
    await git(project.path, ['worktree', 'add', '--detach', integrationPath, integrationCommit])
    const integrationWorkspaceId = `preview:${id}`
    this.store.put('workspaces', {
      id: integrationWorkspaceId,
      projectId: project.id,
      agentId: 'integration',
      path: integrationPath,
      branch: `preview/${id}`,
      kind: 'integration',
    } satisfies Workspace)
    const preview = {
      id,
      workspaceId: workspace.id,
      projectPath: targetPath,
      sourcePath,
      integrationWorkspaceId,
      integrationCommit,
      target,
      targetRef: await git(targetPath, ['symbolic-ref', 'HEAD']),
      source,
      branch: workspace.branch,
      tree: tree.split('\n')[0],
      diff: await git(project.path, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        target,
        tree.split('\n')[0],
        '--',
      ]),
    }
    this.previews.set(preview.id, preview)
    this.store.put('merge_previews', preview)
    return preview
  }
  async revertProject(projectId: string) {
    const project = this.store.require<Project>('projects', projectId)
    return this.revertPreview({
      id: `project:${project.id}`,
      projectId: project.id,
      agentId: 'user',
      path: project.path,
      branch: await git(project.path, ['symbolic-ref', '--short', 'HEAD']),
    })
  }
  async revertPreview(input: string | Workspace) {
    const target =
      typeof input === 'string' ? this.store.require<Workspace>('workspaces', input) : input
    const workspaceId = target.id
    await assertAssignedRoot(target.path)
    if (await git(target.path, ['status', '--porcelain']))
      throw new Error('Checkpoint current changes before a reversible rollback')
    const head = await git(target.path, ['rev-parse', 'HEAD'])
    const parents = (await git(target.path, ['rev-list', '--parents', '-n', '1', head])).split(' ')
    if (parents.length < 2)
      throw new Error('Initial commit cannot be reverted through this workflow')
    const snapshot = await this.snapshot(target, head, 'integration')
    await git(snapshot.path, [
      'revert',
      '--no-commit',
      ...(parents.length > 2 ? ['-m', '1'] : []),
      head,
    ])
    await this.checkpoint(snapshot, `Revert reviewed commit ${head.slice(0, 12)}`)
    const source = await git(snapshot.path, ['rev-parse', 'HEAD'])
    const tree = await git(snapshot.path, ['rev-parse', 'HEAD^{tree}'])
    const preview: Preview = {
      id: randomUUID(),
      mode: 'revert',
      workspaceId,
      projectPath: target.path,
      sourcePath: snapshot.path,
      target: head,
      source,
      branch: target.branch,
      targetRef: await git(target.path, ['symbolic-ref', 'HEAD']),
      tree,
      integrationWorkspaceId: snapshot.id,
      integrationCommit: source,
      diff: await git(target.path, ['diff', '--no-ext-diff', '--no-textconv', head, source, '--']),
    }
    this.previews.set(preview.id, preview)
    this.store.put('merge_previews', preview)
    return preview
  }
  async merge(previewId: string): Promise<string> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error('Preview expired. Generate a fresh preview.')
    const snapshot = this.store.require<Workspace>('workspaces', preview.integrationWorkspaceId)
    await assertAssignedRoot(preview.projectPath)
    await assertAssignedRoot(preview.sourcePath)
    await assertAssignedRoot(snapshot.path)
    await assertSafeGitAttributes(preview.projectPath)
    await assertSafeGitAttributes(preview.sourcePath)
    await assertSafeGitAttributes(snapshot.path)
    if ((await git(preview.projectPath, ['symbolic-ref', 'HEAD'])) !== preview.targetRef)
      throw new Error('Target branch changed; review again.')
    if (
      (await git(preview.projectPath, ['rev-parse', 'HEAD'])) !== preview.target ||
      (await git(preview.sourcePath, ['rev-parse', 'HEAD'])) !== preview.source
    )
      throw new Error('Code changed since preview. Review again.')
    if (
      (await git(preview.projectPath, ['status', '--porcelain'])) ||
      (await git(preview.sourcePath, ['status', '--porcelain']))
    )
      throw new Error('Uncommitted changes detected; merge refused.')
    if (
      (await git(snapshot.path, ['rev-parse', 'HEAD'])) !== preview.integrationCommit ||
      (await git(snapshot.path, ['status', '--porcelain']))
    )
      throw new Error('Integration snapshot changed. Review and test a fresh preview.')
    if (
      !this.store
        .list<TestRun>('test_runs')
        .some(
          (run) =>
            run.workspaceId === snapshot.id &&
            run.revision === preview.integrationCommit &&
            (run.kind === 'test' || run.name === 'npm run test') &&
            run.status === 'passed',
        )
    )
      throw new Error('Run and pass tests on this exact integration preview before merging.')
    const tree = await git(preview.projectPath, [
      'merge-tree',
      '--write-tree',
      preview.target,
      preview.source,
    ])
    if (tree.split('\n')[0] !== preview.tree) throw new Error('Merge tree changed; review again.')
    await git(preview.projectPath, [
      '-c',
      'user.name=AgentHub',
      '-c',
      'user.email=local@agenthub.invalid',
      '-c',
      'commit.gpgsign=false',
      'merge',
      preview.mode === 'revert' ? '--ff-only' : '--no-ff',
      '--no-edit',
      preview.source,
    ])
    this.previews.delete(previewId)
    this.store.remove('merge_previews', previewId)
    if ((await git(preview.projectPath, ['rev-parse', 'HEAD^{tree}'])) !== preview.tree)
      throw new Error(
        'Merged tree differs from tested snapshot. State preserved for manual inspection.',
      )
    return git(preview.projectPath, ['rev-parse', 'HEAD'])
  }
  async discard(previewId: string) {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error('Preview not found')
    this.previews.delete(previewId)
    this.store.remove('merge_previews', previewId)
    return this.removeSnapshot(preview.integrationWorkspaceId)
  }
  private async removeSnapshot(id: string) {
    const workspace = this.store.require<Workspace>('workspaces', id)
    if (!workspace.kind || workspace.kind === 'agent')
      throw new Error('Agent workspaces cannot be removed by snapshot cleanup')
    await withinWorkspace(this.directory, workspace.path)
    if (await git(workspace.path, ['status', '--porcelain']))
      throw new Error('Snapshot has modifications; preserved for inspection')
    const project = this.store.require<Project>('projects', workspace.projectId)
    await git(project.path, ['worktree', 'remove', workspace.path])
    this.store.remove('workspaces', id)
  }
  async cleanup() {
    const preserved: string[] = []
    let removed = 0
    for (const preview of [...this.previews.values()]) {
      this.previews.delete(preview.id)
      this.store.remove('merge_previews', preview.id)
    }
    for (const workspace of this.store
      .list<Workspace>('workspaces')
      .filter((w) => w.kind === 'review' || w.kind === 'integration')) {
      if (
        this.store
          .list<{ workspaceId: string }>('artifacts')
          .some((a) => a.workspaceId === workspace.id)
      ) {
        preserved.push(workspace.id)
        continue
      }
      try {
        await this.removeSnapshot(workspace.id)
        removed++
      } catch {
        preserved.push(workspace.id)
      }
    }
    return { removed, preserved }
  }
}
