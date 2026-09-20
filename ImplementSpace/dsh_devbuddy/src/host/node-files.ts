/**
 * Node registry + safe project file access.
 *
 * Nodes are a descriptor table, not hard-coded UI: later milestones register
 * spec/tasks/sessions/review/memory here without touching the panel shell.
 * Every path is resolved against the project directory and must resolve back
 * inside it (symlink-aware) — the browser never touches the filesystem.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { NodeId, NodeMeta } from '../protocol.ts'
import { NODE_IDS } from '../protocol.ts'

/** Static descriptor for one workflow node. */
export interface NodeDescriptor {
  id: string
  title: string
  /** Path relative to the project root. */
  file: string
  /**
   * Previous on-disk file names kept for one-shot migration, most recent
   * predecessor first. When `file` is absent but one of these exists, reads
   * fall back to the first hit and the first write renames it onto `file`.
   */
  legacyFiles?: readonly string[]
  /** Human description shown as the node's subtitle. */
  description: string
}

/**
 * The node table. M0 ships the two nodes below; the rest
 * (spec / tasks / sessions / review / memory) register in M1+.
 */
export const NODE_REGISTRY: readonly NodeDescriptor[] = [
  {
    id: 'project_info',
    title: '项目属性',
    file: 'ProjectInfo.md',
    legacyFiles: ['project_info.md'],
    description: '项目名称、工作目录、项目信息等（ProjectInfo.md）',
  },
  {
    id: 'intend_init',
    title: '设计目标',
    file: 'CoreRequirements.md',
    legacyFiles: ['ProjectGoal.md', 'IntendInit.md', 'intend_init.md'],
    description: '项目整体意图、初步设计思路等（CoreRequirements.md）',
  },
]

const BY_ID = new Map<string, NodeDescriptor>(NODE_REGISTRY.map(n => [n.id, n]))

/** Resolve a node id to its descriptor; unknown ids throw. */
export function requireNode(nodeId: NodeId): NodeDescriptor {
  const descriptor = BY_ID.get(nodeId)
  if (descriptor === undefined) {
    throw new Error(`unknown node: ${String(nodeId)} (known: ${NODE_IDS.join(', ')})`)
  }
  return descriptor
}

/** realpathSync that tolerates a not-yet-existing leaf. */
function realpathSafe(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  if (parent === path) return path
  return resolve(realpathSafe(parent), relative(parent, path))
}

/**
 * Assert `target` stays inside `root`, after symlink resolution on the
 * existing prefixes. Throws on escape attempts.
 */
export function assertInside(root: string, target: string): void {
  const resolvedRoot = realpathSafe(resolve(root))
  const resolvedTarget = realpathSafe(resolve(target))
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes project directory: ${target}`)
  }
}

/** Absolute node file path, validated to stay within the project. */
export function nodeFilePath(projectPath: string, descriptor: NodeDescriptor): string {
  const root = resolve(projectPath)
  const file = resolve(root, descriptor.file)
  assertInside(root, file)
  return file
}

/**
 * Absolute path that currently holds the node's bytes: the canonical file,
 * or the first existing legacy predecessor while the one-shot migration has
 * not run yet.
 */
function existingFilePath(projectPath: string, descriptor: NodeDescriptor): string | null {
  const canonical = nodeFilePath(projectPath, descriptor)
  if (existsSync(canonical)) return canonical
  const root = resolve(projectPath)
  for (const legacyName of descriptor.legacyFiles ?? []) {
    const legacy = resolve(root, legacyName)
    assertInside(root, legacy)
    if (existsSync(legacy)) return legacy
  }
  return null
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Read a node file. Missing files return exists=false with empty content. */
export function readNode(projectPath: string, descriptor: NodeDescriptor): {
  exists: boolean
  content: string
  sha: string | null
  updatedAt: string | null
} {
  const file = existingFilePath(projectPath, descriptor)
  if (file === null) return { exists: false, content: '', sha: null, updatedAt: null }
  const content = readFileSync(file, 'utf8')
  return {
    exists: true,
    content,
    sha: sha256(content),
    updatedAt: statSync(file).mtime.toISOString(),
  }
}

/**
 * Write a node file atomically (mkdir parent, tmp+rename). Optimistic
 * concurrency: when expectedSha is supplied, the current bytes must match.
 *
 * If the canonical file is absent but a legacy predecessor exists, the most
 * recent existing one is renamed onto the canonical path first — the first
 * save after a default file-name change completes the one-shot migration.
 * @returns the new sha.
 */
export function writeNode(
  projectPath: string,
  descriptor: NodeDescriptor,
  content: string,
  expectedSha?: string | null,
): string {
  const file = nodeFilePath(projectPath, descriptor)
  if (expectedSha !== undefined && expectedSha !== null) {
    const current = readNode(projectPath, descriptor)
    if (current.sha !== expectedSha) {
      throw new Error('node content changed on disk: reload before saving')
    }
  }
  if (!existsSync(file)) {
    const root = resolve(projectPath)
    for (const legacyName of descriptor.legacyFiles ?? []) {
      const legacy = resolve(root, legacyName)
      assertInside(root, legacy)
      if (existsSync(legacy)) {
        renameSync(legacy, file)
        break
      }
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
  return sha256(content)
}

/** Build the node meta list for one project. */
export function projectNodes(projectPath: string): NodeMeta[] {
  return NODE_REGISTRY.map(descriptor => {
    const read = readNode(projectPath, descriptor)
    return {
      id: descriptor.id,
      title: descriptor.title,
      file: descriptor.file,
      exists: read.exists,
      sha: read.sha,
      updatedAt: read.updatedAt,
    }
  })
}

/* --- Embedded drawing (Excalidraw) scene files --------------------------
   Drawings are their own project files; the markdown document references
   them only by a project-relative src (`![[diagram-1.excalidraw]]`). The
   same trust model as node files: every path resolves back inside the
   project (symlink-aware); writes are atomic tmp+rename. */

/** Required suffix for a drawing reference. */
export const DRAWING_EXTENSION = '.excalidraw'

/** Validate a project-relative drawing src and return its absolute path. */
export function drawingFilePath(projectPath: string, src: string): string {
  const normalized = src.replace(/\\/g, '/')
  if (normalized.length === 0 || normalized.includes('\0') || isAbsolute(normalized)) {
    throw new Error(`invalid drawing src: ${src}`)
  }
  if (!normalized.endsWith(DRAWING_EXTENSION)) {
    throw new Error(`drawing src must end with ${DRAWING_EXTENSION}: ${src}`)
  }
  const root = resolve(projectPath)
  const file = resolve(root, normalized)
  assertInside(root, file)
  return file
}

/** Read one drawing scene. Missing files return exists=false, empty content. */
export function readDrawingFile(projectPath: string, src: string): {
  exists: boolean
  content: string
} {
  const file = drawingFilePath(projectPath, src)
  if (!existsSync(file)) return { exists: false, content: '' }
  return { exists: true, content: readFileSync(file, 'utf8') }
}

/** Write one drawing scene atomically (mkdir parent, tmp+rename). */
export function writeDrawingFile(projectPath: string, src: string, content: string): void {
  const file = drawingFilePath(projectPath, src)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

/**
 * Allocate the next free `diagram-N.excalidraw` path at the project root.
 * Pure path allocation: the file is written by the caller with the initial
 * scene JSON (see emptyDrawingScene in store.ts).
 */
export function nextDrawingSrc(projectPath: string): string {
  const root = resolve(projectPath)
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = `diagram-${n}${DRAWING_EXTENSION}`
    if (!existsSync(resolve(root, candidate))) return candidate
  }
  throw new Error('could not allocate a free drawing file name')
}
