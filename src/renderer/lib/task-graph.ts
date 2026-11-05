import { latestAttempt } from '../../shared/tasks'
import type { Task } from '../../shared/types'

export type BoardColumn = 'queued' | 'running' | 'attention' | 'done'
export const boardColumns: BoardColumn[] = ['queued', 'running', 'attention', 'done']

// One column per question the user asks: is it waiting, moving, stuck on me, or finished?
export function boardColumn(task: Task): BoardColumn {
  switch (task.status) {
    case 'pending':
    case 'waiting_agent':
      return 'queued'
    case 'running':
    case 'reviewing':
      return 'running'
    case 'completed':
    case 'cancelled':
      return 'done'
    default:
      return 'attention'
  }
}

export interface GraphNode {
  task: Task
  layer: number
  order: number
  /** Dependencies resolved to the attempt that currently represents them. */
  parents: string[]
}
export interface GraphEdge {
  from: string
  to: string
}
export interface TaskGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layers: number
  width: number
  /** Dependencies that point outside this room or at missing/cyclic records. */
  unresolved: number
}

/**
 * Layered dependency graph. Replaced attempts collapse onto the attempt that superseded them
 * so the picture shows the work that still matters; malformed or cyclic restored records are
 * kept visible on layer 0 instead of being dropped or looping.
 */
export function buildTaskGraph(tasks: Task[], showReplaced = false): TaskGraph {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const visible = tasks.filter((t) => showReplaced || !t.supersededBy)
  const visibleIds = new Set(visible.map((t) => t.id))
  let unresolved = 0
  const resolve = (id: string): string | undefined => {
    const original = byId.get(id)
    if (!original) return undefined
    if (showReplaced) return original.id
    const latest = latestAttempt(original, byId)
    return latest && visibleIds.has(latest.id) ? latest.id : undefined
  }
  const parents = new Map<string, string[]>()
  for (const task of visible) {
    const resolved: string[] = []
    for (const dep of task.dependencies) {
      const id = resolve(dep)
      if (!id || id === task.id) unresolved++
      else if (!resolved.includes(id)) resolved.push(id)
    }
    parents.set(task.id, resolved)
  }
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return -1
    visiting.add(id)
    let value = 0
    for (const parent of parents.get(id) || []) {
      const d = depth(parent)
      if (d < 0) {
        visiting.delete(id)
        return -1
      }
      value = Math.max(value, d + 1)
    }
    visiting.delete(id)
    layer.set(id, value)
    return value
  }
  const cyclic = new Set<string>()
  for (const task of visible) if (depth(task.id) < 0) cyclic.add(task.id)
  for (const id of cyclic) {
    unresolved += parents.get(id)?.length || 0
    parents.set(id, [])
    layer.set(id, 0)
  }
  // Re-run for nodes whose depth was abandoned because an ancestor turned out cyclic.
  for (const task of visible) if (!layer.has(task.id)) depth(task.id)
  const rows: string[][] = []
  for (const task of visible) {
    const l = Math.max(0, layer.get(task.id) ?? 0)
    ;(rows[l] ||= []).push(task.id)
  }
  // One barycenter pass keeps children under their parents and reduces edge crossings.
  const position = new Map<string, number>()
  rows.forEach((row, l) => {
    if (l > 0)
      row.sort((a, b) => {
        const center = (id: string) => {
          const ps = (parents.get(id) || []).map((p) => position.get(p) ?? 0)
          return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : Number.MAX_SAFE_INTEGER
        }
        return center(a) - center(b)
      })
    row.forEach((id, i) => position.set(id, i))
  })
  const nodes: GraphNode[] = visible.map((task) => ({
    task,
    layer: Math.max(0, layer.get(task.id) ?? 0),
    order: position.get(task.id) ?? 0,
    parents: parents.get(task.id) || [],
  }))
  const edges = nodes.flatMap((n) => n.parents.map((from) => ({ from, to: n.task.id })))
  return {
    nodes,
    edges,
    layers: rows.length,
    width: Math.max(0, ...rows.map((r) => r.length)),
    unresolved,
  }
}

/** Every ancestor and descendant of a node, for highlighting one chain of work. */
export function relatedIds(graph: TaskGraph, id: string): Set<string> {
  const related = new Set([id])
  const walk = (start: string, next: (id: string) => string[]) => {
    const stack = [start]
    while (stack.length) {
      for (const other of next(stack.pop()!))
        if (!related.has(other)) {
          related.add(other)
          stack.push(other)
        }
    }
  }
  walk(id, (x) => graph.edges.filter((e) => e.to === x).map((e) => e.from))
  walk(id, (x) => graph.edges.filter((e) => e.from === x).map((e) => e.to))
  return related
}
