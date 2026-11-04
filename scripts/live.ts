import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CodexAdapter } from '../src/main/agents/codex'
import { ClaudeAdapter } from '../src/main/agents/claude'
import { AntigravityAdapter } from '../src/main/agents/antigravity'
import { redact } from '../src/main/permissions/paths'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import type { Provider, Session } from '../src/shared/types'
import { findRuntime } from '../src/main/agents/process'
const directory = resolve('.local/live', randomUUID())
await mkdir(directory, { recursive: true })
const adapters: [Provider, AgentAdapter][] = [
  ['codex', new CodexAdapter()],
  ['claude', new ClaudeAdapter(() => process.env.ANTHROPIC_API_KEY)],
  ['antigravity', new AntigravityAdapter()],
]
const report: Record<string, unknown> = {
  timestamp: new Date().toISOString(),
  directory,
  paidTurnsEnabled: process.env.AGENTHUB_LIVE_RUN === '1',
}
for (const [provider, adapter] of adapters) {
  let session: Session | undefined
  const operations: unknown[] = []
  const approvals: unknown[] = []
  try {
    const detection = await adapter.detect()
    report[provider] = { detection, execution: 'not_run' }
    if (
      process.env.AGENTHUB_LIVE_RUN !== '1' ||
      !detection.installed ||
      detection.authenticated === false
    )
      continue
    const workspace = join(directory, provider)
    await mkdir(workspace)
    const signal = AbortSignal.timeout(180000)
    const context: RunContext = {
      agent: {
        id: provider,
        provider,
        name: provider,
        role: 'Integration test engineer',
        model: '',
        instructions: '',
        enabled: true,
        ...(provider === 'claude' ? { authMode: 'native' as const } : {}),
      },
      workspace,
      signal,
      prompt: `This is an explicitly authorized live integration test in a new empty disposable workspace. Use your real file editing tool to create proof.txt containing exactly AGENTHUB_LIVE_${provider}. Do not run shell commands, install packages or access any other directories. Then use the AgentHub structured collaboration mechanism to report_progress with recipients [], content 'Live file edit complete', dependencies []. End with a brief public result.`,
      delta: () => {},
      emit: (type, detail) => {
        if (type === 'runtime.diagnostic') process.stdout.write(redact(detail).slice(0, 300) + '\n')
      },
      saveSession: (nativeId) => {
        session = {
          id: `live:${provider}`,
          conversationId: 'live',
          agentId: provider,
          nativeId,
          workspace,
          cursor: 0,
        }
      },
      approve: async (tool, detail) => {
        if (tool === 'Codex live web search') return false // This file-only fixture does not authorize network research.
        const params = JSON.parse(detail) as { command?: string }
        approvals.push({ tool, detail: redact(detail) })
        if (tool.includes('fileChange') || ['Write', 'Edit', 'Read'].includes(tool)) return true
        if (tool === 'Antigravity scoped workspace access') return true
        if (!tool.includes('commandExecution') || !params.command) return false
        const actions = (
          params as { commandActions?: { type: string; command: string; path?: string }[] }
        ).commandActions
        // Native App Server supplies parsed read actions. Authorize only this disposable proof file.
        if (
          actions?.length === 1 &&
          actions[0].type === 'read' &&
          actions[0].command === 'Get-Content -LiteralPath proof.txt' &&
          actions[0].path === join(workspace, 'proof.txt')
        )
          return true
        const command = params.command
        const pwsh = await findRuntime('pwsh')
        const powershell = join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        )
        const read = 'Get-Content -LiteralPath proof.txt'
        return [
          read,
          ...[pwsh, powershell]
            .filter(Boolean)
            .flatMap((shell) => [
              `"${shell}" -Command "${read}"`,
              `"${shell}" -NoProfile -Command "${read}"`,
              `${shell} -Command "${read}"`,
            ]),
        ].some((allowed) => allowed.toLowerCase() === command.toLowerCase())
      },
      collaborate: async (input) => {
        operations.push(input)
        return {
          delivered: true,
          note: 'Live harness recorded this structured progress report. No other agent was activated.',
        }
      },
    }
    const result = await adapter.run(context)
    const proof = await readFile(join(workspace, 'proof.txt'), 'utf8')
    if (proof.trim() !== `AGENTHUB_LIVE_${provider}`)
      throw new Error('Real file modification verification failed')
    if (!session) throw new Error('Native session ID was not recorded')
    const nativeBefore = session.nativeId
    const resumeProof = `AGENTHUB_RESUME_${randomUUID()}`
    await writeFile(join(workspace, 'proof.txt'), resumeProof)
    const resumed = await adapter.run({
      ...context,
      session,
      prompt:
        'Resume verification: the host has changed proof.txt since the previous turn. Read its current contents using your native file tool or a read-only shell command (Get-Content -LiteralPath proof.txt). Do not modify files, run other commands, or delegate work. Report the exact current contents; do not guess from history.',
    })
    if (!resumed.includes(resumeProof) || session.nativeId !== nativeBefore)
      throw new Error('Native session resume/file-read verification failed')
    report[provider] = {
      detection,
      execution: 'passed',
      realFileEdit: true,
      nativeSessionResume: true,
      structuredProgress: operations.length > 0,
      result: redact(result),
      resumed: redact(resumed),
      approvals,
    }
  } catch (e) {
    report[provider] = {
      ...((report[provider] as object) || {}),
      execution: 'failed',
      error: redact(String(e)),
      approvals,
    }
  } finally {
    await adapter.dispose()
  }
}
await writeFile(resolve('.local/live-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (
  Object.values(report).some(
    (value) =>
      typeof value === 'object' && value && 'execution' in value && value.execution === 'failed',
  )
)
  process.exitCode = 1
