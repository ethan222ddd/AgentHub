import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ContextMemory, contextMigration, registerContextFunctions } from '../orchestrator/context'
import { builtinWorkflows } from '../../shared/workflows'
import type {
  Activity,
  AgentProfile,
  Conversation,
  Message,
  Project,
  Session,
  Settings,
  Task,
  TestRun,
  Workspace,
  UsageRecord,
  Review,
  Artifact,
  WorkflowTemplate,
  WorkflowRun,
} from '../../shared/types'

export const defaults: Settings = {
  notifications: 'all',
  maxUsageTokens: 200000,
  maxCostUsd: 5,
  defaultMode: 'manual',
  defaultProjectDirectory: '',
  startupBehavior: 'restore',
  automaticReview: false,
  reviewerId: '',
  theme: 'system',
  language: 'zh-TW',
  maxTurns: 12,
  maxConcurrent: 3,
  maxDepth: 3,
  maxFanout: 3,
  timeoutMs: 600000,
  supervisorId: '',
}
export class Store {
  readonly db: DatabaseSync
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    registerContextFunctions(this.db)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    )
    const version = this.db.prepare('SELECT max(version) AS v FROM migrations').get()?.v
    if (Number(version) > 8) {
      this.db.close()
      throw new Error(
        'Database was created by a newer AgentHub. Use a compatible application version.',
      )
    }
    if (!version) {
      this.db.exec(`BEGIN;
        CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE conversations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL);
        CREATE TABLE messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, data TEXT NOT NULL);
        CREATE INDEX messages_conversation ON messages(conversation_id);
        CREATE TABLE agents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE activities(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE workspaces(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE checkpoints(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        INSERT INTO migrations VALUES(1, datetime('now'));
        COMMIT;`)
    }
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=2').get())
      this.db.exec(
        "BEGIN; CREATE TABLE test_runs(id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO migrations VALUES(2,datetime('now')); COMMIT;",
      )
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=3').get()) {
      this.db.exec(
        "BEGIN; CREATE TABLE usage_records(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE reviews(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE artifacts(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE permissions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE merge_previews(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE summaries(id TEXT PRIMARY KEY,data TEXT NOT NULL); INSERT INTO migrations VALUES(3,datetime('now')); COMMIT;",
      )
    }
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=4').get())
      this.db.exec(
        "BEGIN; CREATE TABLE attachments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL,bytes BLOB NOT NULL); CREATE INDEX attachment_project ON attachments(project_id); INSERT INTO migrations VALUES(4,datetime('now')); COMMIT;",
      )
    // Attempt links change scheduler semantics. Older apps must refuse this database rather than replay replaced work.
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=5').get())
      this.db.exec("INSERT INTO migrations VALUES(5,datetime('now'))")
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=6').get())
      this.db.exec(contextMigration)
    // Older schedulers must not rerun an already-finished agent while integration awaits review.
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=7').get())
      this.db.exec(
        "BEGIN; CREATE TABLE workspace_operations(id TEXT PRIMARY KEY,data TEXT NOT NULL,project_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.projectId')) STORED REFERENCES projects(id) ON DELETE CASCADE); CREATE INDEX workspace_operations_project ON workspace_operations(project_id); INSERT INTO migrations VALUES(7,datetime('now')); COMMIT;",
      )
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=8').get()) {
      this.db.exec(
        "BEGIN; CREATE TABLE workflow_templates(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE workflow_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL,conversation_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.conversationId')) STORED REFERENCES conversations(id) ON DELETE CASCADE);",
      )
      try {
        for (const template of builtinWorkflows) this.put('workflow_templates', template)
        this.db.exec("INSERT INTO migrations VALUES(8,datetime('now')); COMMIT;")
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (!this.list<AgentProfile>('agents').length) {
      for (const [provider, name, role] of [
        ['codex', 'Codex', 'Backend Developer'],
        ['claude', 'Claude Agent', 'Frontend Developer'],
        ['antigravity', 'Antigravity', 'QA Engineer'],
      ] as const)
        this.put('agents', {
          id: provider,
          provider,
          name,
          role,
          instructions: '',
          model: '',
          enabled: true,
          ...(provider === 'claude' ? { authMode: 'native' as const } : {}),
        })
    }
    if (!this.get<Settings>('settings', 'general'))
      this.put('settings', { ...defaults, id: 'general' })
    for (const agent of this.list<AgentProfile>('agents'))
      if (agent.provider === 'claude' && !agent.authMode)
        this.put('agents', { ...agent, authMode: 'native' })
  }
  // Table names are private constants from host code, never renderer or agent input.
  list<T>(table: string): T[] {
    return this.db
      .prepare(`SELECT data FROM ${this.table(table)} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(String(row.data)) as T)
  }
  get<T>(table: string, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${this.table(table)} WHERE id=?`).get(id)
    return row ? (JSON.parse(String(row.data)) as T) : undefined
  }
  require<T>(table: string, id: string): T {
    const value = this.get<T>(table, id)
    if (!value) throw new Error(`${table}: item no longer exists`)
    return value
  }
  put<T extends { id: string }>(table: string, value: T): void {
    const extra =
      table === 'messages'
        ? ['conversation_id', (value as unknown as Message).conversationId]
        : table === 'context_receipts'
          ? ['conversation_id', (value as unknown as { conversationId: string }).conversationId]
          : table === 'conversations'
            ? ['project_id', (value as unknown as Conversation).projectId]
            : null
    if (extra)
      this.db
        .prepare(
          `INSERT INTO ${this.table(table)}(id,data,${extra[0]}) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        )
        .run(value.id, JSON.stringify(value), extra[1])
    else
      this.db
        .prepare(
          `INSERT INTO ${this.table(table)}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        )
        .run(value.id, JSON.stringify(value))
  }
  remove(table: string, id: string): void {
    this.db.prepare(`DELETE FROM ${this.table(table)} WHERE id=?`).run(id)
  }
  private table(table: string): string {
    if (
      ![
        'projects',
        'conversations',
        'messages',
        'agents',
        'sessions',
        'tasks',
        'activities',
        'workspaces',
        'checkpoints',
        'settings',
        'test_runs',
        'usage_records',
        'reviews',
        'artifacts',
        'permissions',
        'merge_previews',
        'summaries',
        'context_receipts',
        'workspace_operations',
        'workflow_templates',
        'workflow_runs',
      ].includes(table)
    )
      throw new Error('Invalid table')
    return table
  }
  settings(): Settings {
    const value = this.require<Settings & { id?: string }>('settings', 'general')
    delete value.id
    return { ...defaults, ...value }
  }
  messages(conversationId: string, search = ''): Message[] {
    return this.db
      .prepare(
        `SELECT data FROM (SELECT rowid,data FROM messages WHERE conversation_id=? AND instr(lower(json_extract(data,'$.content')), lower(?))>0 ORDER BY rowid DESC LIMIT 500) ORDER BY rowid`,
      )
      .all(conversationId, search)
      .map((r) => JSON.parse(String(r.data)) as Message)
  }
  page(conversationId: string, search = '', before?: number) {
    const rows = this.db
      .prepare(
        "SELECT rowid,data FROM messages WHERE conversation_id=? AND rowid<? AND instr(lower(json_extract(data,'$.content')),lower(?))>0 ORDER BY rowid DESC LIMIT 80",
      )
      .all(conversationId, before || Number.MAX_SAFE_INTEGER, search)
    return {
      messages: rows.map((r) => JSON.parse(String(r.data)) as Message).reverse(),
      before: rows.length ? Number(rows.at(-1)?.rowid) : undefined,
      hasMore: rows.length === 80,
    }
  }
  context(conversationId: string, cursor: number, query = '', agentId = '') {
    return new ContextMemory(this.db).build(conversationId, cursor, query, agentId)
  }
  addProject(path: string, name: string): Project {
    const existing = this.list<Project>('projects').find(
      (p) => p.path.toLowerCase() === path.toLowerCase(),
    )
    if (existing) return existing
    const project = { id: randomUUID(), path, name, createdAt: new Date().toISOString() }
    this.put('projects', project)
    this.createConversation(project.id)
    return project
  }
  createConversation(projectId: string): Conversation {
    this.require('projects', projectId)
    const conversation: Conversation = {
      id: randomUUID(),
      projectId,
      name: '新對話',
      mode:
        this.settings().defaultMode === 'supervisor' && !this.settings().supervisorId
          ? 'manual'
          : this.settings().defaultMode,
      supervisorId: this.settings().supervisorId,
      createdAt: new Date().toISOString(),
      stopped: false,
    }
    this.put('conversations', conversation)
    return conversation
  }
  recover(): void {
    for (const run of this.list<WorkflowRun>('workflow_runs'))
      if (run.status === 'running')
        this.put('workflow_runs', {
          ...run,
          status: 'paused',
          error:
            'App restarted. Inspect partial work and explicitly resume; no workflow was replayed.',
        })
    for (const review of this.list<Review>('reviews'))
      if (review.status === 'running' || review.status === 'pending')
        this.put('reviews', {
          ...review,
          status: 'failed',
          summary: 'App restarted; inspect the snapshot before requesting a new review.',
        })
    for (const task of this.list<Task>('tasks'))
      if (
        !task.supersededBy &&
        // A plan awaiting approval ran read-only and has no in-flight side effects to inspect.
        !(task.status === 'waiting_user' && task.waitReason === 'plan') &&
        ['pending', 'running', 'reviewing', 'waiting_agent', 'blocked', 'waiting_user'].includes(
          task.status,
        )
      )
        this.put('tasks', {
          ...task,
          status: 'waiting_user',
          waitReason: task.integration ? 'integration' : 'recovery',
          ...(task.integration
            ? {
                integration: {
                  ...task.integration,
                  status: 'attention',
                  detail: 'App 重啟；請檢查後重試整合。Agent 不會重跑。',
                },
              }
            : {}),
          failureKind: 'interrupted',
          error:
            'App restarted. Inspect workspace before explicitly resuming; no task was replayed.',
        })
    for (const m of this.list<Message>('messages'))
      if (m.delivery === 'streaming') this.put('messages', { ...m, delivery: 'failed' })
    for (const run of this.list<TestRun>('test_runs'))
      if (run.status === 'running')
        this.put('test_runs', {
          ...run,
          status: 'interrupted',
          error: 'App restarted; test was not replayed.',
        })
  }
  snapshot() {
    return {
      workflowTemplates: this.list<WorkflowTemplate>('workflow_templates'),
      workflowRuns: this.list<WorkflowRun>('workflow_runs'),
      projects: this.list<Project>('projects'),
      conversations: this.list<Conversation>('conversations'),
      agents: this.list<AgentProfile>('agents'),
      settings: this.settings(),
      tasks: this.list<Task>('tasks'),
      workspaces: this.list<Workspace>('workspaces'),
      tests: this.list<TestRun>('test_runs').slice(-100),
      usage: this.list<UsageRecord>('usage_records'),
      reviews: this.list<Review>('reviews'),
      artifacts: this.list<Artifact>('artifacts'),
      dataPath: this.path,
    }
  }
  session(conversationId: string, agentId: string): Session | undefined {
    return this.get<Session>('sessions', `${conversationId}:${agentId}`)
  }
  activity(activity: Activity): void {
    this.put('activities', activity)
    this.db.exec(
      'DELETE FROM activities WHERE rowid < (SELECT COALESCE(max(rowid),0)-2000 FROM activities)',
    )
  }
  close(): void {
    this.db.close()
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = work()
      this.db.exec('COMMIT')
      return value
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  clearConversation(id: string): void {
    this.transaction(() => {
      const attachments = this.db
        .prepare('SELECT data FROM messages WHERE conversation_id=?')
        .all(id)
        .flatMap(
          (row) => (JSON.parse(String(row.data)) as Message).attachments?.map((a) => a.id) || [],
        )
      for (const table of [
        'messages',
        'sessions',
        'tasks',
        'activities',
        'usage_records',
        'reviews',
        'summaries',
        'workflow_runs',
      ])
        for (const row of this.list<{ id: string; conversationId?: string }>(table))
          if (row.conversationId === id) this.remove(table, row.id)
      for (const asset of new Set(attachments))
        this.db
          .prepare(
            "DELETE FROM attachments WHERE id=? AND NOT EXISTS(SELECT 1 FROM messages,json_each(json_extract(messages.data,'$.attachments')) AS a WHERE json_extract(a.value,'$.id')=?) AND NOT EXISTS(SELECT 1 FROM tasks,json_each(json_extract(tasks.data,'$.attachmentIds')) AS a WHERE a.value=?)",
          )
          .run(asset, asset, asset)
    })
  }
}
