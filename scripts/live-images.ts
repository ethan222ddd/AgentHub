import { guardIdentity } from './release-identity'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile, unlink, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomInt, createHash } from 'node:crypto'
import { repository } from '../tests/helpers'
import type { Snapshot, Message } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/live-images')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(join(base, 'profile-'))
const project = await repository()
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const packaged = process.env.AGENTHUB_IMAGES_PACKAGED === '1' || process.argv.includes('--packaged')
if (!packaged) env.AGENTHUB_DATA_DIR = profile
const app = await electron.launch(
  packaged
    ? {
        executablePath: resolve(
          process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
        ),
        args: [`--user-data-dir=${profile}`],
        env,
      }
    : { args: ['.'], env },
)
let code = String(randomInt(100000, 999999))
let expected = code + ' blue'
const result: Record<string, unknown> = { version, packaged, profile, project }
if (packaged) Object.assign(result, await guardIdentity())
if (packaged)
  result.appAsarSha256 = createHash('sha256')
    .update(
      await readFile(
        resolve(
          process.env.AGENTHUB_PACKAGED_EXE || `release/${version}/win-unpacked/AgentHub.exe`,
          '..',
          'resources',
          'app.asar',
        ),
      ),
    )
    .digest('hex')
try {
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await page.getByRole('button', { name: '變更', exact: true }).click()
  await page.getByRole('button', { name: '建立 Git 隔離工作區', exact: true }).click()
  const snapshot = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  const approvals = async () => {
    const search = page
      .locator('.approval')
      .filter({ hasText: 'Codex live web search' })
      .getByRole('button', { name: '拒絕', exact: true })
    if (await search.count()) await search.click()
    const files = page
      .locator('.approval')
      .filter({ hasText: 'Antigravity scoped workspace access' })
      .getByRole('button', { name: '允許一次', exact: true })
    if (await files.count()) await files.click()
  }
  await expect.poll(async () => (await snapshot()).workspaces.length, { timeout: 30000 }).toBe(3)
  await page.getByRole('button', { name: 'Close panel' }).click()
  const data = await page.evaluate((secret) => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 320
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#147bea'
    ctx.fillRect(0, 0, 640, 320)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 96px monospace'
    ctx.fillText(secret, 135, 195)
    return canvas.toDataURL('image/png').split(',')[1]
  }, code)
  const file = join(project, 'visual.png')
  await writeFile(file, Buffer.from(data, 'base64'))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
  await page.getByTitle('附加專案檔案').click()
  await expect(page.locator('.attachments img')).toBeVisible()
  await unlink(file)
  const prompt =
    'Read the six-digit code printed in the attached image. Reply with exactly that code followed by a space and the background color name in lowercase English. Do not use tools, access files, run commands or delegate.'
  const answers: Record<string, string> = {}
  const expectations: Record<string, string> = { codex: expected }
  for (const provider of ['codex', 'claude', 'antigravity']) {
    if (provider !== 'codex') {
      // A fresh room plus a different nonce prevents copying Codex's public answer.
      await page.getByTitle('New conversation').first().click()
      code = String(randomInt(100000, 999999))
      expected = code + (provider === 'claude' ? ' green' : ' red')
      expectations[provider] = expected
      const image = await page.evaluate(
        ({ secret, color }) => {
          const canvas = document.createElement('canvas')
          canvas.width = 640
          canvas.height = 320
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 640, 320)
          ctx.fillStyle = 'white'
          ctx.font = 'bold 96px monospace'
          ctx.fillText(secret, 135, 195)
          return canvas.toDataURL('image/png').split(',')[1]
        },
        { secret: code, color: provider === 'claude' ? '#16883b' : '#bb2233' },
      )
      await writeFile(file, Buffer.from(image, 'base64'))
      await page.getByTitle('附加專案檔案').click()
      await expect(page.locator('.attachments img')).toBeVisible()
      await unlink(file)
    }
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(
        `@${provider} ${provider === 'antigravity' ? 'Use your native local image reader to open the attached image. Read its six-digit code and background color. Reply with exactly the code, a space and lowercase English color. Do not run commands, access other files, use the network or delegate.' : prompt}`,
      )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(
        async () => {
          await approvals()
          const s = await snapshot()
          const task = s.tasks.filter((t) => t.agentId === provider).at(-1)
          if (task?.status === 'failed' || task?.status === 'cancelled') throw new Error(task.error)
          return task?.status
        },
        { timeout: 180000, intervals: [500, 1000] },
      )
      .toBe('completed')
    const s = await snapshot()
    const messages = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{ messages: Message[] }>({ op: 'messages', conversationId: id }),
      s.conversations.at(-1)!.id,
    )
    const answer = messages.messages
      .filter((m) => m.senderId === provider && m.delivery === 'completed')
      .at(-1)!
      .content.trim()
    expect(answer).toBe(expected)
    answers[provider] = answer
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(
        `@${provider} Continue this same session. What was the background color in the previous image? Reply only with its lowercase English name. Do not use tools or access files.`,
      )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(
        async () => {
          await approvals()
          const state = await snapshot()
          const task = state.tasks.filter((t) => t.agentId === provider).at(-1)
          if (task?.status === 'failed' || task?.status === 'cancelled') throw new Error(task.error)
          return task?.status
        },
        { timeout: 180000, intervals: [500, 1000] },
      )
      .toBe('completed')
    const resumed = await page.evaluate(
      (id) =>
        window.agenthub.invoke<{
          messages: Message[]
          activities: { agentId: string; sessionId: string }[]
        }>({ op: 'messages', conversationId: id }),
      s.conversations.at(-1)!.id,
    )
    expect(
      resumed.messages
        .filter((m) => m.senderId === provider && m.delivery === 'completed')
        .at(-1)
        ?.content.trim(),
    ).toBe(expected.split(' ')[1])
    expect(
      new Set(
        resumed.activities
          .filter((a) => a.agentId === provider && a.sessionId)
          .map((a) => a.sessionId),
      ).size,
    ).toBe(1)
  }
  const state = await snapshot()
  for (const workspace of state.workspaces)
    expect(
      (await readdir(workspace.path)).some((name) => name.startsWith('.agenthub-images-')),
    ).toBe(false)
  const log = await readFile(state.diagnosticsPath!, 'utf8')
  expect(log).not.toContain(data.slice(0, 100))
  expect(log).not.toContain(code)
  await page.screenshot({ path: join(base, packaged ? 'packaged-vision.png' : 'vision.png') })
  Object.assign(result, {
    passed: true,
    originalDeleted: true,
    expectations,
    independentImageNonces: true,
    nativeImageSessionResume: true,
    answers,
    workspaces: state.workspaces,
    taskStatuses: state.tasks.map((t) => ({ agentId: t.agentId, status: t.status })),
    logsExcludeImageData: true,
  })
} catch (error) {
  result.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(
    join(base, packaged ? 'packaged-report.json' : 'report.json'),
    JSON.stringify(result, null, 2),
  )
}
console.log(
  'PASS: actual image bytes → all three native runtimes, independent hidden image codes read correctly, sources deleted, sessions resumed and temporary image files cleaned.',
)
