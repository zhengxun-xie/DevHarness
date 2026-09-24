/**
 * 「新增视图」 inline form: the requirement's flow for adding a header tab.
 *
 * ONE field — the employee, picked from the placeholder 员工A/B/C roster the
 * host supplies through /state. The view is then named after that employee, so
 * the form asks for the only thing that actually distinguishes one added tab
 * from another. Each view created here is an INDIVIDUAL perspective.
 *
 * Rendered IN the panel's upper area (like DevBuddy's 新增项目 form), never as
 * a modal dialog: no scrim, no overlay, no focus trap — the board stays
 * visible. Validation mirrors the host, which stays authoritative.
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export interface ViewCreateFormProps {
  t: TranslateNS<'devTaskLeft'>
  employees: { id: string; name: string }[]
  onCancel(): void
  onSubmit(employeeId: string): void | Promise<void>
}

export function ViewCreateForm({ t, employees, onCancel, onSubmit }: ViewCreateFormProps) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy || employeeId === '') return
    setBusy(true)
    try {
      await onSubmit(employeeId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="dtk-form"
      aria-label={t('view.new')}
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="dtk-form-head">
        <h2 className="dtk-form-title">{t('view.new')}</h2>
      </div>

      <div className="dtk-field">
        <label className="dtk-label" htmlFor="dtk-view-employee">{t('view.name')}</label>
        <select
          id="dtk-view-employee"
          className="dtk-select"
          value={employeeId}
          autoFocus
          // eslint-disable-next-line react/jsx-no-bind
          onChange={event => setEmployeeId(event.target.value)}
        >
          {employees.length === 0 && <option value="">{t('view.employeePlaceholder')}</option>}
          {employees.map(employee => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </select>
      </div>

      <div className="dtk-form-actions">
        <button type="button" className="dtk-btn" onClick={onCancel}>{t('view.cancel')}</button>
        <button type="submit" className="dtk-btn dtk-btn-primary" disabled={busy || employeeId === ''}>
          {t('view.create')}
        </button>
      </div>
    </form>
  )
}