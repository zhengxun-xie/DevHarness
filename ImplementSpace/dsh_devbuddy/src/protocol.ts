/**
 * DevBuddy wire protocol: the JSON shapes exchanged between the browser panel
 * and the host half over loopback HTTP (`/api/devbuddy-left/*`). Both halves
 * import this module; the browser bundle inlines it.
 *
 * The prefix is distinct from the right-sidebar implementation
 * (`/api/devbuddy/*`) so both plugins can coexist in one web profile; the
 * on-disk registry and node files they read/write are shared.
 *
 * Endpoints (M0):
 *   GET  /api/devbuddy-left/state                    -> registry + project summaries
 *   POST /api/devbuddy-left/projects                 { name, path } -> Project
 *   POST /api/devbuddy-left/projects/:id/remove      {}            -> State
 *   POST /api/devbuddy-left/projects/:id/open        {}            -> ProjectView
 *   GET  /api/devbuddy-left/nodes/:node              -> NodeView
 *   POST /api/devbuddy-left/nodes/:node              { content, expectedSha? }
 *        -> { sha }
 *   GET  /api/devbuddy-left/workspaces               -> WorkspaceInfo[]
 *   POST /api/devbuddy-left/project/bind             { id, workspaceId: string | null }
 *        -> State
 *   GET  /api/devbuddy-left/drawing                  ?projectId&src -> DrawingView
 *   POST /api/devbuddy-left/drawing                  { projectId, src, content }
 *   POST /api/devbuddy-left/drawing/create           { projectId } -> { src }
 */

export const DEVBUDDY_API_PREFIX = '/api/devbuddy-left'

/** Registry + on-disk schema version. */
export const REGISTRY_VERSION = 1

/** The workflow nodes M0 knows. Node 3+ arrive in later milestones. */
export const NODE_IDS = ['project_info', 'intend_init'] as const

/** Node ids used across the wire; later milestones extend the union. */
export type NodeId = (typeof NODE_IDS)[number] | string

/** One registered project row in the global registry. */
export interface ProjectRecord {
  /** Stable random id. */
  id: string
  /** User-facing name, editable. */
  name: string
  /** Absolute working directory of the project. */
  path: string
  /** Header tab ordering, ascending. */
  order: number
  /** Removed tabs are hidden rather than deleted on disk. */
  archived: boolean
  /**
   * Optional explicit binding to a DSH workspace id. Absent/null means the
   * link is derived automatically by canonical-path match. Older registries
   * simply lack the field — no schema migration needed.
   */
  workspaceId?: string | null
  createdAt: string
  lastOpenedAt: string
}

/** The global registry persisted at $DSH_HOME/devbuddy/registry.json. */
export interface DevBuddyRegistry {
  version: number
  projects: ProjectRecord[]
  activeProjectId: string | null
}

/** Per-node metadata derived from the registry definition table. */
export interface NodeMeta {
  id: NodeId
  title: string
  /** File path relative to the project directory. */
  file: string
  /** Whether the node file currently exists on disk. */
  exists: boolean
  /** sha256 hex of the current bytes, or null when absent. */
  sha: string | null
  updatedAt: string | null
}

/** One DSH workspace row as projected for the binding picker. */
export interface WorkspaceInfo {
  id: string
  title: string
  path: string
  sessionCount: number
}

/**
 * Resolved link between a DevBuddy project and a DSH workspace.
 * - 'explicit': the registry stores a chosen workspaceId that exists
 * - 'auto': no explicit choice; matched by canonical (realpath) directory
 * - null: neither an explicit match nor a same-path workspace exists
 */
export interface WorkspaceLink {
  kind: 'explicit' | 'auto'
  workspaceId: string
  title: string
  /** Whether workspace.path equals the project directory (false for a
   *  manually rebound project that points at a workspace elsewhere). */
  samePath: boolean
  sessionCount: number
}

/** Project summary for the header tab strip (no file contents). */
export interface ProjectSummary extends ProjectRecord {
  nodes: NodeMeta[]
  /** Resolved DSH workspace link, when one exists. */
  workspace: WorkspaceLink | null
}

/** Full state returned by GET /state. */
export interface DevBuddyState {
  projects: ProjectSummary[]
  activeProjectId: string | null
}

/** One node file's contents. */
export interface NodeView {
  projectId: string
  nodeId: NodeId
  file: string
  /** Absolute path on the host. */
  absolutePath: string
  exists: boolean
  content: string
  sha: string | null
}

/** POST body for writing a node. */
export interface WriteNodeRequest {
  content: string
  /** Optimistic-concurrency token: reject when the on-disk sha moved. */
  expectedSha?: string | null
}

export interface WriteNodeResult {
  sha: string
}

/** POST body for setting/clearing an explicit workspace binding. */
export interface BindProjectRequest {
  id: string
  /** A workspace id to bind explicitly, or null to resume auto-match. */
  workspaceId: string | null
}

/** Generic error body. */
export interface ErrorBody {
  error: string
}

/**
 * One embedded drawing (Excalidraw scene file). Scene JSON lives in a
 * separate `.excalidraw` file next to / under the project; the markdown
 * document references it by a project-relative src through a
 * `![[diagram-1.excalidraw]]` line. Missing files report exists=false.
 */
export interface DrawingView {
  projectId: string
  /** Project-relative path (validated to stay inside the project). */
  src: string
  exists: boolean
  /** Scene JSON text; '' when the file is missing. */
  content: string
}

/** POST body for writing a drawing scene. */
export interface WriteDrawingRequest {
  src: string
  content: string
}

/** Result of POST /drawing/create: the allocated project-relative path. */
export interface CreateDrawingResult {
  src: string
}
