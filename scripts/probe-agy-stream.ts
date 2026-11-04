// Opt-in native protocol probe. No project files or credentials are read or included.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { JsonProcess, findRuntime } from '../src/main/agents/process'
import { antigravityEnvelope } from '../src/main/agents/antigravity'

const base = resolve('.local/agy-stream-probe')
await mkdir(base, { recursive: true })
const workspace = await mkdtemp(join(base, 'run-'))
const executable = await findRuntime('agy')
if (!executable) throw new Error('agy missing')
const process = new JsonProcess(
  executable,
  [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--sandbox',
    '--settings',
    JSON.stringify({
      permissions: {
        allow: ['read_file(.)'],
        deny: ['command(*)', 'write_file(*)', 'unsandboxed(*)'],
      },
    }),
    '--json-schema',
    JSON.stringify(z.toJSONSchema(antigravityEnvelope)),
  ],
  workspace,
)
const steps: unknown[] = []
try {
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), 120000)
    process.on('message', (event) => {
      if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response') {
        const { state, step_index, text_delta } = event.step_update
        steps.push({ state, step_index, text: text_delta })
        console.log(
          JSON.stringify({
            state,
            step_index,
            characters: text_delta?.length,
            prefix: text_delta?.slice(0, 80),
          }),
        )
      }
      if (event.event === 'result') {
        clearTimeout(timer)
        resolve(event.result)
      }
    })
    process.send({
      event: 'user',
      message: {
        content:
          'This is a public streaming protocol test in an empty disposable workspace. Do not use tools, read files, access network or delegate. Produce 70 numbered lines, each line PUBLIC_STREAM_<number> followed by a short ordinary sentence about software testing. The supplied JSON Schema applies to your final result: put the public lines in message, and requests must be [].',
      },
    })
  })
  await writeFile(join(base, 'report.json'), JSON.stringify({ workspace, steps, result }, null, 2))
} finally {
  await process.dispose()
}
