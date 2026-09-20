/**
 * Project ↔ DSH workspace status bar, rendered in the active project header.
 *
 * Shows the resolved workspace link (explicit binding or same-path auto
 * match) with its session count, offers:
 *   - "new session here": sessions.create({workspaceId}) → sessions.open →
 *     close the DevBuddy takeover so the fresh conversation is revealed
 *   - rebind picker: any DSH workspace, plus an "auto-match by path" reset
 *
 * The workspace list is fetched lazily the first time the picker opens.
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { api } from './api.ts'
import type { WorkspaceInfo, WorkspaceLink } from '../protocol.ts'

/** Minimal structural face of the client `sessions` service (session-controller). */
export interface SessionsNav {
  create(opts?: { workspaceId?: string }): Promise<string>
  open(id: string): void
}

export interface WorkspaceBarProps {
  projectId: string
  link: WorkspaceLink | null
  t: TranslateNS<'devBuddyLeft'>
  /**
   * Client sessions service. Null only when the platform service is absent
   * (older shell): the bar still renders, new-session is disabled.
   */
  sessions: SessionsNav | null
  /** Reveal the newly opened conversation by dismissing the panel takeover. */
  onClosePanel(): void
  /** Refetch /state after a binding change. */
  onRefresh(): Promise<void>
}

export function WorkspaceBar({ projectId, link, t, sessions, onClosePanel, onRefresh }: WorkspaceBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openMenu(): Promise<void> {
    if (menuOpen) { setMenuOpen(false); return }
    setMenuOpen(true)
    if (workspaces === null) {
      setListError(null)
      try {
        setWorkspaces(await api.listWorkspaces())
      } catch (caught) {
        setListError(caught instanceof Error ? caught.message : String(caught))
      }
    }
  }

  async function choose(workspaceId: string | null): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.bindProject(projectId, workspaceId)
      await onRefresh()
      setMenuOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function startSession(): Promise<void> {
    if (link === null || sessions === null || starting) return
    setStarting(true)
    setError(null)
    try {
      const sessionId = await sessions.create({ workspaceId: link.workspaceId })
      sessions.open(sessionId)
      onClosePanel()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStarting(false)
    }
  }

  return (
    <div className="dbl-wsbar">
      <div className="dbl-wsbar-info">
        <span className="dbl-wsbar-dot" data-linked={link !== null} aria-hidden />
        {link === null ? (
          <span className="dbl-wsbar-unlinked">{t('workspace.unlinked')}</span>
        ) : (
          <>
            <span className="dbl-wsbar-kicker">{t('workspace.label')}</span>
            <span className="dbl-wsbar-name" title={link.title}>{link.title}</span>
            {link.kind === 'auto' && (
              <span className="dbl-wsbar-badge" title={t('workspace.autoMatch')}>{t('workspace.auto')}</span>
            )}
            <span className="dbl-wsbar-count">{link.sessionCount} {t('workspace.sessions')}</span>
          </>
        )}
      </div>

      <div className="dbl-wsbar-actions">
        {link !== null && (
          <button
            type="button"
            className="dbl-linkbtn dbl-wsbar-new"
            disabled={starting || sessions === null}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={startSession}
          >
            {starting ? t('workspace.starting') : `＋ ${t('workspace.newSession')}`}
          </button>
        )}
        <div className="dbl-wsbar-menu-wrap">
          <button
            type="button"
            className="dbl-linkbtn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void openMenu() }}
          >
            {link === null ? t('workspace.choose') : t('workspace.rebind')} ▾
          </button>
          {menuOpen && (
            <>
              {/* Click-away layer. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="dbl-wsbar-scrim"
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => setMenuOpen(false)}
              />
              <div className="dbl-wsbar-menu" role="menu">
                {listError !== null && (
                  <div className="dbl-wsbar-menu-error" data-kind="error">{listError}</div>
                )}
                {listError === null && workspaces !== null && workspaces.length === 0 && (
                  <div className="dbl-wsbar-menu-empty">{t('workspace.empty')}</div>
                )}
                {workspaces?.map(workspace => (
                  <button
                    key={workspace.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={workspace.id === link?.workspaceId}
                    className="dbl-wsbar-item"
                    data-current={workspace.id === link?.workspaceId}
                    title={workspace.path}
                    disabled={busy}
                    // eslint-disable-next-line react/jsx-no-bind
                    onClick={() => { void choose(workspace.id) }}
                  >
                    <span className="dbl-wsbar-item-title">
                      {workspace.id === link?.workspaceId ? '✓ ' : ''}{workspace.title}
                    </span>
                    <span className="dbl-wsbar-item-path">{workspace.path} · {workspace.sessionCount} {t('workspace.sessions')}</span>
                  </button>
                ))}
                {link?.kind === 'explicit' && (
                  <>
                    <div className="dbl-wsbar-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="dbl-wsbar-item"
                      disabled={busy}
                      // eslint-disable-next-line react/jsx-no-bind
                      onClick={() => { void choose(null) }}
                    >
                      <span className="dbl-wsbar-item-title">↩ {t('workspace.autoMatch')}</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error !== null && <div className="dbl-wsbar-error" data-kind="error">{error}</div>}
    </div>
  )
}
