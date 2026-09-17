/**
 * Anchor auto-triage (design/06 §12, ticket 04). Pure decision layer: given a
 * fresh `resolveAnchor` result and the review's current status, decide what the
 * review store should do about it.
 *
 * Guiding principle — 06 §3, revised by this ticket: **除 orphaned 外不自动改
 * 状态**. A moved/modified anchor follows the document silently; only a wholly
 * unlocatable anchor trips the review into `needs_review`, and only a human
 * re-anchor moves it back out.
 */
import type { AnchorStatus, ReviewStatus, ThreadEntry } from '../protocol.ts'
import { isTerminal, normalizeStatus } from '../protocol.ts'

export type AnchorTriageAction = 'none' | 'silent-update' | 'system-note' | 'auto-needs-review'

export interface AnchorTriageDecision {
  action: AnchorTriageAction
  /** Body for the thread entry this action writes; '' when nothing is written. */
  note: string
}

/**
 * Decide the triage action for one read.
 *
 * Debounce (§15): the position is rewritten only when the fresh resolution
 * names a *different* line range, so re-reading an unchanged document is a
 * strict no-op and cannot amplify reads into writes. `modified`/`outdated`
 * additionally leave a system entry, but only on the read that observes the
 * move — on-going text drift is reported by the list badge
 * (`needsReviewCandidate`), not by a new thread entry per read.
 */
export function decideAnchorTriage(input: {
  state: AnchorStatus
  status: ReviewStatus
  positionalChanged: boolean
}): AnchorTriageDecision {
  const { state, status, positionalChanged } = input
  // Terminal reviews are frozen: the anchor never edits them (06 §17).
  if (isTerminal(status)) return { action: 'none', note: '' }
  // Jitter guard (06 §17): a `needs_review` trip belongs to the human until
  // they re-bind the anchor. A document that happens to become locatable again
  // must NOT silently pull the review back — that is a human decision.
  if (status === 'needs_review') return { action: 'none', note: '' }

  switch (state) {
    case 'valid':
      return { action: 'none', note: '' }
    case 'orphaned':
      // The only automatic status change in the whole lifecycle.
      return { action: 'auto-needs-review', note: 'anchor could not be located in the document' }
    case 'moved':
      return positionalChanged
        ? { action: 'silent-update', note: '' }
        : { action: 'none', note: '' }
    case 'modified':
      return positionalChanged
        ? { action: 'system-note', note: 'anchor text changed; position followed it' }
        : { action: 'none', note: '' }
    case 'outdated':
      return positionalChanged
        ? { action: 'system-note', note: 'anchor text looks outdated; position followed it' }
        : { action: 'none', note: '' }
  }
}

/**
 * Status to restore when a `needs_review` trip ends (06 §12): read back from
 * the newest status entry that entered `needs_review`, so the review returns to
 * wherever it was when the anchor broke. Falls back to `open` when history
 * cannot answer (hand-edited or truncated files).
 */
export function preNeedsReviewStatus(entries: readonly ThreadEntry[]): ReviewStatus {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind !== 'status') continue
    if (entry.toStatus !== 'needs_review') continue
    if (entry.fromStatus === undefined) continue
    const back = normalizeStatus(entry.fromStatus)
    // Never restore into a terminal state: a resolved review must not come back
    // to life through an anchor rebind.
    return isTerminal(back) ? 'open' : back
  }
  return 'open'
}
