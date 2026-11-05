import { Columns3, ExternalLink, Network } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentProfile, Task } from '../../../shared/types'
import { Button } from '../../components/ui'
import { seriesSlot } from '../../lib/series'
import {
  boardColumn,
  boardColumns,
  buildTaskGraph,
  relatedIds,
  type BoardColumn,
} from '../../lib/task-graph'
import { TaskStatusChip, statusTone } from './TaskStatus'

const NODE_W = 184,
  NODE_H = 66,
  GAP_X = 18,
  GAP_Y = 46,
  PAD = 14

interface Props {
  tasks: Task[]
  agents: AgentProfile[]
  allAgents: AgentProfile[]
  en: boolean
  openTask(id: string): void
}
export function TaskMap({ tasks, agents, allAgents, en, openTask }: Props) {
  const text = (zh: string, eng: string) => (en ? eng : zh)
  const [view, setView] = useState<'graph' | 'board'>(() => {
    try {
      return localStorage.getItem('agenthub.taskView') === 'board' ? 'board' : 'graph'
    } catch {
      return 'graph'
    }
  })
  const [agentFilter, setAgentFilter] = useState('')
  const [showReplaced, setShowReplaced] = useState(false)
  const [selected, setSelected] = useState('')
  const graph = useMemo(() => buildTaskGraph(tasks, showReplaced), [tasks, showReplaced])
  const related = useMemo(
    () =>
      selected && graph.nodes.some((n) => n.task.id === selected)
        ? relatedIds(graph, selected)
        : undefined,
    [graph, selected],
  )
  const choose = (next: 'graph' | 'board') => {
    setView(next)
    try {
      localStorage.setItem('agenthub.taskView', next)
    } catch {
      // Preference only; the view still switches without storage.
    }
  }
  const agentName = (id: string) => allAgents.find((a) => a.id === id)?.name || id
  const matches = (task: Task) => !agentFilter || task.agentId === agentFilter
  const selectedTask = tasks.find((t) => t.id === selected)
  const columnTitle: Record<BoardColumn, string> = {
    queued: text('排程與等待', 'Queued'),
    running: text('執行中', 'Running'),
    attention: text('需要你處理', 'Needs you'),
    done: text('已結束', 'Done'),
  }
  const counts = boardColumns.map(
    (c) => graph.nodes.filter((n) => boardColumn(n.task) === c && matches(n.task)).length,
  )

  const rowSizes: number[] = []
  for (const n of graph.nodes) rowSizes[n.layer] = (rowSizes[n.layer] || 0) + 1
  const canvasW = PAD * 2 + Math.max(1, graph.width) * (NODE_W + GAP_X) - GAP_X
  const canvasH = PAD * 2 + Math.max(1, graph.layers) * (NODE_H + GAP_Y) - GAP_Y
  const place = new Map(
    graph.nodes.map((n) => {
      const offset = ((graph.width - (rowSizes[n.layer] || 1)) * (NODE_W + GAP_X)) / 2
      return [
        n.task.id,
        { x: PAD + offset + n.order * (NODE_W + GAP_X), y: PAD + n.layer * (NODE_H + GAP_Y) },
      ]
    }),
  )

  if (!tasks.length)
    return (
      <div className="task-map-empty">
        <Network size={22} strokeWidth={1.5} />
        <p>
          {text(
            '還沒有任務。在聊天室指派工作，或用流程範本建立有依賴的任務，這裡會畫出誰在等誰。',
            'No tasks yet. Assign work in chat or start a workflow; this map shows who is waiting on whom.',
          )}
        </p>
      </div>
    )
  return (
    <div className="task-map">
      <div className="task-map-toolbar">
        <div className="segmented" role="group" aria-label={text('任務檢視', 'Task view')}>
          <button aria-pressed={view === 'graph'} onClick={() => choose('graph')}>
            <Network size={13} />
            {text('依賴圖', 'Graph')}
          </button>
          <button aria-pressed={view === 'board'} onClick={() => choose('board')}>
            <Columns3 size={13} />
            {text('看板', 'Board')}
          </button>
        </div>
        <select
          aria-label={text('依代理篩選', 'Filter by agent')}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">{text('全部代理', 'All agents')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label className="toggle-inline inline">
          <input
            type="checkbox"
            checked={showReplaced}
            onChange={(e) => setShowReplaced(e.target.checked)}
          />
          {text('顯示舊嘗試', 'Show replaced attempts')}
        </label>
      </div>
      <dl className="task-map-summary">
        {boardColumns.map((c, i) => (
          <div key={c} className={`summary-${c}`}>
            <dt>{columnTitle[c]}</dt>
            <dd>{counts[i]}</dd>
          </div>
        ))}
      </dl>
      {view === 'graph' ? (
        <div className="task-graph-scroll">
          <div
            className="task-graph"
            style={{ width: canvasW, height: canvasH }}
            role="list"
            aria-label={text('任務依賴圖', 'Task dependency graph')}
          >
            <svg width={canvasW} height={canvasH} aria-hidden="true">
              <defs>
                <marker
                  id="task-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8 z" className="edge-head" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const a = place.get(edge.from)!,
                  b = place.get(edge.to)!
                const x1 = a.x + NODE_W / 2,
                  y1 = a.y + NODE_H,
                  x2 = b.x + NODE_W / 2,
                  y2 = b.y - 3
                const mid = (y1 + y2) / 2
                const lit = related?.has(edge.from) && related.has(edge.to)
                const fromTask = graph.nodes.find((n) => n.task.id === edge.from)!.task
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={`M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`}
                    className={`edge ${fromTask.status === 'completed' ? 'satisfied' : 'pending'} ${lit ? 'lit' : related ? 'dim' : ''}`}
                    markerEnd="url(#task-arrow)"
                  />
                )
              })}
            </svg>
            {graph.nodes.map(({ task }) => {
              const p = place.get(task.id)!
              const dim = (related && !related.has(task.id)) || !matches(task)
              const slot = seriesSlot(task.agentId, allAgents)
              return (
                <button
                  role="listitem"
                  key={task.id}
                  className={`graph-node tone-${statusTone(task)} ${selected === task.id ? 'selected' : ''} ${dim ? 'dim' : ''}`}
                  style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                  onClick={() => setSelected(selected === task.id ? '' : task.id)}
                  aria-pressed={selected === task.id}
                  title={task.name}
                >
                  <span className="node-name">{task.name}</span>
                  <span className="node-meta">
                    <i className="agent-swatch" data-slot={slot} />
                    <span className="node-agent">{agentName(task.agentId)}</span>
                    <TaskStatusChip task={task} en={en} />
                  </span>
                </button>
              )
            })}
          </div>
          {!!graph.unresolved && (
            <p className="muted">
              {text(
                `有 ${graph.unresolved} 個依賴指向不存在或循環的任務，已在圖上省略。`,
                `${graph.unresolved} dependencies point at missing or cyclic tasks and are not drawn.`,
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="task-board">
          {boardColumns.map((column) => {
            const cards = graph.nodes
              .filter((n) => boardColumn(n.task) === column && matches(n.task))
              .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt))
            return (
              <section key={column} className={`board-column column-${column}`}>
                <h5>
                  {columnTitle[column]} <span>{cards.length}</span>
                </h5>
                {!cards.length && <p className="board-empty">{text('沒有任務', 'Nothing here')}</p>}
                {cards.map(({ task, parents }) => {
                  const waitingOn = parents.filter(
                    (id) => tasks.find((t) => t.id === id)?.status !== 'completed',
                  ).length
                  return (
                    <button
                      key={task.id}
                      className={`board-card ${selected === task.id ? 'selected' : ''}`}
                      onClick={() => setSelected(selected === task.id ? '' : task.id)}
                      aria-pressed={selected === task.id}
                    >
                      <span className="node-name">{task.name}</span>
                      <TaskStatusChip task={task} en={en} />
                      <span className="node-meta">
                        <i
                          className="agent-swatch"
                          data-slot={seriesSlot(task.agentId, allAgents)}
                        />
                        <span className="node-agent">{agentName(task.agentId)}</span>
                        {!!waitingOn && (
                          <span className="waiting-on">
                            {text(`等 ${waitingOn} 項`, `waits on ${waitingOn}`)}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
      {selectedTask && (
        <section className="task-focus" aria-live="polite">
          <header>
            <strong>{selectedTask.name}</strong>
            <TaskStatusChip task={selectedTask} en={en} />
          </header>
          <p className="muted">
            {agentName(selectedTask.agentId)}
            {selectedTask.kind === 'review' ? text('，審查任務', ', review task') : ''}
            {text('，建立於 ', ', created ')}
            {new Date(selectedTask.createdAt).toLocaleString()}
          </p>
          {selectedTask.description && (
            <p className="task-focus-description">{selectedTask.description}</p>
          )}
          {selectedTask.error && <pre className="error-text">{selectedTask.error}</pre>}
          {!!selectedTask.dependencies.length && (
            <p className="muted">
              {text('依賴：', 'Depends on: ')}
              {graph.nodes
                .find((n) => n.task.id === selectedTask.id)
                ?.parents.map((id) => tasks.find((t) => t.id === id)?.name || id)
                .join(text('、', ', '))}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={() => openTask(selectedTask.id)}>
            <ExternalLink size={13} />
            {text('在活動中開啟詳情與操作', 'Open details and actions in Activity')}
          </Button>
        </section>
      )}
    </div>
  )
}
