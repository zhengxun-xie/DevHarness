/**
 * Review lifecycle state machine (design/06-lifecycle.md, refactor §4).
 *
 * Converged 8-status write set (spec §5): `discussing` folded into `open`,
 * `implemented` folded into `verifying`. Terminal -> open (Reopen) is added by
 * the reopen ticket; `needs_review` re-entry from a system anchor trip is added
 * by the anchor-triage ticket.
 *
 * Single source of transitions; status-set membership itself lives in
 * `../protocol.ts` (imported by both host and client) and is re-exported here
 * so host callers have one import surface (design/06b E1).
 *
 * All legal transitions are declared here; illegal transitions throw
 * IllegalTransitionError which routes map to HTTP 409.
 */

import {
  DECISION_TYPES,
  LEGACY_STATUS_MAP,
  OPEN_STATUSES,
  STATUSES,
  STORED_STATUSES,
  TERMINAL_STATUSES,
  TERMINAL_STATUS_SET,
  isOpen,
  isTerminal,
  normalizeStatus,
  type ReviewDecision,
  type ReviewStatus,
  type Severity,
} from '../protocol.ts'

// Single import surface for host callers: the status sets live in protocol.ts
// (shared with the client) and are re-exported here unchanged.
export {
  DECISION_TYPES,
  LEGACY_STATUS_MAP,
  OPEN_STATUSES,
  STATUSES,
  STORED_STATUSES,
  TERMINAL_STATUSES,
  TERMINAL_STATUS_SET,
  isOpen,
  isTerminal,
  normalizeStatus,
}

export class IllegalTransitionError extends Error {
  readonly from: ReviewStatus
  readonly to: ReviewStatus

  constructor(from: ReviewStatus, to: ReviewStatus) {
    super(`illegal transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

type Allowed = Partial<Record<ReviewStatus, ReviewStatus[]>>

const ALLOWED: Allowed = {
  // Awaiting a decision; discussion no longer moves the state (spec §5).
  open: ['accepted', 'rejected', 'duplicated', 'needs_review'],
  // Anchor could not be relocated: wait for a human to re-bind it.
  // needs_review can return to ANY non-terminal status — that is the anchor
  // ticket's auto-exit restoring the pre-entry state (design/06 §12); the UI
  // only exposes rebind / reject / duplicate there.
  needs_review: ['open', 'accepted', 'implementing', 'verifying', 'rejected', 'duplicated'],
  accepted: ['implementing', 'open'],
  // "Declared done" lands directly in verifying (no `implemented` stopover);
  // accepted covers implementation blocked / approach changed.
  implementing: ['verifying', 'accepted', 'open'],
  verifying: ['resolved', 'implementing', 'needs_review', 'open'],
  // Terminal states expose exactly one edge: Reopen (spec §5.2). A reopened
  // review is an ordinary `open` review again — history, decisions and
  // duplicatedOf all survive; only `resolvedAt` is cleared.
  resolved: ['open'],
  rejected: ['open'],
  duplicated: ['open'],
}

/**
 * Transitions a `critical` review reserves to a human (spec §5.2, §9): final
 * acceptance and Reopen. Pure so both the host gate and the tests read the
 * same rule.
 */
export function isHumanOnlyTransition(input: {
  from: ReviewStatus
  to: ReviewStatus
  severity: Severity
}): boolean {
  if (input.severity !== 'critical') return false
  if (input.to === 'resolved') return true
  return input.to === 'open' && isTerminal(input.from)
}

/** True when this transition is a Reopen (terminal -> open, spec §5.2). */
export function isReopen(input: { from: ReviewStatus; to: ReviewStatus }): boolean {
  return input.to === 'open' && isTerminal(input.from)
}

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

export function assertTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to)
}

/** Transitions that create a Decision record and what decision type they map to. */
export function decisionTypeFor(to: ReviewStatus): ReviewDecision['type'] | null {
  switch (to) {
    case 'accepted': return 'accept'
    case 'rejected': return 'reject'
    case 'duplicated': return 'duplicate'
    default: return null
  }
}
