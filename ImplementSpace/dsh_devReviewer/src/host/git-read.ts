/**
 * Read-only git access shared by the agent context builder and the review store
 * (commit-trailer backfill, design/06 §8).
 *
 * Every call is best effort: a missing git binary, a non-repo directory or a
 * failed command resolves to null/[] and never blocks a request. No git command
 * here writes to the repository.
 */
import { execFile } from 'node:child_process'

export const GIT_TIMEOUT_MS = 5000

/** Run a read-only git command in `projectPath`; null on any failure. */
export function runGit(projectPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = execFile(
      'git',
      args,
      { cwd: projectPath, timeout: GIT_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolvePromise(error ? null : stdout)
      },
    )
    child.on('error', () => resolvePromise(null))
  })
}

export async function gitAvailable(projectPath: string): Promise<boolean> {
  const out = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return out !== null && out.trim() === 'true'
}

export const REVIEW_TRAILER_KEY = 'DevBuddy-Review'

/**
 * Review ids referenced by `DevBuddy-Review: <id>` commit trailers. Matched on
 * whole lines, case-insensitively; ids are upper-cased so `rev-0001` and
 * `REV-0001` compare equal. Returns the distinct ids in first-seen order.
 */
export function parseReviewTrailers(message: string): string[] {
  const ids = new Set<string>()
  const lines = message.replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    const match = /^\s*DevBuddy-Review:\s*(\S+)\s*$/i.exec(line)
    if (match !== null && match[1] !== '') ids.add(match[1].toUpperCase())
  }
  return [...ids]
}

export interface ReviewCommitHit {
  hash: string
  subject: string
}

/**
 * Newest-first bounded scan for commits whose trailer references `reviewId`.
 * Returns [] when git is unavailable or the repo has no such commit.
 */
export async function scanReviewCommits(
  projectPath: string,
  reviewId: string,
  limit = 200,
): Promise<ReviewCommitHit[]> {
  const wanted = reviewId.toUpperCase()
  const out = await runGit(projectPath, [
    'log',
    `-${limit}`,
    '--pretty=format:%H%x1f%s%x1f%b%x1e',
  ])
  if (out === null) return []
  const hits: ReviewCommitHit[] = []
  for (const record of out.split('\x1e')) {
    const text = record.replace(/^\n+/, '')
    if (text === '') continue
    const [hash = '', subject = '', body = ''] = text.split('\x1f')
    if (hash === '') continue
    if (parseReviewTrailers(`${subject}\n${body}`).includes(wanted)) {
      hits.push({ hash: hash.trim(), subject: subject.trim() })
    }
  }
  return hits
}
