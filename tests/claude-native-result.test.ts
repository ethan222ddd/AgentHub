import { describe, expect, it } from 'vitest'
import { nativeClaudeFailure } from '../src/main/agents/claude-native'

describe('native Claude result failures', () => {
  it('recognizes the actual expired OAuth result with successful subtype and no denied tools', () => {
    expect(
      nativeClaudeFailure({
        subtype: 'success',
        is_error: true,
        permission_denials: [],
        result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      }),
    ).toContain('claude auth login')
  })

  it('keeps provider usage limits separate from real tool denials', () => {
    expect(
      nativeClaudeFailure({ subtype: 'success', is_error: true, result: '429 Too many requests' }),
    ).toContain('usage or rate limit')
    expect(nativeClaudeFailure({ subtype: 'success', permission_denials: [{}] })).toContain(
      'denied 1 tool request',
    )
  })

  it('does not echo untrusted provider errors or classify ordinary successful prose', () => {
    const raw = 'fake private auth response with a credential sentinel'
    expect(nativeClaudeFailure({ subtype: 'error_during_execution', errors: [raw] })).not.toContain(
      raw,
    )
    expect(
      nativeClaudeFailure({ subtype: 'success', result: 'Usage limit settings are saved.' }),
    ).toBeUndefined()
  })
})
