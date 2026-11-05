import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { backup } from 'node:sqlite'
import { builtinWorkflows, workflowHandoffReady } from '../src/shared/workflows'
import { workflowTemplateSchema, requestSchema } from '../src/shared/schemas'
import { Store } from '../src/main/database/store'
import { WorkflowService } from '../src/main/workflows/service'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import type { AgentAdapter, RunContext } from '../src/main/agents/adapter'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { AutomaticProjects } from '../src/main/git/automatic'
import { TestRunner } from '../src/main/tasks/tests'
import { JsonProcess } from '../src/main/agents/process'
import { inspectBackup } from '../src/main/database/backup'
import type { Review, Task, WorkflowRun, WorkflowTemplate } from '../src/shared/types'
import { directory, until } from './helpers'

it('treats a completed rejected or stale review as a closed handoff, not permission to start downstream work', () => {
  const run = {
    template: builtinWorkflows[0],
    steps: {
      implement: { status: 'completed', revision: 'exact' },
      review: { status: 'completed', reviewId: 'r' },
    },
  } as unknown as WorkflowRun
  const review = {
    id: 'r',
    taskId: 'review-task',
    status: 'submitted',
    verdict: 'changes_requested',
    revision: 'exact',
  } as Review
  const task = { id: 'review-task', status: 'completed' } as Task
  expect(workflowHandoffReady(run, 'review', [review], [task])).toBe(false)
  review.verdict = 'approve'
  expect(workflowHandoffReady(run, 'review', [review], [task])).toBe(true)
  review.revision = 'stale'
  expect(workflowHandoffReady(run, 'review', [review], [task])).toBe(false)
  expect(workflowHandoffReady(run, 'missing', [review], [task])).toBe(false)
})

it('validates both editable builtins and rejects cycles, missing handoffs and unreviewed integration', () => {
  for (const template of builtinWorkflows)
    expect(workflowTemplateSchema.safeParse(template).success).toBe(true)
  const template = structuredClone(builtinWorkflows[0])
  template.steps[0].dependsOn = ['integrate']
  expect(workflowTemplateSchema.safeParse(template).success).toBe(false)
  template.steps[0].dependsOn = []
  template.steps[2].dependsOn = ['implement']
  expect(workflowTemplateSchema.safeParse(template).success).toBe(false)
  template.steps[0].artifactFrom = ['review']
  expect(workflowTemplateSchema.safeParse(template).success).toBe(false)
  expect(
    requestSchema.safeParse({
      op: 'workflow.start',
      templateId: 'x',
      conversationId: 'y',
      requirement: 'test',
      bindings: {},
      shell: 'unsafe',
    }).success,
  ).toBe(false)
})

async function fixture(run: (ctx: RunContext) => Promise<string>) {
  const base = await directory('workflow-'),
    root = join(base, 'project')
  await mkdir(root)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { test: 'node test.cjs' } }),
  )
  await writeFile(
    join(root, 'test.cjs'),
    `const fs=require('node:fs'); if(!fs.readFileSync('feature.txt','utf8').includes('fixed')) throw Error('expected fixed feature'); console.log('exact snapshot passed');`,
  )
  await writeFile(join(root, 'feature.txt'), 'fixed baseline')
  const store = new Store(join(base, 'data', 'db.sqlite'))
  const project = { ...store.addProject(root, 'Workflow fixture'), autoManaged: true }
  store.put('projects', project)
  const manager = new WorkspaceManager(store, join(base, 'workspaces'))
  const tests = new TestRunner(
    store,
    () => {},
    (cwd) =>
      new JsonProcess(process.execPath, [resolve('tests/fixtures/command-sandbox.mjs')], cwd),
  )
  const adapter = { run, dispose: async () => {} } as AgentAdapter
  const orchestrator = new Orchestrator(
    store,
    new Map(['codex', 'claude', 'antigravity'].map((id) => [id, adapter])),
    () => {},
  )
  orchestrator.setWorkspaceManager(manager)
  orchestrator.automatic = new AutomaticProjects(store, manager, tests, () =>
    orchestrator.changed(),
  )
  const service = new WorkflowService(store, orchestrator)
  const conversation = store.snapshot().conversations[0]
  const status = (id: string) => store.require<WorkflowRun>('workflow_runs', id)
  const done = (id: string, timeout = 100000) =>
    until(() => status(id).status !== 'running', timeout)
  const close = async () => {
    await service.dispose()
    await orchestrator.dispose()
    await tests.dispose()
    store.close()
  }
  return { root, store, manager, orchestrator, service, conversation, status, done, close }
}

describe(
  'Custom template execution with fixture adapters and real Git/test gates',
  { timeout: 120000 },
  () => {
    it('implements, rejects, fixes, re-reviews and tests the exact merge snapshot; template edits do not mutate a run', async () => {
      let implementations = 0,
        reviews = 0
      const s = await fixture(async (ctx) => {
        if (ctx.readOnly) {
          reviews++
          const fixed = (await readFile(join(ctx.workspace, 'feature.txt'), 'utf8')).includes(
            'fixed implementation',
          )
          await ctx.collaborate({
            operation: 'submit_review',
            recipients: [],
            dependencies: [],
            verdict: fixed ? 'approve' : 'changes_requested',
            content: fixed ? 'Fixed code approved' : 'Fix feature.txt',
            comments: fixed
              ? []
              : [
                  {
                    file: 'feature.txt',
                    line: 1,
                    severity: 'error',
                    content: 'Use the fixed implementation',
                  },
                ],
          })
          return 'structured review'
        }
        implementations++
        // Even if requested by the model, out-of-template fanout must not escape the scheduler.
        await expect(
          ctx.collaborate({
            operation: 'assign_task',
            recipients: ['claude'],
            dependencies: [],
            content: 'extra task',
          }),
        ).rejects.toThrow('host template')
        await writeFile(
          join(ctx.workspace, 'feature.txt'),
          implementations === 1 ? 'broken implementation' : 'fixed implementation',
        )
        return 'coding complete'
      })
      try {
        const run = s.service.start(
          builtinWorkflows[0].id,
          s.conversation.id,
          'Implement the feature',
          { developer: 'codex', reviewer: 'claude' },
        )
        s.service.save({ ...builtinWorkflows[0], name: 'Edited while running', maxFixes: 0 })
        await s.done(run.id)
        expect(s.status(run.id), s.status(run.id).error).toMatchObject({
          status: 'completed',
          template: { name: builtinWorkflows[0].name, maxFixes: 2 },
          steps: { implement: { fixes: 1 }, integrate: { status: 'completed' } },
        })
        expect(implementations).toBe(2)
        expect(reviews).toBe(2)
        expect(await readFile(join(s.root, 'feature.txt'), 'utf8')).toBe('fixed implementation')
        const integration = s.store.snapshot().tests.find((t) => t.status === 'passed')!
        expect(integration).toBeDefined()
        expect(await git(s.root, ['rev-parse', 'HEAD^{tree}'])).toBe(
          await git(s.root, ['rev-parse', `${integration.revision}^{tree}`]),
        )
        expect(
          s.store
            .list<Task>('tasks')
            .filter(
              (t) => t.workflow?.runId === run.id && t.kind !== 'review' && t.name !== '測試與整合',
            )
            .some((t) => t.integration?.status === 'staged'),
        ).toBe(true)
      } finally {
        await s.close()
      }
    })

    it('requires a real immutable published artifact before scheduling both parallel implementations and cross-review', async () => {
      let concurrent = 0,
        maximum = 0
      let releaseParallel!: () => void
      const bothRunning = new Promise<void>((resolve) => {
        releaseParallel = resolve
      })
      const reads: string[] = []
      const s = await fixture(async (ctx) => {
        const task = s.store.require<Task>('tasks', ctx.taskId!)
        if (ctx.readOnly) {
          if (ctx.agent.provider === 'codex') {
            expect(ctx.prompt).toContain('non-mutating file listing, reading and searching')
            expect(ctx.prompt).toContain('native read-only sandbox')
          } else {
            expect(ctx.prompt).toContain('Do not invoke run_command')
          }
          await ctx.collaborate({
            operation: 'submit_review',
            recipients: [],
            dependencies: [],
            verdict: 'approve',
            content: 'Cross review approved',
            comments: [],
          })
        } else if (task.workflow?.stepId === 'contract') {
          await writeFile(join(ctx.workspace, 'contract.json'), '{"version":1}')
          // The runtime has native file tools only. The configured publisher step must
          // obtain a safe host checkpoint without granting arbitrary Git commands.
          await ctx.collaborate({
            operation: 'publish_artifact',
            recipients: [],
            dependencies: [],
            paths: ['contract.json'],
            content: 'API contract',
          })
        } else {
          concurrent++
          maximum = Math.max(maximum, concurrent)
          if (concurrent === 2) releaseParallel()
          ctx.signal.addEventListener('abort', releaseParallel, { once: true })
          await bothRunning
          ctx.signal.throwIfAborted()
          const artifact = s.store.snapshot().artifacts[0]
          expect(ctx.prompt).toContain(artifact.id)
          const received = (await ctx.collaborate({
            operation: 'read_artifact',
            recipients: [],
            dependencies: [],
            artifactId: artifact.id,
            content: 'Read immutable API contract',
          })) as { files: { content: string }[] }
          expect(received.files[0].content).toContain('"version":1')
          reads.push(task.agentId)
          await new Promise((r) => setTimeout(r, 80))
          await writeFile(join(ctx.workspace, `${task.agentId}.txt`), 'fixed implementation')
          concurrent--
        }
        return 'fixture native-contract behavior'
      })
      try {
        const run = s.service.start(builtinWorkflows[1].id, s.conversation.id, 'Parallel project', {
          architect: 'antigravity',
          backend: 'codex',
          frontend: 'claude',
        })
        await s.done(run.id, 110000)
        expect(s.status(run.id).status, s.status(run.id).error).toBe('completed')
        expect(new Set(reads)).toEqual(new Set(['codex', 'claude']))
        expect(maximum).toBe(2)
        expect(await readFile(join(s.root, 'codex.txt'), 'utf8')).toContain('fixed')
        expect(await readFile(join(s.root, 'claude.txt'), 'utf8')).toContain('fixed')
      } finally {
        await s.close()
      }
    }, 120000)

    it.each(['no-artifact', 'no-verdict', 'fix-limit', 'test-failure', 'stale-source'] as const)(
      'stops safely at %s and never integrates rejected/untested code',
      async (mode) => {
        const s = await fixture(async (ctx) => {
          if (ctx.readOnly && mode !== 'no-verdict')
            await ctx.collaborate({
              operation: 'submit_review',
              recipients: [],
              dependencies: [],
              verdict: mode === 'fix-limit' ? 'changes_requested' : 'approve',
              content: 'Fixture review',
              comments: [],
            })
          if (ctx.readOnly && mode === 'stale-source') {
            const current = s.store.require<Task>('tasks', ctx.taskId!)
            const review = s.store.snapshot().reviews.find((r) => r.id === current.reviewId)!
            const source = s.store
              .snapshot()
              .workspaces.find((w) => w.id === review.sourceWorkspaceId)!
            await writeFile(
              join(source.path, 'external-change.txt'),
              'User changed source after review',
            )
          }
          if (!ctx.readOnly)
            await writeFile(
              join(ctx.workspace, 'feature.txt'),
              mode === 'test-failure' ? 'test should fail' : 'fixed implementation',
            )
          return 'fixture result'
        })
        try {
          const template = structuredClone(builtinWorkflows[0])
          template.maxFixes = 0
          if (mode === 'no-artifact') template.steps[0].publishArtifact = true
          s.service.save(template)
          const run = s.service.start(template.id, s.conversation.id, mode, {
            developer: 'codex',
            reviewer: 'claude',
          })
          await s.done(run.id)
          expect(s.status(run.id).status).toBe('attention')
          expect(await readFile(join(s.root, 'feature.txt'), 'utf8')).toBe('fixed baseline')
          if (mode === 'no-artifact') expect(s.store.snapshot().reviews).toHaveLength(0)
          if (mode === 'test-failure')
            expect(s.store.snapshot().tests.some((t) => t.status === 'failed')).toBe(true)
        } finally {
          await s.close()
        }
      },
      120000,
    )

    it('pauses partial coding and resumes only after explicit inspection, preserving workflow attempt links', async () => {
      let entered = false,
        calls = 0
      const s = await fixture(async (ctx) => {
        ctx.signal.throwIfAborted()
        if (ctx.readOnly) {
          await ctx.collaborate({
            operation: 'submit_review',
            recipients: [],
            dependencies: [],
            verdict: 'approve',
            content: 'Resumed snapshot approved',
            comments: [],
          })
          return 'reviewed'
        }
        calls++
        if (calls === 1) {
          await writeFile(join(ctx.workspace, 'partial.txt'), 'preserve me')
          entered = true
          await new Promise<void>((r) => {
            if (ctx.signal.aborted) r()
            else ctx.signal.addEventListener('abort', () => r(), { once: true })
          })
          ctx.signal.throwIfAborted()
        }
        expect(await readFile(join(ctx.workspace, 'partial.txt'), 'utf8')).toBe('preserve me')
        await writeFile(join(ctx.workspace, 'feature.txt'), 'fixed implementation')
        return 'resumed work'
      })
      try {
        const run = s.service.start(builtinWorkflows[0].id, s.conversation.id, 'Resume fixture', {
          developer: 'codex',
          reviewer: 'claude',
        })
        await until(() => entered, 15000)
        await s.service.action(run.id, 'pause')
        await until(() => !s.orchestrator.isBusy(run.projectId), 10000)
        expect(s.status(run.id).status).toBe('paused')
        expect(calls).toBe(1)
        await s.service.action(run.id, 'resume')
        await s.done(run.id)
        expect(s.status(run.id).status, s.status(run.id).error).toBe('completed')
        expect(calls).toBe(2)
        const attempts = s.store
          .list<Task>('tasks')
          .filter((t) => t.workflow?.stepId === 'implement')
        expect(attempts[1].retryOf).toBe(attempts[0].id)
        expect(attempts[0].supersededBy).toBe(attempts[1].id)
        expect(attempts[1].correlationId).toBe(run.id)
      } finally {
        await s.close()
      }
    })

    it('cancels native turns and prevents further steps; rejects disabled and same-agent bindings', async () => {
      const s = await fixture(async (ctx) => {
        ctx.signal.throwIfAborted()
        await new Promise<void>((r) =>
          ctx.signal.addEventListener('abort', () => r(), { once: true }),
        )
        ctx.signal.throwIfAborted()
        return ''
      })
      try {
        expect(() =>
          s.service.start(builtinWorkflows[0].id, s.conversation.id, 'bad binding', {
            developer: 'codex',
            reviewer: 'codex',
          }),
        ).toThrow('different reviewer')
        const run = s.service.start(
          builtinWorkflows[0].id,
          s.conversation.id,
          'Cancellation fixture',
          { developer: 'codex', reviewer: 'claude' },
        )
        await until(() => s.store.list<Task>('tasks').some((t) => t.status === 'running'), 15000)
        await s.service.action(run.id, 'cancel')
        await until(() => !s.orchestrator.isBusy(run.projectId), 10000)
        expect(s.status(run.id).status).toBe('cancelled')
        expect(s.store.snapshot().reviews).toHaveLength(0)
        expect(() => s.orchestrator.send(s.conversation.id, 'after cancel note', [])).not.toThrow()
      } finally {
        await s.close()
      }
    })
  },
)

it('persists templates/runs in schema 8 and backup, pauses recovered runs without replay, and does not re-seed deleted templates', async () => {
  const base = await directory(),
    path = join(base, 'db.sqlite')
  let store = new Store(path)
  const p = store.addProject(base, 'Persistence'),
    c = store.snapshot().conversations[0]
  store.put('workflow_templates', { ...builtinWorkflows[0], id: 'custom', name: 'Custom saved' })
  store.put('workflow_runs', {
    id: 'run',
    projectId: p.id,
    conversationId: c.id,
    template: builtinWorkflows[0],
    bindings: {},
    requirement: 'persist',
    status: 'running',
    createdAt: '',
    steps: {},
  } satisfies WorkflowRun)
  for (const template of store.list<WorkflowTemplate>('workflow_templates'))
    store.remove('workflow_templates', template.id)
  const saved = join(base, 'backup.sqlite')
  await backup(store.db, saved)
  expect(inspectBackup(saved).counts.workflow_runs).toBe(1)
  store.close()
  store = new Store(path)
  try {
    store.recover()
    expect(store.snapshot().workflowTemplates).toHaveLength(0)
    expect(store.require<WorkflowRun>('workflow_runs', 'run').status).toBe('paused')
    expect(store.snapshot().tasks).toHaveLength(0)
  } finally {
    store.close()
  }
})
