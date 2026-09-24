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
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { DevBuddyStore } from './host/store.ts'
import { devbuddyRoutes } from './host/routes.ts'
import { AiSessionService, type SessionControllerLike } from './host/ai-session.ts'
import { workspaceInfoProvider, workspaceEnsurer, workspaceArchiveChecker, type WorkspaceRegistryLike } from './host/workspaces.ts'

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
    store.attachWorkspaceArchiveChecker(workspaceArchiveChecker(registry))
  })

  // Document-scoped AI session: resolve the platform session-controller
  // lazily (same structural pattern as the reviewer plugin). Until it is
  // published, AI dispatch degrades to delivered:false.
  let sessionController: SessionControllerLike | null = null
  ctx.inject(['sessionController'], (sessionCtx) => {
    sessionController = (sessionCtx as unknown as { sessionController: SessionControllerLike }).sessionController
  })
  const aiService = new AiSessionService(
    () => sessionController,
    projectId => store.resolveAiContext(projectId),
    sessionId => store.isSessionArchived(sessionId),
  )

  // "创建新会话": create a session in the project's workspace and queue a
  // welcome prompt into it. A session with a committed turn is persisted; a
  // blank session would be dropped when navigating away. We don't follow the
  // assistant reply — the prompt is just the persistence marker.
  store.attachSessionBootstrapper(async (path, workspaceId, welcome) => {
    const controller = sessionController
    if (controller === null) return null
    try {
      const created = await controller.create(
        workspaceId !== null ? { workspaceId } : { cwd: path },
      )
      const id = created?.sessionId ?? created?.id
      if (typeof id !== 'string' || id === '') return null
      await controller.prompt(
        {
          requestId: randomUUID(),
          sessionId: id,
          mode: 'queue',
          content: [{ type: 'text', text: welcome }],
        },
        AbortSignal.timeout(60_000),
      )
      return id
    } catch {
      return null
    }
  })

  ctx.effect(() => {
    const disposers = devbuddyRoutes(store, excalidrawBundlePath, aiService)
      .map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devbuddy-left: loopback api')
  process.stderr.write('[dsh-devbuddy-left] host API mounted at /api/devbuddy-left\n')
}
