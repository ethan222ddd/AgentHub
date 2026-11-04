import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { JsonProcess } from '../src/main/agents/process'
const fixture = resolve('tests/fixtures/runtime.mjs')
describe('NDJSON process lifecycle', () => {
  it('reassembles fragmented stdout and correlates simultaneous JSON-RPC IDs', async () => {
    const p = new JsonProcess(process.execPath, [fixture, 'echo'], process.cwd())
    // Fixture fragments one response at a time; requests are independently mapped.
    expect(await p.request('echo', { value: '一' })).toEqual({ value: '一' })
    expect(await p.request('echo', { value: 'two' })).toEqual({ value: 'two' })
    await p.dispose()
    await expect(p.request('echo', {})).rejects.toThrow('disconnected')
  })
  it('rejects pending requests on crash and times out hung requests', async () => {
    const crashed = new JsonProcess(process.execPath, [fixture, 'crash'], process.cwd())
    await expect(crashed.request('work', {})).rejects.toThrow('exited')
    await crashed.dispose()
    const hung = new JsonProcess(process.execPath, [fixture, 'hang'], process.cwd())
    await expect(hung.request('work', {}, 40)).rejects.toThrow('timed out')
    await hung.dispose()
  })
  it.each(['invalid', 'oversize', 'notification'])(
    'fails closed and reaps %s protocol failures',
    async (mode) => {
      const p = new JsonProcess(process.execPath, [fixture, mode], process.cwd())
      if (mode === 'notification')
        p.on('message', () => {
          throw new Error('consumer fixture')
        })
      const error =
        mode === 'invalid'
          ? /invalid NDJSON/
          : mode === 'oversize'
            ? /size limit/
            : /handler failed/
      await expect(p.request('work', {})).rejects.toThrow(error)
      await Promise.all([p.dispose(), p.dispose()])
      expect(p.child.exitCode !== null || p.child.signalCode !== null).toBe(true)
    },
  )
  it('settles every in-flight request when one RPC times out', async () => {
    const p = new JsonProcess(process.execPath, [fixture, 'hang'], process.cwd())
    const requests = [p.request('first', {}, 100), p.request('second', {}, 30000)]
    const results = await Promise.allSettled(requests)
    expect(
      results.every(
        (result) => result.status === 'rejected' && /timed out/.test(String(result.reason)),
      ),
    ).toBe(true)
    await p.dispose()
  })
})
