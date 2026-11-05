import { test, expect, _electron as electron } from './fixtures'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/database/store'
import { WorkspaceManager, git } from '../../src/main/git/workspaces'
import type { Project, Task, Workspace } from '../../src/shared/types'
import { repository } from '../helpers'

// No agent runs here: every seeded task is already waiting or finished, and the flows
// exercised (cancel a plan, accept a decision, queue a diff comment) never start a turn.
test('plan review, handoff, decisions, overlaps, diff comments and GitHub entry points', async () => {
  const root = resolve('.local/e2e-collaboration')
  await mkdir(root, { recursive: true })
  const data = await mkdtemp(join(root, 'profile-'))
  const repo = await repository()
  const db = new Store(join(data, 'agenthub.sqlite'))
  const project = db.addProject(repo, 'Shop')
  const c = db.snapshot().conversations[0]
  const manager = new WorkspaceManager(db, join(data, 'workspaces'))
  await manager.prepare({ ...project, autoManaged: false }, false)
  const ws = (agentId: string) =>
    db.list<Workspace>('workspaces').find((w) => w.agentId === agentId)!
  const identity = [
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@local.invalid',
    '-c',
    'commit.gpgsign=false',
  ]
  await writeFile(join(ws('codex').path, 'README.md'), '# Codex\n')
  await git(ws('codex').path, [...identity, 'commit', '-qam', 'codex'])
  await writeFile(join(ws('codex').path, 'package.json'), '{"name":"shop","private":true}\n')
  await writeFile(join(ws('claude').path, 'README.md'), '# Claude\n')
  const base = {
    projectId: project.id,
    conversationId: c.id,
    description: 'Implement coupons',
    dependencies: [],
    createdAt: new Date().toISOString(),
    correlationId: 'fixture',
    depth: 0,
  }
  db.put('tasks', {
    ...base,
    id: 'plan-task',
    agentId: 'codex',
    name: 'Coupon API',
    status: 'waiting_user',
    waitReason: 'plan',
    planFirst: true,
    plan: {
      status: 'awaiting',
      content: '## Plan\nAdd a coupon table and endpoint.',
      files: ['src/pay.ts'],
      steps: ['Add the coupon model', 'Expose POST /coupons'],
      risks: ['Rounding before tax'],
      verification: 'npm test',
      structured: true,
      revisions: 0,
    },
  } satisfies Task)
  db.put('tasks', {
    ...base,
    id: 'done-task',
    agentId: 'claude',
    name: 'Coupon UI',
    status: 'completed',
    workspace: ws('claude').path,
    workspaceId: ws('claude').id,
    handoff: {
      summary: 'Coupon field added to checkout.',
      changed: ['src/Checkout.tsx'],
      tested: ['npm test'],
      untested: ['Screen reader labels'],
      questions: [],
      next: [],
      submittedAt: new Date().toISOString(),
    },
  } satisfies Task)
  db.put('projects', {
    ...db.require<Project>('projects', project.id),
    autoManaged: false,
    decisions: [
      {
        id: 'd1',
        title: 'Store money as integer cents',
        detail: 'Avoid float rounding.',
        status: 'proposed',
        proposedBy: 'codex',
        createdAt: new Date().toISOString(),
      },
    ],
  })
  const codexWorkspace = ws('codex').id
  db.close()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  env.AGENTHUB_DATA_DIR = data
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.'], env })
  const shots = join(root, 'screens')
  await mkdir(shots, { recursive: true })
  const snapshot = (page: import('@playwright/test').Page) =>
    page.evaluate(() =>
      window.agenthub.invoke<{ tasks: Task[]; projects: Project[] }>({ op: 'snapshot' }),
    )
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator(`[data-conversation-id="${c.id}"]`).click()

    // Overlap early warning appears without any agent running.
    const strip = page.locator('.overlap-strip')
    await expect(strip).toContainText('1 個檔案', { timeout: 15000 })
    await strip.getByRole('button', { name: '查看檔案' }).click()
    const overlap = page.locator('.overlaps')
    await expect(overlap).toContainText('README.md')
    await expect(overlap).toContainText('未提交')
    await page.screenshot({ path: join(shots, 'tasks-overlaps.png') })

    // Plan review card with structured plan; edit is reversible, cancel ends the task.
    await page.getByRole('tab', { name: '活動' }).click()
    const plan = page.getByRole('region', { name: '計畫審核' })
    await expect(plan).toContainText('src/pay.ts')
    await expect(plan).toContainText('Rounding before tax')
    await page.screenshot({ path: join(shots, 'plan-review.png') })
    await plan.getByRole('button', { name: '編輯' }).click()
    await expect(plan.getByRole('textbox', { name: '編輯計畫' })).toHaveValue(/coupon table/)
    await plan.getByRole('button', { name: '取消編輯' }).click()
    page.once('dialog', (dialog) => void dialog.accept())
    await plan.getByRole('button', { name: '取消任務' }).click()
    await expect
      .poll(async () => (await snapshot(page)).tasks.find((t) => t.id === 'plan-task')?.status)
      .toBe('cancelled')

    // Handoff and PR entry point on the finished task.
    await page.locator('#task-done-task summary').click()
    const handoff = page.locator('#task-done-task .handoff')
    await expect(handoff).toContainText('Screen reader labels')
    await expect(
      page.locator('#task-done-task').getByRole('button', { name: '建立 GitHub PR' }),
    ).toBeVisible()

    // Decision log: accept the agent proposal and add one of our own.
    await page.getByRole('tab', { name: /決策/ }).click()
    await page.getByRole('button', { name: '採用' }).click()
    await page.getByRole('button', { name: '新增決策' }).click()
    await page.getByRole('textbox', { name: '決策標題' }).fill('API errors use problem+json')
    await page.getByRole('button', { name: '新增並採用' }).click()
    await expect
      .poll(async () =>
        (await snapshot(page)).projects
          .find((p) => p.id === project.id)
          ?.decisions?.map((d) => `${d.title}:${d.status}`),
      )
      .toEqual(['Store money as integer cents:accepted', 'API errors use problem+json:accepted'])
    await page.screenshot({ path: join(shots, 'decisions.png') })

    // Diff line comment is queued for the workspace's agent (not sent: that would start a turn).
    await page.getByRole('tab', { name: '變更' }).click()
    await page.getByRole('combobox', { name: 'Workspace' }).selectOption(codexWorkspace)
    await page.getByTitle('Refresh diff').click()
    const file = page.locator('.diff-file').filter({ hasText: 'package.json' })
    await expect(file).toBeVisible()
    await file.locator('tr.diff-add.commentable').first().click()
    await page.getByRole('textbox', { name: '行內意見' }).fill('Keep the version field.')
    await page.getByRole('button', { name: '加入意見' }).click()
    await expect(page.locator('.diff-review-send')).toContainText('1 則意見待送出')
    await expect(page.locator('.diff-comment')).toContainText('Keep the version field.')
    await page.screenshot({ path: join(shots, 'diff-review.png') })

    // GitHub issue dialog explains its state (no GitHub remote in this fixture repo).
    await page.getByRole('button', { name: 'Issues' }).click()
    const issues = page.getByRole('dialog', { name: '從 GitHub Issue 派工' })
    await expect(issues.locator('.issue-guidance')).not.toContainText('正在讀取', {
      timeout: 30000,
    })
    await page.screenshot({ path: join(shots, 'issues.png') })
    await page.keyboard.press('Escape')
    await expect(issues).toBeHidden()
  } finally {
    await app.close()
  }
})
