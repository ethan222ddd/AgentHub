import {
  query,
  createSdkMcpServer,
  tool,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeImageContent } from './images'
import { collaborationSchema } from '../../shared/schemas'
import type { Detection, AgentProfile } from '../../shared/types'
import { collaborationInstructions, type AgentAdapter, type RunContext } from './adapter'
import { runtimeEnv, findRuntime, exec, spawnOwned } from './process'
import { gateNativeTool } from './collaboration-server'
import { claudeTools } from './tool-policy'
import { NativeClaudeAdapter } from './claude-native'

export class ClaudeAdapter implements AgentAdapter {
  private queries = new Set<Query>()
  private native = new NativeClaudeAdapter()
  constructor(private key: () => string | undefined) {}
  async getQuota(profile?: AgentProfile): Promise<import('../../shared/quota').Quota> {
    if (profile?.authMode === 'api')
      return {
        provider: 'claude',
        status: 'unavailable',
        source: 'Anthropic API',
        windows: [],
        checkedAt: new Date().toISOString(),
        detail:
          'API-key billing is separate from Claude Code subscription limits. Remaining API balance is not exposed by this runtime.',
      }
    return this.native.getQuota()
  }
  async detect(profile?: AgentProfile): Promise<Detection> {
    if (profile?.authMode !== 'api') return this.native.detect()
    const executable = await findRuntime('claude')
    let version = 'Bundled official Agent SDK runtime'
    if (executable)
      try {
        version = (
          await exec(executable, ['--version'], { windowsHide: true, timeout: 10000 })
        ).stdout.trim()
      } catch {
        /* bundled runtime remains available */
      }
    return {
      provider: 'claude',
      installed: true,
      version,
      authenticated: this.key() ? null : false,
      models: [],
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      detail: this.key()
        ? 'API key configured; validity verified on first SDK request. Use runtime default or an account-supported model ID.'
        : 'Configure an Anthropic API key locally. Existing claude.ai subscription credentials are not reused.',
    }
  }
  async run(ctx: RunContext): Promise<string> {
    if (ctx.agent.authMode === 'native') return this.native.run(ctx)
    const key = this.key()
    if (!key)
      throw new Error(
        'Set an Anthropic API key in AgentHub Settings. Third-party reuse of claude.ai login is not enabled.',
      )
    const server = createSdkMcpServer({
      name: 'agenthub',
      version: '0.1.0',
      tools: [
        tool(
          'agenthub_collaborate',
          'Coordinate with the AgentHub team using structured requests.',
          collaborationSchema.shape,
          async (input) => ({
            content: [
              { type: 'text' as const, text: JSON.stringify(await ctx.collaborate(input)) },
            ],
          }),
        ),
      ],
    })
    const imageMessage: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: claudeImageContent(ctx.prompt, ctx.images) },
      parent_tool_use_id: null,
    }
    const q = query({
      prompt: ctx.images?.length
        ? (async function* () {
            yield imageMessage
          })()
        : ctx.prompt,
      options: {
        spawnClaudeCodeProcess: (options) =>
          spawnOwned(options.command, options.args, {
            ...options,
            context: { taskId: ctx.taskId, agentId: ctx.agent.id, stage: 'claude-sdk' },
          }),
        cwd: ctx.workspace,
        model: ctx.agent.model || undefined,
        effort: ctx.agent.reasoningEffort ? this.effort(ctx.agent.reasoningEffort) : undefined,
        resume: ctx.session?.nativeId,
        env: { ...runtimeEnv(), ANTHROPIC_API_KEY: key },
        settingSources: [],
        permissionMode: 'default',
        includePartialMessages: true,
        persistSession: true,
        tools: claudeTools(ctx.readOnly),
        maxBudgetUsd: ctx.maxCostUsd || undefined,
        maxTurns: 30,
        abortController: new AbortController(),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `${collaborationInstructions}\nRole: ${ctx.agent.role}\n${ctx.agent.instructions}`,
        },
        mcpServers: { agenthub: server },
        allowedTools: ['mcp__agenthub__agenthub_collaborate'],
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PreToolUse') return {}
                  const allow = await gateNativeTool(
                    ctx,
                    input.tool_name,
                    input.tool_input as Record<string, unknown>,
                  )
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: allow ? ('allow' as const) : ('deny' as const),
                      permissionDecisionReason: allow ? 'User approved once' : 'User denied',
                    },
                  }
                },
              ],
            },
          ],
        },
        canUseTool: async (name, input) =>
          (await gateNativeTool(ctx, name, input))
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Denied by user' },
      },
    })
    this.queries.add(q)
    const abort = () => {
      q.close()
    }
    ctx.signal.addEventListener('abort', abort, { once: true })
    let output = ''
    let completed = false
    try {
      if (ctx.signal.aborted) throw new Error('Cancelled')
      for await (const message of q) {
        if ('session_id' in message && typeof message.session_id === 'string')
          ctx.saveSession(message.session_id)
        if (message.type === 'stream_event') {
          const event = message.event
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            output += event.delta.text
            ctx.delta(event.delta.text)
          }
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use')
            ctx.emit('tool.started', event.content_block.name)
        }
        if (message.type === 'result') {
          if (message.usage)
            ctx.usage?.({
              inputTokens:
                message.usage.input_tokens +
                message.usage.cache_read_input_tokens +
                message.usage.cache_creation_input_tokens,
              outputTokens: message.usage.output_tokens,
              costUsd: message.total_cost_usd,
              source: 'sdk-estimate',
            })
          if (message.subtype !== 'success' || message.is_error)
            throw new Error(
              'errors' in message ? message.errors.join('\n') : 'Claude SDK turn failed',
            )
          output = message.result
          if (message.permission_denials.length)
            throw new Error(
              'Claude reported tool permission denials. Inspect activities before retrying.',
            )
          completed = true
        }
        if (message.type === 'user' && Array.isArray(message.message.content)) {
          for (const block of message.message.content)
            if (block.type === 'tool_result')
              ctx.emit(
                'tool.completed',
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              )
        }
      }
      if (ctx.signal.aborted || !completed)
        throw new Error(
          ctx.signal.aborted ? 'Cancelled' : 'Claude exited without a successful result',
        )
      return output
    } finally {
      ctx.signal.removeEventListener('abort', abort)
      q.close()
      this.queries.delete(q)
    }
  }
  async dispose(): Promise<void> {
    await this.native.dispose()
    for (const q of this.queries) q.close()
    this.queries.clear()
  }
  private effort(value: string): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(value))
      throw new Error('Unsupported Claude effort; select a level supported by this runtime/model')
    return value as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  }
}
