/**
 * Header control that toggles the standard session right sidebar IN PLACE —
 * a stateful open/close switch mirroring what the conversation header's
 * ExpandButton opens and the right bar's own control collapses.
 *
 * Binding: under the DOM-takeover mount activePanelId stays null and the
 * session never switches, so the session right-bar seat stays mounted the
 * whole time, already bound to the workspace's active session. The button
 * just flips the live controller.
 *
 * State source: the click flips optimistically; the authoritative state is
 * tracked via the AppFrame's `data-rightbar-collapsed` /
 * `data-rightbar-fullscreen` attributes (the same presentation the frame
 * publishes), observed on the frame element, so collapsing from the right
 * bar's own rail control updates this button too — no polling. The frame is
 * reached through the always-present shell-overlay node.
 */
import { useEffect, useState } from 'react'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { subscribeBodyInvalidations } from './family/body-mutations.ts'

export interface RightbarToggleProps {
  sidebarRight: ISidebarRight
  /** Tooltip / aria label while collapsed (action = open). */
  openLabel: string
  /** Tooltip / aria label while expanded (action = close). */
  closeLabel: string
}

/** AppFrame attributes whose mutations signify a right-bar presentation change. */
const WATCHED_ATTRS = ['data-rightbar-collapsed', 'data-rightbar-fullscreen']

/** The frame element, via the shell-overlay node the AppFrame always renders. */
function frameElement(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement ?? undefined
}

/** Mirrored panel glyph: a panel whose rail sits on the right edge. */
function PanelRightIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}

export function RightbarToggle({ sidebarRight, openLabel, closeLabel }: RightbarToggleProps) {
  // The seat is mounted for the panel's whole lifetime; isExpanded() is the
  // authoritative read and is safe throughout.
  const [expanded, setExpanded] = useState<boolean>(() => sidebarRight.isExpanded())

  useEffect(() => {
    let frame: HTMLElement | undefined
    let observer: MutationObserver | undefined

    const sync = () => {
      setExpanded(sidebarRight.isExpanded())
    }

    const observe = () => {
      const next = frameElement()
      if (next === undefined || next === frame) return
      observer?.disconnect()
      frame = next
      observer = new MutationObserver(sync)
      observer.observe(frame, { attributes: true, attributeFilter: WATCHED_ATTRS })
      sync()
    }

    // The shell is normally already mounted; the body hub covers a late
    // frame rebuild the same way the panel mount cores self-heal.
    observe()
    const unsubscribeBody = subscribeBodyInvalidations(observe)

    return () => {
      unsubscribeBody()
      observer?.disconnect()
    }
  }, [sidebarRight])

  const label = expanded ? closeLabel : openLabel

  return (
    <button
      type="button"
      className="dbl-btn"
      title={label}
      aria-label={label}
      aria-pressed={expanded}
      data-active={expanded || undefined}
      // eslint-disable-next-line react/jsx-no-bind
      onClick={() => {
        // Flip the live per-session surface; the frame observer reconciles
        // the icon state when the presentation commits.
        sidebarRight.toggleExpanded()
        setExpanded(sidebarRight.isExpanded())
      }}
    >
      <PanelRightIcon />
    </button>
  )
}
