/**
 * DevBuddy project registry operations.
 *
 * The registry is the only global state: $DSH_HOME/devbuddy/registry.json —
 * SHARED with the right-sidebar implementation, so projects created in either
 * surface appear in both. All project content lives in each project's own
 * directory. Removing a project never touches project files.
 */
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CreateDrawingResult,
  DevBuddyRegistry,
  DevBuddyState,
  DrawingView,
  NodeView,
  ProjectRecord,
  ProjectSummary,
  WorkspaceInfo,
  WorkspaceLink,
} from '../protocol.ts'
import { REGISTRY_VERSION } from '../protocol.ts'
import { readJson, withLockedJson } from './json-store.ts'
import { dshHome, expandHome } from './dsh-home.ts'
import {
  NODE_REGISTRY,
  nextDrawingSrc,
  projectNodes,
  readDrawingFile,
  readNode,
  requireNode,
  writeDrawingFile,
  writeNode,
} from './node-files.ts'

function emptyRegistry(): DevBuddyRegistry {
  return { version: REGISTRY_VERSION, projects: [], activeProjectId: null }
}

/**
 * Source of DSH workspace facts. Attached lazily from the plugin fiber once
 * cordis publishes the workspaceRegistry service (the service is a browser/
 * host platform service, not part of this package — structural typing keeps
 * the dependency edge one-way).
 */
export type WorkspaceProvider = () => readonly WorkspaceInfo[]

/**
 * Idempotent "ensure a DSH workspace exists for this directory" action;
 * resolves true when the workspace exists afterwards. Attached lazily from
 * the plugin fiber alongside the provider.
 */
export type WorkspaceEnsurer = (path: string, title?: string) => Promise<boolean>

/** Host-side DevBuddy facade over the registry and project files. */
export class DevBuddyStore {
  private readonly registryPath: string
  private workspaceProvider: WorkspaceProvider | null = null
  private workspaceEnsurer: WorkspaceEnsurer | null = null
  private workspaceArchiveChecker: ((sessionId: string) => boolean) | null = null

  constructor(dshHomeDir: string = dshHome()) {
    this.registryPath = resolve(dshHomeDir, 'devbuddy', 'registry.json')
  }

  /** Wire the live DSH workspace registry (called from ctx.inject). */
  attachWorkspaceProvider(provider: WorkspaceProvider): void {
    this.workspaceProvider = provider
  }

  /** Wire the idempotent workspace-ensure action (called from ctx.inject). */
  attachWorkspaceEnsurer(ensurer: WorkspaceEnsurer): void {
    this.workspaceEnsurer = ensurer
  }

  /** Wire the archive-membership test (called from ctx.inject). */
  attachWorkspaceArchiveChecker(checker: (sessionId: string) => boolean): void {
    this.workspaceArchiveChecker = checker
  }

  /** Whether a session is archived. False when the registry is unavailable. */
  isSessionArchived(sessionId: string): boolean {
    return this.workspaceArchiveChecker?.(sessionId) ?? false
  }

  /** All DSH workspaces for the binding picker; [] while the service is absent. */
  listWorkspaces(): WorkspaceInfo[] {
    return [...(this.workspaceProvider?.() ?? [])]
  }

  /**
   * Best-effort: make the project directory a DSH workspace so a brand-new
   * project is addressable from the workspace status bar immediately. Never
   * throws — a fresh project must succeed even when the platform registry is
   * absent or creation fails.
   */
  private async ensureWorkspaceFor(path: string, title: string): Promise<void> {
    if (this.workspaceEnsurer === null) return
    const created = await this.workspaceEnsurer(path, title)
    if (!created) {
      process.stderr.write(`[dsh-devbuddy-left] could not auto-create workspace for ${path}\n`)
    }
  }

  private load(): DevBuddyRegistry {
    const registry = readJson<DevBuddyRegistry>(this.registryPath, emptyRegistry())
    if (!Array.isArray(registry.projects)) return emptyRegistry()
    return registry
  }

  private visible(registry: DevBuddyRegistry): ProjectRecord[] {
    return registry.projects
      .filter(p => !p.archived)
      .sort((a, b) => a.order - b.order)
  }

  /** Full state for the browser: summaries only (no file contents). */
  state(): DevBuddyState {
    const registry = this.load()
    return {
      projects: this.visible(registry).map(p => this.summarize(p)),
      activeProjectId: registry.activeProjectId,
    }
  }

  private summarize(record: ProjectRecord): ProjectSummary {
    let nodes = [] as ProjectSummary['nodes']
    try {
      nodes = projectNodes(record.path)
    } catch {
      // A missing/offline project directory must not poison the whole board.
      nodes = []
    }
    return { ...record, nodes, workspace: this.resolveWorkspace(record) }
  }

  /**
   * Resolve the project's DSH workspace link:
   *   1. an explicit stored workspaceId wins, as long as that workspace exists
   *   2. otherwise match on canonical path (realpath) — the DSH workspace
   *      registry stores the realpath of the session cwd
   *   3. else null (no workspace was ever opened in that directory)
   * A stale explicit id (workspace since deleted) transparently falls back to
   * path auto-match; the stored override is left untouched so a re-created id
   * reconnects, and 改绑/自动匹配 can clear it deliberately.
   */
  private resolveWorkspace(record: ProjectRecord): WorkspaceLink | null {
    const workspaces = this.workspaceProvider?.() ?? []
    if (workspaces.length === 0) return null
    const canonical = (() => {
      try { return realpathSync(record.path) } catch { return record.path }
    })()
    if (record.workspaceId !== null && record.workspaceId !== undefined) {
      const chosen = workspaces.find(ws => ws.id === record.workspaceId)
      if (chosen !== undefined) {
        return {
          kind: 'explicit',
          workspaceId: chosen.id,
          title: chosen.title,
          samePath: chosen.path === canonical,
          sessionCount: chosen.sessionCount,
        }
      }
    }
    const match = workspaces.find(ws => ws.path === canonical)
    if (match === undefined) return null
    return {
      kind: 'auto',
      workspaceId: match.id,
      title: match.title,
      samePath: true,
      sessionCount: match.sessionCount,
    }
  }

  private requireProject(registry: DevBuddyRegistry, id: string): ProjectRecord {
    const project = registry.projects.find(p => p.id === id && !p.archived)
    if (project === undefined) throw new Error(`project not found: ${id}`)
    return project
  }

  /**
   * Register a new project.
   *
   * Path handling: a leading `~` expands to the home directory; a bare
   * relative path is rejected (it would otherwise resolve against the DSH
   * process cwd); missing leaf directories are created. When the directory is
   * fresh, the two M0 node files are seeded from templates — existing files
   * are never overwritten (importing an existing project adopts them).
   */
  async createProject(input: { name: string; path: string }): Promise<ProjectSummary> {
    const name = input.name?.trim()
    const rawPath = input.path?.trim()
    if (!name) throw new Error('project name is required')
    if (!rawPath) throw new Error('project path is required')
    const expanded = expandHome(rawPath)
    if (!isAbsolute(expanded)) {
      throw new Error(`project path must be absolute (you can use ~ for the home directory): ${rawPath}`)
    }
    const absolute = resolve(expanded)
    if (existsSync(absolute)) {
      if (!statSync(absolute).isDirectory()) {
        throw new Error(`project path exists and is not a directory: ${absolute}`)
      }
    } else {
      mkdirSync(absolute, { recursive: true })
    }
    const now = new Date().toISOString()
    let record: ProjectRecord | undefined
    await withLockedJson<DevBuddyRegistry>(this.registryPath, emptyRegistry(), registry => {
      if (registry.projects.some(p => !p.archived && p.path === absolute)) {
        throw new Error(`a project already uses this directory: ${absolute}`)
      }
      record = {
        id: `p_${randomUUID().slice(0, 8)}`,
        name,
        path: absolute,
        order: registry.projects.reduce((max, p) => Math.max(max, p.order), -1) + 1,
        archived: false,
        createdAt: now,
        lastOpenedAt: now,
      }
      registry.projects.push(record)
      registry.activeProjectId = record.id
      return registry
    })
    const created = record as ProjectRecord
    this.seedNodes(absolute, name, now)
    // A fresh project becomes a DSH workspace immediately (idempotent: an
    // existing same-path workspace is reused untouched); best-effort so a
    // registry fault never blocks project creation.
    await this.ensureWorkspaceFor(absolute, name)
    return this.summarize(created)
  }

  /** Seed missing node files for a freshly registered project; never overwrite. */
  private seedNodes(projectPath: string, name: string, now: string): void {
    const seeds: Record<string, string> = {
      project_info: [
        `# ${name}`,
        '',
        `- 名称：${name}`,
        `- 工作目录：${projectPath}`,
        `- 创建时间：${now}`,
        '',
        '## 项目简介',
        '',
        '（在此描述这个项目是做什么的、技术栈、关键约束。）',
        '',
      ].join('\n'),
      intend_init: [
        '# 设计目标',
        '',
        '（在此阐述项目整体的意图、要解决的问题与初步设计思路。）',
        '',
      ].join('\n'),
    }
    for (const descriptor of NODE_REGISTRY) {
      const template = seeds[descriptor.id]
      if (template === undefined) continue
      const current = readNode(projectPath, descriptor)
      if (current.exists) continue
      writeNode(projectPath, descriptor, template)
    }
  }

  /** Remove the registry row only; project files are never deleted. */
  async removeProject(id: string): Promise<DevBuddyState> {
    await withLockedJson<DevBuddyRegistry>(this.registryPath, emptyRegistry(), current => {
      const project = current.projects.find(p => p.id === id)
      if (project === undefined) throw new Error(`project not found: ${id}`)
      project.archived = true
      if (current.activeProjectId === id) {
        current.activeProjectId = current.projects.find(p => !p.archived)?.id ?? null
      }
      return current
    })
    return this.state()
  }

  /** Mark a project active (selected tab) and refresh its lastOpenedAt. */
  async openProject(id: string): Promise<DevBuddyState> {
    await withLockedJson<DevBuddyRegistry>(this.registryPath, emptyRegistry(), current => {
      const project = this.requireProject(current, id)
      current.activeProjectId = id
      project.lastOpenedAt = new Date().toISOString()
      return current
    })
    return this.state()
  }

  /**
   * Set (or clear with null) the explicit workspace binding of a project.
   * Clearing reverts to canonical-path auto matching. The target workspace
   * must currently exist in the DSH registry.
   */
  async bindProject(id: string, workspaceId: string | null): Promise<DevBuddyState> {
    if (workspaceId !== null
      && !this.listWorkspaces().some(workspace => workspace.id === workspaceId)) {
      throw new Error(`workspace not found: ${workspaceId}`)
    }
    await withLockedJson<DevBuddyRegistry>(this.registryPath, emptyRegistry(), current => {
      const project = this.requireProject(current, id)
      project.workspaceId = workspaceId
      return current
    })
    return this.state()
  }

  /**
   * Resolve the context the document-scoped AI session needs: the project's
   * absolute path plus its linked workspace id (null when unbound — the AI
   * session then falls back to create-by-cwd). Throws for an unknown project.
   */
  resolveAiContext(projectId: string): { path: string; workspaceId: string | null } {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    return { path: project.path, workspaceId: this.resolveWorkspace(project)?.workspaceId ?? null }
  }

  /** Read one node file for one project. */
  readNodeView(projectId: string, nodeId: string): NodeView {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    const descriptor = requireNode(nodeId)
    const read = readNode(project.path, descriptor)
    return {
      projectId,
      nodeId: descriptor.id,
      file: descriptor.file,
      absolutePath: resolve(project.path, descriptor.file),
      exists: read.exists,
      content: read.content,
      sha: read.sha,
    }
  }

  /** Write one node file for one project. */
  writeNodeView(projectId: string, nodeId: string, content: string, expectedSha?: string | null): { sha: string } {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    const descriptor = requireNode(nodeId)
    const sha = writeNode(project.path, descriptor, content, expectedSha)
    return { sha }
  }

  // --- Embedded drawing (Excalidraw) scenes -------------------------------

  /** Read one drawing scene file for one project. */
  readDrawingView(projectId: string, src: string): DrawingView {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    const read = readDrawingFile(project.path, src)
    return { projectId, src, exists: read.exists, content: read.content }
  }

  /**
   * Write one drawing scene. Content must parse as an Excalidraw scene JSON
   * object (type 'excalidraw' with an elements array) so a stray request
   * can never drop arbitrary bytes into a `.excalidraw` file.
   */
  writeDrawingView(projectId: string, src: string, content: string): void {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    let scene: unknown
    try {
      scene = JSON.parse(content)
    } catch {
      throw new Error('drawing content must be valid JSON')
    }
    const record = scene as { type?: unknown; elements?: unknown }
    if (record.type !== 'excalidraw' || !Array.isArray(record.elements)) {
      throw new Error('drawing content must be an excalidraw scene (type: "excalidraw")')
    }
    writeDrawingFile(project.path, src, content)
  }

  /**
   * Allocate and seed a new empty drawing, returning its project-relative
   * src. The client inserts a `![[src]]` reference at the cursor, then the
   * user opens the drawing to edit it.
   */
  createDrawingView(projectId: string): CreateDrawingResult {
    const registry = this.load()
    const project = this.requireProject(registry, projectId)
    const src = nextDrawingSrc(project.path)
    writeDrawingFile(project.path, src, emptyDrawingScene())
    return { src }
  }
}

/** Fresh Excalidraw scene JSON, matching the editor's serialized shape. */
function emptyDrawingScene(): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    files: {},
  })
}
