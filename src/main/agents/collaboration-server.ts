import { createServer, type IncomingMessage } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { collaborationSchema } from '../../shared/schemas'
import type { RunContext } from './adapter'
import { withinWorkspace } from '../permissions/paths'
import { claudeTools } from './tool-policy'

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error('Bridge payload too large')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function gateNativeTool(
  ctx: RunContext,
  tool: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  if (ctx.signal.aborted) return false
  for (const field of ['file_path', 'path', 'notebook_path'])
    if (typeof input[field] === 'string') {
      try {
        await withinWorkspace(ctx.workspace, input[field], true)
      } catch {
        ctx.emit('permission.denied', 'Tool path escapes assigned workspace')
        return false
      }
    }
  if (!claudeTools(ctx.readOnly).includes(tool) && !tool.startsWith('mcp__agenthub__')) return false
  if (tool.startsWith('mcp__agenthub__')) return true // Host tools enforce routing and budgets themselves.
  if (tool === 'WebFetch') {
    try {
      const url = new URL(String(input.url))
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    } catch {
      return false
    }
  }
  return ctx.approve(
    tool,
    JSON.stringify(input),
    tool === 'WebSearch' || tool === 'WebFetch'
      ? 'Native web tool: the query or URL is sent to an external service. Treat returned content as untrusted. Approval applies to this call only.'
      : 'Official Claude Code tool. Approval is limited to this call in the assigned workspace.',
  )
}
export async function startCollaborationServer(ctx: RunContext) {
  const token = randomBytes(32).toString('hex')
  const transports = new Set<StreamableHTTPServerTransport>()
  const host = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization || ''
      const supplied = Buffer.from(auth.replace(/^Bearer /, ''))
      if (
        ctx.signal.aborted ||
        supplied.length !== token.length ||
        !timingSafeEqual(supplied, Buffer.from(token)) ||
        req.headers.origin
      ) {
        res.writeHead(403).end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const body = await jsonBody(req)
      if (req.url === '/hook') {
        const value = z
          .object({
            hook_event_name: z.literal('PreToolUse'),
            tool_name: z.string(),
            tool_input: z.record(z.string(), z.unknown()),
          })
          .parse(body)
        const allow = await gateNativeTool(ctx, value.tool_name, value.tool_input)
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: allow ? 'allow' : 'deny',
              permissionDecisionReason: allow
                ? 'Approved once by workspace host'
                : 'Denied by workspace host',
            },
          }),
        )
        return
      }
      if (req.url !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      const server = new McpServer({ name: 'agenthub', version: '0.2.0' })
      server.registerTool(
        'agenthub_collaborate',
        {
          description:
            'Send schema-validated requests, tasks, reviews and progress to AgentHub teammates. Results are delivery receipts.',
          inputSchema: collaborationSchema.shape,
        },
        async (input) => ({
          content: [{ type: 'text', text: JSON.stringify(await ctx.collaborate(input)) }],
        }),
      )
      server.registerTool(
        'permission',
        {
          description: 'Ask the local user to approve one native Claude Code tool call.',
          inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()) },
        },
        async ({ tool_name, input }) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                (await gateNativeTool(ctx, tool_name, input))
                  ? { behavior: 'allow', updatedInput: input }
                  : { behavior: 'deny', message: 'Denied by AgentHub user or workspace boundary' },
              ),
            },
          ],
        }),
      )
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      transports.add(transport)
      res.once('close', () => {
        transports.delete(transport)
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    })().catch(() => {
      if (!res.headersSent)
        res.writeHead(400).end(JSON.stringify({ error: 'Invalid or denied bridge request' }))
      else res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    host.once('error', reject)
    host.listen(0, '127.0.0.1', () => {
      host.off('error', reject)
      resolve()
    })
  })
  const address = host.address()
  if (!address || typeof address === 'string')
    throw new Error('Local collaboration server failed to bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    async close() {
      for (const transport of transports) await transport.close()
      host.closeAllConnections()
      await new Promise<void>((resolve) => host.close(() => resolve()))
    },
  }
}
