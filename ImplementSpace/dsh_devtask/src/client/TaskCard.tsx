/**
 * Task card: one board column item. Clicking opens the edit dialog — the card
 * itself never mutates anything, so a drag (which starts on the card) cannot
 * accidentally fire an edit.
 *
 * Memoized: the card re-renders only when its own task record changes, so a
 * status/filter update on one card never re-renders every card on the board.
 */
import { memo } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevTaskState, TaskRecord } from '../protocol.ts'

export interface TaskCardProps {
  task: TaskRecord
  t: TranslateNS<'devTaskLeft'>
  /** Employee roster for resolving owner name on the card. */
  employees: DevTaskState['employees']
  onClick(): void
}

/** Compact relative time label for the card footer. */
function formatTime(iso: string, justNow: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return justNow
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function TaskCardInner({ task, t, employees, onClick }: TaskCardProps) {
  const ownerName = task.employeeId === null
    ? null
    : employees.find(e => e.id === task.employeeId)?.name ?? task.employeeId
  return (
    <button
      type="button"
      className="dtk-card"
      data-status={task.status}
      draggable
      onDragStart={event => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onClick}
      title={task.description !== '' ? task.description : task.title}
    >
      <span className="dtk-card-title">{task.title}</span>
      {task.description !== '' && <span className="dtk-card-desc">{task.description}</span>}
      <span className="dtk-card-meta">
        {ownerName !== null && <span className="dtk-card-owner">{ownerName}</span>}
        {task.tags.length > 0 && (
          <span className="dtk-card-tags">
            {task.tags.map(tag => <span key={tag} className="dtk-card-tag">{tag}</span>)}
          </span>
        )}
        <span className="dtk-card-time">{formatTime(task.updatedAt, '·')}</span>
      </span>
    </button>
  )
}

/** Memoized card: re-renders only when the card's own task record changes. */
export const TaskCard = memo(TaskCardInner)