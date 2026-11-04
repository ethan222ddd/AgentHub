import { guardIdentity } from './release-identity'
// Real packaged UI → per-chat config → native runtimes. Uses generated data only.
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Store } from '../src/main/database/store'
import { repository } from '../tests/helpers'
import type { Snapshot, Message, Activity, Detection, ContextReceipt } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-models-context')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-')),
  project = await repository()
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const executablePath = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
let app = await launch(),
  page = await app.firstWindow()
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
const report: Record<string, unknown> = {
  version,
  packaged: true,
  profile,
  project,
  ...(await guardIdentity()),
  appAsarSha256: createHash('sha256')
    .update(await readFile(resolve(executablePath, '..', 'resources/app.asar')))
    .digest('hex'),
  turns: [],
}
try {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  let s = await state()
  const room = s.conversations[0]
  await page.evaluate(
    async ({ projectId, settings }) => {
      await window.agenthub.invoke({
        op: 'settings.save',
        settings: { ...settings, maxUsageTokens: 1000000 },
      })
      await window.agenthub.invoke({ op: 'workspace.prepare', projectId, initialize: false })
    },
    { projectId: s.projects[0].id, settings: s.settings },
  )
  const catalog = await page.evaluate(() =>
    window.agenthub.invoke<Detection[]>({ op: 'agents.detect' }),
  )
  const choose = async (provider: string, model: string, effort: string) => {
    await page.locator('.model-control > summary').click()
    const field = page.getByLabel(`Model ${provider}`, { exact: true })
    await expect(field).toBeEnabled({ timeout: 30000 })
    if (await field.evaluate((e) => e.tagName === 'SELECT')) await field.selectOption(model)
    else {
      await field.fill(model)
      await field.press('Tab')
    }
    const levels = page.getByLabel(`Reasoning ${provider}`, { exact: true })
    await expect(levels).toBeEnabled()
    await levels.selectOption(effort)
    await expect
      .poll(
        async () =>
          (await state()).conversations.find((c) => c.id === room.id)?.runtimeOverrides?.[provider],
      )
      .toEqual({ model, reasoningEffort: effort })
    await page.screenshot({ path: join(base, `model-${provider}.png`) })
    await page.locator('.model-control > summary').click()
  }
  const turn = async (provider: string, prompt: string, expected: string) => {
    const count = (await state()).tasks.length
    await page.getByRole('textbox', { name: 'Message' }).fill(`@${provider} ${prompt}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(
        async () => {
          const cards = page.locator('.approval')
          if (await cards.count()) {
            const card = cards.first(),
              label = await card.innerText()
            await card
              .getByRole('button', {
                name: label.includes('Antigravity scoped workspace access') ? '允許一次' : '拒絕',
                exact: true,
              })
              .click()
          }
          const tasks = (await state()).tasks
          if (tasks.length === count) return ''
          const t = tasks.at(-1)!
          if (t.status === 'failed' || t.status === 'cancelled') throw new Error(t.error)
          return t.status
        },
        { timeout: 180000, intervals: [500, 1000] },
      )
      .toBe('completed')
    const task = (await state()).tasks.at(-1)!
    const data = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[]; activities: Activity[] }>({
          op: 'messages',
          conversationId: id,
        }),
      room.id,
    )
    const answer = data.messages
      .find((m) => m.taskId === task.id && m.senderId === provider && m.delivery === 'completed')
      ?.content.trim()
    expect(answer).toBe(expected)
    const configs = data.activities
      .filter((a) => a.taskId === task.id && a.type === 'runtime.configuration')
      .map((a) => JSON.parse(a.detail))
    ;(report.turns as unknown[]).push({ provider, runtime: task.runtime, answer, configs })
    return configs
  }
  const codex = catalog.find((d) => d.agentId === 'codex')!
  for (const [model, effort, answer] of [
    ['gpt-6.1-sol', 'high', 'SOL_OK'],
    ['gpt-6-astra', 'medium', 'ASTRA_OK'],
  ]) {
    expect(codex.models.some((m) => m.id === model && m.reasoningEfforts?.includes(effort))).toBe(
      true,
    )
    await choose('codex', model, effort)
    const configs = await turn(
      'codex',
      `Reply exactly ${answer}. Do not use tools, files, network or delegate.`,
      answer,
    )
    expect(configs.some((c) => c.model === model && c.reasoningEffort === effort)).toBe(true)
  }
  expect(catalog.find((d) => d.agentId === 'claude')?.models.some((m) => m.id === 'opus')).toBe(
    true,
  )
  expect(catalog.find((d) => d.agentId === 'claude')?.models.some((m) => m.id === 'sonnet')).toBe(
    true,
  )
  await choose('claude', 'opus', 'medium')
  const opus = await turn(
    'claude',
    'Reply exactly OPUS_MODEL_OK. Do not use tools, files, network or delegate.',
    'OPUS_MODEL_OK',
  )
  expect(opus.some((c) => c.requestedModel === 'opus' && c.model?.includes('opus'))).toBe(true)
  await choose('claude', 'sonnet', 'low')
  const claude = await turn(
    'claude',
    'Reply exactly CLAUDE_MODEL_OK. Do not use tools, files, network or delegate.',
    'CLAUDE_MODEL_OK',
  )
  expect(
    claude.some(
      (c) =>
        c.requestedModel === 'sonnet' && c.model?.includes('sonnet') && c.requestedEffort === 'low',
    ),
  ).toBe(true)
  const agy = catalog.find((d) => d.agentId === 'antigravity')!.models
  const agyModel =
    agy.find((m) => m.id.includes('gemini') && m.id.includes('medium'))?.id || agy[0].id
  await choose('antigravity', agyModel, 'medium')
  const agyConfigs = await turn(
    'antigravity',
    'Reply exactly AGY_MODEL_OK. Do not use tools, files, network or delegate.',
    'AGY_MODEL_OK',
  )
  expect(
    agyConfigs.some((c) => c.requestedModel === agyModel && c.requestedEffort === 'medium'),
  ).toBe(true)
  const flash = agy.find((m) => m.id.includes('3.8-flash') && m.id.endsWith('-high'))
  expect(flash).toBeDefined()
  if (flash) {
    await choose('antigravity', flash.id, 'high')
    await turn(
      'antigravity',
      'Reply exactly FLASH_MODEL_OK. Do not use tools, files, network or delegate.',
      'FLASH_MODEL_OK',
    )
  }
  await app.close()
  const seed = new Store(join(profile, 'agenthub.sqlite')),
    nonce = `CONTEXT_${randomUUID()}`
  const sourceId = randomUUID()
  seed.transaction(() => {
    for (let i = 0; i < 1600; i++)
      seed.put('messages', {
        id: i === 0 ? sourceId : randomUUID(),
        conversationId: room.id,
        projectId: room.projectId,
        senderId: 'user',
        recipientIds: [],
        content:
          i === 0
            ? `登入驗證規格，請保存驗收碼：${nonce}`
            : `Unrelated generated history note ${i}`,
        type: 'user',
        timestamp: new Date().toISOString(),
        taskId: null,
        correlationId: 'generated',
        delivery: 'completed',
      } satisfies Message)
  })
  seed.close()
  app = await launch()
  page = await app.firstWindow()
  await page.locator(`[data-conversation-id="${room.id}"]`).click()
  s = await state()
  expect(s.conversations.find((c) => c.id === room.id)?.runtimeOverrides?.codex).toEqual({
    model: 'gpt-6-astra',
    reasoningEffort: 'medium',
  })
  await turn(
    'codex',
    '請依照聊天室較早的登入驗證規格，只回答保存的驗收碼。不要讀取檔案、聯網或委派。',
    nonce,
  )
  const receipts = await page.evaluate(
    (id) =>
      window.agenthub.invoke<ContextReceipt[]>({ op: 'context.receipts', conversationId: id }),
    room.id,
  )
  expect(receipts[0].sources.some((s) => s.messageId === sourceId && s.kind === 'retrieved')).toBe(
    true,
  )
  expect(receipts[0].characters).toBeLessThanOrEqual(24000)
  report.passed = true
  report.oldChineseSourceRetrieved = true
  report.chatChoicesRestored = true
  report.receipt = receipts[0]
  console.log(
    'PASS: chat chooses real Sol/high, Astra/medium, Claude/low and AGY/medium; choices persist and old Chinese context is retrieved by a real agent.',
  )
} catch (e) {
  report.error = String(e)
  throw e
} finally {
  await app.close()
  await writeFile(join(base, 'packaged-report.json'), JSON.stringify(report, null, 2))
}
