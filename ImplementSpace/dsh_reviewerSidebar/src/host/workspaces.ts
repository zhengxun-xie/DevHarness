/**
 * Structural bridge to the platform's workspaceRegistry service — copied from
 * dsh-devbuddy-left (no package coupling). cordis services are reached
 * structurally, the same way dsh-taskboard injects `workspaceRegistry`.
 */
import type { WorkspaceInfo } from '../protocol.ts'

export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
}

/** Live reader: every call re-lists, so new workspaces/sessions show up. */
export function workspaceInfoProvider(registry: WorkspaceRegistryLike): () => readonly WorkspaceInfo[] {
  return () => {
    let rows: readonly WorkspaceLike[]
    try {
      rows = registry.list()
    } catch {
      return []
    }
    return rows.map((workspace) => {
      let sessionCount = 0
      try {
        sessionCount = workspace.sessionIds.length
      } catch {
        // A vanished session header must not blank the whole list.
      }
      return {
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        sessionCount,
      }
    })
  }
}
