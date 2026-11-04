import { describe, it, expect, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gateNativeTool, startCollaborationServer } from '../src/main/agents/collaboration-server'
import { directory } from './helpers'
import type { RunContext } from '../src/main/agents/adapter'
async function context(): Promise<RunContext> {
  return {
    agent: {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      role: 'Tester',
      instructions: '',
      model: '',
      enabled: true,
    },
    workspace: await directory(),
    prompt: '',
    signal: new AbortController().signal,
    emit: vi.fn(),
    delta: vi.fn(),
    saveSession: vi.fn(),
    approve: vi.fn(async () => true),
    collaborate: vi.fn(async () => ({ delivered: true })),
  }
}
describe('Native collaboration bridge authorization', () => {
  it('rejects paths outside the workspace and denies writes in read-only reviews', async () => {
    const ctx = await context()
    const outside = join(await directory(), 'secret.txt')
    await writeFile(outside, 'unrelated')
    expect(await gateNativeTool(ctx, 'Read', { file_path: outside })).toBe(false)
    expect(ctx.approve).not.toHaveBeenCalled()
    expect(
      await gateNativeTool({ ...ctx, readOnly: true }, 'Write', {
        file_path: join(ctx.workspace, 'new.txt'),
        content: 'denied',
      }),
    ).toBe(false)
    expect(
      await gateNativeTool(ctx, 'Write', {
        file_path: join(ctx.workspace, 'new.txt'),
        content: 'allowed once',
      }),
    ).toBe(true)
  })
  it('requires an ephemeral bearer token, rejects browser origins and fails closed after cancellation', async () => {
    const ctx = await context()
    const controller = new AbortController()
    ctx.signal = controller.signal
    const bridge = await startCollaborationServer(ctx)
    const body = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: ctx.workspace },
    })
    try {
      expect((await fetch(bridge.url + '/hook', { method: 'POST', body })).status).toBe(403)
      expect(
        (
          await fetch(bridge.url + '/hook', {
            method: 'POST',
            body,
            headers: {
              Authorization: `Bearer ${bridge.token}`,
              Origin: 'https://untrusted.example',
            },
          })
        ).status,
      ).toBe(403)
      const response = await fetch(bridge.url + '/hook', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${bridge.token}` },
      })
      expect((await response.json()).hookSpecificOutput.permissionDecision).toBe('allow')
      controller.abort()
      expect(
        (
          await fetch(bridge.url + '/hook', {
            method: 'POST',
            body,
            headers: { Authorization: `Bearer ${bridge.token}` },
          })
        ).status,
      ).toBe(403)
    } finally {
      await bridge.close()
    }
  })
})
