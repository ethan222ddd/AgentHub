// Opt-in native-runtime probe. Sends only a generated image in a disposable directory.
import sharp from 'sharp'
import { randomInt } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { JsonProcess, findRuntime } from '../src/main/agents/process'

const base = resolve('.local/agy-vision-probe')
await mkdir(base, { recursive: true })
const workspace = await mkdtemp(join(base, 'run-'))
const code = String(randomInt(100000, 999999))
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#16883b"/><text x="135" y="195" font-family="Arial" font-size="96" font-weight="bold" fill="white">${code}</text></svg>`,
  ),
)
  .png()
  .toFile(join(workspace, 'visual.png'))
const exe = await findRuntime('agy')
if (!exe) throw new Error('Official agy CLI is not installed')
const p = new JsonProcess(
  exe,
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
        deny: ['unsandboxed(*)', 'write_file(*)', 'command(*)'],
        ask: ['read_url(*)', 'mcp(*)'],
      },
    }),
  ],
  workspace,
)
const tools: unknown[] = []
try {
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native vision probe timed out')), 120000)
    p.on('diagnostic', (text) => console.log(String(text).slice(0, 500)))
    p.on('message', (e) => {
      if (e.event === 'step_update' && e.step_update?.step_type === 'tool') {
        const step = e.step_update
        const record = {
          name: step.tool_name,
          state: step.state,
          parameters: step.tool_info?.parameters,
          error: step.tool_info?.error,
        }
        tools.push(record)
        console.log(JSON.stringify(record))
      }
      if (e.event === 'result') {
        clearTimeout(timer)
        resolve(e.result)
      }
    })
    p.send({
      event: 'user',
      message: {
        content:
          'Use your native image-reading tool (view_file or the appropriate native local image viewer) to open visual.png in this current directory. Read the six-digit code drawn in the pixels and identify the background color. Reply with only the code followed by a space and the lowercase English color. Do not run commands or access any other files or the network.',
      },
    })
  })
  const report = { expected: `${code} green`, result, tools, workspace }
  await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await p.dispose()
}
