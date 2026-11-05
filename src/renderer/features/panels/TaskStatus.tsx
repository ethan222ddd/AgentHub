import {
  ClipboardCheck,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Hourglass,
  LoaderCircle,
  PauseCircle,
  ShieldAlert,
} from 'lucide-react'
import { taskStatusLabel } from '../../../shared/tasks'
import type { Task } from '../../../shared/types'

export type StatusTone = 'active' | 'good' | 'warning' | 'critical' | 'neutral'
export function statusTone(task: Task): StatusTone {
  if (task.supersededBy) return 'neutral'
  switch (task.status) {
    case 'running':
    case 'reviewing':
      return 'active'
    case 'completed':
      return 'good'
    case 'failed':
      return 'critical'
    case 'waiting_user':
    case 'blocked':
      return 'warning'
    default:
      return 'neutral'
  }
}
function StatusIcon({ task }: { task: Task }) {
  const size = 13
  if (task.supersededBy) return <CircleSlash size={size} />
  switch (task.status) {
    case 'running':
    case 'reviewing':
      return <LoaderCircle size={size} className="spin" />
    case 'completed':
      return <CircleCheck size={size} />
    case 'failed':
      return <CircleX size={size} />
    case 'waiting_user':
      return task.waitReason === 'approval' ? (
        <ShieldAlert size={size} />
      ) : task.waitReason === 'plan' ? (
        <ClipboardCheck size={size} />
      ) : (
        <Hourglass size={size} />
      )
    case 'blocked':
      return <Hourglass size={size} />
    case 'paused':
      return <PauseCircle size={size} />
    case 'cancelled':
      return <CircleSlash size={size} />
    default:
      return <CircleDashed size={size} />
  }
}
/** Status always pairs an icon with its label so state never depends on color alone. */
export function TaskStatusChip({ task, en }: { task: Task; en: boolean }) {
  return (
    <span className={`status-chip tone-${statusTone(task)}`}>
      <StatusIcon task={task} />
      {taskStatusLabel(task, en)}
    </span>
  )
}
