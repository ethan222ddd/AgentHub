// Deterministic protocol fixture. Never used in the application or live acceptance.
import { createInterface } from 'node:readline'
import process from 'node:process'
import { setTimeout } from 'node:timers'
const mode = process.argv[2] || 'codex'
let selectedModel = '',
  selectedEffort = ''
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (mode === 'claude-quota') {
    if (m.type !== 'control_request') process.exit(9)
    if (m.request.subtype === 'get_usage' && m.request.skip_behaviors !== true) process.exit(10)
    send({ type: 'control_response', response: { request_id: 'wrong-id', subtype: 'error' } })
    send({
      type: 'control_response',
      response: {
        request_id: m.request_id,
        subtype: 'success',
        response:
          m.request.subtype === 'initialize'
            ? {}
            : { rate_limits_available: true, rate_limits: { five_hour: { utilization: 25 } } },
      },
    })
    return
  }
  if (mode === 'claude-catalog') {
    send({
      type: 'control_response',
      response: {
        request_id: m.request_id,
        subtype: 'success',
        response: {
          models: [
            { value: 'opus', displayName: 'Fixture Opus', supportedEffortLevels: ['low', 'high'] },
            { value: 'sonnet', displayName: 'Fixture Sonnet', supportedEffortLevels: ['medium'] },
          ],
          account: { email: 'DO_NOT_RETAIN_ACCOUNT_DATA' },
        },
      },
    })
    return
  }
  if (mode === 'crash') {
    process.exit(7)
    return
  }
  if (mode === 'hang') return
  if (mode === 'invalid') return process.stdout.write('not-json\n')
  if (mode === 'oversize') return process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1))
  if (mode === 'notification') return send({ method: 'fixture.event' })
  if (mode === 'echo') {
    const encoded = JSON.stringify({ id: m.id, result: m.params }) + '\n'
    process.stdout.write(encoded.slice(0, 8))
    setTimeout(() => process.stdout.write(encoded.slice(8)), 5)
    return
  }
  if (mode === 'agy' || mode === 'agy-denied' || mode === 'agy-missing' || mode === 'agy-read') {
    send({ event: 'init', conversation_id: 'agy-native-session' })
    if (mode === 'agy-denied') process.stderr.write('Tool denied: run_command requires approval\n')
    if (mode === 'agy-missing')
      send({
        event: 'step_update',
        step_update: {
          step_type: 'tool',
          state: 'ERROR',
          tool_name: 'read_file',
          tool_info: { error: { type: 'TOOL_ERROR', message: 'file does not exist' } },
        },
      })
    send({
      event: 'step_update',
      step_update: { step_type: 'tool', state: 'DONE', tool_name: 'read_file' },
    })
    setTimeout(
      () =>
        send({
          event: 'result',
          result: {
            status: 'SUCCESS',
            conversation_id: 'agy-native-session',
            structured_output: {
              message: 'Validated Antigravity fixture',
              requests: [
                {
                  operation: mode === 'agy-read' ? 'search_context' : 'report_progress',
                  recipients: [],
                  content: 'Fixture progress',
                },
              ],
            },
          },
        }),
      20,
    )
    return
  }
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fixture' } })
  if (m.method === 'thread/start' || m.method === 'thread/resume') {
    if (m.params.model) selectedModel = m.params.model
    send({
      id: m.id,
      result: {
        thread: { id: 'codex-native-session' },
        model: selectedModel,
        reasoningEffort: selectedEffort,
      },
    })
  }
  if (m.method === 'turn/start') {
    selectedEffort = m.params.effort || ''
    selectedModel = m.params.model || selectedModel
    send({ id: m.id, result: { turn: { id: 'native-turn' } } })
    send({
      method: 'item/agentMessage/delta',
      params: { threadId: m.params.threadId, delta: 'hello ' },
    })
    send({
      method: 'item/tool/call',
      id: 999,
      params: {
        threadId: m.params.threadId,
        tool: 'agenthub_collaborate',
        arguments: { operation: 'report_progress', recipients: [], content: 'Fixture progress' },
      },
    })
  }
  if (m.id === 999 && m.result) {
    send({
      method: 'item/completed',
      params: { item: { id: 'answer', type: 'agentMessage', text: 'hello world' } },
    })
    send({ method: 'turn/completed', params: { turn: { id: 'native-turn', status: 'completed' } } })
  }
})
