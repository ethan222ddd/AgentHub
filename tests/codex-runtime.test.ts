import { describe, expect, it } from 'vitest'
import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { npmCodexExecutable, resolveWindowsCodex } from '../src/main/agents/codex-runtime'
import { directory } from './helpers'
async function installation(layout: 'optional' | 'legacy', arch: 'x64' | 'arm64' = 'x64') {
  const prefix = join(await directory(), 'npm 空白 & quoted')
  const root = join(prefix, 'node_modules', '@openai', 'codex')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
  let vendor = join(root, 'vendor')
  if (layout === 'optional') {
    const platform = join(root, 'node_modules', '@openai', `codex-win32-${arch}`)
    await mkdir(platform, { recursive: true })
    await writeFile(join(platform, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    vendor = join(platform, 'vendor')
  }
  const executable = join(
    vendor,
    arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc',
    layout === 'optional' ? 'bin' : 'codex',
    'codex.exe',
  )
  await mkdir(join(executable, '..'), { recursive: true })
  await writeFile(executable, 'Fixture path only; never executed')
  return { prefix, root, executable: await realpath(executable) }
}
describe('Windows npm Codex native executable resolution', () => {
  it('preserves PATH priority by resolving npm before a later Desktop executable, without executing cmd', async () => {
    const npm = await installation('optional')
    const desktop = join(await directory(), 'codex.exe')
    await writeFile(desktop, 'Not executed')
    expect(resolveWindowsCodex([join(npm.prefix, 'codex.cmd'), desktop], {}, 'x64')).toEqual({
      executable: npm.executable,
      source: 'npm-native',
    })
  })
  it('supports legacy vendor, ARM64, and default npm prefix when Explorer PATH is stale', async () => {
    const legacy = await installation('legacy', 'arm64')
    expect(npmCodexExecutable(legacy.root, 'arm64')).toBe(legacy.executable)
    const appdata = await directory()
    const prefix = join(appdata, 'npm')
    const root = join(prefix, 'node_modules', '@openai', 'codex')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    const executable = join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    await mkdir(join(executable, '..'), { recursive: true })
    await writeFile(executable, 'Not executed')
    expect(resolveWindowsCodex([], { APPDATA: appdata }, 'x64')?.executable).toBe(
      await realpath(executable),
    )
  })
  it('never returns a cmd shim when optional native dependency is missing or package identity differs', async () => {
    const prefix = await directory()
    const root = join(prefix, 'node_modules', '@openai', 'codex')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    expect(resolveWindowsCodex([join(prefix, 'codex.cmd')], {}, 'x64')).toBeUndefined()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'unrelated-package' }))
    expect(npmCodexExecutable(root)).toBeUndefined()
  })
})
