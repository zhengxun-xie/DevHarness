/**
 * Plain-DOM DevBuddy row injected into the LEFT sidebar beside the shell's
 * New Session button — the family-panel entry path (task board / dsh-ssh use
 * the same shared core). The row toggles the DOM-takeover panel; it never
 * calls layout.selectPanel, so the session rightbar is not displaced.
 *
 * Injection / self-heal / idempotency live in family/sidebar-entry-core.ts;
 * this wrapper supplies the DevBuddy glyph, copy, and class hooks.
 */
import { mountSidebarEntry } from './family/sidebar-entry-core.ts'
import type { PanelController } from './panelController.ts'
import type { LocaleRefreshSource } from './devbuddy-mount.tsx'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-devbuddy-entry]'

/** Inline icon normalized to the shell's 18px navigation glyph size. */
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9.2 5-9.2 5L2.8 7 12 2Z"/><polyline points="3 12 12 17 21 12"/><polyline points="3 17 12 22 21 17"/></svg>'

/** Class-name map the shared core reads (plain stylesheet, no CSS modules). */
const css = {
  entry: 'dbl-family-entry',
  entryIcon: 'dbl-family-entry__icon',
  entryLabel: 'dbl-family-entry__label',
}

/**
 * Mount the DevBuddy sidebar row, waiting for the shell and self-healing on
 * shell re-renders.
 * @returns disposer removing the row and its observers.
 */
export function mountDevbuddySidebarEntry(options: {
  controller: PanelController
  label: () => string
  tooltip?: () => string
  locale?: LocaleRefreshSource
}): () => void {
  const { controller, label, tooltip, locale } = options
  return mountSidebarEntry({
    rowAttribute: 'data-devbuddy-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'devbuddy' as const,
    icon: ICON,
    css,
    label,
    tooltip,
    refresh: locale === undefined ? undefined : { subscribe: listener => locale.subscribe(listener) },
    onToggle: () => controller.togglePanel(),
    // Trail the existing family block (official dsh-taskboard atb entry,
    // @linxin666 task board / ssh), stable across observer-order races; the
    // core places us relative to the whole block.
    position: 'after',
    familySelectors: [
      ENTRY_SELECTOR,
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
