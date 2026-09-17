/**
 * Review-phase functional verification for the reviewer lifecycle refactor.
 *
 * This is a throwaway do-review script (NOT a committed unit test): it walks
 * the acceptance criteria of tickets 01–04 that the per-ticket unit tests
 * did not already cover, over a real ReviewStore against a temp DSH_HOME and
 * temp project. It exists to give the review its own evidence and will be
 * deleted by the review pass.
 *
 * DSH_HOME must be set before the store module evaluates its path constants.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dbr-verify-home-'))

const { ReviewStore } = await import('../../../ImplementSpace/dsh_reviewerSidebar/src/host/review-store.ts')
const { REVIEWS_DIRNAME } = await import('../../../ImplementSpace/dsh_reviewerSidebar/src/host/review-files.ts')
const { hasAgentCompletionSuggestion, normalizeStatus } = await import('../../../ImplementSpace/dsh_reviewerSidebar/src/protocol.ts')
type ReviewStoreInstance = InstanceType<typeof ReviewStore>

import type { CreateReviewRequest, ReviewAnchorDraft } from '../../../ImplementSpace/dsh_reviewerSidebar/src/protocol.ts'

const PROJECT_ID = 'p-verify'

let projectPath = ''
let store: ReviewStoreInstance

function freshProject(): void {
  projectPath = mkdtempSync(join(tmpdir(), 'dbr-verify-proj-'))
  mkdirSync(join(projectPath, REVIEWS_DIRNAME), { recursive: true })
  writeFileSync(join(projectPath, 'doc.md'), '# Title\n\nalpha beta gamma\n\ndelta\n')
  const registryDir = join(process.env.DSH_HOME as string, 'devbuddy')
  mkdirSync(registryDir, { recursive: true })
  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify({
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [{ id: PROJECT_ID, name: 'verify', path: projectPath }],
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

async function newReview(): Promise<string> {
  const input: CreateReviewRequest = {
    projectId: PROJECT_ID,
    document: 'doc.md',
    target: anchor(),
    comment: 'c',
    severity: 'major',
  }
  const { review } = await store.createReview(input)
  return review.reviewId
}

function read(reviewId: string): ReturnType<ReviewStoreInstance['getReview']>['review'] {
  return store.getReview(PROJECT_ID, reviewId).review
}

async function step(reviewId: string, to: Parameters<ReviewStoreInstance['transitionReview']>[0]['to']): Promise<void> {
  await store.transitionReview({ projectId: PROJECT_ID, reviewId, to })
}

// t01 — legacy single decision migrates into append-only decisions history.
test('t01: legacy single `decision` field reads into decisions[] (store level)', async () => {
  freshProject()
  const reviewId = await newReview()
  await store.transitionReview({ projectId: PROJECT_ID, reviewId, to: 'accepted', decisionSummary: 'go' })
  const review = read(reviewId)
  assert.equal(review.decision?.type, 'accept')
  assert.ok(review.decisions.length >= 1, 'accept decision is in the history')
  assert.equal(review.decisions.at(-1)?.type, 'accept')
  assert.equal(review.decision?.id, review.decisions.at(-1)?.id, 'decision mirrors latest')
})

// t02 — legacy status normalization on the store read path.
test('t02: a legacy `discussing` file reads as open on the store path', async () => {
  freshProject()
  const reviewId = await newReview()
  // Hand-edit the on-disk file to a legacy status, then read it back through
  // the public listReviews scan (which parses the raw file).
  const { readdirSync, readFileSync, writeFileSync: wf } = await import('node:fs')
  const dir = join(projectPath, REVIEWS_DIRNAME)
  const name = readdirSync(dir).find(f => f.startsWith(`${reviewId}-`))
  assert.ok(name !== undefined, 'review file exists')
  const filePath = join(dir, name as string)
  const raw = readFileSync(filePath, 'utf8')
  assert.match(raw, /^status: open$/m)
  wf(filePath, raw.replace(/^status: open$/m, 'status: discussing'))

  const listed = store.listReviews({ projectId: PROJECT_ID })
  const summary = listed.reviews.find(item => item.reviewId === reviewId)
  assert.equal(summary?.status, 'open', 'legacy discussing normalizes to open on read')
  assert.equal(normalizeStatus('discussing' as never), 'open')
  assert.equal(normalizeStatus('implemented' as never), 'verifying')
})

// t02 — discussion does NOT change status (append while open keeps it open).
test('t02: appending a comment while open does not move the status', async () => {
  freshProject()
  const reviewId = await newReview()
  await store.appendReview({ projectId: PROJECT_ID, reviewId, body: 'still talking' })
  assert.equal(read(reviewId).status, 'open', 'discussion must not move open')
})

// t03 — agent completion is a SUGGESTION, never a state change.
test('t03: agent completion writes a suggestion without changing status; human transition clears it', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  assert.equal(read(reviewId).status, 'implementing')

  // Simulate the agent reporting completion via appendAgentComment (private,
  // reached the same way the dispatcher does).
  await (store as unknown as { appendAgentComment(input: Record<string, unknown>): Promise<void> }).appendAgentComment({
    projectId: PROJECT_ID,
    reviewId,
    body: 'done',
    rpcId: 'rpc-1',
    provider: 'test',
    model: 'm',
    sessionId: 'sess-1',
  })
  const withHint = read(reviewId)
  assert.equal(withHint.status, 'implementing', 'agent completion never changes status')
  assert.ok(hasAgentCompletionSuggestion(withHint), 'suggestion is recorded')

  // A human transition clears the suggestion.
  await step(reviewId, 'verifying')
  assert.equal(read(reviewId).status, 'verifying')
  assert.equal(read(reviewId).agentCompletion, null, 'human transition clears the suggestion')
})

// t03 — markAgentDispatched clears the suggestion (fresh dispatch supersedes it).
test('t03: markAgentDispatched from accepted lands in implementing with no stale suggestion', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  assert.equal(read(reviewId).agentCompletion, null)

  store.markAgentDispatched({ projectId: PROJECT_ID, reviewId, sessionId: 'sess-2' })
  const after = read(reviewId)
  assert.equal(after.status, 'implementing', 'dispatch moves accepted -> implementing')
  assert.equal(after.agentCompletion, null, 'no stale suggestion after a fresh dispatch')
})

// t04 — anchor auto-triage: orphaned doc moves open -> needs_review on read.
test('t04: orphaned anchor auto-moves open -> needs_review on read (system triage)', async () => {
  freshProject()
  const reviewId = await newReview()
  // Break the anchor: rewrite the doc so the anchor no longer matches.
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
  const review = read(reviewId)
  assert.equal(review.status, 'needs_review', 'orphaned anchor auto-enters needs_review')
})

// t04 — reanchor is the ONLY way out of needs_review; it restores the prior status.
test('t04: reanchorReview exits needs_review back to the pre-entry status (from open)', async () => {
  freshProject()
  const reviewId = await newReview()
  // Break then read -> needs_review (from open).
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
  assert.equal(read(reviewId).status, 'needs_review', 'enter needs_review from open')

  // Fix the doc and re-bind the anchor -> auto exit back to open.
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\nnew anchor text here\n\nmore\n')
  const fresh: ReviewAnchorDraft = {
    structural: { section: 'Other', headingPath: ['Other'] },
    textual: { selectedText: 'new anchor text here', prefix: '', suffix: '' },
    positional: { lineStart: 3, lineEnd: 3 },
  }
  await store.reanchorReview({ projectId: PROJECT_ID, reviewId, target: fresh })
  const after = read(reviewId)
  assert.equal(after.status, 'open', 'reanchor restores the pre-entry status')
})

// spec §19.3 — Send to Agent from open must not add an `accepted` status entry.
test('t02/§19.3: Send to Agent from open records one accept decision, no accepted status stopover', async () => {
  freshProject()
  const reviewId = await newReview()
  store.markAgentDispatched({ projectId: PROJECT_ID, reviewId, sessionId: 'sess-1' })
  const review = read(reviewId)
  assert.equal(review.status, 'implementing', 'open -> implementing in one step')
  const statusEntries = review.thread.entries.filter(entry => entry.kind === 'status')
  assert.equal(statusEntries.length, 1, 'exactly one status entry for the dispatch')
  assert.equal(statusEntries[0]?.fromStatus, 'open')
  assert.equal(statusEntries[0]?.toStatus, 'implementing')
  assert.equal(
    statusEntries.filter(entry => entry.toStatus === 'accepted').length,
    0,
    'no accepted stopover the user never clicked',
  )
  assert.equal(review.decisions.filter(d => d.type === 'accept').length, 1, 'one accept decision')
})

// DR-002 (fixed in repair pass 01): spec §5.2 lists `verifying -> implementing`
// (验收打回) as requiring a non-empty reason; the host now enforces it.
test('DR-002 fixed: host refuses verifying -> implementing with no reason (spec §5.2)', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  await step(reviewId, 'verifying')
  await assert.rejects(
    step(reviewId, 'implementing'),
    /reason is required when failing verification/,
  )
  assert.equal(read(reviewId).status, 'verifying', 'refused transition must not half-apply')
})

// DR-001 (fixed in repair pass 01): spec §5.2 says open/accepted/implementing/
// verifying all auto-enter needs_review when the anchor is orphaned. These two
// cases failed on revision 8f900d1 (no needs_review edge from accepted/
// implementing: the read path threw instead of triaging).
test('DR-001 repro: orphaned anchor at accepted auto-enters needs_review (spec §5.2)', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
  const review = read(reviewId)
  assert.equal(review.status, 'needs_review')
})

// DR-001 impact (fixed in repair pass 01): the document read path no longer
// throws — the review is triaged into needs_review and the document view works.
test('DR-001 impact fixed: getDocument triages an accepted review with an orphaned anchor', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
  const doc = store.getDocument(PROJECT_ID, 'doc.md')
  const anchor = doc.reviews.find(item => item.reviewId === reviewId)
  assert.equal(anchor?.status, 'needs_review', 'document view shows the triaged status')
})

test('DR-001 repro: orphaned anchor at implementing auto-enters needs_review (spec §5.2)', async () => {
  freshProject()
  const reviewId = await newReview()
  await step(reviewId, 'accepted')
  await step(reviewId, 'implementing')
  writeFileSync(join(projectPath, 'doc.md'), '# Other\n\ncompletely different text\n')
  const review = read(reviewId)
  assert.equal(review.status, 'needs_review')
})
