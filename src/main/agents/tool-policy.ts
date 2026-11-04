import type { RunContext } from './adapter'

// Explicit tools preserve --restricted's file boundary while restoring native research tools.
export function claudeTools(readOnly = false): string[] {
  return [
    'Read',
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    ...(!readOnly ? ['Write', 'Edit', 'Bash', 'NotebookEdit'] : []),
  ]
}

export async function codexNetworkGrant(ctx: RunContext, requested: unknown) {
  const value = requested as { network?: { enabled?: unknown }; fileSystem?: unknown } | null
  if (value?.fileSystem)
    ctx.emit(
      'permission.denied',
      'Additional filesystem access outside the assigned workspace was not granted.',
    )
  if (
    value?.network?.enabled === true &&
    (await ctx.approve(
      'Codex turn network access',
      'The native runtime requests outbound network access for this turn; filesystem permissions remain unchanged.',
      'Commands may send workspace data to external services. This native permission covers the entire remaining turn, not just one domain. Allow only for a trusted task.',
    ))
  )
    return { permissions: { network: { enabled: true } }, scope: 'turn' }
  ctx.emit('permission.denied', 'Native extra network permission was not granted.')
  return { permissions: {}, scope: 'turn' }
}
