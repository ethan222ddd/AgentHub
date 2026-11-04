import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  configureDiagnostics,
  safeTraceFields,
  trace,
  traceError,
} from '../src/main/app/diagnostics'
import { directory } from './helpers'
describe('Metadata-only diagnostic logs', () => {
  it('drops raw payloads, prompts, environment values and credential fields', async () => {
    const log = join(await directory(), 'logs', 'diagnostics.jsonl')
    configureDiagnostics(log)
    const secret = 'sensitive-value-without-a-recognizable-prefix'
    trace('test', {
      method: 'turn/start',
      apiKey: secret,
      token: secret,
      prompt: secret,
      params: secret,
      stderr: secret,
      env: secret,
      status: 'failed',
      ...traceError(new Error(secret)),
    })
    const contents = await readFile(log, 'utf8')
    expect(contents).not.toContain(secret)
    expect(JSON.parse(contents)).toMatchObject({
      method: 'turn/start',
      status: 'failed',
      errorName: 'Error',
    })
    expect(
      safeTraceFields({ executable: 'C:\\npm path\\codex.exe', recipients: ['codex'] }),
    ).toMatchObject({ recipients: ['codex'] })
  })
})
