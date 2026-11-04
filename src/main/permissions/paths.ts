import { realpath, lstat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, dirname } from 'node:path'
export async function withinWorkspace(
  root: string,
  target: string,
  allowMissing = false,
): Promise<string> {
  const base = await realpath(root)
  if (base.toLowerCase() !== resolve(root).toLowerCase())
    throw new Error('Workspace root was replaced or redirected')
  if (!isAbsolute(target)) target = resolve(base, target)
  let canonical: string
  try {
    canonical = await realpath(target)
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await withinWorkspace(base, dirname(target), true)
    canonical = resolve(parent, relative(dirname(target), target))
  }
  const rel = relative(base, canonical)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Path escapes the assigned workspace')
  return canonical
}
export async function validateRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Project path must be absolute')
  const canonical = await realpath(path)
  if (!(await lstat(canonical)).isDirectory()) throw new Error('Project folder missing')
  return canonical
}
export async function assertAssignedRoot(path: string): Promise<void> {
  const canonical = await validateRoot(path)
  if (canonical.toLowerCase() !== resolve(path).toLowerCase())
    throw new Error('Assigned workspace root changed; refusing redirected access')
}
export function redact(text: string): string {
  return text
    .replace(/\b(sk-[\w-]{8,}|AIza[\w-]{10,})\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|authorization)["'\s:=]+)[^\s,"'}]+/gi,
      '$1[REDACTED]',
    )
}
