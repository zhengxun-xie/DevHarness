/**
 * Reopen at the store level (spec reviewer-lifecycle-refactor ticket 05).
 *
 * Boots a real ReviewStore against a temp DSH_HOME and a temp project, so every
 * assertion exercises the actual file writes: reason requirement, history
 * preservation, resolvedAt clearing, and the critical human-only gate.
 *
 * DSH_HOME must be set before the store module evaluates its path constants,
 * hence the dynamic imports below.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dbr-reopen-home-'))

const { ReviewStore, ValidationError, ForbiddenError } = await import('./review-store.ts')
const { REVIEWS_DIRNAME } = await import('./review-files.ts')
type ReviewStoreInstance = InstanceType<typeof ReviewStore>

import type { CreateReviewRequest, ReviewAnchorDraft, ReviewStatus } from '../protocol.ts'
import type { Severity } from '../protocol.ts'

const PROJECT_ID = 'p-reopen'

let projectPath = ''
let store: ReviewStoreInstance

/** Fresh project + registry so each test starts from an empty review store. */
function freshProject(): void {
  projectPath = mkdtempSync(join(tmpdir(), 'dbr-reopen-proj-'))
  mkdirSync(join(projectPath, REVIEWS_DIRNAME), { recursive: true })
  writeFileSync(join(projectPath, 'doc.md'), '# Title\n\nalpha beta gamma\n\ndelta\n')
  const registryDir = join(process.env.DSH_HOME as string, 'devbuddy')
  mkdirSync(registryDir, { recursive: true })
  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify({
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [{ id: PROJECT_ID, name: 'reopen-test', path: projectPath }],
  }))
  store = new ReviewStore()
}

function anchor(): ReviewAnchorDraft {
  return {
    structural: { section: 'Title', headingPath: ['Title'] },
    textual: { selectedText: 'alpha beta gamma', prefix: '', suffix: '' },
    positional: { lineStart: 3, lineEnd: 3 },
  }
}

async function newReview(severity: Severity = 'major'): Promise<string> {
  const input: CreateReviewRequest = {
    projectId: PROJECT_ID,
    document: 'doc.md',
    target: anchor(),
    comment: 'needs work',
    severity,
  }
  const { review } = await store.createReview(input)
  return review.reviewId
}

async function step(reviewId: string, to: ReviewStatus, extra: { reason?: string; duplicatedOf?: string } = {}): Promise<void> {
  await store.transitionReview({ projectId: PROJECT_ID, reviewId, to, ...extra })
}

/** Walk open -> accepted -> implementing -> verifying -> resolved. */
async function toResolved(reviewId: string): Promise<void> {
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  await step(reviewId, 'verifying')
  await step(reviewId, 'resolved')
}

function read(reviewId: string): ReturnType<ReviewStoreInstance['getReview']>['review'] {
  return store.getReview(PROJECT_ID, reviewId).review
}

// ---------------------------------------------------------------------------

test('every terminal state can reopen, and reopen requires a reason', async () => {
  freshProject()

  const resolved = await newReview()
  await toResolved(resolved)
  assert.equal(read(resolved).status, 'resolved')

  const rejected = await newReview()
  await step(rejected, 'rejected', { reason: 'not a real issue' })
  assert.equal(read(rejected).status, 'rejected')

  const original = await newReview()
  const duplicate = await newReview()
  await step(duplicate, 'duplicated', { duplicatedOf: original })
  assert.equal(read(duplicate).status, 'duplicated')

  for (const reviewId of [resolved, rejected, duplicate]) {
    await assert.rejects(
      step(reviewId, 'open'),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError, `${reviewId}: reason must be enforced`)
        assert.match((error as Error).message, /reopening/)
        return true
      },
    )
    // Still terminal — a refused reopen must not have half-applied.
    assert.notEqual(read(reviewId).status, 'open')
  }

  // With a reason, all three come back to open.
  for (const reviewId of [resolved, rejected, duplicate]) {
    await step(reviewId, 'open', { reason: 'came back' })
    assert.equal(read(reviewId).status, 'open', reviewId)
  }
})

test('reopen keeps the whole history and clears resolvedAt', async () => {
  freshProject()
  const reviewId = await newReview()
  await toResolved(reviewId)

  const before = read(reviewId)
  assert.notEqual(before.resolvedAt, null)
  const decisionsBefore = before.decisions.length
  const entriesBefore = before.thread.entries.length
  assert.ok(decisionsBefore >= 1, 'accept produced a decision')

  await step(reviewId, 'open', { reason: 'still broken' })

  const after = read(reviewId)
  assert.equal(after.status, 'open')
  assert.equal(after.resolvedAt, null)
  // History is append-only: nothing is dropped by a reopen.
  assert.equal(after.decisions.length, decisionsBefore)
  assert.equal(after.thread.entries.length, entriesBefore + 1)
  const last = after.thread.entries[after.thread.entries.length - 1]
  assert.equal(last.kind, 'status')
  assert.equal(last.fromStatus, 'resolved')
  assert.equal(last.toStatus, 'open')
  assert.equal(last.body, 'still broken')
})

test('reopening a duplicate keeps its duplicatedOf link', async () => {
  freshProject()
  const original = await newReview()
  const duplicate = await newReview()
  await step(duplicate, 'duplicated', { duplicatedOf: original })
  assert.equal(read(duplicate).duplicatedOf, original)

  await step(duplicate, 'open', { reason: 'actually distinct' })
  const after = read(duplicate)
  assert.equal(after.status, 'open')
  assert.equal(after.duplicatedOf, original)
})

test('a reopened review is writable again (append + edit)', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'rejected', { reason: 'no' })

  // Terminal: append is refused.
  await assert.rejects(store.appendReview({ projectId: PROJECT_ID, reviewId, body: 'hi' }))

  await step(reviewId, 'open', { reason: 'reconsidering' })
  const appended = await store.appendReview({ projectId: PROJECT_ID, reviewId, body: 'back to life' })
  assert.equal(appended.review.thread.entries.at(-1)?.body, 'back to life')

  const edited = await store.editReview({ projectId: PROJECT_ID, reviewId, comment: 'revised' })
  assert.equal(edited.review.comment, 'revised')
})

test('a live rollback to open is not a reopen and needs no reason', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')

  // implementing -> open is the ordinary "withdraw" edge (spec §5.2).
  await step(reviewId, 'open')
  assert.equal(read(reviewId).status, 'open')
})

test('critical resolve and reopen are human-only', async () => {
  freshProject()
  const agent = { type: 'agent' as const, id: 'agent-1' }

  // critical: the final acceptance is fenced.
  const critical = await newReview('critical')
  await step(critical, 'accepted')
  await step(critical, 'implementing')
  await step(critical, 'verifying')
  await assert.rejects(
    store.transitionReview({ projectId: PROJECT_ID, reviewId: critical, to: 'resolved', author: agent }),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenError, 'critical resolve must be refused for an agent')
      return true
    },
  )
  assert.equal(read(critical).status, 'verifying')

  // …and so is its Reopen, once a human resolved it.
  await step(critical, 'resolved')
  await assert.rejects(
    store.transitionReview({ projectId: PROJECT_ID, reviewId: critical, to: 'open', reason: 'back', author: agent }),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenError, 'critical reopen must be refused for an agent')
      return true
    },
  )
  assert.equal(read(critical).status, 'resolved')

  // A human (no declared agent actor) may do both.
  await step(critical, 'open', { reason: 'human decision' })
  assert.equal(read(critical).status, 'open')

  // A non-critical review is not fenced: the same agent may reopen it.
  const normal = await newReview('major')
  await step(normal, 'rejected', { reason: 'no' })
  await store.transitionReview({ projectId: PROJECT_ID, reviewId: normal, to: 'open', reason: 'agent retry', author: agent })
  assert.equal(read(normal).status, 'open')
})

test('reopen then re-resolve walks the whole chain again', async () => {
  freshProject()
  const reviewId = await newReview()
  await toResolved(reviewId)
  await step(reviewId, 'open', { reason: 'regression found' })

  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  await step(reviewId, 'verifying')
  await step(reviewId, 'resolved')

  const after = read(reviewId)
  assert.equal(after.status, 'resolved')
  assert.notEqual(after.resolvedAt, null)
  // Two accept decisions now: the original and the post-reopen one.
  assert.equal(after.decisions.filter(d => d.type === 'accept').length, 2)
})

// ---------------------------------------------------------------------------
// Repair pass 01 (DR-001 / DR-002): anchor auto-triage from accepted and
// implementing, and the host-side reason requirement for failing verification.
// ---------------------------------------------------------------------------

/** Rewrite the document so the anchored text no longer exists. */
function orphanAnchor(): void {
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
}

/** Re-bind the anchor onto the rewritten document. */
async function rebind(reviewId: string): Promise<void> {
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\nnew anchor text here\n\nmore\n')
  const fresh: ReviewAnchorDraft = {
    structural: { section: 'Other', headingPath: ['Other'] },
    textual: { selectedText: 'new anchor text here', prefix: '', suffix: '' },
    positional: { lineStart: 3, lineEnd: 3 },
  }
  await store.reanchorReview({ projectId: PROJECT_ID, reviewId, target: fresh })
}

test('DR-001: orphaned anchor auto-enters needs_review from accepted and implementing', async () => {
  for (const target of ['accepted', 'implementing'] as const) {
    freshProject()
    const reviewId = await newReview()
    await step(reviewId, 'accepted')
    if (target === 'implementing') await step(reviewId, 'implementing')

    orphanAnchor()
    const review = read(reviewId)
    assert.equal(review.status, 'needs_review', `${target} must auto-enter needs_review`)
    const last = review.thread.entries.at(-1)
    assert.equal(last?.kind, 'status')
    assert.equal(last?.fromStatus, target)
    assert.equal(last?.toStatus, 'needs_review')
  }
})

test('DR-001: reanchoring restores the status held before needs_review', async () => {
  for (const target of ['accepted', 'implementing'] as const) {
    freshProject()
    const reviewId = await newReview()
    await step(reviewId, 'accepted')
    if (target === 'implementing') await step(reviewId, 'implementing')

    orphanAnchor()
    assert.equal(read(reviewId).status, 'needs_review')

    await rebind(reviewId)
    assert.equal(read(reviewId).status, target, `rebind restores ${target}`)
  }
})

test('DR-001: a triage write failure degrades to no-triage instead of breaking the read', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  orphanAnchor()
  // First read performs the triage write; a second read must be a clean no-op
  // (no double status entry, no throw).
  assert.equal(read(reviewId).status, 'needs_review')
  const again = read(reviewId)
  assert.equal(again.status, 'needs_review')
  const statusEntries = again.thread.entries.filter(e => e.kind === 'status' && e.toStatus === 'needs_review')
  assert.equal(statusEntries.length, 1, 'triage writes exactly once')
})

test('DR-002: failing verification without a reason is refused by the host', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  await step(reviewId, 'verifying')

  await assert.rejects(
    step(reviewId, 'implementing'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError, 'reasonless fail must be refused')
      assert.match((error as Error).message, /failing verification/)
      return true
    },
  )
  assert.equal(read(reviewId).status, 'verifying', 'refused transition must not half-apply')

  await step(reviewId, 'implementing', { reason: 'tests missing' })
  const review = read(reviewId)
  assert.equal(review.status, 'implementing')
  const last = review.thread.entries.at(-1)
  assert.equal(last?.kind, 'status')
  assert.equal(last?.body, 'tests missing', 'the reason lands on the status entry')
})

test('relatedParties: create normalizes, edit replaces, invalid is refused', async () => {
  freshProject()
  const input: CreateReviewRequest = {
    projectId: PROJECT_ID,
    document: 'doc.md',
    target: anchor(),
    comment: 'needs work',
    relatedParties: ['human', 'agent'],
  }
  const { review } = await store.createReview(input)
  assert.deepEqual(review.relatedParties, ['human', 'agent'], 'create persists the selected parties')

  const edited = await store.editReview({
    projectId: PROJECT_ID,
    reviewId: review.reviewId,
    relatedParties: ['agent'],
  })
  assert.deepEqual(edited.review.relatedParties, ['agent'], 'edit replaces the whole list')

  await assert.rejects(
    store.editReview({
      projectId: PROJECT_ID,
      reviewId: review.reviewId,
      relatedParties: 'human' as unknown as [],
    }),
    (error: unknown) => error instanceof ValidationError,
  )
})
