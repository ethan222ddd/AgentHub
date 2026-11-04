import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/database/store'
import { WorkspaceManager, git } from '../src/main/git/workspaces'
import { Orchestrator } from '../src/main/orchestrator/orchestrator'
import { CodexAdapter } from '../src/main/agents/codex'
import { ClaudeAdapter } from '../src/main/agents/claude'
import { AntigravityAdapter } from '../src/main/agents/antigravity'
import type { AgentAdapter } from '../src/main/agents/adapter'
import type { Task } from '../src/shared/types'
const base = resolve('.local/collaboration', randomUUID())
const root = join(base, 'repository')
await mkdir(root, { recursive: true })
await git(root, ['init'])
await writeFile(join(root, 'README.md'), '# AgentHub real collaboration verification\n')
await git(root, ['add', '.'])
await git(root, [
  '-c',
  'user.name=AgentHub Test',
  '-c',
  'user.email=test@local.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-m',
  'Initial verification repository',
])
const store = new Store(join(base, 'state.sqlite'))
const project = store.addProject(root, 'Live team')
const c = store.snapshot().conversations[0]
store.put('conversations', { ...c, mode: 'collaborative' })
store.put('settings', {
  ...store.settings(),
  id: 'general',
  maxTurns: 8,
  maxDepth: 4,
  maxUsageTokens: 500000,
  timeoutMs: 240000,
})
const adapters = new Map<string, AgentAdapter>([
  ['codex', new CodexAdapter()],
  ['claude', new ClaudeAdapter(() => undefined)],
  ['antigravity', new AntigravityAdapter()],
])
const manager = new WorkspaceManager(store, join(base, 'workspaces'))
const spaces = await manager.prepare(project, false)
const o = new Orchestrator(store, adapters, (event) => {
  if (event.type === 'approvals')
    for (const a of event.approvals) {
      // This explicit live harness approves only file tools inside its disposable worktrees.
      const allow = [
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'Antigravity scoped workspace access',
        'item/fileChange/requestApproval',
      ].includes(a.tool)
      setTimeout(() => o.resolveApproval(a.id, allow), 0)
    }
})
o.setWorkspaceManager(manager)
try {
  o.send(
    c.id,
    `This is a real cross-provider collaboration acceptance test. Use agenthub_collaborate request_response to agent claude. Content must instruct Claude to: (1) Write claude-proof.txt containing CLAUDE_TEAM_PROOF with its real Write tool in its own workspace; (2) call send_message to codex with content CLAUDE_REPLY_RECEIVED; (3) call request_response to antigravity with content: "Write agy-proof.txt containing AGY_TEAM_PROOF using your native file tool in your workspace. Then send_message to codex with content AGY_REPLY_RECEIVED using your structured requests envelope. No commands, no other delegation.". Do not write code yourself, run commands or invoke any subagents. Finish with HANDOFF_SENT. If later shared context contains the replies, acknowledge the exact reply markers, and do not delegate again.`,
    ['codex'],
  )
  const start = Date.now()
  while (Date.now() - start < 300000) {
    const tasks = store.list<Task>('tasks')
    if (tasks.some((t) => t.status === 'failed' || t.status === 'cancelled'))
      throw new Error(
        tasks
          .filter((t) => t.status === 'failed' || t.status === 'cancelled')
          .map((t) => t.error)
          .join('\n'),
      )
    if (tasks.length >= 5 && tasks.every((t) => t.status === 'completed')) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const tasks = store.list<Task>('tasks')
  const messages = store.messages(c.id)
  if (tasks.length < 5 || tasks.some((t) => t.status !== 'completed'))
    throw new Error('Collaboration did not complete five real turns')
  for (const [agent, file, proof] of [
    ['claude', 'claude-proof.txt', 'CLAUDE_TEAM_PROOF'],
    ['antigravity', 'agy-proof.txt', 'AGY_TEAM_PROOF'],
  ]) {
    const workspace = spaces.find((w) => w.agentId === agent)!
    if (!(await readFile(join(workspace.path, file), 'utf8')).includes(proof))
      throw new Error(`Missing actual ${agent} file edit`)
  }
  if (
    !messages.some(
      (m) =>
        m.senderId === 'claude' &&
        m.type === 'collaboration' &&
        m.content.includes('CLAUDE_REPLY_RECEIVED'),
    ) ||
    !messages.some(
      (m) =>
        m.senderId === 'antigravity' &&
        m.type === 'collaboration' &&
        m.content.includes('AGY_REPLY_RECEIVED'),
    )
  )
    throw new Error('Native reply routing evidence missing')
  if (
    !messages.some(
      (m) =>
        m.senderId === 'codex' && m.type === 'agent' && m.content.includes('AGY_REPLY_RECEIVED'),
    )
  )
    throw new Error('Codex did not receive and acknowledge Antigravity reply')
  await writeFile(
    resolve('.local/collaboration-report.json'),
    JSON.stringify(
      { base, passed: true, workspaces: spaces, tasks, messages, usage: store.snapshot().usage },
      null,
      2,
    ),
  )
  console.log(
    `PASS: ${tasks.length} real native turns, Codex → Claude → Antigravity → Codex, isolated worktrees and actual file edits. Evidence: .local/collaboration-report.json`,
  )
} finally {
  await o.dispose()
  store.close()
}
