import { describe, expect, it } from 'vitest'
import { boardColumn, buildTaskGraph, relatedIds } from '../src/renderer/lib/task-graph'
import type { Task } from '../src/shared/types'

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  projectId: 'p',
  conversationId: 'c',
  name: id,
  description: '',
  agentId: 'codex',
  status: 'pending',
  dependencies: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  correlationId: 'x',
  depth: 0,
  ...patch,
})
const layerOf = (graph: ReturnType<typeof buildTaskGraph>, id: string) =>
  graph.nodes.find((n) => n.task.id === id)?.layer

describe('task dependency graph', () => {
  it('layers tasks by their longest dependency chain', () => {
    const graph = buildTaskGraph([
      task('plan'),
      task('api', { dependencies: ['plan'] }),
      task('ui', { dependencies: ['plan'] }),
      task('e2e', { dependencies: ['api', 'ui'] }),
      task('docs', { dependencies: ['plan', 'e2e'] }),
    ])
    expect(layerOf(graph, 'plan')).toBe(0)
    expect(layerOf(graph, 'api')).toBe(1)
    expect(layerOf(graph, 'e2e')).toBe(2)
    expect(layerOf(graph, 'docs')).toBe(3)
    expect(graph.layers).toBe(4)
    expect(graph.width).toBe(2)
    expect(graph.edges).toHaveLength(6)
    expect(graph.unresolved).toBe(0)
  })

  it('collapses replaced attempts onto the attempt that superseded them', () => {
    const graph = buildTaskGraph([
      task('a1', { status: 'failed', supersededBy: 'a2' }),
      task('a2', { status: 'completed', retryOf: 'a1' }),
      task('b', { dependencies: ['a1'] }),
    ])
    expect(graph.nodes.map((n) => n.task.id)).toEqual(['a2', 'b'])
    expect(graph.edges).toEqual([{ from: 'a2', to: 'b' }])
    const all = buildTaskGraph(
      [
        task('a1', { status: 'failed', supersededBy: 'a2' }),
        task('a2', { retryOf: 'a1' }),
        task('b', { dependencies: ['a1'] }),
      ],
      true,
    )
    expect(all.edges).toEqual([{ from: 'a1', to: 'b' }])
  })

  it('keeps cyclic or missing restored records visible without looping', () => {
    const graph = buildTaskGraph([
      task('x', { dependencies: ['y'] }),
      task('y', { dependencies: ['x'] }),
      task('z', { dependencies: ['missing'] }),
    ])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes.every((n) => n.layer === 0)).toBe(true)
    expect(graph.edges).toHaveLength(0)
    expect(graph.unresolved).toBe(3)
  })

  it('highlights one chain of work and no unrelated branch', () => {
    const graph = buildTaskGraph([
      task('a'),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b'] }),
      task('other'),
    ])
    expect([...relatedIds(graph, 'b')].sort()).toEqual(['a', 'b', 'c'])
  })

  it('sorts statuses into the four board columns', () => {
    expect(boardColumn(task('q', { status: 'waiting_agent' }))).toBe('queued')
    expect(boardColumn(task('r', { status: 'reviewing' }))).toBe('running')
    expect(boardColumn(task('w', { status: 'waiting_user', waitReason: 'approval' }))).toBe(
      'attention',
    )
    expect(boardColumn(task('f', { status: 'failed' }))).toBe('attention')
    expect(boardColumn(task('p', { status: 'paused' }))).toBe('attention')
    expect(boardColumn(task('d', { status: 'cancelled' }))).toBe('done')
  })
})
