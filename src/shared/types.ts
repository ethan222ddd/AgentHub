export type Provider = 'codex' | 'claude' | 'antigravity'
export type Mode = 'manual' | 'collaborative' | 'supervisor'
/** A project-level decision. Accepted ones are given to every task in the project. */
export interface Decision {
  id: string
  title: string
  detail: string
  status: 'proposed' | 'accepted' | 'rejected'
  /** 'user' or the proposing agent's id. */
  proposedBy: string
  taskId?: string
  createdAt: string
  decidedAt?: string
}
export interface Project {
  decisions?: Decision[]
  autoManaged?: boolean
  setup?: {
    state: 'preparing' | 'ready' | 'attention' | 'error'
    detail: string
    excluded?: string[]
  }
  agentIds?: string[]
  agentOverrides?: Record<string, { role: string; instructions: string }>
  id: string
  name: string
  path: string
  createdAt: string
}
export interface Conversation {
  runtimeOverrides?: Record<string, RuntimeSelection>
  id: string
  projectId: string
  name: string
  mode: Mode
  supervisorId: string
  createdAt: string
  stopped: boolean
}
export interface AgentProfile {
  reasoningEffort?: string
  commandAllowlist?: string[]
  networkAllowlist?: string[]
  authMode?: 'native' | 'api'
  id: string
  name: string
  provider: Provider
  role: string
  instructions: string
  model: string
  enabled: boolean
}
export interface Message {
  attachments?: Attachment[]
  id: string
  projectId: string
  conversationId: string
  senderId: string
  recipientIds: string[]
  content: string
  type: 'user' | 'agent' | 'system' | 'collaboration'
  timestamp: string
  taskId: string | null
  correlationId: string
  delivery: 'sent' | 'streaming' | 'completed' | 'failed' | 'cancelled'
}
export interface Session {
  runtime?: RuntimeSelection
  providerTokens?: number
  providerInputTokens?: number
  providerOutputTokens?: number
  id: string
  conversationId: string
  agentId: string
  nativeId: string
  workspace: string
  cursor: number
}
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_user'
  | 'waiting_agent'
  | 'blocked'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
/** Plan-first tasks pause after a read-only planning turn until the user approves. */
export interface TaskPlan {
  status: 'drafting' | 'awaiting' | 'approved' | 'revising'
  content: string
  files: string[]
  steps: string[]
  risks: string[]
  verification: string
  /** False when the agent answered in prose instead of the structured submit_plan tool. */
  structured: boolean
  feedback?: string
  revisions: number
  submittedAt?: string
  approvedAt?: string
}
/** What an agent reports when it finishes: the reviewer and the next agent start here. */
export interface TaskHandoff {
  summary: string
  changed: string[]
  tested: string[]
  untested: string[]
  questions: string[]
  next: string[]
  submittedAt: string
}
export interface Task {
  handoff?: TaskHandoff
  planFirst?: boolean
  plan?: TaskPlan
  workflow?: { runId: string; stepId: string }
  nativeTurns?: number
  integration?: {
    status: 'checking' | 'staged' | 'merged' | 'unchanged' | 'attention'
    detail: string
    revision?: string
    previewId?: string
  }
  runtime?: RuntimeSelection
  retryOf?: string
  supersededBy?: string
  waitReason?: 'dependencies' | 'workspace_lock' | 'approval' | 'recovery' | 'integration' | 'plan'
  blockedBy?: string[]
  failureKind?: 'runtime' | 'timeout' | 'cancelled' | 'interrupted'
  startedAt?: string
  attachmentIds?: string[]
  workspaceId?: string
  kind?: 'coding' | 'review'
  reviewId?: string
  id: string
  projectId: string
  conversationId: string
  name: string
  description: string
  agentId: string
  status: TaskStatus
  dependencies: string[]
  createdAt: string
  completedAt?: string
  result?: string
  error?: string
  correlationId: string
  depth: number
  workspace?: string
  revision?: string
}
export interface Activity {
  id: string
  agentId: string
  sessionId: string
  taskId: string
  turnId: string
  conversationId: string
  type: string
  detail: string
  timestamp: string
}
export interface Approval {
  /** When the host started waiting; optional because older events lack it. */
  requestedAt?: string
  canRemember?: boolean
  id: string
  agentId: string
  taskId: string
  conversationId: string
  tool: string
  detail: string
  risk: string
}
export interface Detection {
  reasoningEfforts?: string[]
  agentId?: string
  provider: Provider
  installed: boolean
  version: string
  authenticated: boolean | null
  detail: string
  models: {
    id: string
    name: string
    reasoningEfforts?: string[]
    defaultReasoningEffort?: string
    isDefault?: boolean
  }[]
}
export interface RuntimeSelection {
  model: string
  reasoningEffort: string
}
export interface Workspace {
  syncedHead?: string
  kind?: 'agent' | 'integration' | 'review'
  id: string
  projectId: string
  agentId: string
  path: string
  branch: string
}
export interface TestRun {
  execution?: 'host-approved' | 'native-sandbox' | 'static'
  kind?: 'test' | 'build' | 'preparation'
  id: string
  projectId: string
  workspaceId: string
  revision: string
  name: string
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'interrupted'
  startedAt: string
  durationMs: number
  logs: string
  error?: string
}
export interface Settings {
  notifications: 'all' | 'approvals' | 'off'
  maxUsageTokens: number
  maxCostUsd: number
  defaultMode: Mode
  defaultProjectDirectory: string
  startupBehavior: 'restore' | 'empty'
  automaticReview: boolean
  reviewerId: string
  theme: 'dark' | 'light' | 'system'
  language: 'zh-TW' | 'en'
  maxTurns: number
  maxConcurrent: number
  maxDepth: number
  maxFanout: number
  timeoutMs: number
  supervisorId: string
}
/** One file changed, but not yet integrated, in two or more agents' workspaces. */
export interface FileOverlap {
  path: string
  agents: { agentId: string; workspaceId: string; uncommitted: boolean }[]
}
export interface ProjectOverlaps {
  files: FileOverlap[]
  scannedAt: string
  /** Workspaces that could not be inspected (missing path, Git error). */
  skipped: number
}
export interface Snapshot {
  overlaps?: Record<string, ProjectOverlaps>
  workflowTemplates: WorkflowTemplate[]
  workflowRuns: WorkflowRun[]
  usage: UsageRecord[]
  reviews: Review[]
  artifacts: Artifact[]
  projects: Project[]
  conversations: Conversation[]
  agents: AgentProfile[]
  settings: Settings
  tasks: Task[]
  workspaces: Workspace[]
  tests: TestRun[]
  dataPath: string
  diagnosticsPath?: string
}
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  roles: { id: string; name: string; provider: Provider }[]
  steps: WorkflowStep[]
  maxFixes: number
}
export interface WorkflowStep {
  id: string
  name: string
  kind: 'task' | 'review' | 'integrate'
  roleId: string
  instructions: string
  dependsOn: string[]
  artifactFrom: string[]
  publishArtifact: boolean
  sourceStepId: string
}
export interface WorkflowRun {
  id: string
  projectId: string
  conversationId: string
  template: WorkflowTemplate
  bindings: Record<string, string>
  requirement: string
  status: 'running' | 'paused' | 'attention' | 'completed' | 'cancelled'
  createdAt: string
  error?: string
  steps: Record<
    string,
    {
      status: 'pending' | 'running' | 'completed'
      taskId?: string
      reviewId?: string
      revision?: string
      fixes: number
    }
  >
}
export interface UsageRecord {
  id: string
  taskId: string
  conversationId: string
  agentId: string
  inputTokens: number
  outputTokens: number
  costUsd?: number
  source: string
  timestamp: string
}
export interface ReviewComment {
  id: string
  file: string
  line: number
  severity: 'info' | 'warning' | 'error'
  content: string
  resolved: boolean
}
export interface Review {
  id: string
  projectId: string
  conversationId: string
  workspaceId: string
  sourceWorkspaceId: string
  revision: string
  reviewerId: string
  ownerId: string
  taskId?: string
  status: 'pending' | 'running' | 'submitted' | 'failed'
  verdict?: 'approve' | 'changes_requested'
  summary: string
  comments: ReviewComment[]
  createdAt: string
}
export interface Artifact {
  id: string
  projectId: string
  taskId: string
  agentId: string
  workspaceId: string
  revision: string
  name: string
  files: { path: string; sha256: string; bytes: number }[]
  createdAt: string
}
export type AppEvent =
  | { type: 'navigate'; conversationId: string }
  | { type: 'notification-error'; message: string }
  | { type: 'changed' }
  | { type: 'delta'; messageId: string; conversationId: string; delta: string }
  | { type: 'activity'; activity: Activity }
  | { type: 'approvals'; approvals: Approval[] }
export interface Bridge {
  attachFiles(projectId: string, files: File[]): Promise<Attachment[]>
  invoke<T = unknown>(request: Record<string, unknown>): Promise<T>
  subscribe(callback: (event: AppEvent) => void): () => void
}
export interface Attachment {
  id: string
  projectId: string
  name: string
  kind: 'image' | 'text'
  mime: string
  bytes: number
  sha256: string
  createdAt: string
  width?: number
  height?: number
  preview?: string
  content?: string
}
export interface RuntimeImage {
  id: string
  name: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
}
export interface ProcessInspection {
  ownerPid: number
  appGuardPid?: number
  closing: boolean
  processes: {
    pid?: number
    executable: string
    taskId?: string
    agentId?: string
    stage?: string
    stopping: boolean
    ownership: 'windows-job' | 'direct-child'
  }[]
}
export interface ContextSource {
  attachments?: { id: string; name: string; kind: string }[]
  messageId: string
  senderId: string
  timestamp: string
  kind: 'pinned' | 'retrieved' | 'summary' | 'recent'
  excerpt: string
  truncated: boolean
}
export interface ContextPlan {
  content: string
  cursor: number
  sources: ContextSource[]
  characters: number
  omittedRecent: number
  fingerprint: string
}
export interface ContextReceipt extends ContextPlan {
  id: string
  taskId: string
  conversationId: string
  agentId: string
  requestedModel: string
  cursorBefore: number
  createdAt: string
}
