/**
 * DSH_HOME resolution: the environment override wins, falling back to
 * `~/.dsh`. Mirrors the resolution the DSH host itself uses so the registry
 * lives beside task-board/pet/etc.
 */
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Expand a leading `~` in a path; other inputs pass through unchanged. */
export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/** Resolve the DSH home directory from the live environment. */
export function dshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}
