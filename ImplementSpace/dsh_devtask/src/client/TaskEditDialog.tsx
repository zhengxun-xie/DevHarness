/**
 * Task create/edit dialog. One component serves both modes: `task` absent
 * means create (defaults from the column the header's 新建任务 targets),
 * `task` present means edit and additionally offers 删除.
 *
 * Tags are entered as a comma-separated string and split on submit — the same
 * lightweight convention the task-board family uses for free-form labels.
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskRecord } from '../protocol.ts'
import { TASK_STATUSES } from '../protocol.ts'

/** The submitted field values, normalized by the caller's host round-trip. */
export interface TaskInput {
  title: string
  description: string
  status: string
  tags: string[]
}

export interface TaskEditDialogProps {
  t: TranslateNS<'devTaskLeft'>
  /** Present = edit mode; absent = create mode. */
  task?: TaskRecord
  onCancel(): void
  onSubmit(input: TaskInput): void | Promise<void>
  /** Edit mode only: delete the task. */
  onDelete?(): void | Promise<void>
}

export function TaskEditDialog({ t, task, onCancel, onSubmit, onDelete }: TaskEditDialogProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<string>(task?.status ?? 'todo')
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const editing = task !== undefined

  const submit = async (): Promise<void> => {
    if (busy) return
    if (title.trim() === '') {
      setError(t('task.titleRequired'))
      return
    }
    setBusy(true)
    setError(null)
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      status,
      tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
    })
    setBusy(false)
  }

  return (
    <div
      className="dtk-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? t('task.edit') : t('task.new')}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="dtk-dialog">
        <h2 className="dtk-dialog-title">{editing ? t('task.edit') : t('task.new')}</h2>

        <div className="dtk-field">
          <label className="dtk-label" htmlFor="dtk-task-title">{t('task.title')}</label>
          <input
            id="dtk-task-title"
            className="dtk-input"
            value={title}
            placeholder={t('task.titlePlaceholder')}
            autoFocus
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void submit()
              if (event.key === 'Escape') onCancel()
            }}
          />
        </div>

        <div className="dtk-field">
          <label className="dtk-label" htmlFor="dtk-task-desc">{t('task.description')}</label>
          <textarea
            id="dtk-task-desc"
            className="dtk-textarea"
            value={description}
            placeholder={t('task.descriptionPlaceholder')}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setDescription(event.target.value)}
          />
        </div>

        <div className="dtk-field">
          <label className="dtk-label" htmlFor="dtk-task-status">{t('task.status')}</label>
          <select
            id="dtk-task-status"
            className="dtk-select"
            value={status}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setStatus(event.target.value)}
          >
            {TASK_STATUSES.map(value => (
              <option key={value} value={value}>
                {t(`status.${value}` as 'status.backlog')}
              </option>
            ))}
          </select>
        </div>

        <div className="dtk-field">
          <label className="dtk-label" htmlFor="dtk-task-tags">{t('task.tags')}</label>
          <input
            id="dtk-task-tags"
            className="dtk-input"
            value={tags}
            placeholder={t('task.tagsPlaceholder')}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setTags(event.target.value)}
          />
        </div>

        {error !== null && <div className="dtk-error">{error}</div>}

        <div className="dtk-dialog-actions">
          {editing && onDelete !== undefined && (
            <button
              type="button"
              className="dtk-btn"
              style={{ marginRight: 'auto' }}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void onDelete() }}
            >
              {t('task.remove')}
            </button>
          )}
          <button type="button" className="dtk-btn" onClick={onCancel}>{t('task.cancel')}</button>
          <button
            type="button"
            className="dtk-btn dtk-btn-primary"
            disabled={busy}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void submit() }}
          >
            {editing ? t('task.save') : t('task.create')}
          </button>
        </div>
      </div>
    </div>
  )
}