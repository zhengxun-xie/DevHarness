/**
 * DevReviewer host half (RIGHT-sidebar implementation).
 *
 * Registers the loopback JSON API backing the Reviewer right-sidebar tab:
 * review CRUD over Markdown records, anchor resolution, the review lifecycle
 * state machine, agent context assembly and session dispatch.
 *
 * The browser half ships in ./client (src/client/index.tsx); the two
 * communicate over /api/devreviewer/* on ctx.webServer. The plugin shares the
 * on-disk project registry with dsh-devbuddy-left but never imports it.
 *
 * @module dsh-devreviewer
 */
import type { Context } from '@deepseek-ai/cordis'
import { ReviewStore } from './host/review-store.ts'
import { reviewerRoutes } from './host/routes.ts'
import {
  workspaceInfoProvider,
  type WorkspaceRegistryLike,
} from './host/workspaces.ts'
import {
  AgentDispatcher,
  type AgentRegistryLike,
  type SessionControllerLike,
  type TeamServiceLike,
} from './host/agent-dispatch.ts'
import { registerSessionFeed } from './host/session-feed.ts'

export const name = 'dsh-devreviewer'
export const inject = ['webServer']

/**
 * Mount the Reviewer API for the lifetime of the plugin fiber.
 * @param ctx - host context carrying the webServer carrier service.
 */
export function apply(ctx: Context): void {
  const store = new ReviewStore()
  let workspaceRegistry: WorkspaceRegistryLike | null = null
  let sessionController: SessionControllerLike | null = null
  let agentTeams: TeamServiceLike | null = null
  let agentRegistry: AgentRegistryLike | null = null

  // Platform services are attached lazily/structurally (same style as
  // dsh-taskboard): if a service is absent, the dependent feature degrades
  // (workspace link stays null / agent send returns delivered:false) rather
  // than failing plugin activation. The Agent Teams branch degrades the same
  // way (design/08 §4): without 'agentTeams'/'agents' the member picker
  // disappears and the session path stays authoritative.
  ctx.inject(['workspaceRegistry'], (wsCtx) => {
    const registry = (wsCtx as unknown as { workspaceRegistry: WorkspaceRegistryLike }).workspaceRegistry
    workspaceRegistry = registry
    store.attachWorkspaceProvider(workspaceInfoProvider(registry))
  })

  ctx.inject(['sessionController'], (sessionCtx) => {
    sessionController = (sessionCtx as unknown as { sessionController: SessionControllerLike }).sessionController
  })

  ctx.inject(['agentTeams'], (teamCtx) => {
    agentTeams = (teamCtx as unknown as { agentTeams: TeamServiceLike }).agentTeams
  })

  ctx.inject(['agents'], (agentsCtx) => {
    agentRegistry = (agentsCtx as unknown as { agents: AgentRegistryLike }).agents
  })

  ctx.effect(() => {
    const dispatcher = new AgentDispatcher(
      () => sessionController,
      () => workspaceRegistry,
      () => agentTeams,
      () => agentRegistry,
    )
    // The dispatcher doubles as the review↔session lifecycle adapter
    // (design/09): create/rename/archive/unarchive the review's 1:1 session.
    store.attachSessionLifecycle(dispatcher)
    const disposers = reviewerRoutes(store, dispatcher).map(route => ctx.webServer.register(route))
    // Correlate dispatched runs (prompt requestId -> user/message rpcId ->
    // turn assistant text -> agent-authored review thread comment).
    const disposeFeed = registerSessionFeed(ctx, store)
    disposers.push(disposeFeed)
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devreviewer: loopback api')

  process.stderr.write('[dsh-devreviewer] host API mounted at /api/devreviewer\n')
}
