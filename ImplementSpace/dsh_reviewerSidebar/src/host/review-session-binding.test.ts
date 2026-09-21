/**
 * Review↔session 1:1 lifecycle binding (design/09).
 *
 * Boots a real ReviewStore against a temp DSH_HOME + temp project, and drives
 * a fake ReviewSessionLifecycle to observe the exact session operations:
 * create+name on review creation, archive on delete/close, unarchive on
 * reopen, rename on title/type edit — plus the no-lifecycle degradation path.
 *
 * DSH_HOME must be set before the store module evaluates its path constants,
 * hence the dynamic imports below.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dbr-session-home-'))

const { ReviewStore } = await import('./review-store.ts')
const { REVIEWS_DIRNAME } = await import('./review-files.ts')
import type { ReviewSessionLifecycle } from './agent-dispatch.ts'
import type { CreateReviewRequest, ReviewAnchorDraft, ReviewStatus } from '../protocol.ts'
type ReviewStoreInstance = InstanceType<typeof ReviewStore>

const PROJECT_ID = 'p-session'

let projectPath = ''
let store: ReviewStoreInstance
let calls: {
  create: Array<[string | null, string]>
  rename: string[]
  archive: string[]
  unarchive: string[]
}

function fakeLifecycle(): ReviewSessionLifecycle {
  calls = { create: [], rename: [], archive: [], unarchive: [] }
  return {
    async createNamedSession(workspaceId, title) {
      calls.create.push([workspaceId, title])
      return 'sess-1'
    },
    async renameSession(sessionId, title) {
      calls.rename.push(`${sessionId}::${title}`)
    },
    async archiveSession(sessionId) {
      calls.archive.push(sessionId)
    },
    async unarchiveSession(sessionId) {
      calls.unarchive.push(sessionId)
    },
  }
}

function freshProject(withLifecycle: boolean): void {
  projectPath = mkdtempSync(join(tmpdir(), 'dbr-session-proj-'))
  mkdirSync(join(projectPath, REVIEWS_DIRNAME), { recursive: true })
  writeFileSync(join(projectPath, 'doc.md'), '# Title\n\nalpha beta gamma\n\ndelta\n')
  const registryDir = join(process.env.DSH_HOME as string, 'devbuddy')
  mkdirSync(registryDir, { recursive: true })
  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify({
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [{ id: PROJECT_ID, name: 'session-test', path: projectPath, workspaceId: 'ws-1' }],
  }))
  store = new ReviewStore()
  store.attachWorkspaceProvider(() => [{ id: 'ws-1', title: 'ws', path: projectPath, sessionCount: 0 }])
  if (withLifecycle) store.attachSessionLifecycle(fakeLifecycle())
}

function anchor(): ReviewAnchorDraft {
  return {
    structural: { section: 'Title', headingPath: ['Title'] },
    textual: { selectedText: 'alpha beta gamma', prefix: '', suffix: '' },
    positional: { lineStart: 3, lineEnd: 3 },
  }
}

function createInput(extra: Partial<CreateReviewRequest> = {}): CreateReviewRequest {
  return {
    projectId: PROJECT_ID,
    document: 'doc.md',
    target: anchor(),
    comment: 'needs work',
    ...extra,
  }
}

async function step(reviewId: string, to: ReviewStatus, extra: { reason?: string } = {}): Promise<void> {
  await store.transitionReview({ projectId: PROJECT_ID, reviewId, to, ...extra })
}

// ---------------------------------------------------------------------------

test('createReview creates and names the 1:1 lifecycle session', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput({
    type: 'suggestion',
    title: '项目开发自动化工作流',
  }))
  assert.equal(review.sessionId, 'sess-1')
  assert.deepEqual(calls.create, [['ws-1', '[建议]项目开发自动化工作流']])
})

test('session name falls back to the comment first line when title is absent', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput({
    type: 'bug',
    comment: '崩溃：空指针\n第二行',
  }))
  assert.equal(review.sessionId, 'sess-1')
  assert.equal(calls.create[0][1], '[缺陷]崩溃：空指针')
})

test('sessionId round-trips through the file and closing archives it', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput({ title: 'X' }))
  await step(review.reviewId, 'accepted')
  await step(review.reviewId, 'implementing')
  await step(review.reviewId, 'verifying')
  await step(review.reviewId, 'resolved')
  assert.deepEqual(calls.archive, ['sess-1'])
  // The bound id must have survived the persist/parse cycle.
  assert.equal(store.reviewSessionId(PROJECT_ID, review.reviewId), 'sess-1')
})

test('reopen unarchives the lifecycle session', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput({ title: 'X' }))
  await step(review.reviewId, 'accepted')
  await step(review.reviewId, 'implementing')
  await step(review.reviewId, 'verifying')
  await step(review.reviewId, 'resolved')
  await step(review.reviewId, 'open', { reason: 'reopen for follow-up' })
  assert.deepEqual(calls.unarchive, ['sess-1'])
})

test('removing a review archives its session', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput())
  await store.removeReview({ projectId: PROJECT_ID, reviewId: review.reviewId })
  assert.deepEqual(calls.archive, ['sess-1'])
})

test('editing the title renames the session', async () => {
  freshProject(true)
  const { review } = await store.createReview(createInput({ type: 'suggestion', title: 'Old' }))
  assert.deepEqual(calls.rename, [])
  await store.editReview({ projectId: PROJECT_ID, reviewId: review.reviewId, title: 'New' })
  assert.deepEqual(calls.rename, ['sess-1::[建议]New'])
})

test('without a lifecycle adapter the store degrades: sessionId stays null', async () => {
  freshProject(false)
  const { review } = await store.createReview(createInput({ title: 'X' }))
  assert.equal(review.sessionId, null)
  // Removal (from open) still succeeds with no session side-effects.
  await store.removeReview({ projectId: PROJECT_ID, reviewId: review.reviewId })
  assert.equal(store.reviewSessionId(PROJECT_ID, review.reviewId), null)
  // Transitions still work without a lifecycle adapter.
  const { review: r2 } = await store.createReview(createInput({ title: 'Y' }))
  await step(r2.reviewId, 'accepted')
  assert.equal(store.getReview(PROJECT_ID, r2.reviewId).review.status, 'accepted')
})

test('a review bound to no workspace still degrades to sessionId null', async () => {
  freshProject(true)
  // Drop the project's workspace link AND empty the visible workspace list,
  // so neither explicit-id nor realpath auto-match resolves a workspace.
  const registryDir = join(process.env.DSH_HOME as string, 'devbuddy')
  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify({
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [{ id: PROJECT_ID, name: 'session-test', path: projectPath }],
  }))
  store.attachWorkspaceProvider(() => [])
  const { review } = await store.createReview(createInput({ title: 'X' }))
  assert.equal(review.sessionId, null)
  assert.deepEqual(calls.create, [])
})
