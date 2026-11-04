import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { JsonProcess } from '../src/main/agents/process'
import { CodexAdapter } from '../src/main/agents/codex'
import { AntigravityAdapter } from '../src/main/agents/antigravity'
import type { RunContext } from '../src/main/agents/adapter'
import { directory } from './helpers'
import { readdir } from 'node:fs/promises'
const fixture = resolve('tests/fixtures/runtime.mjs')
function context(): RunContext {
  return {
    agent: {
      id: 'test',
      name: 'Test',
      provider: 'codex',
      role: 'Developer',
      instructions: '',
      model: '',
      enabled: true,
    },
    workspace: process.cwd(),
    prompt: 'Protocol contract test',
    signal: new AbortController().signal,
    emit: vi.fn(),
    delta: vi.fn(),
    saveSession: vi.fn(),
    approve: vi.fn(async () => false),
    collaborate: vi.fn(async () => ({ delivered: true })),
  }
}
describe('Adapter contracts — fixture-backed, not live runtime acceptance', () => {
  it('sends Codex model and reasoning effort through the native turn protocol', async () => {
    const ctx = context()
    ctx.agent.model = 'fixture-model'
    ctx.agent.reasoningEffort = 'high'
    const adapter = new CodexAdapter(
      (cwd) => new JsonProcess(process.execPath, [fixture, 'codex'], cwd),
    )
    await adapter.run(ctx)
    expect(ctx.emit).toHaveBeenCalledWith(
      'runtime.configuration',
      expect.stringContaining('"model":"fixture-model"'),
    )
    expect(ctx.emit).toHaveBeenCalledWith(
      'runtime.configuration',
      expect.stringContaining('"reasoningEffort":"high"'),
    )
    await adapter.dispose()
  })
  it('passes Antigravity model and effort as separate native argv entries', async () => {
    let args: string[] = []
    const adapter = new AntigravityAdapter((input, cwd) => {
      args = input
      return new JsonProcess(process.execPath, [fixture, 'agy'], cwd)
    })
    const ctx = context()
    ctx.agent.model = 'fixture-model'
    ctx.agent.reasoningEffort = 'medium'
    ctx.approve = vi.fn(async () => true)
    await adapter.run(ctx)
    expect(args[args.indexOf('--model') + 1]).toBe('fixture-model')
    expect(args[args.indexOf('--effort') + 1]).toBe('medium')
    await adapter.dispose()
  })
  it('maps Codex native sessions, deltas and dynamic tool requests', async () => {
    const adapter = new CodexAdapter(
      (cwd) => new JsonProcess(process.execPath, [fixture, 'codex'], cwd),
    )
    const ctx = context()
    expect(await adapter.run(ctx)).toBe('hello world')
    expect(ctx.saveSession).toHaveBeenCalledWith('codex-native-session')
    expect(ctx.delta).toHaveBeenCalledWith('hello ')
    expect(ctx.collaborate).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'report_progress' }),
    )
    await adapter.dispose()
  })
  it('validates Antigravity structured routing without parsing prose', async () => {
    const adapter = new AntigravityAdapter(
      (_args, cwd) => new JsonProcess(process.execPath, [fixture, 'agy'], cwd),
    )
    const ctx = context()
    ctx.approve = vi.fn(async () => true)
    expect(await adapter.run(ctx)).toBe('Validated Antigravity fixture')
    expect(ctx.saveSession).toHaveBeenCalledWith('agy-native-session')
    expect(ctx.collaborate).toHaveBeenCalledOnce()
  })
  it('fails on Antigravity soft-denial even when process reports SUCCESS', async () => {
    const adapter = new AntigravityAdapter(
      (_args, cwd) => new JsonProcess(process.execPath, [fixture, 'agy-denied'], cwd),
    )
    const ctx = context()
    ctx.approve = vi.fn(async () => true)
    await expect(adapter.run(ctx)).rejects.toThrow('permission denial')
  })
  it('rejects a claimed visual answer when the native image tool never opened the attachment', async () => {
    const adapter = new AntigravityAdapter(
      (_args, cwd) => new JsonProcess(process.execPath, [fixture, 'agy'], cwd),
    )
    const ctx = {
      ...context(),
      workspace: await directory(),
      images: [{ id: 'x', name: 'visual.png', mime: 'image/png' as const, data: 'eA==' }],
      approve: vi.fn(async () => true),
    }
    await expect(adapter.run(ctx)).rejects.toThrow('IMAGE_NOT_READ')
    expect(ctx.delta).not.toHaveBeenCalled()
    expect(await readdir(ctx.workspace)).toEqual([])
    await adapter.dispose()
  })
  it('surfaces a recoverable native file-not-found error without inventing a permission denial', async () => {
    const adapter = new AntigravityAdapter(
      (_args, cwd) => new JsonProcess(process.execPath, [fixture, 'agy-missing'], cwd),
    )
    const ctx = context()
    ctx.approve = vi.fn(async () => true)
    expect(await adapter.run(ctx)).toBe('Validated Antigravity fixture')
    expect(ctx.emit).toHaveBeenCalledWith(
      'tool.error',
      expect.stringContaining('file does not exist'),
    )
    await adapter.dispose()
  })
})
