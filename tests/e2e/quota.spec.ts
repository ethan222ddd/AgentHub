import { directory } from '../helpers'
import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/database/store'
import type { AgentProfile } from '../../src/shared/types'

test('quota UI distinguishes unsupported API/headless balances without using paid runtimes', async () => {
  const base = resolve('.local/e2e-quota')
  await mkdir(base, { recursive: true })
  const profile = await mkdtemp(join(base, 'profile-')),
    project = await directory('project-')
  const seed = new Store(join(profile, 'agenthub.sqlite'))
  seed.addProject(project, 'Quota controls')
  for (const agent of seed.list<AgentProfile>('agents'))
    seed.put('agents', {
      ...agent,
      enabled: agent.provider !== 'codex',
      ...(agent.provider === 'claude' ? { authMode: 'api' } : {}),
    })
  seed.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Remaining quota', { exact: true }).click()
    const details = page.getByLabel('Quota details', { exact: true })
    await expect(details.locator('article')).toHaveCount(2)
    await expect(details.locator('[data-provider="claude"]')).toContainText(
      'API-key billing is separate',
    )
    await expect(details.locator('[data-provider="antigravity"]')).toContainText('/usage')
    await expect(details.locator('progress')).toHaveCount(0)
    await page.getByLabel('Refresh quota', { exact: true }).click()
    const value = await page.evaluate(() =>
      window.agenthub.invoke<{ tasks: unknown[] }>({ op: 'snapshot' }),
    )
    expect(value.tasks).toEqual([])
    await page.screenshot({ path: join(base, 'unsupported-quota.png') })
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
  } finally {
    await app.close()
  }
})
