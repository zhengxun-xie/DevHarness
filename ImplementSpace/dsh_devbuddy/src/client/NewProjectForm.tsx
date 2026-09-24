/** The 新建项目 inline form: name + absolute working directory. */
import { useState, type FormEvent } from 'react'
import { DirectoryBrowserModal, type DirectoryBrowserLabels } from './DirectoryBrowserModal.tsx'
import type { UiWorkspaceNav } from './WorkspaceBar.tsx'

export interface NewProjectFormProps {
  onSubmit(input: { name: string; path: string; initGit: boolean; createSession: boolean }): Promise<void>
  onCancel(): void
  /** ui-workspace navigation/directory service; the browse button is hidden without it. */
  uiWorkspace: UiWorkspaceNav | null
  labels: {
    name: string
    path: string
    browse: string
    initGit: string
    createSession: string
    create: string
    cancel: string
  }
  pickerLabels: DirectoryBrowserLabels
}

export function NewProjectForm({ onSubmit, onCancel, uiWorkspace, labels, pickerLabels }: NewProjectFormProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [initGit, setInitGit] = useState(false)
  const [createSession, setCreateSession] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), path: path.trim(), initGit, createSession })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy(false)
    }
  }

  /**
   * Pick the project directory. Prefer the host-native OS chooser; when the
   * host lacks one (SSH / headless) the pick throws and we fall back to the
   * in-app directory browser.
   */
  async function handleBrowse(): Promise<void> {
    if (uiWorkspace === null) return
    setError(null)
    try {
      const picked = await uiWorkspace.pickDirectory()
      if (picked !== null) setPath(picked)
    } catch {
      setBrowserOpen(true)
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
        <div className="dbl-input-row">
          <input
            id="dbl-project-path"
            className="dbl-input"
            value={path}
            placeholder="~/workspace/my-project 或 /absolute/path"
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setPath(event.target.value)}
            required
          />
          {uiWorkspace !== null && (
            <button type="button" className="dbl-btn dbl-btn-browse" onClick={handleBrowse}>
              {labels.browse}
            </button>
          )}
        </div>
      </div>
      <div className="dbl-options">
        <label className="dbl-check">
          <input
            type="checkbox"
            checked={initGit}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setInitGit(event.target.checked)}
          />
          <span>{labels.initGit}</span>
        </label>
        <label className="dbl-check">
          <input
            type="checkbox"
            checked={createSession}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setCreateSession(event.target.checked)}
          />
          <span>{labels.createSession}</span>
        </label>
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
      {browserOpen && uiWorkspace !== null && (
        <DirectoryBrowserModal
          list={(p, signal) => uiWorkspace.listDirectory(p, signal)}
          create={(p, n) => uiWorkspace.createDirectory(p, n)}
          labels={pickerLabels}
          onSelect={selected => {
            setPath(selected)
            setBrowserOpen(false)
          }}
          onClose={() => setBrowserOpen(false)}
        />
      )}
    </form>
  )
}
