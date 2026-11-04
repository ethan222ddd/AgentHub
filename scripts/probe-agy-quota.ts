import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { JsonProcess, findRuntime } from '../src/main/agents/process'
const dir = resolve('.local/quota-probe')
await mkdir(dir, { recursive: true })
const script = resolve(dir, 'status.cjs'),
  output = resolve(dir, 'quota.json')
await writeFile(
  script,
  `let s='';process.stdin.on('data',d=>{s+=d;if(s.length>1000000)process.exit(1)});process.stdin.on('end',()=>{try{const {quota}=JSON.parse(s);if(quota)require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({quota}));process.stdout.write('AgentHub quota probe')}catch{}})`,
)
const executable = await findRuntime('agy')
if (!executable) throw new Error('AGY missing')
const proc = new JsonProcess(
  executable,
  [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--sandbox',
    '--settings',
    JSON.stringify({
      statusLine: { type: 'command', command: `"${process.execPath}" "${script}"` },
    }),
  ],
  dir,
)
try {
  if (process.argv.includes('--live-turn')) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AGY quota probe timed out')), 45000)
      proc.on('message', (event: { event?: string; result?: { status?: string } }) => {
        if (event.event !== 'result') return
        clearTimeout(timer)
        console.log('Native result: ' + event.result?.status)
        resolve()
      })
      proc.send({
        event: 'user',
        message: { content: 'Reply only OK. Do not use any tools or access files.' },
      })
    })
  } else await new Promise((r) => setTimeout(r, 5000))
  try {
    console.log(await readFile(output, 'utf8'))
  } catch {
    console.log('No status-line quota emitted in headless mode.')
  }
} finally {
  await proc.dispose()
}
