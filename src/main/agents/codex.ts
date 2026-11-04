import { JsonProcess, findRuntime, exec, runtimeEnv } from './process'
import { trace } from '../app/diagnostics'
import { version } from '../../../package.json'
import { localImageInputs } from './images'
import { collaborationInstructions, type AgentAdapter, type RunContext } from './adapter'
import { collaborationSchema, collaborationJsonSchema } from '../../shared/schemas'
import type { Detection } from '../../shared/types'
import { codexNetworkGrant } from './tool-policy'
import { codexQuota } from './quota'
interface Wire {
  id?: number
  method?: string
  params?: {
    delta?: string
    threadId?: string
    turnId?: string
    tool?: string
    arguments?: unknown
    permissions?: unknown
    tokenUsage?: { total: { inputTokens: number; outputTokens: number } }
    item?: { id: string; type: string; text?: string; command?: string; status?: string }
    turn?: { id: string; status: string; error?: { message: string } }
  }
}
export class CodexAdapter implements AgentAdapter {
  private processes = new Set<JsonProcess>()
  constructor(private factory?: (cwd: string) => JsonProcess) {}
  private async connect(cwd: string, ctx?: RunContext): Promise<JsonProcess> {
    const executable = await findRuntime('codex')
    if (!executable && !this.factory)
      throw new Error(
        'Codex CLI not installed. Install the official Codex CLI and run codex login.',
      )
    const context = {
      agentId: ctx?.agent.id || 'codex',
      taskId: ctx?.taskId,
      conversationId: ctx?.conversationId,
      stage: 'codex-app-server',
    }
    ctx?.emit('agent.connecting', 'Launching native Codex App Server (shell: false)')
    const p = this.factory
      ? this.factory(cwd)
      : new JsonProcess(executable!, ['app-server'], cwd, runtimeEnv(), context)
    this.processes.add(p)
    try {
      await p.request('initialize', {
        clientInfo: { name: 'agenthub', title: 'AgentHub', version },
        capabilities: { experimentalApi: true },
      })
      p.send({ method: 'initialized', params: {} })
      trace('agent.connected', context)
      ctx?.emit('agent.connected', 'App Server initialize completed')
      return p
    } catch (error) {
      await p.dispose()
      this.processes.delete(p)
      throw error
    }
  }
  async getQuota() {
    const proc = await this.connect(process.cwd())
    try {
      return codexQuota(await proc.request('account/rateLimits/read', {}))
    } finally {
      await proc.dispose()
      this.processes.delete(proc)
    }
  }
  async detect(): Promise<Detection> {
    const base: Detection = {
      provider: 'codex',
      installed: false,
      authenticated: null,
      version: '',
      detail: '',
      models: [],
    }
    const executable = await findRuntime('codex')
    if (!executable)
      return { ...base, detail: 'Install Codex CLI, then run codex login in your terminal.' }
    base.installed = true
    let p: JsonProcess | undefined
    try {
      base.version = (
        await exec(executable, ['--version'], { windowsHide: true, timeout: 10000 })
      ).stdout.trim()
      p = await this.connect(process.cwd())
      const account = await p.request<{ account?: unknown }>('account/read', {
        refreshToken: false,
      })
      base.authenticated = !!account.account
      const models = await p.request<{
        data: {
          id: string
          model: string
          displayName: string
          isDefault?: boolean
          defaultReasoningEffort?: string
          supportedReasoningEfforts?: { reasoningEffort: string }[]
        }[]
      }>('model/list', {})
      base.models = models.data.map((m) => ({
        id: m.model || m.id,
        name: m.displayName || m.model,
        isDefault: m.isDefault,
        reasoningEfforts: m.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
        defaultReasoningEffort: m.defaultReasoningEffort,
      }))
      base.detail = base.authenticated
        ? 'App Server handshake and account status verified.'
        : 'Run codex login using the official CLI.'
    } catch (e) {
      base.detail = `App Server compatibility check failed: ${String(e)}`
    } finally {
      if (p) {
        await p.dispose()
        this.processes.delete(p)
      }
    }
    return base
  }
  async run(ctx: RunContext): Promise<string> {
    const p = await this.connect(ctx.workspace, ctx)
    let nativeId = ctx.session?.nativeId || ''
    let turnId = ''
    let output = ''
    const messages = new Map<string, string>()
    let settle: ((value: string) => void) | undefined
    let fail: ((e: Error) => void) | undefined
    const completion = new Promise<string>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    // A setup failure may occur before completion is awaited.
    void completion.catch(() => {})
    const abort = () => {
      fail?.(new Error('Cancelled by user'))
      void p.dispose()
    }
    ctx.signal.addEventListener('abort', abort, { once: true })
    p.on('exit', () => fail?.(new Error('Codex App Server exited before turn completion')))
    p.once('terminal', (error) => fail?.(error))
    p.on('diagnostic', (s: string) => ctx.emit('runtime.diagnostic', s))
    p.on('message', (m: Wire) => {
      const params = m.params || {}
      trace(m.id !== undefined ? 'rpc.server-request' : 'rpc.notification', {
        agentId: ctx.agent.id,
        method: m.method,
        rpcId: m.id,
        sessionId: params.threadId || nativeId,
        turnId: params.turnId || params.turn?.id,
        status: params.turn?.status,
        characters: m.method === 'item/agentMessage/delta' ? params.delta?.length : undefined,
      })
      if (m.id !== undefined && m.method) {
        void (async () => {
          if (m.method === 'item/tool/call') {
            if (params.tool !== 'agenthub_collaborate') throw new Error('Unknown host tool')
            const result = await ctx.collaborate(collaborationSchema.parse(params.arguments))
            p.send({
              id: m.id,
              result: {
                contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
                success: true,
              },
            })
          } else if (
            m.method === 'item/commandExecution/requestApproval' ||
            m.method === 'item/fileChange/requestApproval'
          ) {
            const allow = await ctx.approve(
              m.method,
              JSON.stringify(params),
              'Approve only this operation; native sandbox limits still apply.',
            )
            p.send({ id: m.id, result: { decision: allow ? 'accept' : 'decline' } })
          } else if (m.method === 'item/permissions/requestApproval') {
            p.send({ id: m.id, result: await codexNetworkGrant(ctx, params.permissions) })
          } else
            p.send({
              id: m.id,
              error: {
                code: -32601,
                message: 'AgentHub does not support this interactive request. Operation denied.',
              },
            })
        })().catch((e) => {
          try {
            p.send({ id: m.id, error: { code: -32000, message: String(e) } })
          } catch {
            /* disconnected */
          }
        })
      }
      if (params.threadId && nativeId && params.threadId !== nativeId) return
      if (m.method === 'thread/tokenUsage/updated' && params.tokenUsage)
        ctx.usage?.({ ...params.tokenUsage.total, source: 'codex-reported', scope: 'session' })
      if (m.method === 'item/agentMessage/delta' && params.delta) {
        output += params.delta
        ctx.delta(params.delta)
      }
      if (m.method === 'item/commandExecution/outputDelta' && params.delta)
        ctx.emit('terminal.output', params.delta, params.turnId)
      if (m.method === 'item/started' && params.item && params.item.type !== 'reasoning')
        ctx.emit('tool.started', `${params.item.type}: ${params.item.command || ''}`, params.turnId)
      if (m.method === 'item/completed' && params.item) {
        if (params.item.type === 'agentMessage' && params.item.text)
          messages.set(params.item.id, params.item.text)
        else if (params.item.type !== 'reasoning')
          ctx.emit(
            'tool.completed',
            `${params.item.type}: ${params.item.status || 'finished'}`,
            params.turnId,
          )
      }
      if (m.method === 'turn/completed' && params.turn) {
        if (params.turn.status === 'completed')
          settle?.([...messages.values()].join('\n\n') || output)
        else fail?.(new Error(params.turn.error?.message || `Codex turn ${params.turn.status}`))
      }
    })
    try {
      if (ctx.signal.aborted) throw new Error('Cancelled')
      const liveSearch = await ctx.approve(
        'Codex live web search',
        'Enable the native web_search tool for this turn (queries and page requests go to external services).',
        'This authorizes native web research for the turn, including search queries. Shell network access still uses separate native approval. Denying keeps web search disabled without stopping local work.',
      )
      if (ctx.signal.aborted) throw new Error('Cancelled')
      const policy = {
        cwd: ctx.workspace,
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: ctx.readOnly ? 'read-only' : 'workspace-write',
        config: { web_search: liveSearch ? 'live' : 'disabled' },
      }
      if (nativeId) await p.request('thread/resume', { threadId: nativeId, ...policy })
      else {
        const result = await p.request<{ thread: { id: string } }>('thread/start', {
          ...policy,
          model: ctx.agent.model || undefined,
          developerInstructions: `${collaborationInstructions}\nRole: ${ctx.agent.role}\n${ctx.agent.instructions}`,
          dynamicTools: [
            {
              type: 'function',
              name: 'agenthub_collaborate',
              description:
                'Send structured requests, tasks, review and progress to the shared AgentHub team. Return value is a delivery receipt, not task completion.',
              inputSchema: collaborationJsonSchema,
            },
          ],
        })
        nativeId = result.thread.id
        ctx.saveSession(nativeId)
      }
      trace('session.ready', {
        agentId: ctx.agent.id,
        sessionId: nativeId,
        cwd: ctx.workspace,
        status: ctx.session ? 'resumed' : 'created',
      })
      ctx.emit(
        'session.started',
        ctx.session ? 'Native Codex thread resumed' : 'Native Codex thread created',
      )
      const images = await localImageInputs(ctx.images)
      try {
        const started = await p.request<{ turn: { id: string } }>('turn/start', {
          effort: ctx.agent.reasoningEffort || undefined,
          threadId: nativeId,
          model: ctx.agent.model || undefined,
          input: [{ type: 'text', text: ctx.prompt, text_elements: [] }, ...images.inputs],
        })
        turnId = started.turn.id
        ctx.emit('turn.started', 'Codex running', turnId)
        const output = await completion
        if (ctx.agent.model || ctx.agent.reasoningEffort) {
          const effective = await p.request<{ model: string; reasoningEffort?: string }>(
            'thread/resume',
            { threadId: nativeId },
          )
          ctx.emit(
            'runtime.configuration',
            JSON.stringify({
              requestedModel: ctx.agent.model,
              requestedEffort: ctx.agent.reasoningEffort || '',
              model: effective.model,
              reasoningEffort: effective.reasoningEffort,
            }),
          )
        }
        return output
      } finally {
        await p.dispose()
        await images.dispose()
      }
    } finally {
      ctx.signal.removeEventListener('abort', abort)
      await p.dispose()
      this.processes.delete(p)
    }
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.processes].map((p) => p.dispose()))
    this.processes.clear()
  }
}
