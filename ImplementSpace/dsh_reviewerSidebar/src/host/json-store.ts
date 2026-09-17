/**
 * Minimal durable JSON store: read-modify-write under a sibling `.lock` file
 * (O_EXCL acquire), with tmp+rename atomic publication. Copied from
 * dsh-devbuddy-left so the two plugins have no install-time coupling.
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

function tryAcquire(lockPath: string): string | null {
  try {
    const fd = openSync(lockPath, 'wx')
    closeSync(fd)
    return lockPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
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

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

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
