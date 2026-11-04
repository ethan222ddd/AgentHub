import { JsonProcess, findRuntime } from '../src/main/agents/process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const base = resolve('.local/agy-probe')
await mkdir(base, { recursive: true })
const workspace = await mkdtemp(join(base, 'run-'))
const missing = process.argv.includes('--missing')
if (missing) await writeFile(join(workspace, 'backend.mjs'), 'export const double = n => n * 2\n')
const exe = await findRuntime('agy')
if (!exe) throw new Error('agy missing')
const proc = new JsonProcess(
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
        allow: [missing ? 'read_file(.)' : 'write_file(.)'],
        ask: ['command(*)', 'read_url(*)', 'mcp(*)'],
        deny: ['unsandboxed(*)', ...(missing ? ['write_file(*)'] : [])],
      },
    }),
  ],
  workspace,
)
try {
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), 120000)
    proc.on('diagnostic', (text) => console.log(String(text).slice(0, 800)))
    proc.on('message', (m) => {
      if (m.event === 'init' || m.event === 'result' || m.step_update?.step_type === 'tool')
        console.log(JSON.stringify(m))
      if (m.event === 'result') {
        clearTimeout(timer)
        done()
      }
    })
    proc.send({
      event: 'user',
      message: {
        content: missing
          ? `This is a disposable fixture. Your only workspace is ${workspace}. Try to read frontend.test.mjs with your native file reader (it does not exist), then read backend.mjs. Do not write files or run commands. Report the missing file and summarize backend.mjs.`
          : 'Use your file writing tool to create proof.txt in the current directory containing exactly PROBE. No commands, no access to other folders. Then reply OK.',
      },
    })
  })
} finally {
  await proc.dispose()
}
