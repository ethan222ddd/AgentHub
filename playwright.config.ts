import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  // Repository setup invokes guarded native Git. Give assertions time to observe
  // its completed state on a loaded Windows runner; do not replace this with sleeps.
  expect: { timeout: 15000 },
})
