/**
 * Minimal durable JSON store: read-modify-write under a sibling `.lock` file
 * (O_EXCL acquire), with tmp+rename atomic publication. Same lock-file
 * convention as the DSH task-board ledger.
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  renameSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const LOCK_STALE_MS = 30_000

/** Acquire-style error: another writer holds the lock. */
export class LockBusyError extends Error {
  constructor(public readonly lockPath: string) {
    super(`store: lock busy: ${lockPath}`)
    this.name = 'LockBusyError'
  }
}

/**
 * Try once to acquire the lock file.
 * @returns the lock path when acquired, null when held by a live owner.
 */
function tryAcquire(lockPath: string): string | null {
  try {
    const fd = openSync(lockPath, 'wx')
    closeSync(fd)
    return lockPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // Stale lock (crashed writer, older than the threshold) is reclaimed.
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs
      if (age > LOCK_STALE_MS) {
        unlinkSync(lockPath)
        const fd = openSync(lockPath, 'wx')
        closeSync(fd)
        return lockPath
      }
    } catch {
      /* fall through to busy */
    }
    return null
  }
}

/**
 * Read a JSON file, returning `fallback` when absent.
 */
export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/**
 * Run `mutate` under the lock and persist its result atomically. Retries the
 * lock briefly instead of failing on transient contention.
 * @param path - JSON file path.
 * @param fallback - value used when the file does not exist yet.
 * @param mutate - pure-ish updater; its return value is written.
 */
export async function withLockedJson<T>(
  path: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  let acquired: string | null = null
  for (let attempt = 0; attempt < 20 && acquired === null; attempt++) {
    acquired = tryAcquire(lockPath)
    if (acquired === null) await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (acquired === null) throw new LockBusyError(lockPath)

  try {
    const current = readJson(path, fallback)
    const next = await mutate(current)
    const tmp = `${path}.${randomUUID()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    return next
  } finally {
    try { unlinkSync(lockPath) } catch { /* best effort */ }
  }
}
