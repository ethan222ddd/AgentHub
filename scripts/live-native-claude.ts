import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { NativeClaudeAdapter } from '../src/main/agents/claude-native'
import type { RunContext } from '../src/main/agents/adapter'
const root = resolve('.local/native-claude')
await mkdir(root, { recursive: true })
const workspace = await mkdtemp(join(root, 'live-'))
const adapter = new NativeClaudeAdapter()
const reports: unknown[] = []
const ctx: RunContext = {
  agent: {
    id: 'claude-native',
    provider: 'claude',
    name: 'Claude',
    model: '',
    role: 'Integration tester',
    instructions: '',
    enabled: true,
    authMode: 'native',
  },
  workspace,
  prompt: 'Reply with exactly OK. Do not use tools.',
  signal: AbortSignal.timeout(180000),
  emit: () => {},
  delta: () => {},
  saveSession: (id) => {
    reports.push({ nativeSessionId: id })
  },
  approve: async (name) => ['Read', 'Write', 'Edit'].includes(name),
  collaborate: async (input) => {
    reports.push({ structuredRequest: input })
    return { delivered: true }
  },
}
try {
  const detection = await adapter.detect()
  console.log(JSON.stringify(detection))
  const answer = await adapter.run(ctx)
  if (answer.trim() !== 'OK') throw new Error('Native CLI did not answer OK')
  const edited = await adapter.run({
    ...ctx,
    prompt:
      'Create proof.txt containing exactly CLAUDE_NATIVE_EDIT using your Write tool, then call mcp__agenthub__agenthub_collaborate with operation report_progress, recipients [], content "Native edit complete", dependencies []. Do not run shell commands or access other folders.',
  })
  const proof = (await readFile(join(workspace, 'proof.txt'), 'utf8')).trim()
  if (
    proof !== 'CLAUDE_NATIVE_EDIT' ||
    !reports.some((r) => typeof r === 'object' && r && 'structuredRequest' in r)
  )
    throw new Error('File modification or structured MCP bridge verification failed')
  await writeFile(
    resolve('.local/native-claude-report.json'),
    JSON.stringify({ answer, edited, proof, workspace, reports }, null, 2),
  )
  console.log(
    'PASSED: unmodified local CLI / own subscription / OK / real file write / MCP progress',
  )
} finally {
  await adapter.dispose()
}
