/**
 * Read-only model over the SHARED project registry owned by dsh-devbuddy-left
 * (~/.dsh/devbuddy/registry.json), plus safe in-project file access.
 *
 * Design/04 §5: this plugin must not import the left package, so the registry
 * shape and disk path are duplicated here. The left plugin owns all writes;
 * this module only reads.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { readJson } from './json-store.ts'
import type { DevBuddyRegistry, ProjectRecord, WorkspaceInfo } from '../protocol.ts'

export const REGISTRY_PATH = resolve(dshHome(), 'devbuddy', 'registry.json')

/** Thrown for 404-class errors (unknown project / missing file). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Load the shared registry; missing/corrupt yields an empty registry. */
export function loadRegistry(): DevBuddyRegistry {
  const registry = readJson<DevBuddyRegistry>(REGISTRY_PATH, { version: 1, projects: [] })
  if (!Array.isArray(registry.projects)) registry.projects = []
  return registry
}

/** Visible (non-archived) projects in their declared order. */
export function visibleProjects(registry: DevBuddyRegistry): ProjectRecord[] {
  return registry.projects
    .filter(project => project.archived !== true)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** Resolve a project id to its record (archived records excluded). */
export function requireProject(registry: DevBuddyRegistry, projectId: string): ProjectRecord {
  const project = registry.projects.find(
    candidate => candidate.id === projectId && candidate.archived !== true,
  )
  if (project === undefined) throw new NotFoundError(`unknown project: ${projectId}`)
  return project
}

/** realpathSync that tolerates a not-yet-existing leaf. */
function realpathSafe(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  if (parent === path) return path
  return resolve(realpathSafe(parent), relative(parent, path))
}

/**
 * Assert `target` stays inside `root` after symlink resolution on existing
 * prefixes. Rejects absolute and `..`-escaping relative paths.
 */
export function assertInside(root: string, target: string): void {
  const resolvedRoot = realpathSafe(resolve(root))
  const resolvedTarget = realpathSafe(resolve(target))
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes project directory: ${target}`)
  }
}

/**
 * Resolve a project-relative document path to an absolute path, asserting it
 * stays within the project. Normalises `./`, separators, and symlinks.
 */
export function resolveDocument(projectPath: string, document: string): string {
  if (typeof document !== 'string' || document.trim() === '') {
    throw new Error('document must be a non-empty project-relative path')
  }
  if (isAbsolute(document)) throw new Error('document must be a relative path')
  const root = resolve(projectPath)
  const file = resolve(root, document)
  assertInside(root, file)
  return file
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export interface DocumentRead {
  exists: boolean
  content: string
  sha: string | null
}

/** Read a project document. Missing files return exists=false. */
export function readDocument(projectPath: string, document: string): DocumentRead {
  const file = resolveDocument(projectPath, document)
  if (!existsSync(file)) return { exists: false, content: '', sha: null }
  const content = readFileSync(file, 'utf8')
  return { exists: true, content, sha: sha256(content) }
}

export interface WorkspaceProvider {
  (): readonly WorkspaceInfo[]
}

/** Resolve a project's linked workspace (explicit id wins, then realpath auto). */
export function resolveWorkspace(
  project: ProjectRecord,
  workspaces: readonly WorkspaceInfo[],
): WorkspaceInfo | null {
  if (project.workspaceId !== undefined && project.workspaceId !== null) {
    const explicit = workspaces.find(workspace => workspace.id === project.workspaceId)
    return explicit ?? null
  }
  const root = realpathSafe(resolve(project.path))
  const auto = workspaces.find((workspace) => {
    try {
      return existsSync(workspace.path) && realpathSync(workspace.path) === root
    } catch {
      return false
    }
  })
  return auto ?? null
}
