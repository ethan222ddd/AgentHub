import { guardIdentity } from './release-identity'
// Real packaged UI → three official runtimes → safe snapshots/tests → selected primary folders.
// All project contents are generated fixtures. No mocked agent answers or paid API keys.
import { _electron as electron, expect, chromium } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { git } from '../src/main/git/workspaces'
import type { Snapshot, Detection, Message } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-automatic')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  blank = await mkdtemp(join(base, '空白 專案-')),
  existing = await mkdtemp(join(base, '既有 程式碼-'))
const nonce = randomUUID().replaceAll('-', ''),
  proofs = Object.fromEntries(['codex', 'claude', 'antigravity'].map((p) => [p, `${p}:${nonce}`]))
await writeFile(join(existing, 'original.txt'), nonce)
await writeFile(join(existing, '.env'), 'API_KEY=GENERATED_TEST_SENTINEL_NOT_A_REAL_CREDENTIAL')
await writeFile(join(existing, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nGENERATED TEST ONLY')
await writeFile(
  join(existing, 'package.json'),
  // Official Windows sandbox on this runtime denies nested direct Node process creation.
  // Keep the OS sandbox enabled and run actual assertions in-process; never rewrite user scripts.
  JSON.stringify({
    private: true,
    scripts: { test: 'node --test --test-isolation=none baseline.test.cjs' },
  }),
)
await writeFile(
  join(existing, 'baseline.test.cjs'),
  `const t=require('node:test'),a=require('node:assert/strict'),f=require('node:fs');t('preserve original source',()=>a.equal(f.readFileSync('original.txt','utf8'),${JSON.stringify(nonce)}));for(const [name,value] of Object.entries(${JSON.stringify(proofs)}))t('validate delivered '+name,()=>{if(f.existsSync(name+'.txt'))a.equal(f.readFileSync(name+'.txt','utf8').trim(),value)})`,
)
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
let app = await launch(),
  page = await app.firstWindow()
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
const report: Record<string, unknown> = {
  version,
  packaged: true,
  passed: false,
  ...(await guardIdentity(executablePath)),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
  profile,
  blank,
  existing,
}
async function pick(path: string, first = false) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
  await page
    .getByRole('button', { name: first ? '選擇專案資料夾' : '新增專案', exact: true })
    .click()
  await expect
    .poll(async () => (await state()).projects.find((p) => p.path === path)?.setup?.state, {
      timeout: 30000,
    })
    .toBe('ready')
  const snapshot = await state(),
    project = snapshot.projects.find((p) => p.path === path)!,
    room = snapshot.conversations.find((c) => c.projectId === project.id)!
  return { project, room }
}
async function handleApprovals() {
  const cards = page.locator('.approval')
  if (!(await cards.count())) return
  const card = cards.first(),
    text = await card.innerText()
  const deny =
    /Live web search|git\s+reset|git\s+clean|force.?push|Remove-Item|rmdir|Invoke-WebRequest/i.test(
      text,
    )
  await card.getByRole('button', { name: deny ? '拒絕' : '允許一次', exact: true }).click()
  if (deny && !/Live web search/i.test(text))
    throw new Error('Unexpected unsafe operation in generated live fixture: ' + text)
}
async function send(content: string, count: number) {
  const before = (await state()).tasks.length
  await page.getByRole('textbox', { name: 'Message' }).fill(content)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .poll(
      async () => {
        await handleApprovals()
        const tasks = (await state()).tasks.slice(before)
        const failed = tasks.find(
          (t) =>
            t.status === 'failed' ||
            (t.integration?.status === 'attention' && t.status === 'waiting_user'),
        )
        if (failed)
          throw new Error(
            JSON.stringify({
              agentId: failed.agentId,
              error: failed.error,
              integration: failed.integration,
            }),
          )
        return tasks.length >= count && tasks.every((t) => t.status === 'completed')
      },
      { timeout: 240000, intervals: [300, 700] },
    )
    .toBe(true)
  return (await state()).tasks.slice(before)
}
try {
  const a = await pick(blank, true)
  // Six native turns can exceed the conservative room token budget through input context.
  // Raise only this disposable acceptance profile, never the application default.
  const settings = (await state()).settings
  await page.evaluate(
    (settings) =>
      window.agenthub.invoke({
        op: 'settings.save',
        settings: { ...settings, maxUsageTokens: 1000000 },
      }),
    settings,
  )
  const catalog = await page.evaluate(() =>
    window.agenthub.invoke<Detection[]>({ op: 'agents.detect' }),
  )
  async function choices(roomId: string) {
    for (const d of catalog) {
      const model =
        d.models.find((m) =>
          d.provider === 'codex'
            ? m.id.includes('sol')
            : d.provider === 'claude'
              ? m.id === 'sonnet'
              : /flash/.test(m.id) && /low/.test(m.id),
        ) || d.models.find((m) => d.provider === 'antigravity' && /flash/.test(m.id))
      if (!model) continue
      const effort = model.reasoningEfforts?.includes('low') ? 'low' : ''
      await page.evaluate((request) => window.agenthub.invoke(request), {
        op: 'conversation.runtime',
        conversationId: roomId,
        agentId: d.agentId!,
        model: model.id,
        reasoningEffort: effort,
      })
    }
  }
  await choices(a.room.id)
  const hello = await send(
    '@Codex 使用原生檔案工具建立 index.html，內容為完整靜態 HTML，body 顯示 Hello World。不要使用 Shell、網路、委派、Git 或修改其他檔案。由 Host 檢查並整合，不要假稱自行執行測試。完成只回答 HELLO_DONE。',
    1,
  )
  expect(hello[0].integration?.status).toBe('merged')
  expect(await readFile(join(blank, 'index.html'), 'utf8')).toContain('Hello World')
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const preview = await browser.newPage()
    await preview.route('http**', (route) => route.abort())
    await preview.goto(pathToFileURL(join(blank, 'index.html')).href)
    await expect(preview.locator('body')).toContainText('Hello World')
    await preview.screenshot({ path: join(base, 'hello-primary-folder.png') })
  } finally {
    await browser.close()
  }
  report.blankProject = {
    passed: true,
    root: blank,
    taskId: hello[0].id,
    integration: hello[0].integration,
    renderedHelloWorld: true,
  }
  const b = await pick(existing)
  await choices(b.room.id)
  const verified = await send(
    '@Claude 使用原生讀檔工具讀取 original.txt，再用原生寫檔工具將相同完整字串寫入 verified.txt。不要使用 Shell、網路、Git、委派或修改原有檔案。完成只回答 VERIFIED。Host 會執行測試及整合。',
    1,
  )
  expect((await readFile(join(existing, 'verified.txt'), 'utf8')).trim()).toBe(nonce)
  const tree = await git(existing, ['ls-tree', '-r', '--name-only', 'HEAD'])
  expect(tree).not.toMatch(/\.env|private\.pem/)
  expect(await readFile(join(existing, '.env'), 'utf8')).toContain('GENERATED_TEST_SENTINEL')
  report.existingProject = {
    passed: true,
    taskId: verified[0].id,
    originalSourceSeenInWorktree: true,
    sensitiveFilesExcluded: true,
    originalsPreserved: true,
  }
  const team = await send(
    `團隊平行驗收：請依你的 Agent ID 各自只寫一個檔案。codex 寫 codex.txt，完整內容 ${proofs.codex}；claude 寫 claude.txt，完整內容 ${proofs.claude}；antigravity 寫 antigravity.txt，完整內容 ${proofs.antigravity}。只用原生檔案工具，不用 Shell、網路、Git、委派；不要修改其他人檔案或既有測試。Host 會測試整合快照並把成果放到主要專案。完成只回答 TEAM_DONE。`,
    3,
  )
  expect(new Set(team.map((t) => t.agentId))).toEqual(new Set(['codex', 'claude', 'antigravity']))
  for (const provider of Object.keys(proofs))
    expect((await readFile(join(existing, `${provider}.txt`), 'utf8')).trim()).toBe(
      proofs[provider],
    )
  const snapshot = await state(),
    workspaces = snapshot.workspaces.filter(
      (w) => w.projectId === b.project.id && (!w.kind || w.kind === 'agent'),
    )
  expect(new Set(workspaces.map((w) => w.path)).size).toBe(3)
  expect(team.every((t) => t.integration?.status === 'merged')).toBe(true)
  const testRuns = snapshot.tests.filter((t) => t.projectId === b.project.id)
  expect(
    testRuns.filter(
      (t) => t.execution === 'native-sandbox' && t.kind === 'test' && t.status === 'passed',
    ).length,
  ).toBeGreaterThanOrEqual(4)
  report.parallelTeam = {
    passed: true,
    tasks: team.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      workspace: t.workspace,
      integration: t.integration,
    })),
    testRuns: testRuns.map((t) => ({
      revision: t.revision,
      workspaceId: t.workspaceId,
      status: t.status,
      execution: t.execution,
    })),
    separateWorktrees: true,
    primaryContainsAllResults: true,
  }
  const codex = workspaces.find((w) => w.agentId === 'codex')!
  const unfinished = 'unfinished-' + randomUUID()
  await writeFile(join(codex.path, 'unfinished.txt'), unfinished)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect
    .poll(async () =>
      (await state()).workspaces
        .filter((w) => workspaces.some((old) => old.id === w.id))
        .map((w) => w.path)
        .sort(),
    )
    .toEqual(workspaces.map((w) => w.path).sort())
  const resumed = await send(
    '@Codex 只讀取你的工作區 unfinished.txt，回覆原檔的完整字串。可以使用只讀 Get-Content 或原生讀檔工具；不要寫檔、不要使用 Git、網路或委派。',
    1,
  )
  expect(resumed[0].integration?.status).toBe('unchanged')
  expect(await readFile(join(codex.path, 'unfinished.txt'), 'utf8')).toBe(unfinished)
  expect(existsSync(join(existing, 'unfinished.txt'))).toBe(false)
  const messages = await page.evaluate(
    (conversationId) =>
      window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId }),
    b.room.id,
  )
  expect(
    messages.messages.find((m) => m.taskId === resumed[0].id && m.senderId === 'codex')?.content,
  ).toContain(unfinished)
  report.restart = {
    passed: true,
    worktreeMappingsPreserved: true,
    unfinishedChangesPreserved: true,
    noUnfinishedPublication: resumed[0].integration?.status === 'unchanged',
  }
  report.passed = true
  await page.screenshot({ path: join(base, 'automatic-chat.png') })
  console.log(
    'PASS: actual packaged Codex Hello World in selected folder, Claude sees existing source, all three native agents isolate/merge with real sandbox tests, restart preserves worktrees and unfinished edits.',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
