// Real installed releases, owned disposable profile, native session upgrade.
import { _electron as electron, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { repository } from '../tests/helpers'
import type { Snapshot, Message, Activity } from '../src/shared/types'
import { guardIdentity } from './release-identity'
const phase = process.argv[2]
if (!['baseline', 'upgraded'].includes(phase)) throw new Error('Specify baseline or upgraded')
const base = resolve('.local/installer-roundtrip')
const owner = JSON.parse(await readFile(join(base, 'ownership.json'), 'utf8')) as {
  createdBy: string
  phase: string
  target: string
  from: string
  to: string
}
if (
  owner.createdBy !== 'AgentHub isolated installer validation' ||
  relative(base, resolve(owner.target)) !== 'application'
)
  throw new Error('Untrusted installed validation target')
if (owner.phase !== (phase === 'baseline' ? 'install-old' : 'upgrade'))
  throw new Error('Installer phase mismatch')
const profile = join(base, 'profile'),
  executablePath = join(owner.target, 'AgentHub.exe')
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env })
const page = await app.firstWindow()
const state = () => page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
try {
  const actual = await app.evaluate(({ app }) => app.getVersion())
  expect(actual).toBe(phase === 'baseline' ? owner.from : owner.to)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  let proof: {
    nonce: string
    project: string
    conversationId: string
    nativeSession: string
    taskCount: number
  }
  if (phase === 'baseline') {
    const project = await repository(),
      nonce = randomUUID()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, project)
    await page.getByRole('button', { name: '選擇專案資料夾' }).click()
    await expect(page.locator('.conversation-row.selected')).toHaveCount(1)
    const s = await state(),
      room = s.conversations[0]
    await page.evaluate(
      ({ projectId, settings }) =>
        Promise.all([
          window.agenthub.invoke({ op: 'project.automation', projectId, enabled: false }),
          window.agenthub.invoke({
            op: 'settings.save',
            settings: { ...settings, theme: 'dark', maxUsageTokens: 1000000 },
          }),
        ]),
      { projectId: room.projectId, settings: s.settings },
    )
    await page.evaluate(
      (projectId) =>
        window.agenthub.invoke({ op: 'workspace.prepare', projectId, initialize: false }),
      room.projectId,
    )
    await page.evaluate(
      ({ id, nonce }) =>
        window.agenthub.invoke({
          op: 'send',
          conversationId: id,
          content: `Upgrade history proof ${nonce}`,
          recipients: [],
        }),
      { id: room.id, nonce },
    )
    proof = { nonce, project, conversationId: room.id, nativeSession: '', taskCount: 0 }
  } else {
    proof = JSON.parse(await readFile(join(base, 'profile-proof.json'), 'utf8'))
    expect((await state()).settings.theme).toBe('dark')
    expect((await state()).tasks).toHaveLength(proof.taskCount)
    await page.locator(`[data-conversation-id="${proof.conversationId}"]`).click()
    await expect(page.getByTestId('message').filter({ hasText: proof.nonce })).toBeVisible()
    await page.waitForTimeout(1300)
    expect((await state()).tasks.some((t) => t.status === 'running')).toBe(false)
  }
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('@Codex Reply exactly OK. Do not use tools, files, shell, network or delegation.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .poll(
      async () => {
        const card = page.locator('.approval').first()
        if (await card.count())
          await card.getByRole('button', { name: '拒絕', exact: true }).click()
        const last = (await state()).tasks.at(-1)
        if (last?.status === 'failed') throw new Error(last.error)
        return last?.status
      },
      { timeout: 120000, intervals: [300, 800] },
    )
    .toBe('completed')
  const s = await state()
  const timeline = await page.evaluate(
    (conversationId) =>
      window.agenthub.invoke<{ messages: Message[]; activities: Activity[] }>({
        op: 'messages',
        conversationId,
      }),
    proof.conversationId,
  )
  expect(
    timeline.messages
      .filter((m) => m.senderId === 'codex' && m.delivery === 'completed')
      .at(-1)
      ?.content.trim(),
  ).toBe('OK')
  const sessions = [
    ...new Set(
      timeline.activities
        .filter((a) => a.agentId === 'codex' && a.sessionId)
        .map((a) => a.sessionId),
    ),
  ]
  expect(sessions).toHaveLength(1)
  const asar = createHash('sha256')
    .update(await readFile(join(owner.target, 'resources/app.asar')))
    .digest('hex')
  const identity = { appAsarSha256: asar, ...(await guardIdentity(executablePath)) }
  if (phase === 'baseline') {
    proof.nativeSession = sessions[0]
    proof.taskCount = s.tasks.length
    await writeFile(join(base, 'profile-proof.json'), JSON.stringify(proof, null, 2))
    await writeFile(
      join(base, 'baseline-report.json'),
      JSON.stringify(
        { passed: true, version: actual, installed: true, ...identity, realCodexOK: true },
        null,
        2,
      ),
    )
  } else {
    expect(sessions[0]).toBe(proof.nativeSession)
    expect(s.tasks).toHaveLength(proof.taskCount + 1)
    expect(asar).toBe(
      createHash('sha256')
        .update(await readFile(resolve(`release/${actual}/win-unpacked/resources/app.asar`)))
        .digest('hex'),
    )
    await writeFile(
      join(base, 'upgrade-report.json'),
      JSON.stringify(
        {
          passed: true,
          version: actual,
          from: owner.from,
          to: owner.to,
          installed: true,
          ...identity,
          historyRestored: true,
          themeRestored: true,
          noAutomaticReplay: true,
          nativeSessionResumed: true,
          realCodexOK: true,
        },
        null,
        2,
      ),
    )
  }
  await page.screenshot({ path: join(base, `${phase}.png`) })
  console.log(
    `PASS: installed ${actual} ${phase}, history/settings and native Codex OK${phase === 'upgraded' ? ' in resumed session' : ''}`,
  )
} finally {
  await app.close()
}
