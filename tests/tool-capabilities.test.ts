import { describe, expect, it, vi } from 'vitest'
import { readFile, readdir, symlink, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { directory } from './helpers'
import { claudeTools, codexNetworkGrant } from '../src/main/agents/tool-policy'
import { gateNativeTool } from '../src/main/agents/collaboration-server'
import { localImageInputs } from '../src/main/agents/images'
import { agentSchema } from '../src/shared/schemas'
import type { RunContext } from '../src/main/agents/adapter'

async function context(): Promise<RunContext> {
  return {
    agent: {
      id: 'test',
      provider: 'claude',
      name: 'Test',
      role: '',
      instructions: '',
      enabled: true,
      model: '',
    },
    workspace: await directory(),
    prompt: '',
    signal: new AbortController().signal,
    emit: vi.fn(),
    delta: vi.fn(),
    saveSession: vi.fn(),
    approve: vi.fn(async () => true),
    collaborate: vi.fn(),
  }
}
describe('Native capabilities and least privilege', () => {
  it('offers native web research in read-only mode without shell or edit privileges', async () => {
    const ctx = { ...(await context()), readOnly: true }
    expect(claudeTools(true)).toEqual(expect.arrayContaining(['Read', 'WebFetch', 'WebSearch']))
    expect(await gateNativeTool(ctx, 'WebFetch', { url: 'https://example.com/' })).toBe(true)
    expect(await gateNativeTool(ctx, 'WebSearch', { query: 'public documentation' })).toBe(true)
    expect(await gateNativeTool(ctx, 'WebFetch', { url: 'file:///C:/secret' })).toBe(false)
    expect(await gateNativeTool(ctx, 'WebFetch', { url: 'https://user:secret@example.com' })).toBe(
      false,
    )
    expect(await gateNativeTool(ctx, 'Bash', { command: 'echo NO' })).toBe(false)
    expect(await gateNativeTool(ctx, 'UnknownTool', {})).toBe(false)
    ctx.approve = vi.fn(async () => false)
    expect(await gateNativeTool(ctx, 'WebSearch', { query: 'denied' })).toBe(false)
  })
  it('grants Codex network only for one turn and never copies filesystem escalation', async () => {
    const ctx = await context()
    expect(
      await codexNetworkGrant(ctx, { network: { enabled: true }, fileSystem: { write: ['C:/'] } }),
    ).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' })
    expect(ctx.emit).toHaveBeenCalledWith(
      'permission.denied',
      expect.stringContaining('filesystem'),
    )
    ctx.approve = vi.fn(async () => false)
    expect(await codexNetworkGrant(ctx, { network: { enabled: true } })).toEqual({
      permissions: {},
      scope: 'turn',
    })
    expect(await codexNetworkGrant(ctx, { network: { enabled: 'true' } })).toEqual({
      permissions: {},
      scope: 'turn',
    })
  })
  it('accepts DNS domains only, preventing permission-rule and URL injection', () => {
    const base = {
      id: 'a',
      name: 'A',
      provider: 'antigravity',
      enabled: true,
      role: '',
      model: '',
      instructions: '',
    }
    expect(
      agentSchema.parse({ ...base, networkAllowlist: ['example.com', 'docs.python.org'] })
        .networkAllowlist,
    ).toHaveLength(2)
    for (const domain of [
      '*',
      'example.com) write_file(*)',
      'https://example.com',
      'localhost',
      '127.0.0.1',
      'example.com/path',
    ])
      expect(agentSchema.safeParse({ ...base, networkAllowlist: [domain] }).success).toBe(false)
  })
  it('materializes original image bytes inside the workspace and cleans up only its own files', async () => {
    const root = await directory()
    const image = {
      id: 'x',
      name: 'image.png',
      mime: 'image/png' as const,
      data: Buffer.from('generated test pixels').toString('base64'),
    }
    const files = await localImageInputs([image], root)
    expect(await readFile(files.inputs[0].path, 'utf8')).toBe('generated test pixels')
    expect(dirname(files.inputs[0].path).startsWith(join(root, '.agenthub-images-'))).toBe(true)
    await writeFile(join(root, 'user.txt'), 'keep')
    await files.dispose()
    expect(await readdir(root)).toEqual(['user.txt'])
  })
  it('does not follow a replaced image directory into another folder during cleanup', async () => {
    const root = await directory(),
      outside = await directory()
    const files = await localImageInputs(
      [{ id: 'x', name: 'image.png', mime: 'image/png', data: 'eA==' }],
      root,
    )
    const dir = dirname(files.inputs[0].path)
    await unlink(files.inputs[0].path)
    await rmdir(dir)
    await writeFile(join(outside, '0.png'), 'untouched')
    await symlink(outside, dir, process.platform === 'win32' ? 'junction' : 'dir')
    await files.dispose()
    expect(await readFile(join(outside, '0.png'), 'utf8')).toBe('untouched')
  })
})
