import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TestRun, Workspace } from '../../shared/types'
import { Store } from '../database/store'
import { findRuntime, killTree, runtimeEnv, spawnOwned } from '../agents/process'
import { redact, assertAssignedRoot } from '../permissions/paths'
import { git } from '../git/workspaces'
import type { JsonProcess } from '../agents/process'
import { testSandbox, initializeSandbox } from './sandbox'
import { assertSafeGitAttributes } from '../git/safe-snapshot'
export class TestRunner {
  private processes = new Map<
    string,
    {
      child: ChildProcessWithoutNullStreams
      run: TestRun
      done: Promise<void>
      cancel?: () => Promise<void>
    }
  >()
  private starting = new Set<JsonProcess>()
  private closing = false
  constructor(
    private store: Store,
    private changed: () => void,
    private sandboxFactory?: (cwd: string) => JsonProcess,
  ) {}
  busy(projectId: string): boolean {
    return [...this.processes.values()].some((p) => p.run.projectId === projectId)
  }
  private stopped(run: TestRun) {
    return this.closing || run.status === 'cancelled'
  }
  async run(
    workspace: Workspace,
    script: 'test' | 'build' | 'install' | 'pytest' | 'unittest' | 'dotnet' | 'cargo' | 'go',
    sandboxed = false,
  ): Promise<TestRun> {
    if (this.closing) throw new Error('Test runner is closing')
    await assertAssignedRoot(workspace.path)
    if (sandboxed) await assertSafeGitAttributes(workspace.path)
    if (await git(workspace.path, ['status', '--porcelain']))
      throw new Error(
        'Checkpoint all workspace changes before tests so results identify an exact committed version.',
      )
    let command: string | undefined
    let args: string[] = []
    let name: string
    if (['test', 'build', 'install'].includes(script)) {
      const manifest = JSON.parse(await readFile(join(workspace.path, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      if (script !== 'install' && !manifest.scripts?.[script])
        throw new Error(`No npm ${script} script exists in this workspace.`)
      const node = await findRuntime('node')
      if (!node) throw new Error('Install Node.js with npm to run project test scripts.')
      const npm = join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      if (!existsSync(npm))
        throw new Error(
          'npm-cli.js was not found beside Node.js. Run tests in your terminal, or install the official Node.js distribution.',
        )
      command = node
      if (script === 'install') {
        if (!existsSync(join(workspace.path, 'package-lock.json')))
          throw new Error('Commit package-lock.json before installing preview dependencies.')
        args = [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']
        name = 'npm ci --ignore-scripts'
      } else {
        args = [npm, 'run', script]
        name = `npm run ${script}`
      }
    } else {
      const programs = {
        pytest: ['python', ['-m', 'pytest']],
        unittest: ['python', ['-m', 'unittest', 'discover']],
        dotnet: ['dotnet', ['test', '--nologo']],
        cargo: ['cargo', ['test', '--locked']],
        go: ['go', ['test', './...']],
      } as const
      const spec = programs[script as keyof typeof programs]
      command = await findRuntime(spec[0])
      args = [...spec[1]]
      name = [spec[0], ...args].join(' ')
      if (!command)
        throw new Error(`Install the official ${spec[0]} runtime before running ${script} tests.`)
    }
    const run: TestRun = {
      execution: sandboxed ? 'native-sandbox' : 'host-approved',
      id: randomUUID(),
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      revision: await git(workspace.path, ['rev-parse', 'HEAD']),
      name,
      kind: script === 'install' ? 'preparation' : script === 'build' ? 'build' : 'test',
      status: 'running',
      logs: '',
      durationMs: 0,
      startedAt: new Date().toISOString(),
    }
    if (sandboxed) run.name += ' [native sandbox]'
    if (sandboxed) return this.runSandboxed(workspace, command, args, run, script === 'install')
    if (this.closing) throw new Error('Test runner is closing')
    const child = spawnOwned(command, args, {
      cwd: workspace.path,
      env: { ...runtimeEnv(), CI: '1', GOFLAGS: '-mod=readonly' },
      windowsHide: true,
    })
    child.stdin.end()
    this.store.put('test_runs', run)
    let cancelled = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      void killTree(child)
    }, this.store.settings().timeoutMs)
    const append = (data: Buffer) => {
      run.logs = redact(run.logs + data.toString('utf8')).slice(-100000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const done = new Promise<void>((resolve) => {
      child.once('error', (error) => {
        run.error = redact(error.message)
      })
      child.once('close', (code) => {
        void (async () => {
          clearTimeout(timeout)
          cancelled = run.status === 'cancelled'
          run.durationMs = Date.now() - new Date(run.startedAt).getTime()
          if (cancelled || this.closing) {
            run.status = cancelled ? 'cancelled' : 'interrupted'
            return
          }
          await assertSafeGitAttributes(workspace.path)
          const unchanged =
            (await git(workspace.path, ['rev-parse', 'HEAD'])) === run.revision &&
            !(await git(workspace.path, ['status', '--porcelain']))
          cancelled = run.status === 'cancelled'
          run.status = cancelled
            ? 'cancelled'
            : code === 0 && unchanged && !timedOut
              ? 'passed'
              : 'failed'
          if (!unchanged)
            run.error =
              'Workspace changed during the test. This result cannot certify the original revision.'
          else if (timedOut) run.error = 'Test timed out'
          else if (code !== 0) run.error ||= `Process exited (${code})`
        })()
          .catch((e) => {
            run.status = 'failed'
            run.error = redact(String(e))
          })
          .finally(() => {
            this.store.put('test_runs', run)
            this.processes.delete(run.id)
            this.changed()
            resolve()
          })
      })
    })
    this.processes.set(run.id, { child, run, done })
    this.changed()
    return run
  }
  private async runSandboxed(
    workspace: Workspace,
    command: string,
    args: string[],
    run: TestRun,
    install: boolean,
  ): Promise<TestRun> {
    if (this.closing) throw new Error('Test runner is closing')
    const proc = await testSandbox(workspace.path, this.sandboxFactory)
    this.starting.add(proc)
    try {
      if (this.closing) throw new Error('Test runner is closing')
      await initializeSandbox(proc, !!this.sandboxFactory)
      if (this.closing) throw new Error('Test runner is closing')
      const scratch = join(dirname(this.store.path), 'test-sandboxes', run.id)
      await mkdir(scratch, { recursive: true })
      await writeFile(join(scratch, 'npmrc'), '')
      await writeFile(join(scratch, 'globalnpmrc'), '')
      const isolatedArgs = [
        ...args,
        '--userconfig',
        join(scratch, 'npmrc'),
        '--globalconfig',
        join(scratch, 'globalnpmrc'),
        '--cache',
        join(scratch, 'npm-cache'),
      ]
      const processId = run.id
      this.store.put('test_runs', run)
      const request = proc.request<{ exitCode: number; stdout: string; stderr: string }>(
        'command/exec',
        {
          processId,
          command: [command, ...isolatedArgs],
          cwd: workspace.path,
          timeoutMs: this.store.settings().timeoutMs,
          env: {
            ...runtimeEnv(),
            CI: '1',
            HOME: scratch,
            USERPROFILE: scratch,
            APPDATA: scratch,
            LOCALAPPDATA: scratch,
            TEMP: scratch,
            TMP: scratch,
            NODE_OPTIONS: null,
            NODE_EXTRA_CA_CERTS: null,
            NPM_CONFIG_USERCONFIG: join(scratch, 'npmrc'),
            NPM_CONFIG_GLOBALCONFIG: join(scratch, 'globalnpmrc'),
          },
          sandboxPolicy: {
            type: 'workspaceWrite',
            writableRoots: [workspace.path, scratch],
            networkAccess: install,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          },
        },
        this.store.settings().timeoutMs + 10000,
      )
      const done = request
        .then(async (result) => {
          run.logs = redact(result.stdout + '\n' + result.stderr).slice(-100000)
          if (this.stopped(run)) return
          await assertSafeGitAttributes(workspace.path)
          const unchanged =
            run.revision === (await git(workspace.path, ['rev-parse', 'HEAD'])) &&
            !(await git(workspace.path, ['status', '--porcelain']))
          if (this.stopped(run)) return
          run.status = result.exitCode === 0 && unchanged ? 'passed' : 'failed'
          if (!unchanged)
            run.error = 'Snapshot changed during sandboxed tests; no version certification.'
          else if (result.exitCode !== 0)
            run.error = /spawn(?:Sync)?[^\n]*EPERM|Error: spawn EPERM/i.test(run.logs)
              ? 'Official Windows sandbox denied a child process (EPERM). Inspect test logs; use a compatible in-process test configuration or explicitly approved manual tests. No unsandboxed fallback was run.'
              : `Sandboxed process exited (${result.exitCode})`
        })
        .catch((error) => {
          if (run.status !== 'cancelled') run.status = 'failed'
          run.error = redact(String(error))
        })
        .finally(async () => {
          run.durationMs = Date.now() - Date.parse(run.startedAt)
          await proc.dispose()
          this.store.put('test_runs', run)
          this.processes.delete(run.id)
          this.changed()
        })
      this.processes.set(run.id, {
        child: proc.child,
        run,
        done,
        cancel: async () => {
          await proc.request('command/exec/terminate', { processId }, 2000).catch(() => {})
          await proc.dispose()
        },
      })
      this.starting.delete(proc)
      this.changed()
      return run
    } catch (error) {
      await proc.dispose()
      this.starting.delete(proc)
      throw error
    }
  }
  async cancel(id: string): Promise<void> {
    const p = this.processes.get(id)
    if (!p) return
    p.run.status = 'cancelled'
    if (p.cancel) await p.cancel()
    else await killTree(p.child)
  }
  async wait(id: string): Promise<void> {
    await this.processes.get(id)?.done
  }
  async dispose(): Promise<void> {
    this.closing = true
    await Promise.all([...this.starting].map((p) => p.dispose()))
    const pending = [...this.processes.values()]
    await Promise.all(pending.map((p) => this.cancel(p.run.id)))
    await Promise.all(pending.map((p) => p.done))
  }
}
