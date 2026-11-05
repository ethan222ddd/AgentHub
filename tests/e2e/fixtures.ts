import { test as base } from '@playwright/test'
import { processSupervisor } from '../../src/main/agents/process-owner'
import { cleanupTestDirectories } from '../helpers'

// Keep fixture repositories outside the checked-out source, then reap them once
// every Electron window and guarded Git child has stopped.
export const test = base.extend<Record<never, never>, { temporaryFixtures: void }>({
  // Playwright requires destructuring even when this fixture has no dependencies.
  temporaryFixtures: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use()
      await processSupervisor.shutdown()
      await cleanupTestDirectories()
    },
    { scope: 'worker', auto: true },
  ],
})
export { expect, _electron } from '@playwright/test'
