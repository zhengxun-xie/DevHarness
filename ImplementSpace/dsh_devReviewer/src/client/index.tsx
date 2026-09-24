/**
 * Browser half entry: register the DevReviewer as a right-Sidebar
 * page tab (0.1.5-rc.2 two-stage contract):
 *
 *   1. dictionaries into ctx.locale
 *   2. the tab type definition into ctx.sidebarRightTabs
 *   3. the body into the keyed 'sidebar.right.pane.tab' slot under the
 *      definition's id
 *
 * The module augmentations below make this package's locale namespace and
 * tab navigation params visible to the slot framework's mapped types.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { dictionaries, type ReviewerKey } from './locales.ts'
import { injectStyles } from './styles.ts'
import {
  REVIEWER_NS,
  REVIEWER_TAB_KIND,
  ReviewerPanel,
  type ReviewerTabParams,
} from './ReviewerPanel.tsx'

/** Body registration key (also the tab definition id). */
export const REVIEWER_ID = 'dsh-devreviewer'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DevReviewer panel copy. */
    devReviewer: ReviewerKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'devreviewer': ReviewerTabParams
  }
}

/**
 * The browser UI renderer normally contributes `ctx.slots`
 * (ui-renderer/client declares it); that package is not part of this
 * plugin's installed dependency set, so restate the structural face here.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Renderer-owned UI composition registry. */
    slots: SlotCore & {
      /** Register a slot declaration and its effect. */
      inject: (key: string, callback: () => () => void) => () => void
    }
  }
}

/** Required browser services. */
export const inject = ['locale', 'sidebarRight', 'sidebarRightTabs', 'slots']

function reviewerDefinition(t: TranslateNS<typeof REVIEWER_NS>): SidebarRightTabDefinition {
  return {
    id: REVIEWER_ID,
    kind: REVIEWER_TAB_KIND,
    priority: 'extension',
    title: () => t('tab.title'),
    guide: [
      {
        order: 90,
        title: () => t('tab.title'),
        description: () => t('tab.guideDescription'),
      },
    ],
  }
}

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  injectStyles()
  const t = ctx.locale.bind(REVIEWER_NS)
  ctx.effect(
    () => ctx.locale.register(REVIEWER_NS, dictionaries),
    'dsh-devreviewer: dictionaries',
  )
  ctx.effect(
    () => ctx.sidebarRightTabs.register(reviewerDefinition(t)),
    'dsh-devreviewer: tab type',
  )
  ctx.effect(
    () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: REVIEWER_ID, locale: REVIEWER_NS },
      ReviewerPanel,
    )),
    'dsh-devreviewer: tab body',
  )
}
