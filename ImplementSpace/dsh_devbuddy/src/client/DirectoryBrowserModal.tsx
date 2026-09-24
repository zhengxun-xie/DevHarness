/**
 * In-app directory browser (the fallback when the host has no native OS
 * chooser — e.g. SSH launch or headless). Drives `uiWorkspace.listDirectory`
 * / `createDirectory` one level at a time: breadcrumbs jump to ancestors,
 * child rows descend, a footer confirms the current directory or creates a
 * child folder, and the primary action selects the current directory.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryListingLike } from './WorkspaceBar.tsx'

export interface DirectoryBrowserLabels {
  title: string
  select: string
  newFolder: string
  createFolder: string
  cancel: string
  empty: string
  loading: string
}

export interface DirectoryBrowserModalProps {
  /** Browse primitives (structurally injected uiWorkspace). */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListingLike>
  create(path: string, name: string): Promise<string>
  labels: DirectoryBrowserLabels
  onSelect(path: string): void
  onClose(): void
}

export function DirectoryBrowserModal({ list, create, labels, onSelect, onClose }: DirectoryBrowserModalProps) {
  const [listing, setListing] = useState<DirectoryListingLike | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Latest primitives via refs: the caller may pass fresh arrow props each
  // render, but the mount-only load effect must not re-fire on every identity
  // change (a `[list]` dependency would reload the level in an infinite loop).
  const listRef = useRef(list)
  useEffect(() => { listRef.current = list }, [list])
  const createRef = useRef(create)
  useEffect(() => { createRef.current = create }, [create])

  const load = useCallback(async (path: string | undefined): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    try {
      setListing(await listRef.current(path, controller.signal))
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (abortRef.current === controller) setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(undefined)
    return () => abortRef.current?.abort()
  }, [load])

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    const name = newName.trim()
    if (name === '' || listing === null || creating || busy) return
    setCreating(true)
    setError(null)
    try {
      await createRef.current(listing.path, name)
      setNewName('')
      await load(listing.path)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCreating(false)
    }
  }

  const visibleEntries = listing?.entries.filter(entry => !entry.hidden) ?? []

  return createPortal(
    <div className="dbl-dir-modal-backdrop" onMouseDown={onClose}>
      <div className="dbl-dir-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="dbl-dir-modal-head">
          <span className="dbl-dir-modal-title">{labels.title}</span>
          <button type="button" className="dbl-btn" onClick={onClose}>{labels.cancel}</button>
        </div>
        <div className="dbl-dir-breadcrumb">
          {listing?.crumbs.map((crumb, index) => (
            <span key={crumb.path} className="dbl-dir-crumb">
              <button
                type="button"
                className="dbl-dir-crumb-btn"
                disabled={busy}
                onClick={() => { void load(crumb.path) }}
              >
                {index === 0 && crumb.path === listing.home ? '~' : crumb.name}
              </button>
              {index < listing.crumbs.length - 1 && <span className="dbl-dir-sep">/</span>}
            </span>
          ))}
        </div>
        <div className="dbl-dir-list">
          {listing === null && error === null && <div className="dbl-dir-status">{labels.loading}</div>}
          {error !== null && <div className="dbl-status" data-kind="error">{error}</div>}
          {listing !== null && error === null && visibleEntries.length === 0 && (
            <div className="dbl-dir-status">{labels.empty}</div>
          )}
          {visibleEntries.map(entry => (
            <button
              key={entry.path}
              type="button"
              className="dbl-dir-row"
              disabled={busy}
              onClick={() => { void load(entry.path) }}
            >
              <span className="dbl-dir-glyph" aria-hidden>📁</span>
              <span className="dbl-dir-name">{entry.name}</span>
            </button>
          ))}
        </div>
        <div className="dbl-dir-current" title={listing?.path ?? ''}>{listing?.path ?? ''}</div>
        <form className="dbl-dir-new" onSubmit={handleCreate}>
          <input
            className="dbl-input"
            value={newName}
            placeholder={labels.newFolder}
            disabled={creating || busy}
            onChange={event => setNewName(event.target.value)}
          />
          <button type="submit" className="dbl-btn" disabled={creating || busy || newName.trim() === ''}>
            {labels.createFolder}
          </button>
        </form>
        <div className="dbl-dir-actions">
          <button
            type="button"
            className="dbl-btn dbl-btn-primary"
            disabled={listing === null || busy}
            onClick={() => { if (listing !== null) onSelect(listing.path) }}
          >
            {labels.select}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
