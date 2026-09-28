/**
 * Task-log md storage（06 §6）：一条日志一个文件，YAML frontmatter 为权威
 * 数据、body 为人类可读 Markdown 投影。tmp + rename 原子发布；编辑/删除
 * 携带 sha256 乐观锁（read → validate → write，全程同步无 await 间隙，锁
 * 主要防第二份 dsh 实例）。
 *
 * 与 DevReviewer 的 review-store 同模式；区别在于编号分配在同步段完成
 * （readdir + 取最大号），单进程内并发 create 不会交错撞号。
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import type { CreateTaskLogRequest, PersistedTaskLogEntry, TaskLogEntry } from '../protocol.ts'
import { isLogSubjectKind } from '../protocol.ts'
import { isYamlObject, parseYaml, serializeYaml, type YamlObject } from './yaml-lite.ts'

const LOG_SCHEMA = 1

/** `TL-0001-slug.md`；编号 4 位起点，超过 9999 自然变 5 位（正则不锁位数）。 */
const LOG_FILE_RE = /^(TL-\d+)-.*\.md$/

/** 单条日志 body 上限，防误粘贴把目录撑爆。 */
const MAX_BODY_CHARS = 20_000

/** Optimistic-lock failure: the file changed since the caller read it. */
export class LogShaMismatchError extends Error {
  constructor(id: string) {
    super(`sha mismatch: log ${id} was modified concurrently, please refresh`)
    this.name = 'LogShaMismatchError'
  }
}

/** The addressed log file does not exist (removed or never created). */
export class LogNotFoundError extends Error {
  constructor(id: string) {
    super(`log not found: ${id}`)
    this.name = 'LogNotFoundError'
  }
}

/** A persisted entry plus the checksum of the file it came from. */
interface LoadedLog {
  entry: TaskLogEntry
  sha: string
  path: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Filesystem-safe slug for the human-readable part of the filename. */
function slugify(text: string): string {
  const slug = text.trim().replace(/[\\/:*?"<>|#\s-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug === '' ? 'entry' : slug
}

/** Frontmatter is the authority; body is the projection after the `---` fence. */
function encodeLog(entry: TaskLogEntry): string {
  const frontmatter: YamlObject = {
    schema: LOG_SCHEMA,
    id: entry.id,
    subjectId: entry.subjectId,
    subjectKind: entry.subjectKind,
    subjectTitle: entry.subjectTitle,
    kind: entry.kind,
    author: { type: entry.author.type, id: entry.author.id, displayName: entry.author.displayName },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
  return `---\n${serializeYaml(frontmatter)}---\n${entry.body}\n`
}

/** Parse one log file; malformed rows are skipped (return null), never fatal. */
function decodeLog(raw: string, path: string): LoadedLog | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (match === null) return null
  const doc = parseYaml(match[1]!)
  if (!isYamlObject(doc)) return null
  const author = doc['author']
  if (!isYamlObject(author)) return null
  const subjectKind = doc['subjectKind']
  const kind = doc['kind']
  const createdAt = doc['createdAt']
  if (typeof doc['id'] !== 'string' || !isLogSubjectKind(subjectKind)) return null
  if (kind !== 'system' && kind !== 'manual') return null
  if (typeof createdAt !== 'string') return null
  const updatedAt = doc['updatedAt']
  const body = match[2]!.replace(/\n$/, '')
  return {
    entry: {
      id: doc['id'],
      subjectId: typeof doc['subjectId'] === 'string' ? doc['subjectId'] : '',
      subjectKind,
      subjectTitle: typeof doc['subjectTitle'] === 'string' ? doc['subjectTitle'] : '',
      kind,
      author: {
        type: author['type'] === 'system' ? 'system' : 'user',
        id: typeof author['id'] === 'string' ? author['id'] : '',
        displayName: typeof author['displayName'] === 'string' ? author['displayName'] : '',
      },
      body,
      createdAt,
      updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
    },
    sha: sha256(raw),
    path,
  }
}

/** Local md store for one subject's persisted log entries. */
export class TaskLogStore {
  private readonly dir: string

  constructor(dshHomeDir: string) {
    this.dir = resolve(dshHomeDir, 'devtask', 'logs')
  }

  /** All log files (any subject), newest-first by createdAt. */
  private scan(): LoadedLog[] {
    if (!existsSync(this.dir)) return []
    const loaded: LoadedLog[] = []
    for (const name of readdirSync(this.dir)) {
      if (!LOG_FILE_RE.test(name)) continue
      let raw: string
      try {
        raw = readFileSync(resolve(this.dir, name), 'utf8')
      } catch {
        continue
      }
      const parsed = decodeLog(raw, resolve(this.dir, name))
      if (parsed !== null) loaded.push(parsed)
    }
    loaded.sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt))
    return loaded
  }

  /**
   * Persisted entries for one subject, newest-first, each carrying its
   * file sha so the client can hold the update/remove optimistic lock.
   */
  list(subjectId: string): PersistedTaskLogEntry[] {
    return this.scan()
      .filter(loaded => loaded.entry.subjectId === subjectId)
      .map(({ entry, sha }) => ({ ...entry, sha }))
  }

  /** One entry by id (any subject), for mutation ownership checks. */
  find(id: string): TaskLogEntry | null {
    return this.scan().find(loaded => loaded.entry.id === id)?.entry ?? null
  }

  /**
   * Append a new entry. The sequence number is allocated synchronously from
   * the directory listing, so concurrent calls inside this process cannot
   * interleave; a stale file from a second dsh instance just yields the next
   * free number on the following call.
   */
  create(request: CreateTaskLogRequest & { kind: 'system' | 'manual' }): TaskLogEntry {
    const body = request.body.trim().slice(0, MAX_BODY_CHARS)
    if (body === '') throw new Error('log body is required')
    const subjectTitle = request.subjectTitle.trim().slice(0, 200)
    if (subjectTitle === '') throw new Error('subjectTitle is required')

    mkdirSync(this.dir, { recursive: true })
    let max = 0
    for (const name of readdirSync(this.dir)) {
      const match = LOG_FILE_RE.exec(name)
      if (match !== null) max = Math.max(max, Number(match[1]!.slice(3)))
    }
    const now = new Date().toISOString()
    const entry: TaskLogEntry = {
      id: `TL-${String(max + 1).padStart(4, '0')}`,
      subjectId: request.subjectId,
      subjectKind: request.subjectKind,
      subjectTitle,
      kind: request.kind,
      author: request.author,
      body,
      createdAt: now,
      updatedAt: null,
    }
    const path = resolve(this.dir, `${entry.id}-${slugify(subjectTitle)}.md`)
    const tmp = `${path}.${randomUUID()}.tmp`
    writeFileSync(tmp, encodeLog(entry), 'utf8')
    renameSync(tmp, path)
    return entry
  }

  /** Rewrite one entry's body under the optimistic lock. */
  update(id: string, body: string, expectedSha: string): TaskLogEntry {
    const loaded = this.load(id)
    if (loaded.sha !== expectedSha) throw new LogShaMismatchError(id)
    const nextBody = body.trim().slice(0, MAX_BODY_CHARS)
    if (nextBody === '') throw new Error('log body is required')
    const next: TaskLogEntry = { ...loaded.entry, body: nextBody, updatedAt: new Date().toISOString() }
    const tmp = `${loaded.path}.${randomUUID()}.tmp`
    writeFileSync(tmp, encodeLog(next), 'utf8')
    renameSync(tmp, loaded.path)
    return next
  }

  /** Remove one entry file under the optimistic lock. */
  remove(id: string, expectedSha: string): TaskLogEntry {
    const loaded = this.load(id)
    if (loaded.sha !== expectedSha) throw new LogShaMismatchError(id)
    unlinkSync(loaded.path)
    return loaded.entry
  }

  /** Load one file by id; throws LogNotFoundError when absent. */
  private load(id: string): LoadedLog {
    const hit = this.scan().find(loaded => loaded.entry.id === id)
    if (hit === undefined) throw new LogNotFoundError(id)
    return hit
  }
}
