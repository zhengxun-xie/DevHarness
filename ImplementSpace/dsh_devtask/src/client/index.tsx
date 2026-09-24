/**
 * DevTask browser half — DOM-takeover variant.
 *
 * Two DOM-level mounts (same family-panel mechanism as the task board,
 * dsh-ssh and DevBuddy; cores vendored under ./family, Apache-2.0):
 *
 *   1. A plain-DOM glyph row injected into the LEFT sidebar shell beside its
 *      New Session control (self-healing on shell re-renders). It toggles a
 *      local open-state controller and NEVER calls layout.selectPanel.
 *
 *   2. A render container appended inside the shell's center column as an
 *      extra child React never manages; an <html data-devtask-active>
 *      attribute switches visibility and hides the conversation underneath
 *      (the conversation subtree stays mounted and stateful).
 *
 * A click on a shell session/project sidebar row (or activation of a sibling
 * family panel) hands the center column back automatically; see
 * family/panel-mount-core.ts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pull the ctx.locale / ctx.sidebarRight Context merges; the
// slots import anchors the LocaleNamespaceMap augmentation target.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { mountDevtaskPanel } from './devtask-mount.tsx'
import { mountDevtaskSidebarEntry } from './sidebar-entry.ts'
import { createPanelController } from './panelController.ts'
import { dictionaries, type DevTaskKey } from './locales.ts'
import { ensureStyles } from './styles.ts'

export type { DevTaskKey }

const NS = 'devTaskLeft'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  /** DevDelivery accepts project context when an OKR project node is selected. */
  interface SidebarRightTabParamsMap {
    devdelivery: { project?: { id: string; name: string; path?: string; workspaceId?: string } }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DevTask left-panel copy. */
    devTaskLeft: DevTaskKey
  }
}

/**
 * Required browser services: the locale dictionaries and the session
 * right-sidebar navigation face (the header's expand control).
 */
export const inject = ['locale', 'sidebarRight']

/** Client plugin body: DOM sidebar row + DOM center-column takeover. */
export function apply(ctx: ClientContext): void {
  ensureStyles()

  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-devtask: dictionaries')
  const t = ctx.locale.bind(NS)

  const controller = createPanelController()
  // DevDelivery opens the task workspace through this optional browser event.
  const onDeliveryReturn = () => controller.openPanel()
  window.addEventListener('dsh:devtask:open', onDeliveryReturn)

  // The cores self-heal while the shell is still mounting (page-wide
  // MutationObserver hub), so the mounts can be installed immediately.
  const disposeSidebarEntry = mountDevtaskSidebarEntry({
    controller,
    label: () => t('panel.title'),
    tooltip: () => t('panel.subtitle'),
    locale: ctx.locale,
  })
  const disposePanel = mountDevtaskPanel({
    controller,
    t,
    sidebarRight: ctx.sidebarRight,
    locale: ctx.locale,
  })

  ctx.effect(() => () => {
    window.removeEventListener('dsh:devtask:open', onDeliveryReturn)
    disposePanel()
    disposeSidebarEntry()
  }, 'dsh-devtask: dom mounts')
}