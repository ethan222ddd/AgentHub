import { JsonProcess, exec, findRuntime, runtimeEnv } from './process'
import { collaborationInstructions, type AgentAdapter, type RunContext } from './adapter'
import type { Detection } from '../../shared/types'
import { startCollaborationServer } from './collaboration-server'
import { claudeImageContent } from './images'
import { claudeTools } from './tool-policy'
import { readClaudeCatalog } from './claude-catalog'
import { claudeControl, claudeMetadataArgs } from './claude-control'
import { claudeQuota } from './quota'

interface NativeEvent {
  type: string
  subtype?: string
  session_id?: string
  tools?: string[]
  model?: string
  result?: string
  is_error?: boolean
  permission_denials?: unknown[]
  errors?: string[]
  total_cost_usd?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  event?: {
    type: string
    delta?: { type: string; text?: string }
    content_block?: { type: string; name?: string }
  }
}
/** Classify provider failures without exposing raw result text or tool arguments. */
export function nativeClaudeFailure(
  event: Pick<NativeEvent, 'subtype' | 'is_error' | 'errors' | 'result' | 'permission_denials'>,
): string | undefined {
  const denied = event.permission_denials?.length || 0
  if (event.subtype === 'success' && !event.is_error && !denied) return undefined
  const diagnostic = [
    ...(Array.isArray(event.errors) ? event.errors.slice(0, 8) : []),
    event.is_error ? event.result : undefined,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.slice(0, 4000))
    .join('\n')
  if (
    /oauth.{0,60}(?:expired|refresh)|failed to authenticate|not logged in|authentication required/i.test(
      diagnostic,
    )
  )
    return 'Claude Code sign-in is no longer valid. Run `claude auth login` in a local terminal, then retry the task.'
  if (/rate.limit|usage limit|out of (?:extra )?usage|too many requests|\b429\b/i.test(diagnostic))
    return 'Claude Code reported a usage or rate limit. Check its official usage screen and retry after the limit resets.'
  if (denied)
    return `Claude Code denied ${denied} tool request(s). Review the activity and workspace permissions before retrying.`
  if (/ECONNRESET|ENOTFOUND|ETIMEDOUT|network error|connection refused/i.test(diagnostic))
    return 'Claude Code reported a network error. Check connectivity and retry.'
  if (event.subtype === 'error_max_turns')
    return 'Claude Code reached the native turn limit. Inspect the partial changes before retrying.'
  return 'Claude Code did not complete the task. Check official CLI login and diagnostics before retrying.'
}
export class NativeClaudeAdapter implements AgentAdapter {
  private processes = new Set<JsonProcess>()
  async getQuota() {
    const executable = await findRuntime('claude')
    if (!executable) throw new Error('Official Claude Code CLI not installed')
    const proc = new JsonProcess(executable, claudeMetadataArgs, process.cwd())
    this.processes.add(proc)
    try {
      await claudeControl(proc, { subtype: 'initialize' })
      return claudeQuota(await claudeControl(proc, { subtype: 'get_usage', skip_behaviors: true }))
    } finally {
      await proc.dispose()
      this.processes.delete(proc)
    }
  }
  async detect(): Promise<Detection> {
    const executable = await findRuntime('claude')
    const result: Detection = {
      provider: 'claude',
      installed: !!executable,
      authenticated: false,
      version: '',
      detail: 'Install unmodified official Claude Code and sign in through its own login flow.',
      models: [],
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    }
    if (!executable) return result
    try {
      result.version = (
        await exec(executable, ['--version'], { windowsHide: true, timeout: 10000 })
      ).stdout.trim()
      const status = JSON.parse(
        (
          await exec(executable, ['auth', 'status'], {
            windowsHide: true,
            timeout: 10000,
            env: runtimeEnv(),
          })
        ).stdout,
      ) as { loggedIn?: boolean; authMethod?: string }
      result.authenticated = status.loggedIn === true
      result.detail = result.authenticated
        ? `Official local CLI signed in (${status.authMethod || 'native'}). Its own account and rate limits apply. No credentials are copied by AgentHub.`
        : 'Run claude auth login using the official terminal flow.'
      const proc = new JsonProcess(
        executable,
        [
          '-p',
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--verbose',
          '--restricted',
          '--tools',
          '',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
        ],
        process.cwd(),
      )
      this.processes.add(proc)
      try {
        result.models = await readClaudeCatalog(proc)
      } catch {
        result.detail +=
          ' Native model catalog unavailable; update the CLI or enter an account-supported model ID.'
      } finally {
        await proc.dispose()
        this.processes.delete(proc)
      }
    } catch {
      result.detail =
        'Native authentication status check failed. Run claude auth status in your terminal.'
    }
    return result
  }
  async run(ctx: RunContext): Promise<string> {
    const executable = await findRuntime('claude')
    if (!executable) throw new Error('Official Claude Code CLI not installed')
    const version = (await exec(executable, ['--version'], { windowsHide: true, timeout: 10000 }))
      .stdout
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(version)
    if (
      !match ||
      Number(match[1]) < 2 ||
      (Number(match[1]) === 2 &&
        (Number(match[2]) < 1 || (Number(match[2]) === 1 && Number(match[3]) < 295)))
    )
      throw new Error(
        'Claude Code 2.1.295+ is required for fail-closed HTTP permission hooks. Update the official CLI.',
      )
    const bridge = await startCollaborationServer(ctx)
    const headers = { Authorization: 'Bearer ${AGENTHUB_BRIDGE_TOKEN}' }
    const hook = {
      type: 'http',
      url: bridge.url + '/hook',
      headers,
      allowedEnvVars: ['AGENTHUB_BRIDGE_TOKEN'],
      onFailure: 'block',
      timeout: 600,
    }
    const settings = { hooks: { PreToolUse: [{ matcher: '*', hooks: [hook] }] } }
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--restricted',
      '--tools',
      claudeTools(ctx.readOnly).join(','),
      '--permission-mode',
      'default',
      '--settings',
      JSON.stringify(settings),
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({
        mcpServers: { agenthub: { type: 'http', url: bridge.url + '/mcp', headers } },
      }),
      '--permission-prompt-tool',
      'mcp__agenthub__permission',
      '--append-system-prompt',
      `${collaborationInstructions}\n${ctx.agent.role}\n${ctx.agent.instructions}`,
      '--max-turns',
      '30',
    ]
    if (ctx.agent.model) args.push('--model', ctx.agent.model)
    if (ctx.agent.reasoningEffort) args.push('--effort', ctx.agent.reasoningEffort)
    if (ctx.session?.nativeId) args.push('--resume', ctx.session.nativeId)
    if (ctx.maxCostUsd) args.push('--max-budget-usd', String(ctx.maxCostUsd))
    const proc = new JsonProcess(
      executable,
      args,
      ctx.workspace,
      { ...runtimeEnv(), AGENTHUB_BRIDGE_TOKEN: bridge.token },
      { agentId: ctx.agent.id, taskId: ctx.taskId, stage: 'official-claude-cli' },
    )
    this.processes.add(proc)
    try {
      return await new Promise<string>((resolve, reject) => {
        const abort = () => {
          reject(new Error('Claude Code cancelled'))
          void proc.dispose()
        }
        ctx.signal.addEventListener('abort', abort, { once: true })
        proc.once('terminal', (error) => {
          ctx.signal.removeEventListener('abort', abort)
          reject(error)
        })
        proc.on('exit', (code) => {
          ctx.signal.removeEventListener('abort', abort)
          reject(new Error(`Claude Code exited before successful result (${code})`))
        })
        proc.on('diagnostic', (text: string) => ctx.emit('runtime.diagnostic', text))
        proc.on('message', (m: NativeEvent) => {
          if (m.session_id) ctx.saveSession(m.session_id)
          if (m.type === 'system' && m.subtype === 'init') {
            ctx.emit(
              'runtime.configuration',
              JSON.stringify({
                model: m.model,
                requestedModel: ctx.agent.model,
                requestedEffort: ctx.agent.reasoningEffort || '',
              }),
            )
            ctx.emit('session.started', 'Official Claude Code native session connected')
            if (m.tools)
              ctx.emit(
                'session.capabilities',
                JSON.stringify({
                  tools: m.tools
                    .filter((name) => /^[a-zA-Z0-9_.:/-]{1,160}$/.test(name))
                    .slice(0, 100),
                }),
              )
          }
          if (m.type === 'stream_event') {
            if (
              m.event?.type === 'content_block_delta' &&
              m.event.delta?.type === 'text_delta' &&
              m.event.delta.text
            )
              ctx.delta(m.event.delta.text)
            if (
              m.event?.type === 'content_block_start' &&
              m.event.content_block?.type === 'tool_use'
            )
              ctx.emit('tool.started', m.event.content_block.name || 'tool')
          }
          if (m.type === 'result') {
            ctx.signal.removeEventListener('abort', abort)
            if (m.usage)
              ctx.usage?.({
                inputTokens:
                  (m.usage.input_tokens || 0) +
                  (m.usage.cache_read_input_tokens || 0) +
                  (m.usage.cache_creation_input_tokens || 0),
                outputTokens: m.usage.output_tokens || 0,
                costUsd: m.total_cost_usd,
                source: 'native-estimate',
              })
            const failure = nativeClaudeFailure(m)
            if (failure) reject(new Error(failure))
            else resolve(m.result || '')
          }
        })
        if (ctx.signal.aborted) abort()
        else {
          proc.send({
            type: 'user',
            message: {
              role: 'user',
              content: ctx.images?.length ? claudeImageContent(ctx.prompt, ctx.images) : ctx.prompt,
            },
          })
          proc.child.stdin.end()
        }
      })
    } finally {
      await proc.dispose()
      this.processes.delete(proc)
      await bridge.close()
    }
  }
  async dispose() {
    await Promise.all([...this.processes].map((p) => p.dispose()))
    this.processes.clear()
  }
}
