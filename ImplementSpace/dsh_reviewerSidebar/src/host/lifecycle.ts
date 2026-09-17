/**
 * Review lifecycle state machine (design/06-lifecycle.md).
 *
 * All legal transitions are declared here; illegal transitions throw
 * IllegalTransitionError which routes map to HTTP 409.
 */
import type { ReviewDecision, ReviewStatus } from '../protocol.ts'

export class IllegalTransitionError extends Error {
  constructor(public readonly from: ReviewStatus, public readonly to: ReviewStatus) {
    super(`illegal transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
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

export function isTerminal(status: ReviewStatus): boolean {
  return status === 'resolved' || status === 'rejected' || status === 'duplicated'
}

export function isOpen(status: ReviewStatus): boolean {
  return !isTerminal(status)
}
