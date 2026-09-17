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
import type { ReviewDecision, ReviewStatus } from '../protocol.ts'

export {
  STATUSES,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  TERMINAL_STATUS_SET,
  STORED_STATUSES,
  DECISION_TYPES,
  LEGACY_STATUS_MAP,
  normalizeStatus,
  isOpen,
  isTerminal,
} from '../protocol.ts'

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
  // Anchor could not be relocated: wait for a human to rebind it.
  needs_review: ['open', 'rejected', 'duplicated'],
  accepted: ['implementing', 'open'],
  // "Declared done" lands directly in verifying (no `implemented` stopover);
  // accepted covers implementation blocked / approach changed.
  implementing: ['verifying', 'accepted', 'open'],
  verifying: ['resolved', 'implementing', 'needs_review', 'open'],
  // Terminal states: no outgoing transitions yet (Reopen arrives with the
  // reopen ticket, which owns the reason-required + critical-only-human rules).
  resolved: [],
  rejected: [],
  duplicated: [],
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
