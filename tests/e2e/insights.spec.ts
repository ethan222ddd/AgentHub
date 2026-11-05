import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/database/store'
import type { Task } from '../../src/shared/types'

test('task map, usage trends and keyboard approval queue', async () => {
  const root = resolve('.local/e2e-insights')
  await mkdir(root, { recursive: true })
  const data = await mkdtemp(join(root, 'profile-'))
  const db = new Store(join(data, 'agenthub.sqlite'))
  const project = db.addProject(data, 'Insights')
  db.put('projects', { ...project, autoManaged: false })
  const room = db.snapshot().conversations[0]
  const now = Date.now()
  const base = {
    projectId: project.id,
    conversationId: room.id,
    description: '',
    correlationId: 'fixture',
    depth: 0,
    createdAt: new Date(now - 3600000).toISOString(),
  }
  // Statuses that survive restart recovery unchanged.
  const tasks: (Partial<Task> & { id: string })[] = [
    { id: 'plan', name: 'Plan checkout', agentId: 'codex', status: 'completed' },
    {
      id: 'api',
      name: 'Build payment API',
      agentId: 'codex',
      status: 'failed',
      dependencies: ['plan'],
    },
    {
      id: 'ui',
      name: 'Build checkout UI',
      agentId: 'claude',
      status: 'completed',
      dependencies: ['plan'],
    },
    {
      id: 'e2e',
      name: 'End-to-end tests',
      agentId: 'antigravity',
      status: 'paused',
      dependencies: ['api', 'ui'],
    },
  ]
  for (const t of tasks)
    db.put('tasks', { ...base, dependencies: [], completedAt: new Date(now).toISOString(), ...t })
  db.put('usage_records', {
    id: 'u1',
    taskId: 'plan',
    conversationId: room.id,
    agentId: 'codex',
    inputTokens: 9000,
    outputTokens: 3000,
    costUsd: 0.25,
    source: 'fixture',
    timestamp: new Date(now).toISOString(),
  })
  db.put('usage_records', {
    id: 'u2',
    taskId: 'ui',
    conversationId: room.id,
    agentId: 'claude',
    inputTokens: 6000,
    outputTokens: 2000,
    source: 'fixture',
    timestamp: new Date(now - 86400000).toISOString(),
  })
  db.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  env.AGENTHUB_DATA_DIR = data
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.locator(`[data-conversation-id="${room.id}"]`).click()

    await page.getByRole('button', { name: '任務', exact: true }).click()
    const graph = page.getByRole('list', { name: '任務依賴圖' })
    await expect(graph.getByRole('listitem')).toHaveCount(4)
    await expect(page.locator('.task-graph > svg path.edge')).toHaveCount(4)
    await page.getByRole('listitem').filter({ hasText: 'Build payment API' }).click()
    await expect(page.locator('.task-focus')).toContainText('Plan checkout')
    await expect(page.locator('.graph-node.dim')).toHaveCount(1)
    await page.getByRole('button', { name: '看板' }).click()
    await expect(page.locator('.column-attention .board-card')).toHaveCount(2)
    await expect(page.locator('.column-done .board-card')).toHaveCount(2)
    await page.getByRole('button', { name: '在活動中開啟詳情與操作' }).click()
    await expect(page.locator('#task-api')).toHaveAttribute('open', '')

    await page.getByRole('tab', { name: '用量' }).click()
    const tiles = page.locator('.stat-tiles')
    await expect(tiles).toContainText('20K')
    await expect(tiles).toContainText('成功率 67%')
    await expect(tiles).toContainText('$0.25')
    await expect(tiles).toContainText('另有 1 筆未附金額')
    await expect(page.locator('.usage-chart path.bar')).toHaveCount(2)
    await page.getByRole('button', { name: '表格檢視' }).click()
    await expect(page.locator('.usage-chart-card tbody tr')).toHaveCount(2)
    // Antigravity has neither usage nor a finished task in range, so it gets no row.
    await expect(page.locator('.agent-efficiency tbody tr')).toHaveCount(2)

    // The host owns approvals; deliver an event the way the main process does.
    await app.evaluate(({ BrowserWindow }, conversationId) => {
      const requestedAt = new Date().toISOString()
      BrowserWindow.getAllWindows()[0].webContents.send('agenthub:event', {
        type: 'approvals',
        approvals: [
          {
            id: 'q1',
            agentId: 'codex',
            taskId: 'api',
            conversationId,
            tool: 'Bash',
            detail: 'npm test',
            risk: 'Runs a script.',
            requestedAt,
          },
          {
            id: 'q2',
            agentId: 'claude',
            taskId: 'ui',
            conversationId,
            tool: 'Read',
            detail: 'src/a.ts',
            risk: 'Reads a file.',
            canRemember: true,
            requestedAt,
          },
        ],
      })
    }, room.id)
    await expect(page.locator('.approval-trigger')).toContainText('2')
    await expect(page.locator('.queue-banner')).toContainText('2 筆操作等待批准')
    await page.keyboard.press('Control+Shift+A')
    const queue = page.getByRole('dialog', { name: '批准佇列' })
    await expect(queue).toBeVisible()
    await expect(queue.locator('.queue-command')).toHaveText('npm test')
    await page.keyboard.press('d')
    await expect(queue.locator('.queue-list li')).toHaveCount(1)
    await expect(queue.locator('.queue-command')).toHaveText('src/a.ts')
    // Allow right after a new request appears is held back until it can be read.
    await page.keyboard.press('a')
    await expect(queue.getByRole('status')).toContainText('再按一次 A')
    await expect(queue.locator('.queue-list li')).toHaveCount(1)
    await page.waitForTimeout(700)
    await page.keyboard.press('a')
    await expect(queue).toContainText('沒有等待你批准的操作。')
    await page.keyboard.press('Escape')
    await expect(queue).toBeHidden()
  } finally {
    await app.close()
  }
})
