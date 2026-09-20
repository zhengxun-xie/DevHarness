/** The 新建项目 inline form: name + absolute working directory. */
import { useState, type FormEvent } from 'react'

export interface NewProjectFormProps {
  onSubmit(input: { name: string; path: string }): Promise<void>
  onCancel(): void
  labels: {
    name: string
    path: string
    create: string
    cancel: string
  }
}

export function NewProjectForm({ onSubmit, onCancel, labels }: NewProjectFormProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), path: path.trim() })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy(false)
    }
  }

  return (
    <form className="dbl-form" onSubmit={handleSubmit}>
      <div className="dbl-field">
        <label htmlFor="dbl-project-name">{labels.name}</label>
        <input
          id="dbl-project-name"
          className="dbl-input"
          value={name}
          // eslint-disable-next-line react/jsx-no-bind
          onChange={event => setName(event.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="dbl-field">
        <label htmlFor="dbl-project-path">{labels.path}</label>
        <input
          id="dbl-project-path"
          className="dbl-input"
          value={path}
          placeholder="~/workspace/my-project 或 /absolute/path"
          // eslint-disable-next-line react/jsx-no-bind
          onChange={event => setPath(event.target.value)}
          required
        />
      </div>
      {error !== null && <div className="dbl-status" data-kind="error">{error}</div>}
      <div className="dbl-actions">
        <button type="button" className="dbl-btn" onClick={onCancel} disabled={busy}>
          {labels.cancel}
        </button>
        <button type="submit" className="dbl-btn dbl-btn-primary" disabled={busy || !name.trim() || !path.trim()}>
          {labels.create}
        </button>
      </div>
    </form>
  )
}
