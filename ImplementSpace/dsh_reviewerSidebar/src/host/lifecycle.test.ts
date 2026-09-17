/**
 * Lifecycle state-machine tests for the converged 8-status write set (spec
 * reviewer-lifecycle-refactor §5, ticket 02).
 *
 * `discussing` folded into `open`; `implemented` folded into `verifying`.
 * Terminal -> open (Reopen) intentionally lands with its own ticket, so it is
 * pinned here as NOT yet legal to keep this file an honest regression baseline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IllegalTransitionError,
  OPEN_STATUSES,
  STATUSES,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  decisionTypeFor,
  isOpen,
  isTerminal,
} from './lifecycle.ts'
import type { ReviewStatus } from '../protocol.ts'

test('STATUSES is the single canonical status set and partitions into open/terminal', () => {
  assert.equal(STATUSES.length, 8)
  assert.deepEqual([...TERMINAL_STATUSES], ['resolved', 'rejected', 'duplicated'])
  // OPEN_STATUSES is derived from STATUSES, so the two sets must partition it
  // exactly — no missing, no duplicated, no extra member.
  assert.equal(OPEN_STATUSES.length + TERMINAL_STATUSES.length, STATUSES.length)
  assert.deepEqual(
    [...OPEN_STATUSES, ...TERMINAL_STATUSES].sort(),
    [...STATUSES].sort(),
  )
  assert.equal(new Set(STATUSES).size, STATUSES.length)
})

test('isTerminal/isOpen agree with TERMINAL_STATUSES for every status', () => {
  for (const status of STATUSES) {
    const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status)
    assert.equal(isTerminal(status), terminal, `isTerminal(${status})`)
    assert.equal(isOpen(status), !terminal, `isOpen(${status})`)
  }
})

const LEGAL: Array<[ReviewStatus, ReviewStatus]> = [
  ['open', 'accepted'],
  ['open', 'rejected'],
  ['open', 'duplicated'],
  ['open', 'needs_review'],
  ['needs_review', 'open'],
  ['needs_review', 'rejected'],
  ['needs_review', 'duplicated'],
  ['accepted', 'implementing'],
  ['accepted', 'open'],
  ['implementing', 'verifying'],
  ['implementing', 'accepted'],
  ['implementing', 'open'],
  ['verifying', 'resolved'],
  ['verifying', 'implementing'],
  ['verifying', 'needs_review'],
  ['verifying', 'open'],
]

test('every legal transition of the converged table is accepted', () => {
  for (const [from, to] of LEGAL) {
    assert.equal(canTransition(from, to), true, `${from} -> ${to} should be legal`)
    assert.doesNotThrow(() => assertTransition(from, to), `${from} -> ${to} should not throw`)
  }
})

const ILLEGAL: Array<[ReviewStatus, ReviewStatus]> = [
  ['open', 'implementing'],
  ['open', 'verifying'],
  ['open', 'resolved'],
  ['accepted', 'resolved'],
  ['accepted', 'verifying'],
  ['needs_review', 'accepted'],
  ['needs_review', 'implementing'],
  ['verifying', 'accepted'],
  ['resolved', 'open'], // Reopen: lands with its own ticket — not legal yet.
  ['resolved', 'implementing'],
  ['rejected', 'open'],
  ['duplicated', 'accepted'],
]

test('every illegal transition is rejected with the error fields populated', () => {
  for (const [from, to] of ILLEGAL) {
    assert.equal(canTransition(from, to), false, `${from} -> ${to} should be illegal`)
    assert.throws(
      () => assertTransition(from, to),
      (error: unknown) => {
        assert.ok(error instanceof IllegalTransitionError, 'throws IllegalTransitionError')
        // Guards the parameter-property refactor: `.from`/`.to` must survive.
        assert.equal(error.from, from)
        assert.equal(error.to, to)
        assert.match(error.message, /illegal transition/)
        return true
      },
    )
  }
})

test('decisionTypeFor maps only decision-bearing targets', () => {
  assert.equal(decisionTypeFor('accepted'), 'accept')
  assert.equal(decisionTypeFor('rejected'), 'reject')
  assert.equal(decisionTypeFor('duplicated'), 'duplicate')
  const nonDecision: ReviewStatus[] = [
    'open', 'needs_review', 'implementing', 'verifying', 'resolved',
  ]
  for (const status of nonDecision) {
    assert.equal(decisionTypeFor(status), null, `decisionTypeFor(${status})`)
  }
})
