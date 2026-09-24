/**
 * Anchor auto-triage decisions + needs_review exit restoration
 * (spec reviewer-lifecycle-refactor ticket 04, design/06 §12).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideAnchorTriage, preNeedsReviewStatus } from './anchor-triage.ts'
import { STATUSES, TERMINAL_STATUSES } from '../protocol.ts'
import type { AnchorStatus, ReviewStatus, StoredReviewStatus, ThreadEntry } from '../protocol.ts'

const ANCHOR_STATES: AnchorStatus[] = ['valid', 'moved', 'modified', 'outdated', 'orphaned']

test('terminal reviews are never touched by the anchor', () => {
  for (const status of TERMINAL_STATUSES) {
    for (const state of ANCHOR_STATES) {
      for (const positionalChanged of [true, false]) {
        assert.equal(
          decideAnchorTriage({ state, status, positionalChanged }).action,
          'none',
          `${state} on ${status} (changed=${positionalChanged})`,
        )
      }
    }
  }
})

test('needs_review is human-owned: no state can move it (jitter guard)', () => {
  for (const state of ANCHOR_STATES) {
    for (const positionalChanged of [true, false]) {
      assert.equal(
        decideAnchorTriage({ state, status: 'needs_review', positionalChanged }).action,
        'none',
        `${state} while needs_review`,
      )
    }
  }
})

test('orphaned is the only automatic status change', () => {
  for (const status of STATUSES) {
    if (status === 'needs_review') continue
    const expected = TERMINAL_STATUSES.includes(status) ? 'none' : 'auto-needs-review'
    assert.equal(
      decideAnchorTriage({ state: 'orphaned', status, positionalChanged: false }).action,
      expected,
      `orphaned on ${status}`,
    )
  }
})

test('a located anchor follows the document without changing the status', () => {
  const cases: Array<[AnchorStatus, boolean, string]> = [
    ['valid', false, 'none'],
    ['valid', true, 'none'], // nothing to rewrite: the stored position already matches
    ['moved', true, 'silent-update'],
    ['moved', false, 'none'], // debounce: identical range means no write
    ['modified', true, 'system-note'],
    ['modified', false, 'none'],
    ['outdated', true, 'system-note'],
    ['outdated', false, 'none'],
  ]
  for (const [state, positionalChanged, expected] of cases) {
    for (const status of ['open', 'accepted', 'implementing', 'verifying'] as ReviewStatus[]) {
      assert.equal(
        decideAnchorTriage({ state, status, positionalChanged }).action,
        expected,
        `${state} on ${status} (changed=${positionalChanged})`,
      )
    }
  }
})

test('every entry-writing decision carries a note', () => {
  // `silent-update` deliberately writes NO thread entry (a pure position
  // follow); the note-bearing actions must never produce an empty body.
  for (const state of ANCHOR_STATES) {
    for (const status of STATUSES) {
      const decision = decideAnchorTriage({ state, status, positionalChanged: true })
      if (decision.action === 'none' || decision.action === 'silent-update') continue
      assert.notEqual(decision.note, '', `${state} on ${status} needs a note`)
    }
  }
})

// ---------------------------------------------------------------------------
// preNeedsReviewStatus
// ---------------------------------------------------------------------------

function entry(
  kind: ThreadEntry['kind'],
  toStatus?: StoredReviewStatus,
  fromStatus?: StoredReviewStatus,
): ThreadEntry {
  return {
    id: `e-${kind}-${String(toStatus)}-${String(fromStatus)}`,
    at: '2026-09-17T00:00:00.000Z',
    author: { type: 'user', id: 'reviewer' },
    kind,
    body: 'b',
    ...(fromStatus !== undefined ? { fromStatus } : {}),
    ...(toStatus !== undefined ? { toStatus } : {}),
  }
}

test('the pre-entry status is read back from the newest entering entry', () => {
  const entries: ThreadEntry[] = [
    entry('status', 'open', 'verifying'),
    entry('comment'),
    entry('status', 'needs_review', 'open'),
  ]
  assert.equal(preNeedsReviewStatus(entries), 'open')
})

test('an earlier needs_review trip does not shadow the latest one', () => {
  const entries: ThreadEntry[] = [
    entry('status', 'needs_review', 'verifying'),
    entry('status', 'open', 'needs_review'),
    entry('status', 'needs_review', 'implementing'),
  ]
  assert.equal(preNeedsReviewStatus(entries), 'implementing')
})

test('legacy status names are normalized when restoring', () => {
  const entries: ThreadEntry[] = [entry('status', 'needs_review', 'discussing')]
  assert.equal(preNeedsReviewStatus(entries), 'open')
})

test('restoration falls back to open when history cannot answer', () => {
  assert.equal(preNeedsReviewStatus([]), 'open')
  assert.equal(preNeedsReviewStatus([entry('comment'), entry('status', 'accepted')]), 'open')
  assert.equal(preNeedsReviewStatus([entry('status', 'needs_review')]), 'open')
})

test('restoration never resurrects a terminal status', () => {
  const entries: ThreadEntry[] = [entry('status', 'needs_review', 'resolved')]
  assert.equal(preNeedsReviewStatus(entries), 'open')
})
