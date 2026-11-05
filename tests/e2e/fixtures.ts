import { test as base, _electron as nativeElectron } from '@playwright/test'
import { processSupervisor } from '../../src/main/agents/process-owner'
import { cleanupTestDirectories } from '../helpers'

// Keep fixture repositories outside the checked-out source, then reap them once
// every Electron window and guarded Git child has stopped.
const applications = new Set<Awaited<ReturnType<typeof nativeElectron.launch>>>()
export const _electron = {
  launch: async (...args: Parameters<typeof nativeElectron.launch>) => {
    const app = await nativeElectron.launch(...args)
    applications.add(app)
    return app
  },
}
export const test = base.extend<{ applicationCleanup: void }, { temporaryFixtures: void }>({
  applicationCleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      try {
        await use()
      } finally {
        await Promise.allSettled([...applications].map((app) => app.close()))
        applications.clear()
      }
    },
    { auto: true },
  ],
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
export { expect } from '@playwright/test'
