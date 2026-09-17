/**
 * Center-column panel takeover lifecycle — DevBuddy adaptation.
 *
 * Derived (Apache-2.0) from shared/client/panel-mount-core.ts of
 * @linxin666/dsh-client-ui-task-board v0.3.22, the same generated copy used
 * by its dsh-ssh companion. Adaptation: an ARBITRARY set of sibling family
 * panels is coordinated (official dsh-taskboard "atb", @linxin666 task-board
 * and ssh) instead of a single fixed sibling pair. NOTE the official board
 * uses ACTIVE attr data-dsh-atb-active and event detail 'dsh-taskboard',
 * distinct from the @linxin666 family's data-dsh-taskboard-active /
 * 'taskboard' — both naming schemes must be listed as siblings.
 *
 * Why DevBuddy mounts at the DOM level instead of the keyed `main` slot:
 * RightbarRoot renders the session-scoped right sidebar only while
 * `panelInfo.activePanelId === null`; selecting any global main panel makes
 * it return null, so the standard right column structurally unmounts. A
 * container appended INSIDE the center column as an extra child React never
 * manages, shown/hidden via an <html> data attribute, keeps activePanelId at
 * null forever: the conversation subtree AND the session rightbar stay
 * mounted and stateful while DevBuddy covers the center (identical mechanism
 * to the task board).
 */
import { createRoot, type Root } from 'react-dom/client'
import { subscribeBodyInvalidations } from './body-mutations.ts'

/** Options for mountCenterPanel (multi-sibling variant). */
export interface CenterPanelMountOptions {
  /** Render the panel tree (first open, remount while open, locale refresh). */
  render: (root: Root) => void
  /** dataset key of the injected container's view attribute, e.g. `devbuddyView`. */
  viewDatasetKey: string
  /** value of the container's L2 `data-dsh-plugin` semantic attribute. */
  pluginName: string
  /** stylesheet class applied to the injected container. */
  viewClassName: string
  /** <html> attribute set while this panel is active. */
  activeAttribute: string
  /** Other family panels' active attributes, removed from <html> when this opens. */
  siblingActiveAttributes: readonly string[]
  /** detail value this panel broadcasts on the cross-plugin activation event. */
  panelName: string
  /** activation-event detail values that should close this panel. */
  siblingPanelNames: readonly string[]
  /** open flag of the owning controller. */
  isOpen: () => boolean
  /** close the panel, handing the center column back to the conversation. */
  close: () => void
  /** subscribe to the owning controller's open-state changes; returns unsubscriber. */
  subscribe: (listener: () => void) => () => void
  /** locale-change source; when given, re-renders an open panel on a Language switch. */
  locale?: { subscribe(listener: () => void): () => void }
}

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
// Sidebar rows whose clicks hand the center column back to the conversation
// (including the already-current row, which produces no session-change
// event). Capture phase, so the panel closes before the shell processes it.
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount a family panel into the center column and bind its visibility to the
 * owning controller's open state.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountCenterPanel(options: CenterPanelMountOptions): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let unsubscribeLocale: (() => void) | undefined
  try {
    unsubscribeLocale = options.locale?.subscribe(() => {
      if (root !== undefined) options.render(root)
    })
  } catch { /* locale service absent: the panel follows its next natural re-render */ }

  const ensure = (): void => {
    if (container !== undefined && !container.isConnected) {
      // The conversation pane was replaced; drop the stale tree and remount.
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    if (container === undefined) {
      const column = conversationColumn()
      if (column === undefined) return
      container = document.createElement('div')
      container.dataset[options.viewDatasetKey] = ''
      container.dataset.dshPlugin = options.pluginName
      container.className = options.viewClassName
      column.appendChild(container)
    }
    // Keep a visited tree mounted so drafts survive close/reopen; an unused
    // panel needs neither a React root nor effects.
    if (root !== undefined || !options.isOpen()) return
    root = createRoot(container)
    options.render(root)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const unsubscribeBody = subscribeBodyInvalidations(() => { ensure() })

  const applyActive = (): void => {
    if (options.isOpen()) {
      // Flip the attributes BEFORE committing the React tree: a sibling panel
      // still active keeps this container hidden with display:none !important
      // until its attribute is evicted, and mounting layout-measuring UI into
      // a zero-size box leaves it blank once revealed.
      for (const attribute of options.siblingActiveAttributes) {
        document.documentElement.removeAttribute(attribute)
      }
      document.documentElement.setAttribute(options.activeAttribute, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: options.panelName }))
      ensure()
    } else {
      document.documentElement.removeAttribute(options.activeAttribute)
    }
  }
  const onOtherActivate = (event: Event): void => {
    if (options.siblingPanelNames.includes((event as CustomEvent).detail) && options.isOpen()) {
      options.close()
    }
  }
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!options.isOpen()) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) options.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = options.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    unsubscribeBody()
    unsubscribe()
    unsubscribeLocale?.()
    document.documentElement.removeAttribute(options.activeAttribute)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
