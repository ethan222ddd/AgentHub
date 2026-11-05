import { expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { AntigravityAdapter } from '../src/main/agents/antigravity'
import { JsonProcess } from '../src/main/agents/process'
import type { RunContext } from '../src/main/agents/adapter'
import { until } from './helpers'
function setup(mode = 'normal') {
  let proc: JsonProcess
  const adapter = new AntigravityAdapter(
    (_args, cwd) =>
      (proc = new JsonProcess(
        process.execPath,
        [resolve('tests/fixtures/agy-continuation.mjs'), mode],
        cwd,
      )),
  )
  const controller = new AbortController()
  const ctx: RunContext = {
    agent: {
      id: 'agy',
      name: 'Fixture',
      provider: 'antigravity',
      role: 'Reviewer',
      instructions: '',
      model: '',
      enabled: true,
    },
    workspace: process.cwd(),
    prompt: 'Read host source',
    taskId: 'fixture-task',
    signal: controller.signal,
    emit: vi.fn(),
    delta: vi.fn(),
    saveSession: vi.fn(),
    approve: vi.fn(async () => true),
    beforeContinuation: vi.fn(),
    usage: vi.fn(),
    collaborate: vi.fn(async (input) => ({ nonce: 'host-only-proof', operation: input.operation })),
  }
  return { adapter, ctx, controller, process: () => proc! }
}
it('returns actual structured host results to the same native session and publishes only the final message', async () => {
  const s = setup('chain')
  try {
    const result = await s.adapter.run(s.ctx)
    expect(result).toContain('host-only-proof')
    expect(result).toContain('read_artifact')
    expect(s.ctx.collaborate).toHaveBeenCalledTimes(3)
    expect(s.ctx.beforeContinuation).toHaveBeenCalledTimes(3)
    expect(s.ctx.delta).toHaveBeenCalledExactlyOnceWith(result)
    expect(JSON.stringify(vi.mocked(s.ctx.emit).mock.calls)).not.toContain('host-only-proof')
    expect(s.ctx.saveSession).toHaveBeenCalledWith('agy-continuation')
    expect(s.ctx.usage).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputTokens: 40, outputTokens: 20, scope: 'session' }),
    )
    expect(s.ctx.emit).toHaveBeenCalledWith(
      'host.read.completed',
      expect.stringContaining('fixture-task:read:3'),
      'fixture-task:native:3',
    )
  } finally {
    await s.adapter.dispose()
  }
})
it('streams actual ACTIVE public fragments before completion and reconciles without routing JSON or reasoning', async () => {
  const s = setup('stream')
  s.ctx.replaceText = vi.fn()
  let completed = false
  try {
    const work = s.adapter.run(s.ctx).finally(() => {
      completed = true
    })
    await until(() => vi.mocked(s.ctx.delta).mock.calls.length > 0)
    expect(completed).toBe(false)
    expect(vi.mocked(s.ctx.delta).mock.calls.flat().join('')).toBe(
      'Public streaming before completion',
    )
    expect(await work).toBe('Validated public answer')
    expect(s.ctx.replaceText).toHaveBeenLastCalledWith('Validated public answer')
    expect(JSON.stringify(vi.mocked(s.ctx.delta).mock.calls)).not.toMatch(
      /PRIVATE_REASONING|requests/,
    )
  } finally {
    await s.adapter.dispose()
  }
})
it('buffers structured JSON fragments until a validated final result', async () => {
  const s = setup('stream-json')
  s.ctx.replaceText = vi.fn()
  try {
    expect(await s.adapter.run(s.ctx)).toBe('Validated public answer')
    expect(s.ctx.delta).toHaveBeenCalledExactlyOnceWith('Validated public answer')
    expect(s.ctx.replaceText).not.toHaveBeenCalled()
  } finally {
    await s.adapter.dispose()
  }
})
it('never marks a streamed response complete when the native turn fails', async () => {
  const s = setup('stream-denied')
  s.ctx.replaceText = vi.fn()
  try {
    await expect(s.adapter.run(s.ctx)).rejects.toThrow()
    expect(s.ctx.replaceText).not.toHaveBeenCalledWith('Validated public answer')
  } finally {
    await s.adapter.dispose()
  }
})
it('caps repeated read rounds and executes an identical request only once', async () => {
  const s = setup('loop')
  try {
    await expect(s.adapter.run(s.ctx)).rejects.toThrow('continuation limit reached')
    expect(s.ctx.collaborate).toHaveBeenCalledOnce()
    expect(s.ctx.beforeContinuation).toHaveBeenCalledTimes(3)
    expect(s.ctx.delta).not.toHaveBeenCalled()
  } finally {
    await s.adapter.dispose()
  }
})
it('retains source message IDs in activity without logging source content', async () => {
  const s = setup()
  s.ctx.collaborate = vi.fn(async () => [
    { messageId: 'source-message-id', excerpt: 'DO_NOT_LOG_SOURCE_BODY' },
  ])
  try {
    await s.adapter.run(s.ctx)
    expect(s.ctx.emit).toHaveBeenCalledWith(
      'host.read.completed',
      expect.stringContaining('"sourceMessageIds":["source-message-id"]'),
      'fixture-task:native:1',
    )
    expect(JSON.stringify(vi.mocked(s.ctx.emit).mock.calls)).not.toContain('DO_NOT_LOG_SOURCE_BODY')
  } finally {
    await s.adapter.dispose()
  }
})
it.each(['mixed', 'invalid', 'duplicate', 'late-duplicate', 'switch', 'missing-counter'])(
  'rejects unsafe or malformed %s envelopes without publishing an answer',
  async (mode) => {
    const s = setup(mode)
    try {
      await expect(s.adapter.run(s.ctx)).rejects.toThrow()
      expect(s.ctx.delta).not.toHaveBeenCalled()
      if (['mixed', 'invalid'].includes(mode)) expect(s.ctx.collaborate).not.toHaveBeenCalled()
    } finally {
      await s.adapter.dispose()
    }
  },
)
it('delivers bounded, explicit host read errors rather than oversized source content', async () => {
  const s = setup()
  s.ctx.collaborate = vi.fn(async () => ({ content: 'PRIVATE_LARGE_SOURCE'.repeat(10000) }))
  try {
    const result = await s.adapter.run(s.ctx)
    expect(result).toContain('HOST_RESULT_TOO_LARGE')
    expect(result).not.toContain('PRIVATE_LARGE_SOURCE')
    expect(s.ctx.emit).toHaveBeenCalledWith(
      'host.read.failed',
      expect.stringContaining('"ok":false'),
      'fixture-task:native:1',
    )
  } finally {
    await s.adapter.dispose()
  }
})
it('honors the orchestrator turn/usage budget before another native prompt is sent', async () => {
  const s = setup()
  s.ctx.beforeContinuation = () => {
    throw new Error('Agent turn budget reached')
  }
  try {
    await expect(s.adapter.run(s.ctx)).rejects.toThrow('turn budget')
    expect(s.ctx.usage).toHaveBeenCalledOnce()
    expect(s.ctx.delta).not.toHaveBeenCalled()
  } finally {
    await s.adapter.dispose()
  }
})
it.each(['user-abort', 'adapter-dispose', 'exit-host'])(
  'cancels while host data is pending on %s without sending another prompt',
  async (mode) => {
    const s = setup(mode === 'exit-host' ? mode : 'normal')
    let called = false
    s.ctx.collaborate = () => {
      called = true
      return new Promise(() => {})
    }
    const run = s.adapter.run(s.ctx)
    const checked = expect(run).rejects.toThrow(/Cancelled|disposed|exited/i)
    try {
      await until(() => called)
      if (mode === 'user-abort') s.controller.abort(new Error('Cancelled by user'))
      if (mode === 'adapter-dispose') await s.adapter.dispose()
      await checked
      expect(s.ctx.beforeContinuation).not.toHaveBeenCalled()
      expect(s.ctx.delta).not.toHaveBeenCalled()
    } finally {
      await s.adapter.dispose()
    }
  },
)
it('can cancel a subsequent active native turn', async () => {
  const s = setup('hang')
  const run = s.adapter.run(s.ctx)
  const checked = expect(run).rejects.toThrow('Cancelled')
  try {
    await until(() => vi.mocked(s.ctx.beforeContinuation!).mock.calls.length === 1)
    s.controller.abort(new Error('Cancelled'))
    await checked
    expect(s.ctx.delta).not.toHaveBeenCalled()
  } finally {
    await s.adapter.dispose()
  }
})
