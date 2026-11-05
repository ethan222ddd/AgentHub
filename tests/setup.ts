import { afterAll } from 'vitest'
import { processSupervisor } from '../src/main/agents/process-owner'
import { cleanupTestDirectories } from './helpers'
// A failed assertion must not leave real fixture processes holding a worker open.
afterAll(async () => {
  await processSupervisor.shutdown()
  await cleanupTestDirectories()
})
