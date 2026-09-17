/**
 * Review lifecycle state machine (design/06-lifecycle.md).
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
  DECISION_TYPES,
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
  open: ['discussing', 'needs_review', 'accepted', 'rejected', 'duplicated'],
  discussing: ['open', 'needs_review', 'accepted', 'rejected', 'duplicated'],
  needs_review: ['discussing', 'rejected', 'duplicated'],
  accepted: ['implementing', 'discussing'],
  implementing: ['implemented', 'discussing'],
  implemented: ['verifying', 'implementing'],
  verifying: ['resolved', 'implementing', 'needs_review'],
  // terminal states: no outgoing transitions.
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
