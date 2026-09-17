/**
 * Thin structural adapter over the platform session-controller Remote service
 * (design/07 §4). The service package is not an installed dependency, so —
 * exactly like workspaces.ts does for workspaceRegistry — we declare the
 * minimal wire shape and let cordis resolve it via the 'sessionController'
 * token (typert namespace 'session', service @deepseek-ai/dsh-api-session-controller).
 *
 * Dispatch resolution:
 *   explicit sessionId      -> prompt that session
 *   linked workspace        -> reuse its last known session, else create one
 *   no workspace / no API   -> delivered:false (the UI copies the context or
 *                              asks the user to bind the workspace in the left bar)
 *
 * Failure anywhere never throws past the route: the caller gets the assembled
 * context with delivered:false and can fall back to copy/prefill.
 */
import { randomUUID } from 'node:crypto'
import {
  loadRegistry,
  requireProject,
  resolveWorkspace,
} from './projects.ts'
import type { WorkspaceInfo } from '../protocol.ts'
import type { WorkspaceRegistryLike } from './workspaces.ts'

export interface SessionControllerLike {
  create(req: {
    workspaceId?: string
    cwd?: string
    sessionId?: string
    agentPreset?: string
  }): Promise<{ sessionId?: string; id?: string } | void>
  prompt(
    req: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: Array<{
        type: 'text'
        text: string
      }>
      clientTimeZone?: string
    },
    // Mandatory on the platform service: its first statement is
    // `signal.throwIfAborted()`. The Remote direct-call path forwards this
    // second arg verbatim, so omitting it throws a TypeError before admission.
    signal: AbortSignal,
  ): Promise<{ accepted?: boolean } | void>
}

export interface DispatchResult {
  delivered: boolean
  sessionId: string | null
  /**
   * The prompt request id (user/message source rpcId) for a delivered run.
   * Used to correlate the agent's streamed reply back into the review thread.
   */
  requestId: string | null
  reason:
    | 'sent'
    | 'dry-run'
    | 'no-workspace'
    | 'no-session-controller'
    | 'controller-error'
}

/** Resolve the project's linked workspace (explicit id, then realpath auto). */
export function resolveProjectWorkspace(
  projectId: string,
  workspaces: readonly WorkspaceInfo[],
): { id: string } | null {
  const registry = loadRegistry()
  const project = requireProject(registry, projectId)
  return resolveWorkspace(project, workspaces)
}

/** Pick the most recent known session id of a workspace, if any. */
function existingSessionId(registry: WorkspaceRegistryLike, workspaceId: string): string | null {
  try {
    const workspace = registry.list().find(item => item.id === workspaceId)
    if (workspace === undefined) return null
    const ids = workspace.sessionIds
    return ids.length > 0 ? ids[ids.length - 1] : null
  } catch {
    return null
  }
}

export class AgentDispatcher {
  /**
   * Accessor callbacks (not captured values): cordis inject callbacks may
   * resolve after the effect that registers routes, so every dispatch reads
   * the current service bindings.
   */
  constructor(
    private readonly getController: () => SessionControllerLike | null,
    private readonly getWorkspaceRegistry: () => WorkspaceRegistryLike | null,
  ) {}

  private get controller(): SessionControllerLike | null {
    return this.getController()
  }

  /**
   * Send the assembled instruction. When `dryRun` is true nothing is sent and
   * the caller still receives the context (same assembly path — 07 §6).
   */
  async send(input: {
    projectId: string
    instruction: string
    sessionId?: string | null
    dryRun?: boolean
    workspaces: readonly WorkspaceInfo[]
  }): Promise<DispatchResult> {
    if (input.dryRun === true) {
      return { delivered: false, sessionId: null, requestId: null, reason: 'dry-run' }
    }
    if (this.controller === null) {
      return { delivered: false, sessionId: null, requestId: null, reason: 'no-session-controller' }
    }

    let sessionId: string
    if (typeof input.sessionId === 'string' && input.sessionId !== '') {
      sessionId = input.sessionId
    } else {
      const workspace = resolveProjectWorkspace(input.projectId, input.workspaces)
      if (workspace === null) {
        return { delivered: false, sessionId: null, requestId: null, reason: 'no-workspace' }
      }
      const registry = this.getWorkspaceRegistry()
      const existing = registry !== null
        ? existingSessionId(registry, workspace.id)
        : null
      if (existing !== null) {
        sessionId = existing
      } else {
        try {
          const created = await this.controller.create({ workspaceId: workspace.id })
          const createdId = (created as { sessionId?: string; id?: string } | null | undefined)?.sessionId
            ?? (created as { sessionId?: string; id?: string } | null | undefined)?.id
          if (typeof createdId !== 'string' || createdId === '') {
            return { delivered: false, sessionId: null, requestId: null, reason: 'controller-error' }
          }
          sessionId = createdId
        } catch {
          return { delivered: false, sessionId: null, requestId: null, reason: 'controller-error' }
        }
      }
    }

    // Minted before prompt: the platform stamps it onto the user/message
    // source as rpcId, which lets the session/event subscription correlate
    // this run's streamed reply back to the review thread.
    const requestId = randomUUID()
    try {
      const result = await this.controller.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{
          type: 'text',
          text: input.instruction,
        }],
        clientTimeZone:
          typeof Intl === 'object' && Intl.DateTimeFormat !== undefined
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined,
      }, new AbortController().signal)
      // The wire contract returns { accepted: true }; tolerate void on older builds.
      if (result !== undefined && result !== null && result.accepted === false) {
        return { delivered: false, sessionId, requestId: null, reason: 'controller-error' }
      }
      return { delivered: true, sessionId, requestId, reason: 'sent' }
    } catch {
      return { delivered: false, sessionId, requestId: null, reason: 'controller-error' }
    }
  }
}
