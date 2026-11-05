import type { AgentProfile } from '../../shared/types'
import type { AgentQuota, Quota } from '../../shared/quota'
import type { AgentAdapter } from './adapter'
import { trace, traceError } from '../app/diagnostics'

export class QuotaService {
  private closing = false
  private cache = new Map<string, { value: Quota; attempted: number; stale: boolean }>()
  private pending = new Map<string, Promise<Quota & { stale?: boolean; lastAttemptAt?: string }>>()
  constructor(
    private adapters: Map<string, AgentAdapter>,
    private clock = () => Date.now(),
  ) {}
  async read(agent: AgentProfile, refresh = false): Promise<AgentQuota> {
    if (this.closing) throw new Error('Quota service is closing')
    const key = `${agent.provider}:${agent.authMode || 'native'}`
    const old = this.cache.get(key),
      now = this.clock()
    const ttl = refresh ? 5000 : old?.stale || old?.value.status === 'error' ? 15000 : 30000
    if (old && now - old.attempted < ttl)
      return {
        ...old.value,
        agentId: agent.id,
        stale: old.stale,
        lastAttemptAt: new Date(old.attempted).toISOString(),
      }
    let request = this.pending.get(key)
    if (!request) {
      request = (async () => {
        let value: Quota,
          stale = false
        try {
          const adapter = this.adapters.get(agent.provider)
          value = adapter?.getQuota
            ? await adapter.getQuota(agent)
            : {
                provider: agent.provider,
                source: 'Antigravity headless CLI',
                status: 'unavailable',
                windows: [],
                checkedAt: new Date(this.clock()).toISOString(),
                detail:
                  'This adapter does not provide a quota query. For Antigravity, use official agy 1.5.1+ /usage support; context-window percentage is not account quota.',
              }
          trace('quota.read', { agentId: agent.id, source: value.source, status: value.status })
        } catch (error) {
          if (this.closing) throw new Error('Quota query cancelled during application shutdown')
          trace('quota.failed', { agentId: agent.id, ...traceError(error) })
          stale = !!old && old.value.status === 'available'
          value = stale
            ? {
                ...old!.value,
                detail:
                  'Quota refresh failed. Showing the previous successful snapshot; verify official CLI login/network and retry.',
              }
            : {
                provider: agent.provider,
                source: 'Official runtime',
                status: 'error',
                windows: [],
                checkedAt: new Date(this.clock()).toISOString(),
                detail:
                  'Unable to query quota. Verify official CLI installation, login and network, or update CLI for quota protocol support.',
              }
        }
        const attempted = this.clock()
        if (this.closing) throw new Error('Quota query cancelled during application shutdown')
        this.cache.set(key, { value, attempted, stale })
        return { ...value, stale, lastAttemptAt: new Date(attempted).toISOString() }
      })().finally(() => this.pending.delete(key))
      this.pending.set(key, request)
    }
    return { ...(await request), agentId: agent.id }
  }
  async dispose() {
    this.closing = true
    await Promise.allSettled([...this.pending.values()])
    this.cache.clear()
  }
}
