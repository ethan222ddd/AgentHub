import { expect, it } from 'vitest'
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  ProcessSupervisor,
  guardPath,
  spawnOwned,
  stopOwned,
} from '../src/main/agents/process-owner'
import { directory, until } from './helpers'
const tree = resolve('tests/fixtures/process-tree.mjs')
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
function collect(child: ChildProcessWithoutNullStreams) {
  const rows: {
    role?: string
    pid?: number
    child?: number
    appGuard?: number
    args?: string[]
    input?: string
  }[] = []
  createInterface({ input: child.stdout }).on('line', (line) => rows.push(JSON.parse(line)))
  child.stderr.resume()
  return rows
}
it.skipIf(process.platform !== 'win32').each(['runtime', 'app'])(
  'kills the owned detached descendants when the %s parent is hard-killed, preserving an unrelated process',
  async (mode) => {
    const root = await directory('job-parent-'),
      marker = join(root, 'owned-ticks.txt')
    const outsider = spawn(process.execPath, [tree, 'outsider', join(root, 'other-ticks.txt')], {
      windowsHide: true,
      stdio: 'pipe',
    })
    outsider.stdout.resume()
    outsider.stderr.resume()
    const parent = spawn(
      process.execPath,
      ['--import', 'tsx', resolve('tests/fixtures/process-owner-host.mjs'), mode, marker],
      { windowsHide: true, stdio: 'pipe' },
    )
    const rows = collect(parent)
    try {
      await until(() => rows.some((r) => r.role === 'leaf'), 7000)
      const host = rows.find((r) => r.role === 'host')!,
        child = rows.find((r) => r.role === 'root')!,
        leaf = rows.find((r) => r.role === 'leaf')!
      parent.kill() // Only the parent handle, intentionally not taskkill /T.
      await until(
        () =>
          !alive(child.pid!) &&
          !alive(leaf.pid!) &&
          !alive(host.child!) &&
          (!host.appGuard || !alive(host.appGuard)),
        5000,
      )
      const content = await readFile(marker, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(await readFile(marker, 'utf8')).toBe(content)
      expect(outsider.exitCode).toBeNull()
      expect(alive(outsider.pid!)).toBe(true)
    } finally {
      parent.kill()
      outsider.kill()
    }
  },
)
it.skipIf(process.platform !== 'win32')(
  'reaps detached descendants after the native root exits successfully',
  async () => {
    const root = await directory('job-root-exit-')
    const child = spawnOwned(process.execPath, [tree, 'root-exit', join(root, 'ticks.txt')])
    const rows = collect(child)
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', () => resolve())
    })
    expect(child.exitCode).toBe(0)
    expect(rows.some((r) => r.role === 'leaf')).toBe(true)
    expect(rows.filter((r) => r.pid).every((r) => !alive(r.pid!))).toBe(true)
  },
)
it('passes Unicode, quotes, empty arguments, trailing backslashes and immediate stdin without shell interpretation', async () => {
  const root = await directory('job 中文 ')
  await mkdir(join(root, 'nested with spaces'))
  const args = ['', '中文 argument', '"quotes"', 'C:\\ends\\', '& | > % ! ^']
  const child = spawnOwned(process.execPath, [tree, 'echo', ...args], {
    cwd: join(root, 'nested with spaces'),
  })
  const rows = collect(child)
  child.stdin.end('第一行\nsecond\n')
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', () => resolve())
  })
  expect(rows).toEqual([{ args, input: '第一行\nsecond\n' }])
  expect(child.exitCode).toBe(0)
})
it.skipIf(process.platform !== 'win32')(
  'rejects a mismatched parent creation identity before any child instruction runs',
  async () => {
    const root = await directory('job-identity-'),
      marker = join(root, 'must-not-exist.txt')
    const child = spawn(guardPath(), [], { cwd: root, windowsHide: true, stdio: 'pipe' })
    child.stdout.resume()
    child.stderr.resume()
    child.stdin.end(
      JSON.stringify({
        parentPid: process.pid,
        parentCreation: '0',
        file: process.execPath,
        args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`],
      }) + '\n',
    )
    await new Promise<void>((resolve) => child.once('close', () => resolve()))
    expect(child.exitCode).toBe(125)
    expect(existsSync(marker)).toBe(false)
    expect(
      execFileSync(guardPath(), ['identity', String(process.pid)], {
        windowsHide: true,
        encoding: 'utf8',
      }),
    ).toMatch(/^\d+$/)
  },
)
it('shares an idempotent stop and rejects new children after shutdown without touching foreign child objects', async () => {
  const supervisor = new ProcessSupervisor(),
    root = await directory('job-stop-')
  const child = supervisor.spawn(process.execPath, [tree, 'leaf', join(root, 'ticks.txt')])
  const rows = collect(child)
  await until(() => rows.length > 0)
  await Promise.all([stopOwned(child), stopOwned(child), supervisor.shutdown()])
  expect(supervisor.size).toBe(0)
  expect(() => supervisor.spawn(process.execPath, ['-e', ''])).toThrow('shutting down')
  const foreign = spawn(process.execPath, [tree, 'outsider', join(root, 'foreign.txt')], {
    windowsHide: true,
    stdio: 'pipe',
  })
  foreign.stdout.resume()
  foreign.stderr.resume()
  try {
    await expect(stopOwned(foreign)).rejects.toThrow('without local ownership')
    expect(foreign.killed).toBe(false)
  } finally {
    foreign.kill()
  }
})
