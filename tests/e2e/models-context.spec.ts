import { directory } from '../helpers'
import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/database/store'
test('chat model/effort and context pins persist without executing any agent', async () => {
  const base = resolve('.local/e2e-models-context')
  await mkdir(base, { recursive: true })
  const profile = await mkdtemp(join(base, 'profile-')),
    project = await directory('project-')
  const seed = new Store(join(profile, 'agenthub.sqlite'))
  const p = seed.addProject(project, 'Model controls'),
    c = seed.snapshot().conversations[0]
  seed.put('messages', {
    id: 'pin-source',
    projectId: p.id,
    conversationId: c.id,
    senderId: 'user',
    recipientIds: [],
    content: '請保存這份登入驗證規格',
    type: 'user',
    timestamp: new Date().toISOString(),
    taskId: null,
    correlationId: 'seed',
    delivery: 'completed',
  })
  seed.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  const launch = () => electron.launch({ args: ['.'], env })
  let app = await launch(),
    page = await app.firstWindow()
  try {
    await page.getByTitle('釘選為 Agent 背景').click()
    await expect(page.getByTitle('取消背景釘選')).toBeVisible()
    await page.locator('.model-control > summary').click()
    const model = page.getByLabel('Model claude', { exact: true })
    await expect(model).toBeEnabled({ timeout: 30000 })
    const listed = await model.evaluate((element) => element.tagName === 'SELECT')
    const chosenModel = listed ? 'sonnet' : 'ui-contract-model'
    if (listed) await model.selectOption(chosenModel)
    else {
      await model.fill(chosenModel)
      await model.press('Tab')
    }
    const effort = page.getByLabel('Reasoning claude', { exact: true })
    await expect(effort).toBeEnabled()
    await effort.selectOption('high')
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.agenthub
            .invoke<{ conversations: { runtimeOverrides?: Record<string, unknown> }[] }>({
              op: 'snapshot',
            })
            .then((s) => s.conversations[0].runtimeOverrides?.claude),
        ),
      )
      .toEqual({ model: chosenModel, reasoningEffort: 'high' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.model-menu')).toBeHidden()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByTitle('取消背景釘選')).toBeVisible()
    await page.locator('.model-control > summary').click()
    await expect(page.getByLabel('Model claude', { exact: true })).toHaveValue(chosenModel)
    await expect(page.getByLabel('Reasoning claude', { exact: true })).toHaveValue('high')
    const snapshot = await page.evaluate(() =>
      window.agenthub.invoke<{ tasks: unknown[]; agents: { id: string; model: string }[] }>({
        op: 'snapshot',
      }),
    )
    expect(snapshot.tasks).toHaveLength(0)
    expect(snapshot.agents.find((a) => a.id === 'claude')?.model).toBe('')
    await page.screenshot({ path: join(base, 'chat-model-menu.png') })
  } finally {
    await app.close()
  }
})
