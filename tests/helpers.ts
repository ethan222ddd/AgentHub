import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git } from '../src/main/git/workspaces'
export async function directory(prefix = 'test-'): Promise<string> {
  const base = resolve('.local/tests')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, prefix))
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
