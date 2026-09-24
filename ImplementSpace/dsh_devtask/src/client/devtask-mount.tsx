/**
 * Mount the DevTask board panel as a DOM-level takeover of the center column
 * (same family-panel mechanism as the task board / dsh-ssh / DevBuddy).
 *
 * The container is appended inside the shell's center column as an extra
 * child React never manages; visibility rides the `data-devtask-active`
 * attribute on <html> (rules in styles.ts). activePanelId never changes, so
 * RightbarRoot keeps the session rightbar mounted for the panel's whole
 * lifetime.
 */
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { mountCenterPanel } from './family/panel-mount-core.ts'
import { DevTaskPanel } from './DevTaskPanel.tsx'
import type { PanelController } from './panelController.ts'

/** The injected DevTask container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-devtask-view]'

/** Locale-change source shape (ctx.locale). */
export interface LocaleRefreshSource {
  subscribe(listener: () => void): () => void
}

/**
 * Mount the panel tree into the center column and bind its visibility to the
 * controller's open state.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountDevtaskPanel(options: {
  controller: PanelController
  t: TranslateNS<'devTaskLeft'>
  sidebarRight: ISidebarRight
  locale?: LocaleRefreshSource
}): () => void {
  const { controller, t, sidebarRight, locale } = options
  return mountCenterPanel({
    render: root => root.render(
      <DevTaskPanel t={t} sidebarRight={sidebarRight} />,
    ),
    viewDatasetKey: 'devtaskView',
    pluginName: 'devtask',
    viewClassName: 'dtk-panel-view',
    activeAttribute: 'data-devtask-active',
    // The other family panels sharing the single-occupant center column.
    // 'data-dsh-atb-active' / 'dsh-taskboard' belong to the OFFICIAL
    // dsh-taskboard plugin (atb); 'taskboard' / 'ssh' are the @linxin666
    // family names; 'devbuddy' is our left-sidebar sibling.
    siblingActiveAttributes: [
      'data-dsh-atb-active',
      'data-dsh-taskboard-active',
      'data-dsh-ssh-active',
      'data-devbuddy-active',
    ],
    panelName: 'devtask',
    siblingPanelNames: ['dsh-taskboard', 'taskboard', 'ssh', 'devbuddy'],
    isOpen: () => controller.isOpen(),
    close: () => controller.closePanel(),
    subscribe: listener => controller.subscribe(listener),
    locale,
  })
}