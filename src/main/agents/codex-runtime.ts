import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

export interface CodexLaunch {
  executable: string
  source: 'path-native' | 'npm-native' | 'user-native'
}
const native = (path: string): string | undefined => {
  try {
    return statSync(path).isFile() ? realpathSync(path) : undefined
  } catch {
    return undefined
  }
}
export function npmCodexExecutable(packageRoot: string, arch = process.arch): string | undefined {
  try {
    const root = realpathSync(packageRoot)
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
    if (manifest.name !== '@openai/codex') return undefined
    const triple =
      arch === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : arch === 'x64'
          ? 'x86_64-pc-windows-msvc'
          : undefined
    if (!triple) return undefined
    const vendors = [join(root, 'vendor')]
    try {
      const platformManifest = createRequire(manifestPath).resolve(
        `@openai/codex-win32-${arch}/package.json`,
      )
      vendors.unshift(join(dirname(platformManifest), 'vendor'))
    } catch {
      /* older npm distributions bundle vendor directly */
    }
    for (const vendor of vendors)
      for (const directory of ['bin', 'codex']) {
        const candidate = native(join(vendor, triple, directory, 'codex.exe'))
        if (candidate) return candidate
      }
  } catch {
    /* optional dependency missing or incompatible package */
  }
  return undefined
}
export function resolveWindowsCodex(
  paths: string[],
  env: NodeJS.ProcessEnv = process.env,
  arch = process.arch,
): CodexLaunch | undefined {
  for (const path of paths) {
    if (/\.exe$/i.test(path)) {
      const executable = native(path)
      if (executable) return { executable, source: 'path-native' }
    }
    // Resolve package metadata adjacent to the shim; never execute or parse cmd text as code.
    if (!/\.(exe|com)$/i.test(path))
      for (const root of [
        join(dirname(path), 'node_modules', '@openai', 'codex'),
        join(dirname(path), '..', '@openai', 'codex'),
      ]) {
        const executable = npmCodexExecutable(root, arch)
        if (executable) return { executable, source: 'npm-native' }
      }
  }
  if (env.APPDATA) {
    const executable = npmCodexExecutable(
      join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex'),
      arch,
    )
    if (executable) return { executable, source: 'npm-native' }
  }
  if (env.USERPROFILE) {
    const executable = native(resolve(env.USERPROFILE, '.local', 'bin', 'codex.exe'))
    if (executable && existsSync(executable)) return { executable, source: 'user-native' }
  }
  return undefined
}
