import type { AgentProfile } from '../../shared/types'

/** Validated categorical slots (see styles/insights.css). Past eight, agents share "other". */
export const SERIES_SLOTS = 8

/**
 * Color follows the agent, never its rank: the slot comes from the agent's position in the
 * full profile list, so filtering or a quiet week never repaints the remaining agents.
 */
export function seriesSlot(agentId: string, agents: AgentProfile[]): string {
  const index = agents.findIndex((a) => a.id === agentId)
  return index >= 0 && index < SERIES_SLOTS ? String(index + 1) : 'other'
}
