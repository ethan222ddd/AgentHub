// Deterministic NDJSON protocol fixture, not a real runtime or sandbox.
import { createInterface } from 'node:readline'
import process from 'node:process'
import { setTimeout } from 'node:timers'
const mode = process.argv[2] || 'normal'
let round = 0
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const request = (operation) => ({
  operation,
  recipients: [],
  content: 'Fixture source',
  ...(operation === 'read_context' ? { messageIds: ['source-id'] } : {}),
  ...(operation === 'read_artifact' ? { artifactId: 'artifact-id' } : {}),
})
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line)
  if (input.event !== 'user' || typeof input.message.content !== 'string') process.exit(9)
  round++
  if (round === 1)
    send({
      event: 'init',
      conversation_id: 'agy-continuation',
      init: { tools: ['read_file'], permission_mode: 'request-review' },
    })
  if (['stream', 'stream-json', 'stream-denied'].includes(mode)) {
    const envelope = { message: 'Validated public answer', requests: [] }
    const step = (step_type, state, text_delta) =>
      send({
        event: 'step_update',
        step_update: {
          conversation_id: 'agy-continuation',
          step_index: 1,
          step_type,
          state,
          text_delta,
        },
      })
    step('thinking', 'ACTIVE', 'PRIVATE_REASONING_SENTINEL')
    step(
      'agent_response',
      'ACTIVE',
      mode === 'stream-json' ? '{"message":"ROUTING_JSON_SENTINEL"' : 'Public streaming ',
    )
    step(
      'agent_response',
      'ACTIVE',
      mode === 'stream-json' ? ',"requests":[]}' : 'before completion',
    )
    setTimeout(() => {
      step('agent_response', 'DONE', JSON.stringify(envelope))
      send({
        event: 'result',
        result: {
          status: mode === 'stream-denied' ? 'ERROR' : 'SUCCESS',
          num_turns: 1,
          conversation_id: 'agy-continuation',
          structured_output: envelope,
        },
      })
    }, 300)
    return
  }
  if (['hang', 'late-duplicate'].includes(mode) && round > 1) return
  let envelope
  if (round === 1 || mode === 'loop') {
    envelope = { message: 'DO_NOT_PUBLISH_STAGE', requests: [request('search_context')] }
    if (mode === 'mixed') envelope.requests.push(request('report_progress'))
    if (mode === 'invalid') envelope.requests[0].operation = 'invented_operation'
  } else {
    const payload = JSON.parse(input.message.content.slice(input.message.content.indexOf('\n') + 1))
    if (payload.trust !== 'untrusted-data' || !payload.results?.length) process.exit(8)
    if (mode === 'chain' && round < 4)
      envelope = {
        message: 'DO_NOT_PUBLISH_STAGE',
        requests: [request(round === 2 ? 'read_context' : 'read_artifact')],
      }
    else envelope = { message: JSON.stringify(payload.results), requests: [] }
  }
  const result = {
    event: 'result',
    result: {
      status: 'SUCCESS',
      ...(mode !== 'missing-counter' ? { num_turns: round } : {}),
      conversation_id: mode === 'switch' && round > 1 ? 'wrong-session' : 'agy-continuation',
      structured_output: envelope,
      usage: { input_tokens: round * 10, output_tokens: round * 5 },
    },
  }
  send(result)
  if (mode === 'duplicate') send(result)
  if (mode === 'late-duplicate') setTimeout(() => send(result), 5)
  if (mode === 'exit-host') setTimeout(() => process.exit(7), 15)
})
