import { AntigravityAdapter } from '../src/main/agents/antigravity'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const base = resolve('.local/agy-command')
await mkdir(base, { recursive: true })
const workspace = await mkdtemp(join(base, 'fixture-'))
const adapter = new AntigravityAdapter()
const web = process.argv.includes('--web')
const command = web ? 'curl.exe -I https://example.com/' : 'echo AGENTHUB_COMMAND_OK'
const events: { type: string; detail: string }[] = []
try {
  const result = await adapter.run({
    agent: {
      id: 'agy-command-test',
      provider: 'antigravity',
      name: 'Antigravity',
      enabled: true,
      model: '',
      role: 'Integration tester',
      instructions: '',
      commandAllowlist: [command],
      networkAllowlist: web ? ['example.com'] : [],
    },
    workspace,
    signal: AbortSignal.timeout(120000),
    prompt: `This disposable fixture authorizes exactly one command: ${command}. Execute that exact command using your native command tool. Do not read/write files, run other commands or delegate. Report its actual stdout in message and requests [].`,
    emit: (type, detail) => events.push({ type, detail }),
    delta: () => {},
    saveSession: () => {},
    approve: async (tool, detail) =>
      tool === 'Antigravity scoped workspace access' && detail.includes(command),
    collaborate: async () => {
      throw new Error('No delegation authorized')
    },
  })
  if (
    !(web ? /HTTP\/[\d.]+\s+200/i.test(result) : result.includes('AGENTHUB_COMMAND_OK')) ||
    !events.some((e) => e.type === 'tool.completed' && e.detail.includes('run_command'))
  )
    throw new Error('Exact command was not verifiably executed')
  await writeFile(
    resolve(web ? '.local/agy-command-web-report.json' : '.local/agy-command-report.json'),
    JSON.stringify({ passed: true, result, events, workspace, command, web }, null, 2),
  )
  console.log('PASS: real sandboxed Antigravity command with approved exact allowlist')
} finally {
  await adapter.dispose()
}
