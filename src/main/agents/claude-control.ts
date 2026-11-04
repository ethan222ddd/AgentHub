import { randomUUID } from 'node:crypto'
import type { JsonProcess } from './process'

export async function claudeControl<T>(
  proc: JsonProcess,
  request: Record<string, unknown>,
): Promise<T> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (error?: Error, data?: T) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      proc.off('message', message)
      proc.off('exit', exit)
      proc.off('terminal', terminal)
      if (error) reject(error)
      else resolve(data as T)
    }
    const exit = () => finish(new Error('Claude CLI exited before control response'))
    const terminal = (error: Error) => finish(error)
    const message = (value: {
      type?: string
      response?: { request_id?: string; subtype?: string; response?: T }
    }) => {
      if (value.type !== 'control_response' || value.response?.request_id !== requestId) return
      if (value.response.subtype !== 'success')
        return finish(
          new Error(
            'Claude native control request rejected; update CLI and verify official login.',
          ),
        )
      finish(undefined, value.response.response)
    }
    const timer = setTimeout(
      () => finish(new Error('Claude native control request timed out')),
      15000,
    )
    proc.on('message', message)
    proc.once('exit', exit)
    proc.once('terminal', terminal)
    try {
      proc.send({ type: 'control_request', request_id: requestId, request })
    } catch {
      finish(new Error('Cannot send Claude native control request'))
    }
  })
}
export const claudeMetadataArgs = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--restricted',
  '--tools',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
]
