import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWindowsCodex } from './codex-runtime'
import { trace, traceError, type TraceFields } from '../app/diagnostics'
import { ownedExec, runtimeEnv, spawnOwned, stopOwned } from './process-owner'
export { runtimeEnv, spawnOwned } from './process-owner'
export const exec = ownedExec
export async function findRuntime(name: string): Promise<string | undefined> {
  let paths: string[] = []
  try {
    const locator =
      process.platform === 'win32'
        ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe')
        : 'which'
    const { stdout } = await exec(locator, [name], {
      windowsHide: true,
      timeout: 5000,
    })
    paths = stdout.trim().split(/\r?\n/).filter(Boolean)
    if (process.platform === 'win32' && name === 'codex') {
      const launch = resolveWindowsCodex(paths)
      trace('runtime.resolved', {
        agentId: name,
        executable: launch?.executable,
        source: launch?.source,
        status: launch ? 'found' : 'missing',
      })
      return launch?.executable
    }
    const native = paths.find((p) => process.platform !== 'win32' || /\.exe$/i.test(p))
    if (native) return native
  } catch {
    /* report absence */
  }
  if (process.platform === 'win32' && name === 'codex') {
    const launch = resolveWindowsCodex(paths)
    trace('runtime.resolved', {
      agentId: name,
      executable: launch?.executable,
      source: launch?.source,
      status: launch ? 'found' : 'missing',
    })
    return launch?.executable
  }
  if (process.platform === 'win32') {
    if (name === 'agy' && process.env.LOCALAPPDATA) {
      const path = join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')
      if (existsSync(path)) return path
    }
    const user = process.env.USERPROFILE || ''
    const path = join(user, '.local', 'bin', `${name}.exe`)
    if (existsSync(path)) return path
  }
  return undefined
}
export async function killTree(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return stopOwned(proc)
}
export class JsonProcess extends EventEmitter {
  readonly child: ChildProcessWithoutNullStreams
  private sequence = 0
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  private ended = false
  private stopping = false
  private disposal?: Promise<void>
  constructor(
    command: string,
    args: string[],
    cwd: string,
    env = runtimeEnv(),
    private context: TraceFields = {},
  ) {
    super()
    trace('process.spawn', { ...context, executable: command, cwd, stage: 'native-shell-false' })
    try {
      this.child = spawnOwned(command, args, {
        cwd,
        env,
        windowsHide: true,
        context: {
          taskId: context.taskId as string | undefined,
          agentId: context.agentId as string | undefined,
          stage: context.stage as string | undefined,
        },
      })
    } catch (error) {
      trace('process.spawn.error', { ...context, ...traceError(error) })
      throw error
    }
    this.child.once('spawn', () => trace('process.started', { ...context, pid: this.child.pid }))
    let buffered = ''
    const line = (value: string) => {
      if (this.ended) return
      let m: {
        id?: number
        method?: string
        result?: unknown
        error?: { message: string; code?: number }
        params?: Record<string, unknown>
      }
      try {
        m = JSON.parse(value)
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Invalid event')
      } catch {
        trace('process.protocol.error', { ...context, reason: 'invalid-ndjson' })
        this.fail(new Error('Runtime emitted invalid NDJSON; the owned process was stopped.'))
        return
      }
      try {
        if (m.id !== undefined && !m.method && this.pending.has(m.id)) {
          const pending = this.pending.get(m.id)!
          clearTimeout(pending.timer)
          this.pending.delete(m.id)
          if (m.error)
            pending.reject(Object.assign(new Error(m.error.message), { code: m.error.code }))
          else pending.resolve(m.result)
        } else this.emit('message', m)
      } catch (error) {
        trace('process.consumer.error', { ...context, ...traceError(error) })
        this.fail(new Error('Runtime event handler failed; inspect the task before retrying.'))
      }
    }
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      if (this.ended) return
      buffered += chunk
      let end: number
      while ((end = buffered.indexOf('\n')) >= 0) {
        const value = buffered.slice(0, end).replace(/\r$/, '')
        buffered = buffered.slice(end + 1)
        if (Buffer.byteLength(value) > 4 * 1024 * 1024) {
          this.fail(new Error('Runtime event exceeds size limit'))
          return
        }
        if (value.trim()) line(value)
        if (this.ended) return
      }
      if (Buffer.byteLength(buffered) > 4 * 1024 * 1024) {
        buffered = ''
        this.fail(new Error('Runtime event exceeds size limit before newline'))
      }
    })
    this.child.stdout.once('end', () => {
      if (buffered.trim()) line(buffered)
      buffered = ''
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (value: string) => {
      trace('process.stderr', { ...context, bytes: Buffer.byteLength(value) })
      this.emit('diagnostic', value.slice(-8000))
    })
    this.child.on('error', (e) => {
      trace('process.spawn.error', { ...context, ...traceError(e) })
      this.fail(e)
    })
    this.child.on('close', (code, signal) => {
      trace('process.exit', {
        ...context,
        pid: this.child.pid,
        code,
        signal,
        status: this.stopping ? 'host-stopped' : 'exited',
      })
      this.fail(new Error(`Runtime exited (${code})`))
      this.emit('exit', code)
    })
    this.child.stdin.on('error', (e) => {
      trace('process.stdin.error', { ...context, ...traceError(e) })
      this.fail(e)
    })
  }
  send(value: unknown): void {
    if (this.ended || this.stopping) throw new Error('Runtime is disconnected')
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  request<T = unknown>(method: string, params: unknown, timeout = 30000): Promise<T> {
    const id = ++this.sequence
    const started = Date.now()
    trace('rpc.request', { ...this.context, method, rpcId: id })
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          Object.assign(new Error(`Runtime request timed out: ${method}`), { code: 'RPC_TIMEOUT' }),
        )
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      try {
        this.send({ id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
    return promise.then(
      (result) => {
        trace('rpc.response', {
          ...this.context,
          method,
          rpcId: id,
          status: 'ok',
          durationMs: Date.now() - started,
        })
        return result
      },
      (error) => {
        trace('rpc.response', {
          ...this.context,
          method,
          rpcId: id,
          status: 'failed',
          ...traceError(error),
          durationMs: Date.now() - started,
        })
        throw error
      },
    )
  }
  private fail(error: Error): void {
    if (this.ended) return
    this.ended = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    this.pending.clear()
    try {
      this.emit('terminal', error)
    } catch (failure) {
      trace('process.consumer.error', { ...this.context, ...traceError(failure) })
    }
    void this.dispose().catch((failure) => trace('process.stop.failed', traceError(failure)))
  }
  async dispose(): Promise<void> {
    if (!this.disposal) {
      this.stopping = true
      this.disposal = Promise.resolve().then(async () => {
        trace('process.stop', { ...this.context, pid: this.child.pid, reason: 'host-dispose' })
        this.fail(new Error('Runtime disconnected'))
        await killTree(this.child)
        this.removeAllListeners()
      })
    }
    return this.disposal
  }
}
