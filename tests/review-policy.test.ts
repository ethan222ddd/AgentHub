import { expect, it } from 'vitest'
import { reviewApproved } from '../src/shared/reviews'
import type { Review, Task } from '../src/shared/types'
const review = {
  id: 'r1',
  sourceWorkspaceId: 'source',
  revision: 'commit1',
  reviewerId: 'qa',
  taskId: 't1',
  verdict: 'approve',
  status: 'submitted',
} as Review
const task = { id: 't1', status: 'completed' } as Task
it('requires the designated reviewer, exact source/revision and fully completed native task', () => {
  expect(reviewApproved([review], [task], 'source', 'commit1', 'qa')).toBe(true)
  expect(reviewApproved([review], [task], 'source', 'commit1', 'other')).toBe(false)
  expect(reviewApproved([review], [task], 'source', 'commit2', 'qa')).toBe(false)
  expect(
    reviewApproved([review], [{ ...task, status: 'running' }], 'source', 'commit1', 'qa'),
  ).toBe(false)
  expect(reviewApproved([review], [], 'source', 'commit1', 'qa')).toBe(false)
})
it.each(['pending', 'failed', 'changes_requested'])(
  'a later %s re-review supersedes an earlier approval',
  (state) => {
    const newer = {
      ...review,
      id: 'r2',
      status: state === 'changes_requested' ? 'submitted' : state,
      verdict: state === 'changes_requested' ? state : undefined,
    } as Review
    expect(reviewApproved([review, newer], [task], 'source', 'commit1', 'qa')).toBe(false)
  },
)
