import type { Review, Task } from './types'
export function finalizedReview(review: Review, task?: Task): boolean {
  return (
    review.status === 'submitted' &&
    !!review.verdict &&
    !!review.taskId &&
    task?.id === review.taskId &&
    task.status === 'completed'
  )
}
// Store.list supplies creation order. A newer failed/pending/negative re-review
// supersedes an old approval for the same revision and chosen reviewer.
export function reviewApproved(
  reviews: Review[],
  tasks: Task[],
  sourceId: string,
  revision: string,
  reviewerId: string,
): boolean {
  const latest = reviews
    .filter(
      (r) =>
        r.sourceWorkspaceId === sourceId && r.revision === revision && r.reviewerId === reviewerId,
    )
    .at(-1)
  return (
    !!latest &&
    latest.verdict === 'approve' &&
    finalizedReview(
      latest,
      tasks.find((t) => t.id === latest.taskId),
    )
  )
}
