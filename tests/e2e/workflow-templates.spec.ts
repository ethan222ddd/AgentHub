import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Store } from '../../src/main/database/store'
import type { Snapshot } from '../../src/shared/types'

test('custom workflow CRUD, role/step editing, validation and restart use real IPC and SQLite without agent turns', async () => {
  const root = resolve('.local/e2e-workflows')
  await mkdir(root, { recursive: true })
  const profile = await mkdtemp(join(root, 'profile-'))
  const store = new Store(join(profile, 'agenthub.sqlite'))
  const project = store.addProject(root, 'Workflows')
  store.put('projects', { ...project, autoManaged: false })
  const room = store.snapshot().conversations[0]
  store.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  const executablePath = process.env.AGENTHUB_PACKAGED_EXE
  const launch = () =>
    electron.launch({
      ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      env,
    })
  let app = await launch()
  try {
    if (executablePath) expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    let page = await app.firstWindow()
    await page.locator(`[data-conversation-id="${room.id}"]`).click()
    await page.locator('button[aria-label="Workflows"]').click()
    await page.getByRole('button', { name: '新增範本', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Template name', exact: true })
      .fill('自訂：實作與合約審查')
    await page.getByRole('spinbutton', { name: 'Maximum fixes' }).fill('1')
    await page.getByRole('textbox', { name: 'Role developer', exact: true }).fill('服務開發者')
    await page
      .locator('[data-step-id="implement"] textarea')
      .fill('Read the project contract and implement with tests.')
    await page.getByRole('button', { name: '新增步驟', exact: true }).click()
    const newStep = page.locator('.workflow-step').last()
    await newStep.getByRole('textbox').first().fill('額外契約檢查')
    await newStep.getByRole('checkbox', { name: '實作', exact: true }).check()
    await page.getByRole('button', { name: '儲存範本', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('範本已儲存')
    const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
    const custom = (await snapshot()).workflowTemplates.find(
      (t) => t.name === '自訂：實作與合約審查',
    )!
    expect(custom.maxFixes).toBe(1)
    expect(custom.steps.at(-1)?.dependsOn).toEqual(['implement'])
    expect(custom.roles[0].name).toBe('服務開發者')
    await page.getByRole('button', { name: '另存副本', exact: true }).click()
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('待刪除副本')
    await page.getByRole('button', { name: '儲存範本', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('範本已儲存')
    await expect.poll(async () => (await snapshot()).workflowTemplates.length).toBe(4)
    await page.getByRole('button', { name: '刪除範本', exact: true }).click()
    await page.getByRole('button', { name: '確認刪除此範本', exact: true }).click()
    await expect.poll(async () => (await snapshot()).workflowTemplates.length).toBe(3)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.locator('button[aria-label="Workflows"]').click()
    await page.getByRole('button', { name: '自訂：實作與合約審查', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Workflow requirement' })
      .fill('Do not run; this project intentionally lacks automatic workspace management.')
    await page.getByRole('button', { name: '啟動工作流程', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Workflows' })).toContainText('需要自動管理')
    expect((await snapshot()).tasks).toHaveLength(0)
    await page.getByRole('button', { name: '編輯範本', exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: 'Maximum fixes' })).toHaveValue('1')
    await expect(page.getByRole('textbox', { name: 'Role developer', exact: true })).toHaveValue(
      '服務開發者',
    )
    await page.screenshot({ path: join(root, 'workflow-editor.png') })
  } finally {
    await app.close()
  }
})
