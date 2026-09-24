import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { dictionaries, type DeliveryKey } from './locales.ts'
import { DELIVERY_NS, DELIVERY_TAB_KIND, DeliveryPanel, type DeliveryTabParams } from './DeliveryPanel.tsx'
import { injectStyles } from './styles.ts'

export const DELIVERY_ID = 'dsh-devdelivery'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { devDelivery: DeliveryKey } }
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' { interface SidebarRightTabParamsMap { devdelivery: DeliveryTabParams } }
declare module '@deepseek-ai/cordis' { interface Context { slots: SlotCore & { inject: (key: string, callback: () => () => void) => () => void } } }
export const inject = ['locale', 'sidebarRightTabs', 'slots']
function definition(t: TranslateNS<typeof DELIVERY_NS>): SidebarRightTabDefinition { return { id: DELIVERY_ID, kind: DELIVERY_TAB_KIND, priority: 'extension', title: () => t('tab.title'), guide: [{ order: 92, title: () => t('tab.title'), description: () => t('tab.guide') }] } }
export function apply(ctx: ClientContext): void {
  injectStyles(); const t = ctx.locale.bind(DELIVERY_NS)
  ctx.effect(() => ctx.locale.register(DELIVERY_NS, dictionaries), 'dsh-devdelivery: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(definition(t)), 'dsh-devdelivery: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: DELIVERY_ID, locale: DELIVERY_NS }, DeliveryPanel)), 'dsh-devdelivery: tab body')
}
