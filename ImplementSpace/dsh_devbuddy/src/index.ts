/**
 * DevBuddy host half (LEFT-sidebar implementation).
 *
 * Registers the loopback JSON API backing the DevBuddy left-sidebar global
 * panel: project registry CRUD plus node file reads/writes. The browser half
 * ships in ./client (see src/client/index.ts); the two communicate over
 * /api/devbuddy-left/* on ctx.webServer.
 *
 * @module dsh-devbuddy-left
 */
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { DevBuddyStore } from './host/store.ts'
import { devbuddyRoutes } from './host/routes.ts'
import { workspaceInfoProvider, workspaceEnsurer, type WorkspaceRegistryLike } from './host/workspaces.ts'

export const name = 'dsh-devbuddy-left'
export const inject = ['webServer']

/**
 * Mount the DevBuddy API for the lifetime of the plugin fiber.
 * @param ctx - host context carrying the webServer carrier service.
 */
export function apply(ctx: Context): void {
  const store = new DevBuddyStore()

  // excalidraw-bundle.js is built alongside this index.js in lib/; the host
  // serves it at GET /api/devbuddy-left/excalidraw-bundle.js so the browser
  // can lazy-load Excalidraw without bundling it into the main client.js.
  const excalidrawBundlePath = fileURLToPath(new URL('./excalidraw-bundle.js', import.meta.url))

  // Attach the platform workspace registry lazily (same injection style as
  // dsh-taskboard): if the service is absent at startup the link projection
  // simply stays null until cordis publishes it.
  ctx.inject(['workspaceRegistry'], (wsCtx) => {
    const registry = (wsCtx as unknown as { workspaceRegistry: WorkspaceRegistryLike }).workspaceRegistry
    store.attachWorkspaceProvider(workspaceInfoProvider(registry))
    store.attachWorkspaceEnsurer(workspaceEnsurer(registry))
  })

  ctx.effect(() => {
    const disposers = devbuddyRoutes(store, excalidrawBundlePath).map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devbuddy-left: loopback api')
  process.stderr.write('[dsh-devbuddy-left] host API mounted at /api/devbuddy-left\n')
}
