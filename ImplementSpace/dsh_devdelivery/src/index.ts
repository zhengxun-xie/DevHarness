import type { Context } from '@deepseek-ai/cordis'
import { DeliveryStore } from './host/store.ts'
import { deliveryRoutes } from './host/routes.ts'

export const name = 'dsh-devdelivery'
export const inject = ['webServer']

/** Mount the credential-free local delivery registry and loopback API. */
export function apply(ctx: Context): void {
  const store = new DeliveryStore()
  ctx.effect(() => {
    const disposers = deliveryRoutes(store).map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devdelivery: loopback api')
  process.stderr.write('[dsh-devdelivery] host API mounted at /api/devdelivery\n')
}
