import { existsSync } from 'node:fs'
import { mkdir, readFile, lstat } from 'node:fs/promises'
import { extname, join, resolve, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { AgentProfile, Project, Task, Workspace, TestRun } from '../../shared/types'
import { Store } from '../database/store'
import { WorkspaceManager, git } from './workspaces'
import {
  changedFiles,
  hasSecret,
  safeCommit,
  scanFiles,
  rejectExecutableFilters,
  assertSafeGitAttributes,
} from './safe-snapshot'
import { TestRunner } from '../tasks/tests'
import { assertAssignedRoot, withinWorkspace } from '../permissions/paths'

type Ask = (tool: string, detail: string, risk?: string) => Promise<boolean>
import { reviewApproved } from '../../shared/reviews'
export class AutomaticProjects {
  private locks = new Map<string, Promise<unknown>>()
  constructor(
    private store: Store,
    private manager: WorkspaceManager,
    private tests: TestRunner,
    private changed: () => void,
    private branchId: () => string = randomUUID,
  ) {}
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve()
    const next = previous.catch(() => {}).then(work)
    this.locks.set(id, next)
    void next
      .finally(() => {
        if (this.locks.get(id) === next) this.locks.delete(id)
      })
      .catch(() => {})
    return next
  }
  private state(
    id: string,
    state: NonNullable<Project['setup']>['state'],
    detail: string,
    excluded: string[] = [],
  ) {
    this.store.put('projects', {
      ...this.store.require<Project>('projects', id),
      autoManaged: true,
      setup: { state, detail, excluded },
    })
    this.changed()
  }
  private async assertProjectBoundary(project: Project) {
    await assertAssignedRoot(project.path)
    if (dirname(resolve(project.path)) === resolve(project.path))
      throw new Error('請選擇專用的專案子資料夾，不要選擇整個磁碟。')
    const projectPath = resolve(project.path)
      .replaceAll('\\', '/')
      .toLowerCase()
      .replace(/\/+$/, '')
    for (const root of [dirname(this.store.path), this.manager.directory]) {
      const dataPath = resolve(root).replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '')
      if (
        projectPath === dataPath ||
        projectPath.startsWith(dataPath + '/') ||
        dataPath.startsWith(projectPath + '/')
      )
        throw new Error(
          '專案資料夾不可包含或位於 AgentHub 私有資料／受管工作區內。請另選獨立的專案資料夾，避免遞迴或提交聊天與認證資料。',
        )
    }
  }
  private audit(projectId: string, operation: string, status: string, detail: string) {
    this.store.put('workspace_operations', {
      id: randomUUID(),
      projectId,
      operation,
      status,
      detail,
      time: new Date().toISOString(),
    })
    this.store.db
      .prepare(
        'DELETE FROM workspace_operations WHERE project_id=? AND rowid NOT IN (SELECT rowid FROM workspace_operations WHERE project_id=? ORDER BY rowid DESC LIMIT 200)',
      )
      .run(projectId, projectId)
  }
  async prepare(project: Project, ask?: Ask): Promise<void> {
    return this.serial(project.id, () => this.bootstrap(project, ask))
  }
  async savePrimary(project: Project): Promise<string> {
    return this.serial(project.id, async () => {
      await this.assertProjectBoundary(project)
      const scan = await scanFiles(project.path, await changedFiles(project.path))
      if (scan.excluded.length || scan.review.length)
        throw new Error('主專案有需要個別檔案檢查的內容；未自動提交。請保留原檔並審核。')
      const revision = await safeCommit(
        project.path,
        scan,
        join(this.manager.directory, '.indexes'),
        'AgentHub user-approved primary project snapshot',
      )
      this.audit(project.id, 'primary.checkpoint', 'completed', revision)
      this.changed()
      return revision
    })
  }
  private async bootstrap(project: Project, ask?: Ask): Promise<void> {
    this.state(project.id, 'preparing', '正在檢查本機專案／版本基礎…')
    try {
      await this.assertProjectBoundary(project)
      await git(project.path, ['--version'])
      let top = ''
      try {
        top = await git(project.path, ['rev-parse', '--show-toplevel'])
      } catch {
        // Existing Git metadata means damage/permissions, never initialize over it.
        if (existsSync(join(project.path, '.git')))
          throw new Error(
            'Repository metadata cannot be read. Existing files and Git data were preserved.',
          )
      }
      if (top && resolve(top).toLowerCase() !== resolve(project.path).toLowerCase())
        throw new Error(
          '選取位置在其他 Git Repository 內；請選擇該 Repository 根目錄，避免巢狀初始化。',
        )
      if (!top) await git(project.path, ['init', '--initial-branch=main'])
      let head = ''
      try {
        head = await git(project.path, ['rev-parse', '--verify', 'HEAD'])
      } catch {
        const branch = await git(project.path, ['symbolic-ref', 'HEAD'])
        if (
          await git(project.path, ['show-ref', '--verify', branch]).then(
            () => true,
            () => false,
          )
        )
          throw new Error('Repository HEAD is damaged; no initial history was overwritten.')
      }
      let excluded: string[] = []
      if (!head) await this.manager.addDefaultIgnore(project.id)
      await assertSafeGitAttributes(project.path)
      if (!head) {
        const scan = await scanFiles(project.path, await changedFiles(project.path, true))
        excluded = [...scan.excluded, ...scan.review]
        const staged = await git(project.path, ['diff', '--cached', '--name-only'])
        if (scan.review.length || staged) {
          const detail = `安全的初始快照會排除下列需檢查項目，原始檔案與既有暫存內容會保留：\n${scan.review.join('\n')}\n${staged ? '偵測到既有暫存區；快照採目前工作檔版本，原暫存項目不會被清除或覆寫。' : ''}`
          if (
            !ask ||
            !(await ask(
              '確認安全初始快照',
              detail,
              'Only reviewed ordinary files enter the snapshot; excluded files stay in the original folder.',
            ))
          )
            throw new Error('初始快照需要檢查。直接發送任務可在 App 內確認；不需要執行 Git 指令。')
        }
        const revision = await safeCommit(
          project.path,
          scan,
          join(this.manager.directory, '.indexes'),
          'AgentHub safe initial project snapshot',
        )
        this.audit(project.id, 'snapshot.initial', 'completed', revision)
      }
      this.state(
        project.id,
        'ready',
        excluded.length
          ? '專案已就緒；敏感或未確認檔案未加入快照。'
          : '專案已就緒；Agent 工作區將自動配置。',
        excluded,
      )
    } catch (error) {
      this.audit(
        project.id,
        'project.prepare',
        'attention',
        error instanceof Error ? error.message : 'Preparation failed',
      )
      this.state(project.id, 'attention', error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  async workspace(
    project: Project,
    agent: AgentProfile,
    ask: Ask,
    signal: AbortSignal,
  ): Promise<Workspace> {
    return this.serial(project.id, async () => {
      await this.bootstrap(project, ask)
      signal.throwIfAborted()
      const id = `${project.id}:${agent.id}`
      let workspace = this.store.get<Workspace>('workspaces', id)
      const head = await git(project.path, ['rev-parse', 'HEAD'])
      if (workspace && !existsSync(workspace.path)) {
        const records = (
          await git(project.path, ['worktree', 'list', '--porcelain', '-z'], false)
        ).split('\0\0')
        for (const record of records) {
          const lines = record.split('\0')
          const path = lines.find((line) => line.startsWith('worktree '))?.slice(9)
          if (path && lines.includes(`branch refs/heads/${workspace.branch}`) && existsSync(path)) {
            await withinWorkspace(this.manager.directory, path)
            workspace = { ...workspace, path: resolve(path) }
            this.audit(project.id, 'worktree.relocated', 'completed', workspace.path)
            this.store.put('workspaces', workspace)
            break
          }
        }
      }
      if (workspace && existsSync(workspace.path)) {
        await assertAssignedRoot(workspace.path)
        if (
          resolve(
            await git(workspace.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
          ).toLowerCase() !==
          resolve(
            await git(project.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
          ).toLowerCase()
        )
          throw new Error('Worktree belongs to a different repository; no files were changed.')
        if ((await git(workspace.path, ['symbolic-ref', '--short', 'HEAD'])) !== workspace.branch)
          throw new Error(
            'Agent branch changed outside AgentHub; workspace preserved for inspection.',
          )
        const top = await git(workspace.path, ['rev-parse', '--show-toplevel'])
        if (resolve(top).toLowerCase() !== resolve(workspace.path).toLowerCase())
          throw new Error('Agent worktree registration is invalid; existing files were preserved.')
      } else {
        // Missing paths are recovered into a new directory/branch, never prune or force-remove.
        const base = workspace
          ? await git(project.path, ['rev-parse', `refs/heads/${workspace.branch}`])
          : head
        await rejectExecutableFilters(
          project.path,
          (await git(project.path, ['ls-tree', '-r', '--name-only', '-z', base], false))
            .split('\0')
            .filter(Boolean),
          base,
        )
        const recovery = workspace ? `-recovered-${randomUUID().slice(0, 8)}` : ''
        const folder = join(
          this.manager.directory,
          project.id,
          `${agent.id.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 32)}-${createHash('sha256').update(agent.id).digest('hex').slice(0, 12)}${recovery}`,
        )
        await mkdir(join(this.manager.directory, project.id), { recursive: true })
        if (existsSync(folder))
          throw new Error(
            'Managed worktree path already contains data; it was not deleted. Inspect it before continuing.',
          )
        let branch = ''
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = `agenthub/${agent.provider}-${this.branchId()}`
          if (
            await git(project.path, ['show-ref', '--verify', `refs/heads/${candidate}`]).then(
              () => true,
              () => false,
            )
          )
            continue
          try {
            await git(project.path, ['worktree', 'add', '-b', candidate, folder, base])
            branch = candidate
            break
          } catch (error) {
            if (
              existsSync(folder) ||
              !(await git(project.path, ['show-ref', '--verify', `refs/heads/${candidate}`]).then(
                () => true,
                () => false,
              ))
            )
              throw error
          }
        }
        if (!branch)
          throw new Error(
            'Unable to allocate a unique agent branch; existing branches were preserved.',
          )
        workspace = {
          id,
          projectId: project.id,
          agentId: agent.id,
          path: folder,
          branch,
          kind: 'agent',
          syncedHead: head,
        }
        this.store.put('workspaces', workspace)
        this.audit(
          project.id,
          recovery ? 'worktree.recovered' : 'worktree.created',
          'completed',
          `${workspace.branch} · ${workspace.path}`,
        )
      }
      signal.throwIfAborted()
      await assertSafeGitAttributes(workspace.path)
      const dirty = await git(workspace.path, ['status', '--porcelain'])
      const current = await git(workspace.path, ['rev-parse', 'HEAD'])
      // A merged primary commit is not automatically present in the agent branch.
      // Compare actual commits even when cached metadata says this primary was seen.
      if (current !== head) {
        const alreadyContainsPrimary = await git(workspace.path, [
          'merge-base',
          '--is-ancestor',
          head,
          current,
        ]).then(
          () => true,
          () => false,
        )
        if (!alreadyContainsPrimary) {
          const fastForward = await git(workspace.path, [
            'merge-base',
            '--is-ancestor',
            current,
            head,
          ]).then(
            () => true,
            () => false,
          )
          if (dirty) {
            const local = (await changedFiles(workspace.path)).map((p) =>
              p.normalize('NFC').toLowerCase(),
            )
            const incoming = (
              await git(
                workspace.path,
                ['diff', '--no-renames', '--name-only', '-z', current, head],
                false,
              )
            )
              .split('\0')
              .filter(Boolean)
              .map((p) => p.normalize('NFC').toLowerCase())
            if (
              !fastForward ||
              local.some((a) =>
                incoming.some((b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')),
              )
            )
              throw new Error(
                '主專案更新與工作區未完成修改可能衝突；已保留所有內容，需檢查後同步。',
              )
          }
          await rejectExecutableFilters(
            project.path,
            (await git(project.path, ['ls-tree', '-r', '--name-only', '-z', head], false))
              .split('\0')
              .filter(Boolean),
            head,
          )
          await git(workspace.path, ['merge-tree', '--write-tree', current, head])
          await git(workspace.path, [
            '-c',
            'user.name=AgentHub',
            '-c',
            'user.email=local@agenthub.invalid',
            '-c',
            'commit.gpgsign=false',
            'merge',
            ...(fastForward ? ['--ff-only'] : []),
            '--no-edit',
            head,
          ])
          this.audit(project.id, 'worktree.synced', 'completed', head)
        }
      }
      workspace = { ...workspace, syncedHead: head }
      this.store.put('workspaces', workspace)
      this.changed()
      return workspace
    })
  }
  async finish(
    project: Project,
    workspace: Workspace,
    signal: AbortSignal,
    before?: { dirty: boolean; fingerprint: string },
    policy?: { checkpointOnly?: boolean; expectedRevision?: string; reviewerIds?: string[] },
  ): Promise<NonNullable<Task['integration']>> {
    return this.serial(project.id, async () => {
      let previewId: string | undefined
      try {
        signal.throwIfAborted()
        await assertAssignedRoot(project.path)
        await assertAssignedRoot(workspace.path)
        await assertSafeGitAttributes(workspace.path)
        if (
          policy?.expectedRevision &&
          ((await git(workspace.path, ['rev-parse', 'HEAD'])) !== policy.expectedRevision ||
            (await git(workspace.path, ['status', '--porcelain'])))
        )
          throw new Error(
            'Workflow source changed since review. Inspect and re-review; integration refused.',
          )
        // Autonomous rooms treat leftover workspace changes as this agent's work in progress:
        // the safety scan below still refuses sensitive or unknown files before any commit.
        if (before?.dirty && this.store.settings().autonomy !== 'auto') {
          const current = await this.capture(workspace)
          if (current.fingerprint === before.fingerprint)
            return {
              status: 'unchanged',
              detail: '本回合沒有改動檔案；先前未完成的工作區修改保持原樣，未自動提交或發佈。',
            }
          return {
            status: 'attention',
            detail:
              '工作區原先已有未完成修改，已保留全部內容。請先檢查 Diff，再明確重試整合；不會自動混入發佈。',
          }
        }
        const scan = await scanFiles(workspace.path, await changedFiles(workspace.path))
        if (scan.excluded.length || scan.review.length)
          throw new Error(
            `自動快照需要檔案檢查，未提交或合併：${[...scan.excluded, ...scan.review].join(', ')}`,
          )
        await safeCommit(
          workspace.path,
          scan,
          join(this.manager.directory, '.indexes'),
          'AgentHub automatic task checkpoint',
        )
        signal.throwIfAborted()
        const head = await git(project.path, ['rev-parse', 'HEAD'])
        const agentHead = await git(workspace.path, ['rev-parse', 'HEAD'])
        if (policy?.checkpointOnly)
          return {
            status: 'staged',
            revision: agentHead,
            detail: '工作流程快照已保存；等待範本審查與測試整合，尚未合併。',
          }
        for (const reviewerId of policy?.reviewerIds || [])
          if (
            !reviewApproved(
              this.store.list('reviews'),
              this.store.list('tasks'),
              workspace.id,
              agentHead,
              reviewerId,
            )
          )
            throw new Error(
              'Workflow requires successful structured approval of this exact revision from every configured reviewer.',
            )
        const ancestor = await git(project.path, [
          'merge-base',
          '--is-ancestor',
          agentHead,
          head,
        ]).then(
          () => true,
          () => false,
        )
        if (ancestor)
          return {
            status: 'unchanged',
            detail: '沒有待整合變更；主要專案已包含此版本。',
            revision: head,
          }
        const settings = this.store.settings()
        const reviewer = this.store.get<import('../../shared/types').AgentProfile>(
          'agents',
          settings.reviewerId,
        )
        if (
          settings.automaticReview &&
          (!reviewer?.enabled || (project.agentIds && !project.agentIds.includes(reviewer.id)))
        )
          throw new Error('自動 Review 需要選擇已啟用的團隊審查者；尚未合併到主專案。')
        if (
          settings.automaticReview &&
          !reviewApproved(
            this.store.list('reviews'),
            this.store.list('tasks'),
            workspace.id,
            agentHead,
            settings.reviewerId,
          )
        )
          throw new Error(
            '已啟用自動審查：等待此確切版本的 Review 通過，再重試整合；尚未合併到主專案。',
          )
        await this.checkHistory(workspace.path, workspace.syncedHead || head)
        const combinedPaths = [
          ...new Set(
            (
              (await git(workspace.path, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], false)) +
              (await git(project.path, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], false))
            )
              .split('\0')
              .filter(Boolean),
          ),
        ]
        await rejectExecutableFilters(project.path, combinedPaths, head)
        await rejectExecutableFilters(workspace.path, combinedPaths, agentHead)
        if (await git(project.path, ['status', '--porcelain']))
          throw new Error(
            '主要專案有使用者未提交或暫存變更，未覆寫。請先檢查並保存主專案變更，再重試整合。',
          )
        const preview = await this.manager.preview(workspace)
        previewId = preview.id
        const snapshot = this.store.require<Workspace>('workspaces', preview.integrationWorkspaceId)
        await this.testSnapshot(snapshot, signal)
        signal.throwIfAborted()
        const revision = await this.manager.merge(preview.id)
        this.audit(project.id, 'integration.merged', 'completed', revision)
        this.store.put('workspaces', { ...workspace, syncedHead: agentHead })
        this.changed()
        return {
          status: 'merged',
          detail: '安全檢查與此整合快照測試通過，成果已整合到你選擇的主要專案資料夾。',
          revision,
        }
      } catch (error) {
        signal.throwIfAborted()
        this.audit(
          project.id,
          'integration.blocked',
          'attention',
          error instanceof Error ? error.message : 'Integration failed',
        )
        return {
          status: 'attention',
          detail: error instanceof Error ? error.message : String(error),
          previewId,
        }
      }
    })
  }
  async capture(workspace: Workspace) {
    await assertSafeGitAttributes(workspace.path)
    const scan = await scanFiles(workspace.path, await changedFiles(workspace.path))
    return {
      dirty: !!(await git(workspace.path, ['status', '--porcelain'])),
      fingerprint: JSON.stringify(scan),
    }
  }
  private async checkHistory(root: string, base: string) {
    await git(root, ['merge-base', '--is-ancestor', base, 'HEAD'])
    const commits = (await git(root, ['rev-list', `${base}..HEAD`])).split('\n').filter(Boolean)
    if (commits.length > 50)
      throw new Error('More than 50 new commits require review before automatic integration.')
    for (const commit of commits) {
      const paths = (
        await git(
          root,
          ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', commit],
          false,
        )
      )
        .split('\0')
        .filter(Boolean)
      for (const path of paths) {
        const spec = await git(root, ['ls-tree', commit, '--', path])
        if (!spec) continue // deletion
        if (!/^100(?:644|755) blob /.test(spec))
          throw new Error('New symlink/submodule requires review before integration.')
        if (
          /(^|\/)(\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(pem|key|p12|pfx))$/i.test(
            path,
          )
        )
          throw new Error('Sensitive filename found in agent commit history; integration stopped.')
        if (
          !/\.(png|jpe?g|webp)$/i.test(path) &&
          hasSecret(await git(root, ['show', `${commit}:${path}`], false))
        )
          throw new Error('Possible credential found in agent commit history; integration stopped.')
      }
    }
  }
  private async testSnapshot(workspace: Workspace, signal: AbortSignal) {
    let manifest: { scripts?: Record<string, string> } = {}
    if (existsSync(join(workspace.path, 'package.json')))
      manifest = JSON.parse(await readFile(join(workspace.path, 'package.json'), 'utf8'))
    if (manifest.scripts?.test) {
      if (existsSync(join(workspace.path, '.npmrc')))
        throw new Error(
          'Project npm configuration requires explicit review before automatic tests. No account configuration was read or reused.',
        )
      if (
        /\b(?:rm|rmdir|del|powershell|pwsh|curl|wget|Invoke-WebRequest|reset\s+--hard)\b/i.test(
          manifest.scripts.test,
        )
      )
        throw new Error('Test command requires explicit review; automatic execution refused.')
      if (existsSync(join(workspace.path, 'package-lock.json'))) {
        const lock = JSON.parse(
          await readFile(join(workspace.path, 'package-lock.json'), 'utf8'),
        ) as { packages?: Record<string, { resolved?: string }> }
        if (
          !lock.packages ||
          Object.values(lock.packages).some(
            (entry) => entry.resolved && !entry.resolved.startsWith('https://registry.npmjs.org/'),
          )
        )
          throw new Error(
            'Dependency sources require review before automatic installation; no private registry credentials were used.',
          )
        await this.runTest(workspace, 'install', signal)
      }
      await this.runTest(workspace, 'test', signal)
    } else {
      const files = (await git(workspace.path, ['ls-files', '-z'], false))
        .split('\0')
        .filter(Boolean)
      const allowed = new Set([
        '.html',
        '.htm',
        '.css',
        '.json',
        '.md',
        '.txt',
        '.svg',
        '.png',
        '.jpg',
        '.jpeg',
        '.webp',
        '.gitignore',
      ])
      if (
        !files.length ||
        files.some(
          (p) => !allowed.has(extname(p).toLowerCase()) && !/^\.gitignore$|^LICENSE$/.test(p),
        )
      )
        throw new Error(
          '未找到適用的自動測試入口；請在進階變更面板測試快照，或替專案加入 npm test。',
        )
      const started = Date.now()
      const revision = await git(workspace.path, ['rev-parse', 'HEAD'])
      const run: TestRun = {
        execution: 'static',
        id: randomUUID(),
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        revision,
        kind: 'test',
        name: 'Static site basic checks (not functional/browser tests)',
        status: 'running',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        logs: '',
      }
      try {
        for (const file of files) {
          signal.throwIfAborted()
          if (/\.(?:json|html?|svg|css|md|txt)$/.test(file)) {
            if ((await lstat(join(workspace.path, file))).size > 5 * 1024 * 1024)
              throw new Error('Static file exceeds validation limit')
            const data = await readFile(join(workspace.path, file), 'utf8')
            if (file.endsWith('.json')) JSON.parse(data)
            if (/\.html?$/.test(file) && !/<html\b/i.test(data))
              throw new Error(`Missing HTML document element: ${file}`)
          }
        }
        if (
          revision !== (await git(workspace.path, ['rev-parse', 'HEAD'])) ||
          (await git(workspace.path, ['status', '--porcelain']))
        )
          throw new Error('Static snapshot changed during checks')
        run.status = 'passed'
        run.logs =
          'Static file format/JSON/document checks passed. No browser or application behavior was tested.'
      } catch (error) {
        run.status = 'failed'
        run.error = String(error)
        throw error
      } finally {
        run.durationMs = Date.now() - started
        this.store.put('test_runs', run)
        this.changed()
      }
    }
  }
  private async runTest(workspace: Workspace, kind: 'test' | 'install', signal: AbortSignal) {
    const autonomous = this.store.settings().autonomy === 'auto'
    const result = await this.runOnce(workspace, kind, signal, true)
    if (result.status === 'passed') return
    const output = `${result.error || ''}\n${result.logs}`
    // Toolchains such as Vite/Vitest start esbuild child processes that the Windows sandbox
    // denies. With autonomy on, rerun the same fixed npm script directly on the exact snapshot.
    if (autonomous && /EPERM/.test(output)) {
      this.audit(workspace.projectId, `test.host-fallback.${kind}`, 'started', workspace.id)
      const host = await this.runOnce(workspace, kind, signal, false)
      if (host.status === 'passed') return
      if (kind === 'test' && /No test files found/i.test(host.logs)) return this.noTests(workspace)
      throw new Error(host.error || 'Integration snapshot tests failed (host run)')
    }
    // A project that has a test runner but no tests yet must not block the first integration.
    if (kind === 'test' && autonomous && /No test files found/i.test(output))
      return this.noTests(workspace)
    throw new Error(result.error || 'Integration snapshot tests failed')
  }
  /** Records, under an explicit name, that the snapshot had no tests at all; nothing ran. */
  private async noTests(workspace: Workspace) {
    this.store.put('test_runs', {
      execution: 'static',
      id: randomUUID(),
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      revision: await git(workspace.path, ['rev-parse', 'HEAD']),
      kind: 'test',
      name: '沒有測試檔：未執行任何測試（全自動模式允許先整合） / No test files: nothing was executed',
      status: 'passed',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      logs: 'The test runner found no test files. Autonomous mode lets the first integration proceed; no behavior was verified.',
    } satisfies TestRun)
    this.changed()
  }
  private async runOnce(
    workspace: Workspace,
    kind: 'test' | 'install',
    signal: AbortSignal,
    sandboxed: boolean,
  ): Promise<TestRun> {
    signal.throwIfAborted()
    const run = await this.tests.run(workspace, kind, sandboxed)
    const abort = () => {
      void this.tests.cancel(run.id)
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (signal.aborted) abort()
      await this.tests.wait(run.id)
      signal.throwIfAborted()
      return this.store.require<TestRun>('test_runs', run.id)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
}
