import { guardIdentity } from './release-identity'
// Opt-in real, packaged Electron → native runtime web test. Only example.com is requested.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { repository } from '../tests/helpers'
import type { Snapshot, Message, Activity } from '../src/shared/types'

const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-web')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-'))
const project = await repository()
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(`release/${version}/win-unpacked/AgentHub.exe`),
  args: [`--user-data-dir=${profile}`],
  env,
})
const report: Record<string, unknown> = {
  version,
  packaged: true,
  project,
  profile,
  providers: {},
  ...(await guardIdentity()),
}
report.appAsarSha256 = createHash('sha256')
  .update(await readFile(resolve(`release/${version}/win-unpacked/resources/app.asar`)))
  .digest('hex')
try {
  const page = await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  // The project is persisted before async safe Git initialization completes.
  // Wait for pickProject to select its room before creating another room.
  await expect(page.locator('.conversation-row.selected')).toHaveCount(1)
  const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  let state = await snapshot()
  await page.evaluate(
    async ({ agent, projectId }) => {
      await window.agenthub.invoke({
        op: 'agent.save',
        agent: { ...agent, networkAllowlist: ['example.com'] },
      })
      await window.agenthub.invoke({ op: 'workspace.prepare', projectId, initialize: false })
    },
    { agent: state.agents.find((a) => a.id === 'antigravity')!, projectId: state.projects[0].id },
  )
  for (const provider of ['codex', 'claude', 'antigravity']) {
    state = await snapshot()
    // Use the actual room selector so room-scoped approval cards are visible.
    await page.getByTitle('New conversation').first().click()
    await expect
      .poll(async () => (await snapshot()).conversations.length)
      .toBe(state.conversations.length + 1)
    const c = (await snapshot()).conversations.at(-1)!
    // Backend creation can finish before newChat's refresh/load selects it.
    // Send only after the actual room selector confirms the new room.
    await expect(page.locator(`[data-conversation-id="${c.id}"]`)).toHaveClass(/selected/)
    const instruction = `Use your native ${provider === 'codex' ? 'live web_search open tool' : provider === 'claude' ? 'WebFetch tool' : 'web tool (search_web for example.com, or read_url_content if it is exposed)'} to retrieve https://example.com/ and report its main heading with the source URL. You must actually use the native web tool; do not answer from memory. Describe accurately whether you searched or fetched. Do not access local files, run commands, write files, browse other sites or delegate.`
    await page.getByRole('textbox', { name: 'Message' }).fill(`@${provider} ${instruction}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const approvals: string[] = []
    let capturedWaiting = false
    await expect
      .poll(
        async () => {
          const current = (await snapshot()).tasks.filter((t) => t.conversationId === c.id).at(-1)
          if (current?.status === 'waiting_user' && !(await page.locator('.approval').count())) {
            if (!capturedWaiting) {
              console.log(
                'Waiting approval UI',
                JSON.stringify({
                  reason: current.waitReason,
                  selected: await page
                    .locator('.conversation-row.selected')
                    .getAttribute('data-conversation-id'),
                  expected: c.id,
                }),
              )
              await page.screenshot({ path: join(base, 'waiting-approval.png') })
              capturedWaiting = true
            }
            const review = page.getByRole('button', { name: '前往批准', exact: true })
            if (await review.count()) await review.first().click()
            else await page.getByRole('button', { name: '活動', exact: true }).click()
          }
          const cards = page.locator('.approval')
          for (let i = 0; i < (await cards.count()); i++) {
            const card = cards.nth(i)
            const text = await card.innerText()
            const allowed =
              /Codex live web search|Antigravity scoped workspace access/.test(text) ||
              (/WebFetch/.test(text) && /https:\/\/example\.com\//.test(text))
            approvals.push(text)
            await card
              .getByRole('button', { name: allowed ? '允許一次' : '拒絕', exact: true })
              .click()
          }
          const task = (await snapshot()).tasks.filter((t) => t.conversationId === c.id).at(-1)
          if (task?.status === 'failed' || task?.status === 'cancelled') throw new Error(task.error)
          return task?.status
        },
        { timeout: 240000, intervals: [500, 1000] },
      )
      .toBe('completed')
    const result = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[]; activities: Activity[] }>({
          op: 'messages',
          conversationId: id,
        }),
      c.id,
    )
    const answer =
      result.messages.find((m) => m.senderId === provider && m.delivery === 'completed')?.content ||
      ''
    expect(answer).toMatch(/Example Domain/i)
    expect(answer).toContain('https://example.com')
    const events = result.activities
      .filter((a) => a.type.startsWith('tool.'))
      .map((a) => ({ type: a.type, detail: a.detail }))
    expect(
      events.some((e) =>
        /webSearch|WebFetch|read_url|url_content|search_web|web.*read/i.test(e.detail),
      ),
    ).toBe(true)
    ;(report.providers as Record<string, unknown>)[provider] = {
      passed: true,
      answer,
      approvals,
      tools: events,
    }
    console.log(`PASS: packaged ${provider} native web tool`)
  }
  report.passed = true
} catch (e) {
  report.error = String(e)
  throw e
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
