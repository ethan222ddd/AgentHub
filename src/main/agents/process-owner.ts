import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { trace } from '../app/diagnostics'
import type { ProcessInspection } from '../../shared/types'

export function runtimeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'HOME',
    'LANG',
    'PATHEXT',
  ])
    if (process.env[key]) env[key] = process.env[key]
  return env
}
export function guardPath() {
  const path =
    process.resourcesPath && !process.defaultApp
      ? join(process.resourcesPath, 'native/agenthub-process-guard.exe')
      : resolve('.native/agenthub-process-guard.exe')
  if (!existsSync(path))
    throw new Error(
      'Required Windows process guard missing. Reinstall AgentHub or run npm run build:native. No unowned runtime was started.',
    )
  return path
}
let parentCreation: string | undefined
let appGuardPid: number | undefined
let appOwnership: Promise<void> | undefined
function parentIdentity(helper: string) {
  if (!parentCreation) {
    const value = execFileSync(helper, ['identity', String(process.pid)], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf8',
    }).trim()
    if (!/^\d{15,20}$/.test(value)) throw new Error('Cannot verify application process identity')
    parentCreation = value
  }
  return parentCreation
}
// This keeper is created BEFORE assigning this app to its job, so it can close
// that job after app death. It is never terminated as part of normal task cleanup.
export function startApplicationOwnership(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  if (!appOwnership)
    appOwnership = (async () => {
      const helper = guardPath(),
        identity = parentIdentity(helper)
      const keeper = spawn(helper, ['owner'], {
        env: runtimeEnv(),
        windowsHide: true,
        stdio: 'pipe',
      })
      await new Promise<void>((resolve, reject) => {
        let output = '',
          stderr = '',
          done = false
        const timer = setTimeout(
          () => finish(new Error('Windows application ownership setup timed out')),
          5000,
        )
        const finish = (error?: Error) => {
          if (done) return
          done = true
          clearTimeout(timer)
          if (error) {
            keeper.kill()
            reject(error)
            return
          }
          appGuardPid = keeper.pid
          keeper.unref()
          keeper.stdout.destroy()
          keeper.stderr.destroy()
          trace('app.ownership.ready', { pid: keeper.pid, stage: 'windows-app-job' })
          resolve()
        }
        keeper.once('error', (error) => finish(error))
        keeper.once('exit', () =>
          finish(new Error('Windows application ownership setup failed: ' + stderr.slice(-500))),
        )
        keeper.stdout.setEncoding('utf8')
        keeper.stdout.on('data', (chunk: string) => {
          output += chunk
          if (output === '{"ready":true}\r\n' || output === '{"ready":true}\n') finish()
          else if (output.length > 100) finish(new Error('Invalid ownership readiness response'))
        })
        keeper.stderr.setEncoding('utf8')
        keeper.stderr.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-1000)
        })
        keeper.stdin.on('error', (error) => finish(error))
        keeper.stdin.end(
          JSON.stringify({ parentPid: process.pid, parentCreation: identity }) + '\n',
        )
      })
    })()
  return appOwnership
}
function executable(command: string, env: NodeJS.ProcessEnv, cwd: string) {
  const name = extname(command) ? command : command + '.exe'
  if (extname(name).toLowerCase() !== '.exe')
    throw new Error('A native .exe is required; shell launch scripts are not executed.')
  const candidates =
    isAbsolute(name) || /[/\\]/.test(name)
      ? [resolve(cwd, name)]
      : (env.PATH || env.Path || '')
          .split(';')
          .filter(Boolean)
          .map((directory) => join(directory.replace(/^"(.*)"$/, '$1'), name))
  const found = candidates.find((path) => existsSync(path))
  if (!found)
    throw Object.assign(new Error(`Executable not found: ${basename(command)}`), { code: 'ENOENT' })
  return resolve(found)
}
interface Owned {
  child: ChildProcessWithoutNullStreams
  closed: Promise<void>
  stop?: Promise<void>
  executable: string
  context?: { taskId?: string; agentId?: string; stage?: string }
}
const ownership = new WeakMap<ChildProcessWithoutNullStreams, Owned>()
export interface OwnedOptions {
  context?: Owned['context']
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  windowsHide?: boolean
}
export class ProcessSupervisor {
  private children = new Set<Owned>()
  private closing = false
  get size() {
    return this.children.size
  }
  stopAccepting() {
    this.closing = true
  }
  spawn(
    command: string,
    args: readonly string[],
    options: OwnedOptions = {},
  ): ChildProcessWithoutNullStreams {
    if (this.closing) throw new Error('Application is shutting down; no new process was started.')
    options.signal?.throwIfAborted()
    const cwd = options.cwd || process.cwd(),
      env = options.env || runtimeEnv()
    let file = command,
      bootstrap: string | undefined
    if (process.platform === 'win32') {
      const helper = guardPath(),
        identity = parentIdentity(helper)
      bootstrap =
        JSON.stringify({
          parentPid: process.pid,
          parentCreation: identity,
          file: executable(command, env, cwd),
          args,
        }) + '\n'
      file = helper
      trace('process.owned', {
        executable: command,
        source: helper,
        cwd,
        stage: 'windows-job-object',
        status: 'required',
      })
    }
    const child = spawn(file, bootstrap ? [] : [...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: 'pipe',
    })
    let finish!: () => void
    const entry: Owned = {
      executable: basename(command),
      context: options.context,
      child,
      closed: new Promise<void>((resolve) => {
        finish = resolve
      }),
    }
    ownership.set(child, entry)
    this.children.add(entry)
    // These listeners do not consume output; every caller retains its native stdio protocol.
    child.on('error', () => {})
    child.stdin.on('error', () => {})
    const abort = () => {
      void stopOwned(child).catch(() => {})
    }
    child.once('close', () => {
      options.signal?.removeEventListener('abort', abort)
      this.children.delete(entry)
      finish()
      trace('process.reaped', {
        pid: child.pid,
        stage: process.platform === 'win32' ? 'windows-job-object' : 'direct-child',
      })
    })
    options.signal?.addEventListener('abort', abort, { once: true })
    if (bootstrap) child.stdin.write(bootstrap)
    if (options.signal?.aborted) abort()
    return child
  }
  async shutdown() {
    this.stopAccepting()
    await Promise.allSettled([...this.children].map((entry) => stopOwned(entry.child)))
  }
  inspect(): ProcessInspection {
    return {
      ownerPid: process.pid,
      appGuardPid,
      closing: this.closing,
      processes: [...this.children].map((entry) => ({
        pid: entry.child.pid,
        executable: entry.executable,
        ...entry.context,
        stopping: !!entry.stop,
        ownership: process.platform === 'win32' ? 'windows-job' : 'direct-child',
      })),
    }
  }
}
export async function stopOwned(child: ChildProcessWithoutNullStreams) {
  const entry = ownership.get(child)
  if (!entry) throw new Error('Refusing to terminate a process without local ownership')
  if (!entry.stop)
    entry.stop = (async () => {
      if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill()
      // A cancelled process may have already exited while an inherited pipe is
      // still open. Do not let EOF from an external holder gate host shutdown.
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          entry.closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Owned process did not close within five seconds')),
              5000,
            )
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    })()
  return entry.stop
}
export const processSupervisor = new ProcessSupervisor()
export const spawnOwned = (command: string, args: readonly string[], options?: OwnedOptions) =>
  processSupervisor.spawn(command, args, options)

// Bounded execFile equivalent. No shell, no inherited credential environment by default.
export async function ownedExec(
  command: string,
  args: readonly string[],
  options: OwnedOptions & { timeout?: number; maxBuffer?: number } = {},
) {
  const child = spawnOwned(command, args, options)
  child.stdin.end()
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const output: Buffer[] = [],
      errors: Buffer[] = []
    const limit = options.maxBuffer || 1024 * 1024
    let bytes = 0,
      error: Error | undefined
    const fail = (reason: Error) => {
      error ||= reason
      void stopOwned(child).catch(() => {})
    }
    const append = (chunks: Buffer[], data: Buffer) => {
      bytes += data.length
      if (bytes > limit) fail(new Error('Command output exceeds its size limit'))
      else chunks.push(data)
    }
    child.stdout.on('data', (data: Buffer) => append(output, data))
    child.stderr.on('data', (data: Buffer) => append(errors, data))
    child.once('error', fail)
    const timer = setTimeout(
      () => fail(Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' })),
      options.timeout || 30000,
    )
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(output).toString('utf8'),
        stderr = Buffer.concat(errors).toString('utf8')
      if (error || code !== 0)
        reject(
          Object.assign(
            error || new Error(`${basename(command)} exited (${code})\n${stderr.slice(-4000)}`),
            { code: (error as NodeJS.ErrnoException)?.code || code, signal, stdout, stderr },
          ),
        )
      else resolve({ stdout, stderr })
    })
  })
}
