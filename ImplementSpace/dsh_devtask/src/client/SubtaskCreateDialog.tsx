/**
 * 添加子任务弹窗（项目视图「＋」按钮）。字段对齐「📋OKR 任务拆解」表的
 * 可编辑列：任务(text)、任务状态(select)、负责人(user)、进展描述(text)、
 * 开始日期(datetime)、预计完成日期(datetime)、任务进度(number, 0–1 量纲
 * 于 host 侧换算)。
 *
 * 与 TaskEditDialog 的分工：这里只做「创建子任务」，父任务由调用方锁定
 * （弹窗头部展示父任务标题，用户不可改）；负责人默认「跟随父任务」——
 * 提交时省略 employeeId，让 host 按优先级链继承（父任务负责人 → 视角员工）。
 * 日期输入 yyyy-mm-dd（HTML date input 原生格式），提交时空串不发送。
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevTaskState, TaskRecord } from '../protocol.ts'
import { TASK_STATUSES } from '../protocol.ts'

/** The submitted field values; inheritance is decided host-side. */
export interface SubtaskInput {
  title: string
  description: string
  status: string
  employeeId: string | undefined
  startDate: string
  dueDate: string
  progress: number | undefined
}

export interface SubtaskCreateDialogProps {
  t: TranslateNS<'devTaskLeft'>
  /** The parent task (项目视图任务行) or KR-host task (O/KR 行) to append under. */
  parent: TaskRecord
  /** 员工名册（负责人下拉）；空时隐藏该字段。 */
  employees: DevTaskState['employees']
  onCancel(): void
  onSubmit(input: SubtaskInput): void | Promise<void>
}

export function SubtaskCreateDialog({ t, parent, employees, onCancel, onSubmit }: SubtaskCreateDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('todo')
  const [owner, setOwner] = useState('inherit')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [progressText, setProgressText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    if (title.trim() === '') {
      setError(t('task.titleRequired'))
      return
    }
    // 进度 0–100 百分比；空串 = 不填写（host 不写该字段）。
    let progress: number | undefined
    if (progressText.trim() !== '') {
      const parsed = Number(progressText)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setError(t('subtask.progressInvalid'))
        return
      }
      progress = parsed
    }
    setBusy(true)
    setError(null)
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      status,
      // '' = 明确不指派（清空继承）；'inherit' = 跟随父任务（host 继承）。
      employeeId: owner === 'inherit' ? undefined : owner,
      startDate: startDate.trim(),
      dueDate: dueDate.trim(),
      progress,
    })
    setBusy(false)
  }

  return (
    <div
      className="dtk-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={t('subtask.new')}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="dtk-dialog">
        <h2 className="dtk-dialog-title">{t('subtask.new')}</h2>
        <p className="dtk-dialog-sub">
          {t('subtask.parentLabel')}<span className="dtk-dialog-sub-strong">{parent.title}</span>
        </p>

        <div className="dtk-field">
          <label className="dtk-label" htmlFor="dtk-subtask-title">{t('task.title')}</label>
          <input
            id="dtk-subtask-title"
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
          <label className="dtk-label" htmlFor="dtk-subtask-desc">{t('task.description')}</label>
          <textarea
            id="dtk-subtask-desc"
            className="dtk-textarea"
            value={description}
            placeholder={t('task.descriptionPlaceholder')}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setDescription(event.target.value)}
          />
        </div>

        <div className="dtk-dialog-grid">
          <div className="dtk-field">
            <label className="dtk-label" htmlFor="dtk-subtask-status">{t('task.status')}</label>
            <select
              id="dtk-subtask-status"
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

          {employees.length > 0 && (
            <div className="dtk-field">
              <label className="dtk-label" htmlFor="dtk-subtask-owner">{t('subtask.owner')}</label>
              <select
                id="dtk-subtask-owner"
                className="dtk-select"
                value={owner}
                // eslint-disable-next-line react/jsx-no-bind
                onChange={event => setOwner(event.target.value)}
              >
                <option value="inherit">{t('subtask.ownerInherit')}</option>
                <option value="">{t('subtask.ownerNone')}</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="dtk-field">
            <label className="dtk-label" htmlFor="dtk-subtask-start">{t('subtask.startDate')}</label>
            <input
              id="dtk-subtask-start"
              className="dtk-input"
              type="date"
              value={startDate}
              // eslint-disable-next-line react/jsx-no-bind
              onChange={event => setStartDate(event.target.value)}
            />
          </div>

          <div className="dtk-field">
            <label className="dtk-label" htmlFor="dtk-subtask-due">{t('subtask.dueDate')}</label>
            <input
              id="dtk-subtask-due"
              className="dtk-input"
              type="date"
              value={dueDate}
              // eslint-disable-next-line react/jsx-no-bind
              onChange={event => setDueDate(event.target.value)}
            />
          </div>

          <div className="dtk-field">
            <label className="dtk-label" htmlFor="dtk-subtask-progress">{t('okr.progress')}（%）</label>
            <input
              id="dtk-subtask-progress"
              className="dtk-input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={progressText}
              placeholder="0–100"
              // eslint-disable-next-line react/jsx-no-bind
              onChange={event => setProgressText(event.target.value)}
            />
          </div>
        </div>

        {error !== null && <div className="dtk-error">{error}</div>}

        <div className="dtk-dialog-actions">
          <button type="button" className="dtk-btn" onClick={onCancel}>{t('task.cancel')}</button>
          <button
            type="button"
            className="dtk-btn dtk-btn-primary"
            disabled={busy}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void submit() }}
          >
            {t('subtask.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
