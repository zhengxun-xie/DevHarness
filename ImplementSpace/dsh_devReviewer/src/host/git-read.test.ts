/**
 * Commit-trailer parser + agent completion suggestion round-trip
 * (spec reviewer-lifecycle-refactor ticket 03).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewTrailers } from './git-read.ts'
import { parseReviewFile, serializeReviewFile } from './review-files.ts'
import { hasAgentCompletionSuggestion } from '../protocol.ts'

const BASE = `---
schemaVersion: 1
review_id: REV-0007
number: 1
document: doc.md
type: suggestion
severity: minor
title: t
status: implementing
tags: []
author: reviewer
related:
  decisions: []
  reviews: []
  code: []
  tests: []
  commits: []
  agent_runs: []
created_at: '2026-09-17T00:00:00.000Z'
updated_at: '2026-09-17T00:00:00.000Z'
duplicated_of: null
---

## Comment

c

## Proposal

p

## Thread

- [2026-09-17T00:00:00.000Z / reviewer] [accepted -> implementing] dispatched
`

// ---------------------------------------------------------------------------

test('parseReviewTrailers finds canonical whole-line trailers', () => {
  assert.deepEqual(
    parseReviewTrailers('feat: add thing\n\nDevBuddy-Review: REV-0001'),
    ['REV-0001'],
  )
})

test('parseReviewTrailers tolerates case, spaces and duplicate mentions', () => {
  const message = 'subject body\n\ndevbuddy-review: rev-0002\nDevBuddy-Review: REV-0002\nDevBuddy-Review: REV-0003\n'
  assert.deepEqual(parseReviewTrailers(message), ['REV-0002', 'REV-0003'])
})

test('parseReviewTrailers ignores non-trailer mentions', () => {
  assert.deepEqual(parseReviewTrailers('see DevBuddy-Review: REV-0009 in prose'), [])
  assert.deepEqual(parseReviewTrailers('REV-0009'), [])
  assert.deepEqual(parseReviewTrailers(''), [])
})

// ---------------------------------------------------------------------------

test('agentCompletion round-trips through the file codec', () => {
  const withCompletion = BASE.replace(
    'duplicated_of: null',
    `agent_completion:
  at: '2026-09-17T01:00:00.000Z'
  session_id: sess-abc
  rpc_id: rpc-123
  provider: deepseek
  model: k3
duplicated_of: null`,
  )
  const { record } = parseReviewFile(withCompletion)

  assert.notEqual(record.agentCompletion, null)
  assert.equal(record.agentCompletion?.sessionId, 'sess-abc')
  assert.equal(record.agentCompletion?.rpcId, 'rpc-123')
  assert.equal(record.agentCompletion?.provider, 'deepseek')
  assert.equal(record.agentCompletion?.model, 'k3')

  const reparsed = parseReviewFile(serializeReviewFile(record)).record
  assert.deepEqual(reparsed.agentCompletion, record.agentCompletion)
})

test('agentCompletion defaults to null for legacy files without the key', () => {
  const { record } = parseReviewFile(BASE)
  assert.equal(record.agentCompletion, null)

  // Serialize must emit an explicit null, and re-read stays null.
  const reparsed = parseReviewFile(serializeReviewFile(record)).record
  assert.equal(reparsed.agentCompletion, null)
})

test('the completion suggestion only shows while implementing', () => {
  const marker = {
    at: '2026-09-17T01:00:00.000Z',
    sessionId: 'sess-abc',
    rpcId: 'rpc-123',
    provider: null,
    model: null,
  }

  // No marker -> never a suggestion.
  assert.equal(hasAgentCompletionSuggestion({ status: 'implementing', agentCompletion: null }), false)
  // Marker while implementing -> suggest.
  assert.equal(hasAgentCompletionSuggestion({ status: 'implementing', agentCompletion: marker }), true)
  // Marker left over on any other status -> not a suggestion (never a state change).
  for (const status of ['open', 'needs_review', 'accepted', 'verifying', 'resolved', 'rejected', 'duplicated'] as const) {
    assert.equal(
      hasAgentCompletionSuggestion({ status, agentCompletion: marker }),
      false,
      `status ${status}`,
    )
  }
})
