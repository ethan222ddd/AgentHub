import { guardIdentity } from './release-identity'
// Read-only quota acceptance against the final packaged app; never starts a model turn.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Store } from '../src/main/database/store'
import type { AgentQuota } from '../src/shared/quota'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-quota')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await mkdtemp(join(base, 'project-'))
const seed = new Store(join(profile, 'agenthub.sqlite'))
seed.addProject(project, 'Official account quota')
seed.close()
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
try {
  const page = await app.firstWindow()
  const read = (refresh = false) =>
    page.evaluate(
      (refresh) =>
        window.agenthub.invoke<AgentQuota[]>({
          op: 'quotas.read',
          agentIds: ['codex', 'claude', 'antigravity'],
          refresh,
        }),
      refresh,
    )
  const first = await read()
  console.log(
    JSON.stringify(
      first.map(({ provider, status, detail, windows }) => ({ provider, status, detail, windows })),
    ),
  )
  for (const provider of ['codex', 'claude', 'antigravity']) {
    const q = first.find((q) => q.provider === provider)!
    if (provider === 'claude' && q.status === 'unavailable') {
      // The official CLI may expose usage scope but return rate_limits:null.
      // Accept only the honest, explicit no-balance state; never fabricate a number.
      expect(q.windows).toHaveLength(0)
      expect(q.detail).toContain('Subscription limits unavailable')
      continue
    }
    expect(q.status).toBe('available')
    expect(
      q.windows.some(
        (w) => w.remainingPercent !== null && w.remainingPercent >= 0 && w.remainingPercent <= 100,
      ),
    ).toBe(true)
  }
  await page.getByLabel('Remaining quota', { exact: true }).click()
  await expect(page.locator('.quota-menu progress').first()).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: join(base, 'quota-live.png') })
  // Observe DOM only: IPC polling here would itself refresh the host's cache.
  const stamp = page.locator('.quota-menu [data-provider="codex"] time')
  const initialStamp = await stamp.getAttribute('datetime')
  await expect
    .poll(
      async () => {
        return (await stamp.getAttribute('datetime')) !== initialStamp
      },
      { timeout: 60000, intervals: [3000] },
    )
    .toBe(true)
  const last = await read(true)
  const tasks = await page.evaluate(() =>
    window.agenthub.invoke<{ tasks: unknown[] }>({ op: 'snapshot' }),
  )
  expect(tasks.tasks).toHaveLength(0)
  await writeFile(
    join(base, 'packaged-report.json'),
    JSON.stringify(
      {
        version,
        packaged: true,
        passed: true,
        ...(await guardIdentity(executablePath)),
        appAsarSha256: createHash('sha256')
          .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
          .digest('hex'),
        noModelTurns: true,
        foregroundAutoRefresh: true,
        availableProviders: last.filter((q) => q.status === 'available').map((q) => q.provider),
        unavailableProviders: last.filter((q) => q.status === 'unavailable').map((q) => q.provider),
        quotas: last,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      passed: true,
      providers: last.map((q) => ({
        provider: q.provider,
        status: q.status,
        windows: q.windows.length,
      })),
      noModelTurns: true,
      foregroundAutoRefresh: true,
    }),
  )
} finally {
  await app.close()
}
