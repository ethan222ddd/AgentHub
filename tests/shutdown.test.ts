import { expect, it } from 'vitest'
import { resolve } from 'node:path'
import { JsonProcess } from '../src/main/agents/process'
import { processSupervisor } from '../src/main/agents/process-owner'
import { claudeControl } from '../src/main/agents/claude-control'
import { QuotaService } from '../src/main/agents/quota-service'
import type { AgentAdapter } from '../src/main/agents/adapter'
import type { AgentProfile } from '../src/shared/types'

it('drains an in-flight native control read and quota service when process shutdown races initialization (fixture protocol)', async () => {
  const p = new JsonProcess(
    process.execPath,
    [resolve('tests/fixtures/runtime.mjs'), 'hang'],
    process.cwd(),
  )
  const adapter = {
    getQuota: async () => {
      try {
        await claudeControl(p, { subtype: 'initialize' })
        throw new Error('Fixture never responds')
      } finally {
        await p.dispose()
      }
    },
  } as unknown as AgentAdapter
  const quota = new QuotaService(new Map([['claude', adapter]]))
  const pending = quota.read({ id: 'qa', provider: 'claude', authMode: 'native' } as AgentProfile)
  const rejected = expect(pending).rejects.toThrow(/shutdown/)
  await Promise.all([quota.dispose(), processSupervisor.shutdown(), rejected])
  expect(processSupervisor.size).toBe(0)
  expect(p.child.stdin.destroyed && p.child.stdout.destroyed && p.child.stderr.destroyed).toBe(true)
}, 5000)
