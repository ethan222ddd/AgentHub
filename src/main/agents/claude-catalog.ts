import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import type { Detection } from '../../shared/types'
import type { JsonProcess } from './process'

// Official CLI control initialization: query metadata only, never send a user/model turn.
export async function readClaudeCatalog(proc: JsonProcess): Promise<Detection['models']> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (error?: Error, models?: Detection['models']) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      proc.off('message', message)
      proc.off('exit', exit)
      proc.off('terminal', terminal)
      if (error) reject(error)
      else resolve(models || [])
    }
    const exit = () => finish(new Error('Claude CLI exited before model catalog response'))
    const terminal = (error: Error) => finish(error)
    const message = (value: {
      type?: string
      response?: {
        request_id?: string
        subtype?: string
        error?: string
        response?: { models?: ModelInfo[] }
      }
    }) => {
      if (value.type !== 'control_response' || value.response?.request_id !== requestId) return
      if (value.response.subtype === 'error')
        return finish(new Error('Claude native model catalog request rejected'))
      const models = value.response.response?.models
      if (!Array.isArray(models))
        return finish(new Error('Claude CLI did not return a model catalog'))
      // Deliberately discard account/organization fields returned by initialization.
      finish(
        undefined,
        models
          .filter((m) => typeof m.value === 'string' && typeof m.displayName === 'string')
          .map((m) => ({
            id: m.value,
            name: m.displayName,
            reasoningEfforts: m.supportedEffortLevels || [],
            isDefault: m.value === 'default',
          })),
      )
    }
    const timer = setTimeout(() => finish(new Error('Claude model catalog timed out')), 10000)
    proc.on('message', message)
    proc.once('exit', exit)
    proc.once('terminal', terminal)
    try {
      proc.send({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'initialize' },
      })
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)))
    }
  })
}
