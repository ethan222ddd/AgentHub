import { it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readClaudeCatalog } from '../src/main/agents/claude-catalog'
import { JsonProcess } from '../src/main/agents/process'
it('uses native CLI model metadata and discards account fields without invoking a model', async () => {
  const proc = new JsonProcess(
    process.execPath,
    [resolve('tests/fixtures/runtime.mjs'), 'claude-catalog'],
    process.cwd(),
  )
  try {
    const models = await readClaudeCatalog(proc)
    expect(models.map((m) => m.id)).toEqual(['opus', 'sonnet'])
    expect(models[0].reasoningEfforts).toEqual(['low', 'high'])
    expect(JSON.stringify(models)).not.toContain('DO_NOT_RETAIN_ACCOUNT_DATA')
  } finally {
    await proc.dispose()
  }
})
