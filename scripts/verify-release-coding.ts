// Complete evidence verification after a screenshot-only harness failure.
// No task is replayed; every native operation must already be completed in this
// same exact packaged release, and actual Git trees/tests are verified again.
import { _electron as electron, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { guardIdentity } from './release-identity'
import { git } from '../src/main/git/workspaces'
import { ownedExec } from '../src/main/agents/process-owner'
import type { Snapshot, Activity, Message, Detection } from '../src/shared/types'
const base = resolve('.local/live-release-coding'),
  file = join(base, 'packaged-report.json')
const previous = JSON.parse(await readFile(file, 'utf8'))
if (!String(previous.error).includes('strict mode violation'))
  throw new Error('Only a screenshot selector failure can use this verifier')
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const exe = resolve(`release/${version}/win-unpacked/AgentHub.exe`)
const asar = createHash('sha256')
    .update(await readFile(resolve(exe, '..', 'resources/app.asar')))
    .digest('hex'),
  identity = await guardIdentity(exe)
if (
  previous.version !== version ||
  previous.appAsarSha256 !== asar ||
  previous.processGuardSha256 !== identity.processGuardSha256
)
  throw new Error('Cannot reuse evidence from a different binary')
for (const [key, prefix] of [
  ['profile', 'profile-'],
  ['project', 'repository-'],
] as const) {
  const rel = relative(base, resolve(previous[key]))
  if (rel.includes('..') || rel.includes('/') || rel.includes('\\') || !rel.startsWith(prefix))
    throw new Error('Fixture path outside validation root')
}
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: exe,
  args: [`--user-data-dir=${previous.profile}`],
  env,
})
try {
  const page = await app.firstWindow()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  const s = await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' }))
  expect(s.tasks.length).toBeGreaterThanOrEqual(6)
  expect(s.tasks.every((t) => t.status === 'completed')).toBe(true)
  const room = s.conversations[0]
  await page.locator(`[data-conversation-id="${room.id}"]`).click()
  const timeline = await page.evaluate(
    (conversationId) =>
      window.agenthub.invoke<{ activities: Activity[]; messages: Message[] }>({
        op: 'messages',
        conversationId,
      }),
    room.id,
  )
  expect(s.tasks.some((t) => t.agentId === 'claude' && t.depth > 0)).toBe(true)
  expect(
    timeline.messages.some(
      (m) =>
        m.senderId === 'codex' && m.type === 'collaboration' && m.recipientIds.includes('claude'),
    ),
  ).toBe(true)
  const artifact = s.artifacts.find((a) => a.agentId === 'codex')!
  expect(artifact).toBeTruthy()
  expect(
    timeline.activities.some(
      (a) =>
        a.agentId === 'claude' &&
        a.type === 'collaboration.read' &&
        JSON.parse(a.detail).artifactId === artifact.id,
    ),
  ).toBe(true)
  const backend = s.workspaces.find((w) => w.agentId === 'codex')!,
    frontend = s.workspaces.find((w) => w.agentId === 'claude')!
  expect(backend.path).not.toBe(frontend.path)
  const reviews = [backend, frontend].map((w) =>
    s.reviews.find((r) => r.sourceWorkspaceId === w.id)!,
  )
  expect(reviews).toHaveLength(2)
  for (const r of reviews) {
    expect(r).toMatchObject({ status: 'submitted', verdict: 'approve', reviewerId: 'antigravity' })
    expect(s.tasks.find((t) => t.id === r.taskId)?.status).toBe('completed')
    expect(
      await git(s.workspaces.find((w) => w.id === r.workspaceId)!.path, ['status', '--porcelain']),
    ).toBe('')
  }
  expect(artifact.revision).toBe(reviews[0].revision)
  const mergeIds = (
    await git(previous.project, ['log', '--first-parent', '--merges', '--format=%H'])
  )
    .trim()
    .split(/\r?\n/)
    .reverse()
  expect(mergeIds).toHaveLength(2)
  const tests = s.tests.filter((t) => t.status === 'passed' && t.execution === 'host-approved')
  expect(tests).toHaveLength(2)
  const merges = []
  for (const [i, merge] of mergeIds.entries()) {
    expect(
      await git(previous.project, ['merge-base', '--is-ancestor', reviews[i].revision, merge]),
    ).toBe('')
    const tree = await git(previous.project, ['show', '-s', '--format=%T', merge])
    expect(await git(previous.project, ['show', '-s', '--format=%T', tests[i].revision])).toBe(tree)
    expect(
      await git(s.workspaces.find((w) => w.id === tests[i].workspaceId)!.path, [
        'status',
        '--porcelain',
      ]),
    ).toBe('')
    merges.push({
      revision: merge,
      testedTree: tree,
      testedCommit: tests[i].revision,
      reviewId: reviews[i].id,
    })
  }
  const finalRevision = await git(previous.project, ['rev-parse', 'HEAD'])
  const finalTest = await ownedExec(process.execPath, ['--test', '--test-isolation=none'], {
    cwd: previous.project,
    timeout: 30000,
  })
  expect(finalTest.stdout).toMatch(/fail 0/)
  await ownedExec(
    process.execPath,
    [
      '-e',
      "const a=require('node:assert/strict'),b=require('./backend.cjs'),f=require('./frontend.cjs');a.equal(f.formatUpper(b.triple(-3)),'VALUE: -9');a.equal(f.format(b.double(7)),'value: 14')",
    ],
    { cwd: previous.project },
  )
  expect(await git(previous.project, ['rev-parse', 'HEAD'])).toBe(finalRevision)
  expect(await git(previous.project, ['status', '--porcelain'])).toBe('')
  const detected = await page.evaluate(() =>
    window.agenthub.invoke<Detection[]>({ op: 'agents.detect' }),
  )
  await page.screenshot({ path: join(base, 'release-coding.png') })
  const report = {
    ...previous,
    passed: true,
    verificationResumedFromPersistedExactRelease: true,
    priorScreenshotError: previous.error,
    error: undefined,
    realDelegation: true,
    artifactReadByClaude: true,
    independentWorktrees: true,
    readOnlyReviews: true,
    structuredVerdicts: true,
    reviews,
    artifact,
    testRecords: tests,
    merges,
    finalRevision,
    finalProjectTest: {
      revision: finalRevision,
      execution: 'host-approved generated fixture',
      stdout: finalTest.stdout,
    },
    tasks: s.tasks,
    providers: detected.map((d) => ({ provider: d.provider, version: d.version })),
  }
  await writeFile(file, JSON.stringify(report, null, 2))
  console.log(
    'PASS: same exact packaged native coding/review evidence, two exact tested merge trees and final project tests verified; no agent work replayed',
  )
} finally {
  await app.close()
}
