/**
 * DevTask host half.
 *
 * Registers the loopback JSON API backing the DevTask left-sidebar panel:
 * board-view (header tab) CRUD plus task CRUD. The browser half ships in
 * ./client (see src/client/index.tsx); the two communicate over
 * /api/devtask/* on ctx.webServer.
 *
 * The panel is a left-sidebar family sibling of DevBuddy and DevReviewer:
 * distinct bundle id, distinct API prefix, and its own on-disk registry
 * ($DSH_HOME/devtask/registry.json).
 *
 * @module dsh-devtask
 */
import type { Context } from '@deepseek-ai/cordis'
import { DevTaskStore } from './host/store.ts'
import { devtaskRoutes } from './host/routes.ts'

export const name = 'dsh-devtask'
export const inject = ['webServer']

/**
 * Mount the DevTask API for the lifetime of the plugin fiber.
 * @param ctx - host context carrying the webServer carrier service.
 */
export function apply(ctx: Context): void {
  const store = new DevTaskStore()

  ctx.effect(() => {
    const disposers = devtaskRoutes(store).map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devtask: loopback api')
  process.stderr.write('[dsh-devtask] host API mounted at /api/devtask\n')
}