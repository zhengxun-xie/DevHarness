/**
 * Structural bridge to the platform's workspaceRegistry service
 * (`@deepseek-ai/dsh-workspace`, provided by the DSH host).
 *
 * The plugin must not take a package dependency on the host-side workspace
 * package (the browser bundle ships standalone); cordis services are reached
 * structurally, the same way dsh-taskboard injects `workspaceRegistry`. The
 * surface we need is tiny: ordered entities carrying id/path/title and their
 * accounted session ids.
 */
import type { WorkspaceInfo } from '../protocol.ts'

/** Subset of dsh-workspace's Workspace entity. */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  /** Getter filters stored ids against still-readable session headers. */
  readonly sessionIds: readonly string[]
}

/** Subset of the injected workspaceRegistry service. */
export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
  /**
   * Idempotent create-by-path (realpath-normalized internally; an existing
   * same-path workspace is returned unchanged, title never overwritten).
   * Optional so older hosts lacking it degrade gracefully.
   */
  create?(path: string, title?: string): Promise<unknown>
  /**
   * Registry-global archive set. Archiving hides a session from every grouping
   * surface but keeps its `sessionIds` slot. Optional so older hosts degrade.
   */
  archivedSessionIds?: readonly string[]
}

/**
 * Build an archive-membership test over the registry. Returns false when the
 * registry (or its archive set) is unavailable, so an unknown state never
 * invalidates an existing binding.
 */
export function workspaceArchiveChecker(registry: WorkspaceRegistryLike): (sessionId: string) => boolean {
  return (sessionId: string) => {
    try {
      return registry.archivedSessionIds?.includes(sessionId) ?? false
    } catch {
      return false
    }
  }
}

/**
 * Build a live reader over the registry. Every call re-lists, so workspace
 * creation / session attachment show up on the next panel refresh without any
 * event wiring. Read faults degrade to empty rather than failing /state.
 */
export function workspaceInfoProvider(registry: WorkspaceRegistryLike): () => readonly WorkspaceInfo[] {
  return () => {
    let rows: readonly WorkspaceLike[]
    try {
      rows = registry.list()
    } catch {
      return []
    }
    let archived: readonly string[] = []
    try {
      archived = registry.archivedSessionIds ?? []
    } catch {
      // Without the archive set, treat every session as live.
    }
    return rows.map((workspace) => {
      let sessionIds: readonly string[] = []
      try {
        sessionIds = workspace.sessionIds
      } catch {
        // A vanished session header must not blank the whole workspace list.
      }
      // sessionIds is ordered newest-first (bootstrap sorts headers by
      // createdAt desc; attachSession prepends). Skip archived sessions: a
      // project switch must not land on a hidden-from-surface conversation.
      let latestSessionId: string | null = null
      for (const id of sessionIds) {
        if (!archived.includes(id)) { latestSessionId = id; break }
      }
      return {
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        sessionCount: sessionIds.length,
        latestSessionId,
      }
    })
  }
}

/**
 * Build an idempotent "ensure a DSH workspace exists for this directory"
 * action for use at project-creation time. Returns true when a workspace now
 * exists for the path (created or already present); false when the platform
 * lacks the create capability or creation failed — callers keep the project
 * creation independent of this result.
 */
export function workspaceEnsurer(
  registry: WorkspaceRegistryLike,
): (path: string, title?: string) => Promise<boolean> {
  return async (path, title) => {
    if (typeof registry.create !== 'function') return false
    try {
      await registry.create(path, title)
      return true
    } catch {
      return false
    }
  }
}
