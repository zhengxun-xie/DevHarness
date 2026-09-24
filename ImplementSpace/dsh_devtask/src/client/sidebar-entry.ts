/**
 * Plain-DOM DevTask row injected into the LEFT sidebar beside the shell's
 * New Session button — the family-panel entry path (task board / dsh-ssh /
 * DevBuddy use the same shared core). The row toggles the DOM-takeover panel;
 * it never calls layout.selectPanel, so the session rightbar is not displaced.
 *
 * Injection / self-heal / idempotency live in family/sidebar-entry-core.ts;
 * this wrapper supplies the DevTask glyph, copy, and class hooks.
 */
import { mountSidebarEntry } from './family/sidebar-entry-core.ts'
import type { PanelController } from './panelController.ts'
import type { LocaleRefreshSource } from './devtask-mount.tsx'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-devtask-entry]'

/** Inline icon normalized to the shell's 18px navigation glyph size. */
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></svg>'

/** Class-name map the shared core reads (plain stylesheet, no CSS modules). */
const css = {
  entry: 'dtk-family-entry',
  entryIcon: 'dtk-family-entry__icon',
  entryLabel: 'dtk-family-entry__label',
}

/**
 * Mount the DevTask sidebar row, waiting for the shell and self-healing on
 * shell re-renders.
 * @returns disposer removing the row and its observers.
 */
export function mountDevtaskSidebarEntry(options: {
  controller: PanelController
  label: () => string
  tooltip?: () => string
  locale?: LocaleRefreshSource
}): () => void {
  const { controller, label, tooltip, locale } = options
  return mountSidebarEntry({
    rowAttribute: 'data-devtask-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'devtask' as const,
    icon: ICON,
    css,
    label,
    tooltip,
    refresh: locale === undefined ? undefined : { subscribe: listener => locale.subscribe(listener) },
    onToggle: () => controller.togglePanel(),
    // Trail the existing family block (official dsh-taskboard atb entry,
    // @linxin666 task board / ssh, DevBuddy), stable across observer-order
    // races; the core places us relative to the whole block.
    position: 'after',
    familySelectors: [
      ENTRY_SELECTOR,
      '[data-devbuddy-entry]',
      '[data-dsh-atb-entry]',
      '[data-dsh-taskboard-entry]',
      '[data-dsh-ssh-entry]',
    ],
    active: {
      subscribe: listener => controller.subscribe(listener),
      isOpen: () => controller.isOpen(),
    },
  })
}