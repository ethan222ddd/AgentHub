import { describe, expect, it } from 'vitest'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withinWorkspace, redact } from '../src/main/permissions/paths'
import { requestSchema, collaborationSchema } from '../src/shared/schemas'
import { directory } from './helpers'
describe('Host security boundary', () => {
  it('rejects traversal, absolute escapes and junction escapes, including missing targets', async () => {
    const base = await directory()
    const root = join(base, 'workspace')
    const outside = join(base, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await expect(withinWorkspace(root, '../outside/secret.txt')).rejects.toThrow('escapes')
    await expect(withinWorkspace(root, join(outside, 'missing', 'new.txt'), true)).rejects.toThrow(
      'escapes',
    )
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(withinWorkspace(root, join(root, 'link', 'secret.txt'))).rejects.toThrow('escapes')
    await expect(withinWorkspace(root, join(root, 'link', 'new.txt'), true)).rejects.toThrow(
      'escapes',
    )
    await symlink(
      outside,
      join(base, 'redirected'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(withinWorkspace(join(base, 'redirected'), 'secret.txt')).rejects.toThrow(
      'root was replaced',
    )
    await expect(withinWorkspace(root, join(root, 'src', 'new.txt'), true)).resolves.toBe(
      join(root, 'src', 'new.txt'),
    )
  })
  it('validates all host operations and structured collaboration requests', () => {
    expect(requestSchema.safeParse({ op: 'shell', command: 'anything' }).success).toBe(false)
    expect(
      requestSchema.safeParse({ op: 'send', conversationId: 'c', content: '', recipients: [] })
        .success,
    ).toBe(false)
    expect(
      collaborationSchema.safeParse({
        operation: 'send_message',
        recipients: ['a'],
        content: 'hello',
        elevate: true,
      }).success,
    ).toBe(false)
    expect(redact('Bearer abc123 sk-secretsecret ANTHROPIC_API_KEY=secret')).not.toContain('abc123')
    expect(redact('api_key=secret')).not.toContain('=secret')
  })
})
