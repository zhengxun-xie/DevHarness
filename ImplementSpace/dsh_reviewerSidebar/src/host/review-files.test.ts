/**
 * Review-file codec tests (spec reviewer-lifecycle-refactor ticket 01):
 * decision history `decisions[]` plus its lazy migration from the legacy
 * single `decision`, and removal of the dead `defer`/`wont_fix` enums.
 *
 * The legacy fixture mirrors a real v1 record found in the repo
 * (.devbuddy/reviews/REV-0001-*.md), including the fact that old decisions
 * carry no `id` field (the codec falls back to DEC-0001).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatThreadEntry,
  parseReviewFile,
  parseThreadSection,
  serializeReviewFile,
} from './review-files.ts'

/** Legacy v1 shape: single `decision:`, no `decisions:`, no thread frontmatter. */
const LEGACY_FILE = `---
schemaVersion: 1
review_id: REV-0001
number: 1
document: CoreRequirements.md
type: suggestion
severity: minor
title: legacy
status: resolved
tags: []
author: reviewer
related:
  decisions: []
  reviews: []
  code: []
  tests: []
  commits: []
  agent_runs: []
decision:
  type: accept
  summary: legacy summary
  decided_by: reviewer
  decided_at: '2026-09-16T06:49:19.803Z'
created_at: '2026-09-16T05:58:09.665Z'
updated_at: '2026-09-16T07:26:04.097Z'
resolved_at: '2026-09-16T07:26:04.097Z'
duplicated_of: null
---

## Comment

legacy comment

## Proposal

legacy proposal

## Thread

- [2026-09-16T07:26:04.097Z / reviewer] [verifying -> resolved]
`

test('a legacy single decision is migrated into the append-only decisions history', () => {
  const { record } = parseReviewFile(LEGACY_FILE)

  assert.equal(record.decisions.length, 1)
  assert.equal(record.decisions[0].type, 'accept')
  assert.equal(record.decisions[0].id, 'DEC-0001')
  assert.equal(record.decisions[0].summary, 'legacy summary')
  // `decision` mirrors the latest entry.
  assert.deepEqual(record.decision, record.decisions[0])
})

test('serialize emits decisions and round-trips the history', () => {
  const first = parseReviewFile(LEGACY_FILE)
  const text = serializeReviewFile(first.record)

  assert.match(text, /^decisions:/m, 'writes the decisions key')

  const second = parseReviewFile(text)
  assert.equal(second.record.decisions.length, 1)
  assert.equal(second.record.decisions[0].id, 'DEC-0001')
  assert.equal(second.record.decisions[0].type, 'accept')
  assert.deepEqual(second.record.decisions, first.record.decisions)
})

test('appending a decision keeps the whole history and updates the latest mirror', () => {
  const { record } = parseReviewFile(LEGACY_FILE)
  const latest = {
    id: 'DEC-0002',
    type: 'reject' as const,
    summary: 'reconsidered',
    decidedBy: { type: 'user' as const, id: 'reviewer' },
    decidedAt: '2026-09-17T00:00:00.000Z',
  }
  record.decisions.push(latest)
  record.decision = latest

  const reparsed = parseReviewFile(serializeReviewFile(record)).record
  assert.equal(reparsed.decisions.length, 2)
  assert.deepEqual(reparsed.decisions.map(entry => entry.id), ['DEC-0001', 'DEC-0002'])
  assert.deepEqual(reparsed.decisions.map(entry => entry.type), ['accept', 'reject'])
  assert.equal(reparsed.decision?.id, 'DEC-0002')
  assert.equal(reparsed.decision?.summary, 'reconsidered')
})

test('a review with no decision history parses to an empty array', () => {
  const noDecision = LEGACY_FILE
    .replace(/decision:\n(?: {2}.*\n)+/, '')
  const { record } = parseReviewFile(noDecision)

  assert.deepEqual(record.decisions, [])
  assert.equal(record.decision, null)
})

test('dead decision enums (defer / wont_fix) are no longer recognized', () => {
  const deferred = LEGACY_FILE.replace('type: accept', 'type: defer')
  const { record } = parseReviewFile(deferred)

  // Not a known decision type any more -> dropped, not silently kept.
  assert.deepEqual(record.decisions, [])
  assert.equal(record.decision, null)
})

test('thread lines: live decision markers parse, dead ones fall back to comments', () => {
  const live = parseThreadSection('- [2026-09-17T00:00:00.000Z / reviewer] Decision(accept): ok')
  assert.equal(live.length, 1)
  assert.equal(live[0].kind, 'decision')
  assert.equal(live[0].decisionType, 'accept')
  assert.equal(live[0].body, 'ok')

  const dead = parseThreadSection('- [2026-09-17T00:00:00.000Z / reviewer] Decision(defer): later')
  assert.equal(dead.length, 1)
  assert.equal(dead[0].kind, 'comment', 'defer is not a decision marker any more')
})

test('a decision entry without a type degrades to a comment line, never a fake decision', () => {
  const line = formatThreadEntry({
    id: 'ENTRY-0001',
    at: '2026-09-17T00:00:00.000Z',
    author: { type: 'user', id: 'reviewer' },
    kind: 'decision',
    body: 'body text',
  })
  assert.ok(!line.includes('Decision('), 'must not fabricate a decision type')
  assert.ok(line.endsWith('body text'))
})
