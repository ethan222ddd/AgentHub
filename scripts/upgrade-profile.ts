import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { Snapshot } from '../src/shared/types'
const base = resolve('.local/installer-roundtrip')
await mkdir(base, { recursive: true })
const verify = process.argv.includes('--verify')
const statePath = join(base, 'profile-proof.json')
const state: { profile: string; project: string; marker: string } = verify
  ? JSON.parse(await readFile(statePath, 'utf8'))
  : {
      profile: await mkdtemp(join(base, 'profile-')),
      project: await mkdtemp(join(base, 'project-')),
      marker: 'INSTALLER_UPGRADE_PERSISTENCE_OK',
    }
const env = Object.fromEntries(
  Object.entries(process.env).filter((v): v is [string, string] => typeof v[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: join(base, 'application', 'AgentHub.exe'),
  args: [`--user-data-dir=${state.profile}`],
  env,
})
try {
  const page = await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  if (verify) {
    await expect(page.getByTestId('message')).toContainText(state.marker)
    const snapshot = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
    expect(snapshot.settings.maxUsageTokens).toBe(200000)
    expect(snapshot.agents.find((a) => a.provider === 'claude')?.authMode).toBe('native')
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.0')
    await page.screenshot({ path: join(base, 'upgraded.png') })
    await writeFile(
      join(base, 'upgrade-report.json'),
      JSON.stringify({ passed: true, from: '0.1.1', to: '0.2.0', state, snapshot }, null, 2),
    )
    console.log(
      'PASS: installed v0.1.1 profile survives actual v0.2.0 installer upgrade and migration',
    )
  } else {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.1.1')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, state.project)
    await page.getByRole('button', { name: '選擇專案資料夾' }).click()
    await page.getByRole('textbox', { name: 'Message' }).fill(state.marker)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByTestId('message')).toContainText(state.marker)
    await writeFile(statePath, JSON.stringify(state, null, 2))
    console.log('PASS: installed v0.1.1 persisted test profile')
  }
} finally {
  await app.close()
}
