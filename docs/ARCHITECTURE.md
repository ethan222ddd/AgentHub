# AgentHub architecture — v0.7.0

## Automatic project lifecycle

AutomaticProjects prepares safe initial history, allocates/reuses agent worktrees on demand, synchronizes compatible primary revisions and serializes tested integration back into the user-selected folder. Native turns remain parallel with per-agent locks. Safe snapshots use an alternate index, content/blob hashes and branch/index checks, preserve original staged entries, and refuse unknown/sensitive inputs or executable Git filters/merge drivers. Git command arguments and environment are host-controlled.

Migration 7 records workspace operations and separates completed native turns from pending integration. Restart/retry never reruns an already-finished agent to repair a merge. Automatic executable tests use official Codex command/exec sandboxing with no model turn; unsupported sandboxes fail closed. Explicitly approved manual Host tests remain separate. Static basic checks are labelled as nonfunctional checks. See AUTOMATIC_PROJECTS and USER_GUIDE.

## Process boundary

Electron Main owns SQLite, native dialogs, credentials, Git, filesystem, test runners and agent processes. Renderer is sandboxed with Node disabled and context isolation enabled. Preload exposes one validated request bridge, event subscriptions and a dropped-file helper using Electron webUtils; all resulting paths are revalidated in Main. IPC requires the exact owning WebContents/main frame and expected file/dev origin. Navigation, window.open, webviews and generic permissions are denied.

Main startup applies only an explicitly staged restore, opens versioned SQLite, marks interrupted tasks/tests for inspection and constructs runtime registry, Orchestrator, WorkspaceManager and TestRunner. Startup errors are visible. Restart never executes interrupted work automatically.

## Native adapters

The small adapter interface is detect(profile), run(context), dispose. RunContext carries the assigned workspace, independent native session, abort, public deltas, normalized activity, usage, approval and validated collaboration callback. Provider-specific wire formats stay out of Renderer.

Codex uses local App Server JSON-RPC with ID/request mapping, NDJSON framing, timeout, stderr separation and native process-tree cleanup. npm shims are metadata used to resolve vendor codex.exe, never shell commands. Experimental dynamic tools implement agenthub_collaborate. Live native web search requires turn approval; extra network-only grants use native turn scope and never copy filesystem escalation.

Claude native mode launches the unmodified official CLI under its own login. Version 2.1.295+ is needed for HTTP hook onFailure:block. --restricted confines native tools; an ephemeral 127.0.0.1 HTTP MCP/hook bridge requires a random bearer passed via an environment reference. It rejects Origin requests and canceled turns. Host checks canonical file paths and asks permission before native actions. The separate official SDK/API adapter uses a local configured API key and SDK MCP/PreToolUse hooks. Neither mode extracts subscription tokens.

Antigravity launches the native agy with sandbox, stdin user events, NDJSON and JSON Schema. A per-turn approved cwd-relative file rule avoids the observed Windows absolute-rule mismatch. Commands are denied unless listed exactly and approved for this turn, with regex metacharacters escaped and the expression anchored; unsandboxed execution is denied. Review additionally denies all commands and writes. Native denial always fails; recoverable tool errors remain visible while Runtime may recover. Result envelopes are schema-validated before public text/routing. Process-per-turn + native conversation resume avoids competing writes to persistent stdin. Models come from native discovery.

## Shared context and scheduler

Account quota metadata is queried only in Main through official Codex rateLimits/read and Claude control/get_usage (skip_behaviors). QuotaService coalesces reads by provider/auth mode and caches normalized allowlisted fields. Renderer refreshes in the foreground, after task completion and on demand; unknown/stale/error states remain explicit. API billing is separate from native subscriptions. AGY headless quota and inline host read-result return are currently unsupported, with visible limitations rather than fabricated values or discarded reads. See QUOTAS.

Conversation runtime overrides store per-agent model/effort. Enqueue snapshots them into each task; runtime adapters receive real native parameters. Codex capabilities come from model/list, Claude native catalog comes from control initialization without sending a model turn (account metadata is discarded), and Antigravity comes from agy models. Runtime defaults are reset with a fresh native session when needed to avoid sticky settings; shared chat remains available.

Schema 6 adds FTS5 with English/CJK search terms, pins and prepared-context receipts. Search and source reads are host-scoped to one room. Context uses explicit 24k character budgets and attributed excerpts with no duplicate source in one delivery. Completion delivery sequences avoid skipping messages created earlier but completed after another agent's cursor. Streaming deltas are not indexed repeatedly; task side effects are never replayed on migration. See MODELS_AND_CONTEXT for limits and benchmark scope.

Agent profiles are not limited to three. Each project may choose its own team and role/instruction overrides. The host binds sender/task/session identity; agents cannot provide a privileged sender ID. Native private session history and shared timeline remain separate.

Twelve schema-validated operations cover collaboration, versioned artifacts/reviews and read-only search_context/read_context. Codex dynamic tools, Claude MCP and AGY structured result requests all call the same host callback. A receipt means queued, not finished. request_response is asynchronous to avoid cross-agent wait deadlocks.

One lock per project/profile protects its assigned worktree across rooms. Independent agents run in parallel. Persisted dependency tasks wait until prerequisites complete; failed dependencies create visible failure messages. There is no automatic retry of side effects. SHA-256 request IDs deduplicate delivery across restart. Turn/depth/fanout/concurrency/time limits, user Stop and reported token/cost budgets bound autonomous work. Manual activation requires approval; supervisor mode restricts member delegation to the supervisor.

Shared context uses completion-sequence cursors, a window of at most 60 recent messages and a total 24k-character budget. Older sources come from indexed full-text/CJK queries and explicit pins, with IDs, timestamps and truncation metadata. It is attributed extraction, not model-generated semantic summarization. Repository and other-agent text remain untrusted. Each turn includes its exact absolute workspace to discourage mistaken cross-worktree reads.

## Versioned coding and integration

Worktrees start from committed HEAD. Initial Git setup is explicit and stages only reviewed files whose bytes still match the preview. Checkpoint is explicit. Artifacts refer to exact Git objects, bounded text paths/bytes and SHA-256, never implicit filesystem copying. Sensitive/traversal paths are rejected.

Review creates a detached read-only snapshot at the source commit, using an independent native session. Structured verdict/comments reference that revision. Any snapshot mutation invalidates the review. Fix requests reject stale source HEAD; user can resolve comments and request a new review. Host test execution is distinct from static review.

Merge preview requires clean source/target, computes merge-tree, creates an immutable integration commit and detached worktree. TestRunner executes user-approved fixed npm/Python/.NET/Rust/Go entry points without joining chat text into a shell. It records revision, logs/status/duration and invalidates success if code changes. Dependency installation uses committed npm lockfile and --ignore-scripts. Merge requires a passing test on this exact snapshot, then rechecks both heads, target branch, clean trees and computed final tree. Reverse sync uses the same workflow. Revert uses a new commit and identical preview/test gate, never reset. Persisted preview metadata survives restart; explicit cleanup preserves dirty snapshots and artifact sources.

## Persistence, recovery and performance

SQLite has six migrations and a host-only table allowlist. Migration 5 records scheduler semantics so earlier apps refuse unsafe downgrade. Projects/conversations/messages have relational ownership; attachments store original bytes and hashes in a private BLOB table; other entities retain typed JSON payloads. Restore validates database integrity and schema, copies a consistent preview, takes a safety backup and schedules fixed filenames inside the profile. On restart the previous DB/WAL/SHM are preserved before replacement. Native session files and worktrees are not included in SQLite backups.

Retries/reassignments create new attempt IDs linked by retryOf/supersededBy in an atomic savepoint. Original messages, errors and usage retain their IDs. Queued dependents follow validated same-room attempt chains; invalid/missing/failed dependencies block without executing. Waiting dependencies/workspaces and active approvals have distinct statuses. Restart converts unconfirmed queued/active work to manual recovery, including dependents; successful upstream retries never bypass that restart gate. Other-room approvals expose a navigation notice. See TASK_RECOVERY for lifecycle and actual live verification.

Only read tools may remember a project/profile/root-scoped grant. Shell grants are not remembered. Claude API credentials use OS encryption outside SQLite. JSONL diagnostics use an explicit metadata allowlist and rotation; no prompt/result/token payload is logged there. Tool output is bounded and best-effort redacted.

Public deltas batch at 40ms, persistence at 250ms. SQLite pages contain 80 messages and Renderer virtualizes long histories. Activity/test logs are bounded. Expensive Mermaid rendering is lazy and strict. No private model reasoning is displayed. Known limits and validation coverage are tracked in IMPLEMENTATION_STATUS and VALIDATION.
