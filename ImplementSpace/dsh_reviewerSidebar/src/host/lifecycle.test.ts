/**
 * Lifecycle state-machine regression baseline (spec reviewer-lifecycle-refactor
 * ticket 01).
 *
 * IMPORTANT: ticket 01 deliberately keeps the CURRENT 10-status semantics —
 * this file pins them so ticket 02's convergence (10 -> 8) has to update these
 * expectations on purpose instead of drifting silently.
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
  assert.equal(STATUSES.length, 10)
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
  ['open', 'discussing'],
  ['open', 'needs_review'],
  ['open', 'accepted'],
  ['open', 'rejected'],
  ['open', 'duplicated'],
  ['discussing', 'open'],
  ['discussing', 'needs_review'],
  ['discussing', 'accepted'],
  ['discussing', 'rejected'],
  ['discussing', 'duplicated'],
  ['needs_review', 'discussing'],
  ['needs_review', 'rejected'],
  ['needs_review', 'duplicated'],
  ['accepted', 'implementing'],
  ['accepted', 'discussing'],
  ['implementing', 'implemented'],
  ['implementing', 'discussing'],
  ['implemented', 'verifying'],
  ['implemented', 'implementing'],
  ['verifying', 'resolved'],
  ['verifying', 'implementing'],
  ['verifying', 'needs_review'],
]

test('every legal transition of the current table is accepted', () => {
  for (const [from, to] of LEGAL) {
    assert.equal(canTransition(from, to), true, `${from} -> ${to} should be legal`)
    assert.doesNotThrow(() => assertTransition(from, to), `${from} -> ${to} should not throw`)
  }
})

const ILLEGAL: Array<[ReviewStatus, ReviewStatus]> = [
  ['open', 'implementing'],
  ['open', 'implemented'],
  ['open', 'verifying'],
  ['open', 'resolved'],
  ['accepted', 'resolved'],
  ['accepted', 'implemented'],
  ['verifying', 'open'],
  ['resolved', 'open'],
  ['rejected', 'discussing'],
  ['duplicated', 'accepted'],
  ['needs_review', 'accepted'],
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
    'open', 'discussing', 'needs_review', 'implementing', 'implemented', 'verifying',
    'resolved',
  ]
  for (const status of nonDecision) {
    assert.equal(decisionTypeFor(status), null, `decisionTypeFor(${status})`)
  }
})
