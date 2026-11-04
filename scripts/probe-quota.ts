import { CodexAdapter } from '../src/main/agents/codex'
import { NativeClaudeAdapter } from '../src/main/agents/claude-native'
for (const adapter of [new CodexAdapter(), new NativeClaudeAdapter()]) {
  try {
    console.log(JSON.stringify(await adapter.getQuota()))
  } catch (e) {
    console.log(e instanceof Error ? e.message : 'Quota probe failed')
  } finally {
    await adapter.dispose()
  }
}
