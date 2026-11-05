import { mkdtemp, lstat, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { git } from '../src/main/git/workspaces'
let fixtureRoot: Promise<string> | undefined
export async function directory(prefix = 'test-'): Promise<string> {
  // Empty-project fixtures must not inherit AgentHub's own Git repository.
  fixtureRoot ??= realpath(tmpdir()).then((base) => mkdtemp(join(base, 'agenthub-tests-')))
  return mkdtemp(join(await fixtureRoot, prefix))
}
export async function cleanupTestDirectories(): Promise<void> {
  if (!fixtureRoot) return
  const target = resolve(await fixtureRoot),
    temporary = await realpath(tmpdir())
  if (!target.startsWith(temporary + sep) || !basename(target).startsWith('agenthub-tests-'))
    throw new Error('Refusing fixture cleanup outside the owned temporary directory')
  const entry = await lstat(target)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Fixture root was redirected')
  await rm(target, { recursive: true, force: true })
  fixtureRoot = undefined
}
export async function repository(): Promise<string> {
  const path = await directory('repo-')
  await git(path, ['init'])
  await writeFile(join(path, 'README.md'), '# Test repository\n')
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "console.log(\'fixture-test-pass\')"' } }),
  )
  await git(path, ['add', '.'])
  await git(path, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Initial',
  ])
  return path
}
export async function until(predicate: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}
