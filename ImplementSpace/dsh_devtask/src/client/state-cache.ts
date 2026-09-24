/**
 * DevTaskState snapshot cache for instant panel mount.
 *
 * Clicking DevTask (or switching back from a conversation) remounts the panel,
 * which used to block on a full fetch — three Bitable table reads plus the
 * registry, several seconds on cold lark-cli calls. This cache keeps the last
 * good snapshot in a module variable (survives remounts within the page) and
 * mirrors it into localStorage (survives reloads), so the panel renders the
 * previous view immediately and swaps in fresh data when the refresh lands.
 *
 * The cache is a pure convenience: a stale or corrupt snapshot degrades to
 * `null` and the panel falls back to its loading state. It is never a source
 * of truth — every mutation still returns the authoritative state.
 */
import type { DevTaskState } from '../protocol.ts'

const CACHE_KEY = 'devtask.stateCache.v1'

/** In-page snapshot; module-level so it outlives the component. */
let memory: DevTaskState | null = null

function looksLikeState(value: unknown): value is DevTaskState {
  if (value === null || typeof value !== 'object') return false
  const s = value as Partial<DevTaskState>
  return Array.isArray(s.views) && Array.isArray(s.tasks)
    && Array.isArray(s.objectives) && Array.isArray(s.keyResults)
    && Array.isArray(s.employees) && Array.isArray(s.agents)
}

/** Latest snapshot: memory first, then localStorage; null when unavailable. */
export function loadCachedState(): DevTaskState | null {
  if (memory !== null) return memory
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!looksLikeState(parsed)) return null
    memory = parsed
    return parsed
  } catch {
    return null
  }
}

/** Remember a fresh snapshot (memory + localStorage; write failures ignored). */
export function saveCachedState(state: DevTaskState): void {
  memory = state
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state))
  } catch {
    // ignored: quota/private-mode failures only cost the reload-speedup
  }
}
