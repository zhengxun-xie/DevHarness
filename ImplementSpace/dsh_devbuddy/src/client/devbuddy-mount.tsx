/**
 * Mount the DevBuddy workflow panel as a DOM-level takeover of the center
 * column (same family-panel mechanism as the task board / dsh-ssh).
 *
 * The container is appended inside the shell's center column as an extra
 * child React never manages; visibility rides the `data-devbuddy-active`
 * attribute on <html> (rules in styles.ts). activePanelId never changes, so
 * RightbarRoot keeps the session rightbar mounted (bound to the active
 * session) for the panel's whole lifetime — the header control expands that
 * sidebar in place, exactly like the conversation header's ExpandButton,
 * without leaving the panel.
 */
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { mountCenterPanel } from './family/panel-mount-core.ts'
import { DevBuddyPanel } from './DevBuddyPanel.tsx'
import type { UiWorkspaceNav } from './WorkspaceBar.tsx'
import type { PanelController } from './panelController.ts'

/** The injected DevBuddy container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-devbuddy-view]'

/** Locale-change source shape (ctx.locale). */
export interface LocaleRefreshSource {
  subscribe(listener: () => void): () => void
}

/**
 * Mount the panel tree into the center column and bind its visibility to the
 * controller's open state.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountDevbuddyPanel(options: {
  controller: PanelController
  t: TranslateNS<'devBuddyLeft'>
  sidebarRight: ISidebarRight
  uiWorkspace: UiWorkspaceNav | null
  locale?: LocaleRefreshSource
}): () => void {
  const { controller, t, sidebarRight, uiWorkspace, locale } = options
  return mountCenterPanel({
    render: root => root.render(
      <DevBuddyPanel
        t={t}
        sidebarRight={sidebarRight}
        uiWorkspace={uiWorkspace}
        panelController={controller}
      />,
    ),
    viewDatasetKey: 'devbuddyView',
    pluginName: 'devbuddy',
    viewClassName: 'dbl-panel-view',
    activeAttribute: 'data-devbuddy-active',
    // The other family panels sharing the single-occupant center column.
    // 'data-dsh-atb-active' / 'dsh-taskboard' belong to the OFFICIAL
    // dsh-taskboard plugin (atb), the one actually installed alongside us;
    // 'taskboard' / 'ssh' are the @linxin666 family names.
    siblingActiveAttributes: [
      'data-dsh-atb-active',
      'data-dsh-taskboard-active',
      'data-dsh-ssh-active',
      'data-devtask-active',
    ],
    panelName: 'devbuddy',
    siblingPanelNames: ['dsh-taskboard', 'taskboard', 'ssh', 'devtask'],
    isOpen: () => controller.isOpen(),
    close: () => controller.closePanel(),
    subscribe: listener => controller.subscribe(listener),
    locale,
  })
}
