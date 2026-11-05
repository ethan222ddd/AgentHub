import type { Review, Task, WorkflowRun, WorkflowStep, WorkflowTemplate } from './types'
import { finalizedReview } from './reviews'

export function workflowHandoffReady(
  run: WorkflowRun,
  stepId: string,
  reviews: Review[],
  tasks: Task[],
): boolean {
  const step = run.template.steps.find((s) => s.id === stepId),
    state = run.steps[stepId]
  if (!step || state?.status !== 'completed') return false
  if (step.kind !== 'review') return true
  const review = reviews.find((r) => r.id === state.reviewId)
  return (
    !!review &&
    review.verdict === 'approve' &&
    review.revision === run.steps[step.sourceStepId]?.revision &&
    finalizedReview(
      review,
      tasks.find((t) => t.id === review.taskId),
    )
  )
}

const step = (
  id: string,
  name: string,
  roleId: string,
  patch: Partial<WorkflowStep> = {},
): WorkflowStep => ({
  id,
  name,
  roleId,
  kind: 'task',
  instructions: '',
  dependsOn: [],
  artifactFrom: [],
  publishArtifact: false,
  sourceStepId: '',
  ...patch,
})
export const builtinWorkflows: WorkflowTemplate[] = [
  {
    id: 'builtin-implement-review',
    name: '實作 → 審查 → 回修 → 測試整合',
    description: 'Codex 實作，Claude 審查；退件最多回修兩次，通過後測試確切整合快照。',
    maxFixes: 2,
    roles: [
      { id: 'developer', name: '實作者', provider: 'codex' },
      { id: 'reviewer', name: '審查者', provider: 'claude' },
    ],
    steps: [
      step('implement', '實作', 'developer', {
        instructions: 'Implement the requested change with meaningful tests.',
      }),
      step('review', '審查', 'reviewer', {
        kind: 'review',
        dependsOn: ['implement'],
        sourceStepId: 'implement',
      }),
      step('integrate', '測試與整合', 'developer', {
        kind: 'integrate',
        dependsOn: ['review'],
        sourceStepId: 'implement',
      }),
    ],
  },
  {
    id: 'builtin-contract-parallel',
    name: '規格契約 → 平行實作 → 交叉審查',
    description:
      'Antigravity 發布不可變契約，Codex／Claude 依契約平行開發、交叉審查，再逐份測試整合。',
    maxFixes: 2,
    roles: [
      { id: 'architect', name: '契約設計者', provider: 'antigravity' },
      { id: 'backend', name: '後端實作者', provider: 'codex' },
      { id: 'frontend', name: '前端實作者', provider: 'claude' },
    ],
    steps: [
      step('contract', '發布規格契約', 'architect', {
        publishArtifact: true,
        instructions:
          'Write a concrete API/specification contract in workspace files and call publish_artifact with those paths. The host safely checkpoints this configured contract step before publishing; no shell/Git command is needed. This stage only publishes a contract; it does not integrate its worktree.',
      }),
      step('backend', '後端實作', 'backend', {
        dependsOn: ['contract'],
        artifactFrom: ['contract'],
        instructions:
          'Implement the backend against the supplied immutable contract. Read the artifacts with read_artifact. Materialize required contract files in your own worktree; worktrees do not synchronize automatically.',
      }),
      step('frontend', '前端實作', 'frontend', {
        dependsOn: ['contract'],
        artifactFrom: ['contract'],
        instructions:
          'Implement the frontend against the supplied immutable contract. Read the artifacts with read_artifact. Materialize required contract files in your own worktree; worktrees do not synchronize automatically.',
      }),
      step('review-backend', '前端成員審查後端', 'frontend', {
        kind: 'review',
        dependsOn: ['backend', 'frontend'],
        sourceStepId: 'backend',
      }),
      step('review-frontend', '後端成員審查前端', 'backend', {
        kind: 'review',
        dependsOn: ['backend', 'frontend'],
        sourceStepId: 'frontend',
      }),
      step('integrate-backend', '測試整合後端', 'backend', {
        kind: 'integrate',
        dependsOn: ['review-backend', 'review-frontend'],
        sourceStepId: 'backend',
      }),
      step('integrate-frontend', '測試整合前端', 'frontend', {
        kind: 'integrate',
        dependsOn: ['review-backend', 'review-frontend', 'integrate-backend'],
        sourceStepId: 'frontend',
      }),
    ],
  },
]

// Shared structural rules: no executable commands, arbitrary conditions or natural-language gates.
export function workflowIssues(template: WorkflowTemplate): string[] {
  const errors: string[] = []
  const roles = new Set(template.roles.map((r) => r.id)),
    steps = new Map(template.steps.map((s) => [s.id, s]))
  if (roles.size !== template.roles.length || steps.size !== template.steps.length)
    errors.push('角色或步驟 ID 重複 / Duplicate role or step ID')
  const visiting = new Set<string>(),
    visited = new Set<string>()
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(id)) return seen
    seen.add(id)
    for (const dependency of steps.get(id)?.dependsOn || []) ancestors(dependency, seen)
    return seen
  }
  const visit = (id: string) => {
    if (visiting.has(id)) {
      errors.push('步驟依賴形成循環 / Cyclic dependencies')
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of steps.get(id)?.dependsOn || [])
      if (steps.has(dependency)) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const s of template.steps) {
    visit(s.id)
    if (!roles.has(s.roleId)) errors.push(`${s.name}: 角色不存在 / Unknown role`)
    if (s.kind === 'integrate' && s.instructions.trim())
      errors.push(
        `${s.name}: 整合使用既有測試與安全政策，不執行額外自然語言指示 / Integration uses existing test and safety gates`,
      )
    if (
      new Set(s.dependsOn).size !== s.dependsOn.length ||
      s.dependsOn.some((d) => !steps.has(d) || d === s.id)
    )
      errors.push(`${s.name}: 依賴無效 / Invalid dependency`)
    const prior = ancestors(s.id)
    prior.delete(s.id)
    if (s.artifactFrom.some((d) => !prior.has(d) || !steps.get(d)?.publishArtifact))
      errors.push(
        `${s.name}: 契約來源必須是上游發布產物步驟 / Artifact source must publish upstream`,
      )
    if (s.kind !== 'task') {
      const source = steps.get(s.sourceStepId)
      if (!source || source.kind !== 'task' || !prior.has(source.id))
        errors.push(`${s.name}: 必須指定上游實作步驟 / Select an upstream task`)
      if (s.kind === 'integrate' && source && s.roleId !== source.roleId)
        errors.push(
          `${s.name}: Host 整合使用來源實作者的工作區 / Integration role must match its source task`,
        )
      if (
        s.kind === 'integrate' &&
        !template.steps.some(
          (r) => r.kind === 'review' && r.sourceStepId === s.sourceStepId && prior.has(r.id),
        )
      )
        errors.push(`${s.name}: 整合必須依賴同來源審查 / Integration needs a matching review gate`)
    }
    if (s.kind !== 'integrate' && [...prior].some((id) => steps.get(id)?.kind === 'integrate'))
      errors.push(`${s.name}: 整合後不得再修改或審查 / Integration must be the final phase`)
    if (s.kind !== 'task' && (s.publishArtifact || s.artifactFrom.length))
      errors.push(`${s.name}: 只有實作步驟可發布或接收產物 / Artifact options require a task step`)
  }
  return [...new Set(errors)]
}
