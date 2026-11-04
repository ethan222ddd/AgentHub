import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookInput, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RunContext } from '../src/main/agents/adapter'
const state = vi.hoisted(() => ({
  options: undefined as Options | undefined,
  prompt: undefined as string | AsyncIterable<SDKUserMessage> | undefined,
  deny: false,
  close: vi.fn(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()
  return {
    ...actual,
    query: vi.fn(
      ({
        options,
        prompt,
      }: {
        options: Options
        prompt: string | AsyncIterable<SDKUserMessage>
      }) => {
        state.options = options
        state.prompt = prompt
        const generator = (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'claude-native-session',
          } as unknown as SDKMessage
          yield {
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
          } as unknown as SDKMessage
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Hello',
            permission_denials: state.deny ? [{}] : [],
          } as unknown as SDKMessage
        })()
        return Object.assign(generator, { close: state.close })
      },
    ),
  }
})
import { ClaudeAdapter } from '../src/main/agents/claude'
function context(): RunContext {
  return {
    agent: {
      id: 'claude',
      provider: 'claude',
      name: 'Claude Agent',
      role: 'Reviewer',
      instructions: '',
      model: '',
      enabled: true,
    },
    workspace: process.cwd(),
    prompt: 'Fixture contract test',
    signal: new AbortController().signal,
    emit: vi.fn(),
    delta: vi.fn(),
    saveSession: vi.fn(),
    approve: vi.fn(async () => false),
    collaborate: vi.fn(async () => ({})),
  }
}
describe('Claude official SDK adapter contract — mocked SDK, not live acceptance', () => {
  it('uses the SDK model and effort options without changing permission mode', async () => {
    const ctx = context()
    ctx.agent.model = 'fixture-model'
    ctx.agent.reasoningEffort = 'high'
    await new ClaudeAdapter(() => 'fixture-not-a-real-key').run(ctx)
    expect(state.options?.model).toBe('fixture-model')
    expect(state.options?.effort).toBe('high')
    expect(state.options?.permissionMode).toBe('default')
  })
  beforeEach(() => {
    state.options = undefined
    state.deny = false
    state.close.mockClear()
  })
  it('requires explicitly configured API authentication', async () => {
    await expect(new ClaudeAdapter(() => undefined).run(context())).rejects.toThrow('API key')
    expect(state.options).toBeUndefined()
  })
  it('maps native sessions/streaming and enforces PreToolUse before any tool allow', async () => {
    const ctx = context()
    expect(await new ClaudeAdapter(() => 'fixture-not-a-real-key').run(ctx)).toBe('Hello')
    expect(ctx.saveSession).toHaveBeenCalledWith('claude-native-session')
    expect(ctx.delta).toHaveBeenCalledWith('Hello')
    expect(state.options?.permissionMode).toBe('default')
    expect(state.options?.settingSources).toEqual([])
    expect(state.options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    const hook = state.options!.hooks!.PreToolUse![0].hooks[0]
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'unsafe operation' },
        cwd: ctx.workspace,
      } as HookInput,
      'tool-id',
      { signal: ctx.signal },
    )
    expect(result).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    expect(ctx.approve).toHaveBeenCalledOnce()
    expect(state.close).toHaveBeenCalled()
  })
  it('does not mark a result with permission denials as success', async () => {
    state.deny = true
    await expect(new ClaudeAdapter(() => 'fixture-not-a-real-key').run(context())).rejects.toThrow(
      'permission denials',
    )
    expect(state.close).toHaveBeenCalled()
  })
  it('sends binary images through official SDK streaming input, not a filename-only string', async () => {
    const ctx = context()
    ctx.images = [{ id: 'image', name: 'fixture.png', mime: 'image/png', data: 'Zml4dHVyZQ==' }]
    await new ClaudeAdapter(() => 'fixture-not-a-real-key').run(ctx)
    expect(typeof state.prompt).not.toBe('string')
    if (state.prompt && typeof state.prompt !== 'string')
      for await (const message of state.prompt) {
        expect(message).toMatchObject({
          type: 'user',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              { type: 'text', text: ctx.prompt },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: ctx.images[0].data },
              },
            ],
          },
        })
      }
  })
})
