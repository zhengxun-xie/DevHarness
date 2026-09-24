/**
 * DevBuddy browser half, LEFT-sidebar implementation — DOM-takeover variant.
 *
 * Two DOM-level mounts (same family-panel mechanism as the task board and
 * dsh-ssh; cores vendored under ./family, Apache-2.0):
 *
 *   1. A plain-DOM glyph row injected into the LEFT sidebar shell beside its
 *      New Session control (self-healing on shell re-renders). It toggles a
 *      local open-state controller and NEVER calls layout.selectPanel.
 *
 *   2. A render container appended inside the shell's center column as an
 *      extra child React never manages; an <html data-devbuddy-active>
 *      attribute switches visibility and hides the conversation underneath
 *      (the conversation subtree stays mounted and stateful).
 *
 * Rationale: the official keyed `main` slot swaps activePanelId away from
 * null, which makes ui-sidebar-right's RightbarRoot unmount the session
 * rightbar (and makes any expand gesture race the remount). The takeover
 * keeps activePanelId null for the panel's whole lifetime, so the standard
 * session right sidebar stays mounted and available — opening it from the
 * DevBuddy header is a plain synchronous toggle.
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
import { mountDevbuddyPanel } from './devbuddy-mount.tsx'
import { mountDevbuddySidebarEntry } from './sidebar-entry.ts'
import { createPanelController } from './panelController.ts'
import type { UiWorkspaceNav } from './WorkspaceBar.tsx'
import { dictionaries, type DevBuddyKey } from './locales.ts'
import { ensureStyles } from './styles.ts'

export type { DevBuddyKey }

const NS = 'devBuddyLeft'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  /** DevDelivery accepts current DevBuddy project context. */
  interface SidebarRightTabParamsMap {
    devdelivery: { project?: { id: string; name: string; path?: string; workspaceId?: string } }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DevBuddy left-panel copy. */
    devBuddyLeft: DevBuddyKey
  }
}

/**
 * Required browser services: the locale dictionaries, the session
 * right-sidebar navigation face (the header's expand control), and the
 * ui-workspace navigation service (switch DSH workspace/session on project
 * switch and for "new session in project").
 */
export const inject = ['locale', 'sidebarRight', 'uiWorkspace']

/** Client plugin body: DOM sidebar row + DOM center-column takeover. */
export function apply(ctx: ClientContext): void {
  ensureStyles()

  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-devbuddy-left: dictionaries')
  const t = ctx.locale.bind(NS)

  const controller = createPanelController()
  // DevDelivery returns here through this deliberately loose browser contract.
  // Opening the panel is owned by the mount controller; DevBuddyPanel itself
  // consumes the same event to select a matching project.
  const onDeliveryReturn = () => controller.openPanel()
  window.addEventListener('dsh:devbuddy:open', onDeliveryReturn)
  // Tolerate an older shell without the ui-workspace service published: the
  // panel still mounts; project switch just does not re-point the DSH
  // workspace/session underneath, and "new session" is disabled.
  const uiWorkspace = (ctx as unknown as { uiWorkspace?: UiWorkspaceNav }).uiWorkspace ?? null

  // The cores self-heal while the shell is still mounting (page-wide
  // MutationObserver hub), so the mounts can be installed immediately. The
  // dictionary effect is disposed by cordis with the plugin context.
  const disposeSidebarEntry = mountDevbuddySidebarEntry({
    controller,
    label: () => t('panel.title'),
    tooltip: () => t('panel.subtitle'),
    locale: ctx.locale,
  })
  const disposePanel = mountDevbuddyPanel({
    controller,
    t,
    sidebarRight: ctx.sidebarRight,
    uiWorkspace,
    locale: ctx.locale,
  })

  ctx.effect(() => () => {
    window.removeEventListener('dsh:devbuddy:open', onDeliveryReturn)
    disposePanel()
    disposeSidebarEntry()
  }, 'dsh-devbuddy-left: dom mounts')
}
