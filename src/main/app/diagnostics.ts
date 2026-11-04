import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { redact } from '../permissions/paths'

// Metadata only. Never accept prompts, RPC payloads, account objects, stderr or env values.
const allowed = new Set([
  'agentId',
  'taskId',
  'conversationId',
  'messageId',
  'correlationId',
  'sessionId',
  'turnId',
  'rpcId',
  'method',
  'stage',
  'executable',
  'source',
  'cwd',
  'pid',
  'code',
  'signal',
  'errorCode',
  'errorName',
  'status',
  'characters',
  'bytes',
  'recipients',
  'enabledAgentIds',
  'pathEntries',
  'environmentKeys',
  'packaged',
  'version',
  'reason',
  'durationMs',
])
type Value = string | number | boolean | null | undefined | string[]
export type TraceFields = Record<string, Value>
export function safeTraceFields(fields: TraceFields): TraceFields {
  const result: TraceFields = {}
  for (const [key, value] of Object.entries(fields))
    if (allowed.has(key))
      result[key] = Array.isArray(value)
        ? value.map((v) => redact(v).slice(0, 2048)).slice(0, 100)
        : typeof value === 'string'
          ? redact(value).slice(0, 4096)
          : value
  return result
}
let logPath: string | undefined
export function configureDiagnostics(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  logPath = path
}
export function diagnosticsPath(): string | undefined {
  return logPath
}
export function trace(event: string, fields: TraceFields = {}): void {
  if (!logPath) return
  try {
    if (existsSync(logPath) && statSync(logPath).size > 2 * 1024 * 1024) {
      if (existsSync(logPath + '.1')) unlinkSync(logPath + '.1')
      renameSync(logPath, logPath + '.1')
    }
    appendFileSync(
      logPath,
      JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeTraceFields(fields) }) +
        '\n',
      { mode: 0o600 },
    )
  } catch {
    /* diagnostics must not interrupt the coding task */
  }
}
export function traceError(error: unknown): TraceFields {
  const e = error as { code?: string | number; name?: string }
  return { errorCode: e?.code, errorName: e?.name || 'Error' }
}
