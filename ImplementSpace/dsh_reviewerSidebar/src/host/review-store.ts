/**
 * ReviewStore: all review record CRUD, id allocation, state-machine
 * enforcement and the derived index.json projection (design/03 §7-8,
 * design/06). Pure host half; every mutating path goes read -> validate ->
 * append -> tmp+rename write, guarded by expectedSha optimistic locks.
 */
import { mkdirSync, unlinkSync, writeFileSync, renameSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { readJson, withLockedJson } from './json-store.ts'
import {
  loadRegistry,
  requireProject,
  resolveDocument,
  resolveWorkspace,
  visibleProjects,
  sha256,
  readDocument,
  listMarkdownDocuments,
  type WorkspaceProvider,
} from './projects.ts'
import {
  listReviewFiles,
  readReviewFile,
  writeReviewFile,
  deriveParticipants,
  REVIEWS_DIRNAME,
  type ParsedReviewFile,
} from './review-files.ts'
import { resolveAnchor, parseHeadings } from './anchors.ts'
import { decideAnchorTriage, preNeedsReviewStatus } from './anchor-triage.ts'
import { scanReviewCommits } from './git-read.ts'
import {
  assertTransition,
  decisionTypeFor,
  isHumanOnlyTransition,
  isReopen,
  isTerminal,
} from './lifecycle.ts'
import type { ReviewSessionLifecycle } from './agent-dispatch.ts'
import { REVIEW_TYPES, REVIEW_TYPE_LABELS, SEVERITIES, normalizeRelatedParties } from '../protocol.ts'
import type {
  AnchorResolution,
  AppendRequest,
  AuthorRef,
  CreateReviewRequest,
  DocumentHeading,
  DocumentResponse,
  DocumentReviewAnchor,
  EditReviewRequest,
  EditThreadEntryRequest,
  GetReviewResponse,
  ListDocsResponse,
  ListReviewsResponse,
  ProjectRecord,
  ProjectsResponse,
  ReviewAnchor,
  ReviewAnchorDraft,
  ReviewDecision,
  ReviewRecord,
  ReviewStatus,
  ReviewSummary,
  ThreadEntry,
  RemoveRequest,
  ReanchorRequest,
  TransitionRequest,
  WorkspaceInfo,
} from '../protocol.ts'

const REVIEWER_STATE_PATH = resolve(dshHome(), 'devbuddy', 'reviewer-state.json')
const MAX_SELECTED_CHARS = 4000
const INDEX_REBUILD_DEBOUNCE_MS = 200

interface ReviewerState {
  activeProjectId: string | null
}

interface IndexFile {
  version: number
  projectId: string
  updatedAt: string
  reviews: ReviewSummary[]
}

/**
 * In-memory correlation record for one dispatched agent run. The prompt's
 * requestId becomes the user/message source rpcId; session feed events bind
 * it to a turn, collect that turn's assistant text and — once the turn
 * completes — flush it back as an agent-authored thread comment.
 */
interface PendingAgentRun {
  projectId: string
  reviewId: string
  sessionId: string
  rpcId: string
  turn: number | null
  textParts: string[]
  provider: string | null
  model: string | null
  registeredAt: number
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** The caller is authenticated but not allowed to do this (spec §5.2/§9). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyRelated(): ReviewRecord['related'] {
  return { decisions: [], reviews: [], code: [], tests: [], commits: [], agentRuns: [] }
}

/** Default human actor for transitions the reviewer triggers locally. */
const REVIEWER_AUTHOR: AuthorRef = { type: 'user', id: 'reviewer' }

/**
 * Who is asking for a transition: a caller that declares an agent actor is
 * honoured (so the critical human-only gate above can refuse it); anything else
 * is the human reviewer, which is the whole model here (spec §5.2: single-user,
 * no account system).
 */
function resolveActor(author: AuthorRef | undefined): AuthorRef {
  return author !== undefined && author.type === 'agent' ? author : REVIEWER_AUTHOR
}

/** Next stable ENTRY-#### by max+1 over the whole thread (never positional). */
function nextEntryId(entries: ThreadEntry[]): string {
  let max = 0
  for (const entry of entries) {
    const match = /^ENTRY-(\d+)$/.exec(entry.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return `ENTRY-${String(max + 1).padStart(4, '0')}`
}

/** Next stable DEC-#### by max+1 over the decision history and timeline links. */
function nextDecisionId(record: ReviewRecord): string {
  let max = 0
  for (const decision of record.decisions ?? []) max = Math.max(max, decisionNumber(decision.id))
  if (record.decision !== null) max = Math.max(max, decisionNumber(record.decision.id))
  for (const entry of record.thread.entries) {
    if (entry.decisionId !== undefined) max = Math.max(max, decisionNumber(entry.decisionId))
  }
  return `DEC-${String(max + 1).padStart(4, '0')}`
}

function decisionNumber(id: string): number {
  const match = /^DEC-(\d+)$/.exec(id)
  return match !== null ? Number(match[1]) : 0
}

export class ReviewStore {
  private workspaceProvider: WorkspaceProvider | null = null
  private sessionLifecycle: ReviewSessionLifecycle | null = null
  private readonly sequenceLocks = new Map<string, Promise<unknown>>()
  private readonly indexTimers = new Map<string, NodeJS.Timeout>()
  private readonly pendingRunsByRpc = new Map<string, PendingAgentRun>()
  private readonly pendingRunsBySession = new Map<string, Set<string>>()
  private readonly currentTurns = new Map<string, number>()

  /** Bound on the in-memory correlation table; oldest entries are evicted. */
  private static readonly MAX_PENDING_RUNS = 100
  /** Unbound runs (user/message never observed) are dropped after this age. */
  private static readonly STALE_RUN_MS = 30 * 60 * 1000

  attachWorkspaceProvider(provider: WorkspaceProvider): void {
    this.workspaceProvider = provider
  }

  /** Bind the review↔session lifecycle adapter (design/09); null = degrade. */
  attachSessionLifecycle(lifecycle: ReviewSessionLifecycle): void {
    this.sessionLifecycle = lifecycle
  }

  private workspaces(): readonly WorkspaceInfo[] {
    return this.workspaceProvider !== null ? this.workspaceProvider() : []
  }

  /** Live workspace list for agent dispatch resolution. */
  snapshotWorkspaces(): readonly WorkspaceInfo[] {
    return this.workspaces()
  }

  /** The review's 1:1 lifecycle session id (design/09), or null. */
  reviewSessionId(projectId: string, reviewId: string): string | null {
    try {
      const { project } = this.useProject(projectId)
      return this.readRecord(project, reviewId).record.sessionId
    } catch {
      return null
    }
  }

  /** Create + name the review's 1:1 lifecycle session. Never throws. */
  private async openReviewSession(project: ProjectRecord, record: ReviewRecord): Promise<string | null> {
    const lifecycle = this.sessionLifecycle
    if (lifecycle === null) return null
    const workspace = resolveWorkspace(project, this.workspaces())
    if (workspace === null) return null
    try {
      return await lifecycle.createNamedSession(workspace.id, reviewSessionTitle(record))
    } catch {
      return null
    }
  }

  private async archiveReviewSession(sessionId: string | null): Promise<void> {
    if (sessionId === null || sessionId === '' || this.sessionLifecycle === null) return
    try { await this.sessionLifecycle.archiveSession(sessionId) } catch { /* silent */ }
  }

  private async unarchiveReviewSession(sessionId: string | null): Promise<void> {
    if (sessionId === null || sessionId === '' || this.sessionLifecycle === null) return
    try { await this.sessionLifecycle.unarchiveSession(sessionId) } catch { /* silent */ }
  }

  private async renameReviewSession(record: ReviewRecord): Promise<void> {
    const sessionId = record.sessionId
    if (sessionId === null || sessionId === '' || this.sessionLifecycle === null) return
    try { await this.sessionLifecycle.renameSession(sessionId, reviewSessionTitle(record)) } catch { /* silent */ }
  }

  // -------------------------------------------------------------------------
  // Active project
  // -------------------------------------------------------------------------

  private loadState(): ReviewerState {
    const state = readJson<ReviewerState>(REVIEWER_STATE_PATH, { activeProjectId: null })
    return { activeProjectId: typeof state.activeProjectId === 'string' ? state.activeProjectId : null }
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  listProjects(): ProjectsResponse {
    const registry = loadRegistry()
    const state = this.loadState()
    const workspaces = this.workspaces()
    const projects = visibleProjects(registry).map((project) => {
      const openCount = this.countOpen(project)
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        active: project.id === state.activeProjectId,
        workspaceLinked: resolveWorkspace(project, workspaces) !== null,
        openCount,
      }
    })
    return { projects }
  }

  async activateProject(id: string): Promise<{ projectId: string }> {
    const registry = loadRegistry()
    requireProject(registry, id)
    await withLockedJson<ReviewerState>(REVIEWER_STATE_PATH, { activeProjectId: null }, () => ({
      activeProjectId: id,
    }))
    return { projectId: id }
  }

  /** Resolve and load a project for a request; shared validation entry. */
  private useProject(projectId: string): { project: ProjectRecord } {
    const registry = loadRegistry()
    return { project: requireProject(registry, projectId) }
  }

  private countOpen(project: ProjectRecord): number {
    let count = 0
    for (const { reviewId } of listReviewFiles(project.path)) {
      try {
        const parsed = readReviewFile(project.path, reviewId)
        if (!isTerminal(parsed.record.status)) count++
      } catch {
        // One unreadable file must not blank the project badge.
      }
    }
    return count
  }

  // -------------------------------------------------------------------------
  // Review reads
  // -------------------------------------------------------------------------

  listReviews(query: {
    projectId: string
    status?: string
    severity?: string
    document?: string
    author?: string
    tag?: string
  }): ListReviewsResponse {
    const { project } = this.useProject(query.projectId)
    const statuses = splitFilter(query.status)
    const severities = splitFilter(query.severity)
    const summaries = this.scanSummaries(project)
    const reviews = summaries.filter((summary) => {
      if (statuses !== null && !statuses.has(summary.status)) return false
      if (severities !== null && !severities.has(summary.severity)) return false
      if (query.document !== undefined && query.document !== '' && summary.document !== query.document) return false
      if (query.author !== undefined && query.author !== '' && summary.author !== query.author) return false
      if (query.tag !== undefined && query.tag !== '' && !summary.tags.includes(query.tag)) return false
      return true
    })
    return { reviews }
  }

  getReview(projectId: string, reviewId: string): GetReviewResponse {
    const { project } = this.useProject(projectId)
    const parsed = this.readRecord(project, reviewId)
    if (parsed.record.number <= 0) {
      parsed.record.number = this.backfillNumbers(project.path).get(reviewId) ?? 0
    }
    const doc = readDocument(project.path, parsed.record.document)
    const anchorResolution = resolveAnchor(parsed.record.target, doc.content)
    // Auto-triage may rewrite the record (position follow / needs_review) and
    // returns the resolution that matches the post-triage state.
    const { record, resolution } = this.applyAnchorTriage(project, parsed, anchorResolution)
    return { review: record, anchorResolution: resolution }
  }

  getDocument(projectId: string, document: string): DocumentResponse {
    const { project } = this.useProject(projectId)
    // Validates path containment before touching disk.
    resolveDocument(project.path, document)
    const doc = readDocument(project.path, document)
    const headings: DocumentHeading[] = doc.exists ? parseHeadings(doc.content) : []
    const numbers = this.backfillNumbers(project.path)
    const reviews: DocumentReviewAnchor[] = []
    for (const { reviewId } of listReviewFiles(project.path)) {
      let parsed: ParsedReviewFile & { sha: string }
      try {
        parsed = readReviewFile(project.path, reviewId)
      } catch {
        continue
      }
      if (parsed.record.document !== document) continue
      const resolution = resolveAnchor(parsed.record.target, doc.content)
      const { record: triaged, resolution: finalResolution } = this.applyAnchorTriage(project, parsed, resolution)
      reviews.push({
        reviewId,
        number: numbers.get(reviewId) ?? triaged.number,
        status: triaged.status,
        severity: triaged.severity,
        type: triaged.type,
        selectedText: triaged.target.textual.selectedText,
        lineStart: finalResolution.lineStart,
        lineEnd: finalResolution.lineEnd,
        matchOffsetStart: finalResolution.matchOffsetStart,
        matchOffsetEnd: finalResolution.matchOffsetEnd,
        anchorStatus: finalResolution.state,
        needsReviewCandidate: finalResolution.needsReviewCandidate,
      })
    }
    reviews.sort((a, b) => (a.lineStart ?? Number.MAX_SAFE_INTEGER) - (b.lineStart ?? Number.MAX_SAFE_INTEGER))
    return { path: document, content: doc.content, sha: doc.sha, exists: doc.exists, headings, reviews }
  }

  /** List every markdown document under the project directory (doc-ref picker "browse"). */
  listDocuments(projectId: string): ListDocsResponse {
    const { project } = this.useProject(projectId)
    const documents = listMarkdownDocuments(project.path).map(path => ({
      path,
      title: basename(path, extname(path)),
    }))
    return { documents }
  }

  // -------------------------------------------------------------------------
  // Review writes
  // -------------------------------------------------------------------------

  async createReview(input: CreateReviewRequest): Promise<{ review: ReviewRecord }> {
    const { project } = this.useProject(input.projectId)
    const comment = input.comment.trim()
    if (comment === '') throw new ValidationError('comment must be non-empty')
    const { anchor, documentSha } = this.buildAnchor(project, input.document, input.target)

    const reviewId = await this.allocateReviewId(project.path)
    const number = await this.allocateReviewNumber(project.path, input.document)
    const at = nowIso()
    const authorRef: AuthorRef = { type: 'user', id: 'reviewer' }
    const record: ReviewRecord = {
      schemaVersion: 2,
      reviewId,
      number,
      document: input.document,
      documentSha: input.documentSha ?? documentSha,
      type: input.type ?? 'suggestion',
      severity: input.severity ?? 'minor',
      title: input.title?.trim() || null,
      status: 'open',
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      relatedParties: normalizeRelatedParties(input.relatedParties ?? []),
      target: anchor,
      author: authorRef.id,
      authorRef,
      sessionId: null,
      assignee: null,
      assigneeMember: null,
      teamTaskId: null,
      related: emptyRelated(),
      decision: null,
      decisions: [],
      agentCompletion: null,
      duplicatedOf: null,
      createdAt: at,
      updatedAt: at,
      resolvedAt: null,
      comment,
      proposal: input.proposal?.trim() ?? '',
      thread: {
        id: reviewId,
        status: 'open',
        participants: [authorRef],
        entries: [{
          id: 'ENTRY-0001',
          at,
          author: authorRef,
          kind: 'comment',
          body: comment,
        }],
      },
    }
    // Bind the review's 1:1 lifecycle session before first persist (design/09
    // §5): create + name `[类型]标题`, best-effort (null on degradation).
    record.sessionId = await this.openReviewSession(project, record)
    this.writeWithSlug(project.path, record)
    this.scheduleIndexRebuild(project)
    return { review: record }
  }

  async appendReview(input: AppendRequest): Promise<{ review: ReviewRecord; sha: string }> {
    const { project } = this.useProject(input.projectId)
    const body = input.body.trim()
    if (body === '') throw new ValidationError('body must be non-empty')
    const parsed = this.readRecord(project, input.reviewId)
    this.assertSha(parsed.sha, input.expectedSha)
    if (isTerminal(parsed.record.status)) {
      throw new ValidationError(`cannot append to a ${parsed.record.status} review`)
    }
    const author: AuthorRef = input.author ?? REVIEWER_AUTHOR
    this.pushEntry(parsed.record, {
      at: nowIso(),
      author,
      kind: 'comment',
      body,
      ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
    })
    // Discussion no longer moves the state (spec §5, refactor §4.1): the
    // `discussing` status is gone, and the thread already carries the fact
    // that a conversation is happening — no status noise on every reply.
    parsed.record.updatedAt = nowIso()
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha }
  }

  /**
   * Edit a published review (GitHub-style edit): wording (comment/proposal)
   * and classification metadata (title/type/severity/tags). The anchor,
   * fingerprint, thread and status stay untouched, so document positioning
   * and already-sent agent context are unaffected. Terminal reviews are
   * read-only, matching the append policy.
   */
  async editReview(input: EditReviewRequest): Promise<{ review: ReviewRecord; sha: string }> {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    this.assertSha(parsed.sha, input.expectedSha)
    if (isTerminal(parsed.record.status)) {
      throw new ValidationError(`cannot edit a ${parsed.record.status} review`)
    }
    if (input.comment === undefined && input.proposal === undefined
      && input.title === undefined && input.severity === undefined
      && input.type === undefined && input.tags === undefined
      && input.relatedParties === undefined) {
      throw new ValidationError('nothing to edit: provide at least one editable field')
    }
    let wordingEdited = false
    let sessionNameEdited = false
    if (input.comment !== undefined) {
      const comment = input.comment.trim()
      if (comment === '') throw new ValidationError('comment must be non-empty')
      parsed.record.comment = comment
      // The opening comment is authoritative in the thread; keep both in sync.
      const opening = parsed.record.thread.entries[0]
      if (opening !== undefined && opening.kind === 'comment') {
        opening.body = comment
        wordingEdited = true
      }
    }
    if (input.proposal !== undefined) {
      parsed.record.proposal = input.proposal.trim()
      wordingEdited = true
    }
    if (input.title !== undefined) {
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      parsed.record.title = title === '' ? null : title
      sessionNameEdited = true
    }
    if (input.severity !== undefined) {
      if (!SEVERITIES.includes(input.severity)) {
        throw new ValidationError(`unknown severity: ${String(input.severity)}`)
      }
      parsed.record.severity = input.severity
    }
    if (input.type !== undefined) {
      if (!REVIEW_TYPES.includes(input.type)) {
        throw new ValidationError(`unknown review type: ${String(input.type)}`)
      }
      parsed.record.type = input.type
      sessionNameEdited = true
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags)) throw new ValidationError('tags must be an array of strings')
      parsed.record.tags = input.tags.map(tag => String(tag).trim()).filter(tag => tag !== '')
    }
    if (input.relatedParties !== undefined) {
      if (!Array.isArray(input.relatedParties)) {
        throw new ValidationError('relatedParties must be an array of strings')
      }
      parsed.record.relatedParties = normalizeRelatedParties(input.relatedParties)
    }
    const at = nowIso()
    if (wordingEdited) {
      parsed.record.commentEditedAt = at
      const opening = parsed.record.thread.entries[0]
      if (opening !== undefined && opening.kind === 'comment') opening.editedAt = at
    }
    parsed.record.updatedAt = at
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    // Rename the lifecycle session when title/type changed (design/09 §4).
    if (sessionNameEdited) await this.renameReviewSession(parsed.record)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha }
  }

  /**
   * Edit one discussion entry's body. Only kind === 'comment' entries are
   * editable — status/decision/system lines are machine-written transitions.
   */
  async editThreadEntry(input: EditThreadEntryRequest): Promise<{ review: ReviewRecord; sha: string }> {
    const { project } = this.useProject(input.projectId)
    const body = input.body.trim()
    if (body === '') throw new ValidationError('body must be non-empty')
    const parsed = this.readRecord(project, input.reviewId)
    this.assertSha(parsed.sha, input.expectedSha)
    if (isTerminal(parsed.record.status)) {
      throw new ValidationError(`cannot edit entries of a ${parsed.record.status} review`)
    }
    const entry = parsed.record.thread.entries.find(item => item.id === input.entryId)
    if (entry === undefined) {
      const error = new ValidationError(`thread entry not found: ${input.entryId}`)
      error.name = 'NotFoundError'
      throw error
    }
    if (entry.kind !== 'comment') {
      throw new ValidationError(`only comment entries can be edited (got ${entry.kind})`)
    }
    const at = nowIso()
    entry.body = body
    entry.editedAt = at
    // The opening entry IS the comment projection (v2): keep record.comment
    // in sync so the body's "## Comment" section round-trips coherently.
    if (entry === parsed.record.thread.entries[0]) {
      parsed.record.comment = body
    }
    parsed.record.updatedAt = at
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha }
  }

  async transitionReview(input: TransitionRequest): Promise<{ review: ReviewRecord; sha: string }> {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    this.assertSha(parsed.sha, input.expectedSha)
    const from = parsed.record.status
    const to = input.to
    assertTransition(from, to)

    // Human-only transitions (spec §5.2/§9): a critical review's final
    // acceptance and its Reopen are reserved to a human. The actor is declared
    // by the caller; an agent that declares itself is refused outright.
    const actor = resolveActor(input.author)
    if (actor.type === 'agent'
      && isHumanOnlyTransition({ from, to, severity: parsed.record.severity })) {
      throw new ForbiddenError(
        to === 'resolved'
          ? 'only a human can resolve a critical review'
          : 'only a human can reopen a critical review',
      )
    }

    // A human driving the workflow keeps / dismisses a pending agent
    // completion suggestion (spec §9): the next human transition clears it.
    parsed.record.agentCompletion = null

    // Conditional transitions (06 §2).
    if (to === 'rejected' && (input.reason ?? '').trim() === '') {
      throw new ValidationError('reason is required when rejecting a review')
    }
    // Reopen (spec §5.2): coming back from a terminal state is an explicit,
    // reasoned act — a plain rollback from a live state needs no reason.
    if (isReopen({ from, to }) && (input.reason ?? '').trim() === '') {
      throw new ValidationError('reason is required when reopening a review')
    }
    // Failing verification (spec §5.2) must record why: the UI dialog requires
    // it, and the host enforces the same rule for every other caller.
    if (from === 'verifying' && to === 'implementing' && (input.reason ?? '').trim() === '') {
      throw new ValidationError('reason is required when failing verification')
    }
    if (to === 'duplicated') {
      if ((input.duplicatedOf ?? '').trim() === '') {
        throw new ValidationError('duplicatedOf is required when marking duplicated')
      }
      const target = this.readRecord(project, input.duplicatedOf as string)
      if (target.record.reviewId === parsed.record.reviewId) {
        throw new ValidationError('a review cannot duplicate itself')
      }
      parsed.record.duplicatedOf = target.record.reviewId
    }

    const at = nowIso()
    const decisionKind = decisionTypeFor(to)
    const threadBody = (input.reason ?? input.decisionSummary ?? '').trim()
    this.pushEntry(parsed.record, {
      at,
      author: actor,
      kind: 'status',
      body: threadBody,
      fromStatus: from,
      toStatus: to,
    })
    if (decisionKind !== null) {
      const summary = (input.decisionSummary ?? input.reason ?? '').trim()
      const decision: ReviewDecision = {
        id: nextDecisionId(parsed.record),
        type: decisionKind,
        summary,
        decidedBy: actor,
        decidedAt: at,
      }
      parsed.record.decision = decision
      parsed.record.decisions.push(decision)
      this.pushEntry(parsed.record, {
        at,
        author: actor,
        kind: 'decision',
        body: summary,
        decisionType: decisionKind,
        decisionId: decision.id,
      })
    }
    parsed.record.status = to
    parsed.record.thread.status = to
    parsed.record.updatedAt = at
    if (to === 'resolved') parsed.record.resolvedAt = at
    // Reopen clears the terminal timestamp; decisions, thread and
    // duplicatedOf all survive (spec §5.2).
    if (isReopen({ from, to })) parsed.record.resolvedAt = null
    // Session lifecycle sync (design/09 §5): entering a terminal state
    // archives the review's session; reopening unarchives it. Best-effort.
    if (isTerminal(to)) {
      await this.archiveReviewSession(parsed.record.sessionId)
    } else if (isReopen({ from, to })) {
      await this.unarchiveReviewSession(parsed.record.sessionId)
    }
    // Evidence chain (design/06 §8): backfill commit trailers when the review
    // is entering a verification-bearing state. Best effort — never blocks.
    if (to === 'implementing' || to === 'verifying' || to === 'resolved' || to === 'accepted') {
      try {
        await this.backfillReviewCommits(project.path, parsed.record)
      } catch { /* git apathy must never block a transition */ }
    }
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha }
  }

  /**
   * Manual re-anchor (design/06 §12, ticket 04): bind the review to a fresh
   * document selection. When the review sits in `needs_review`, it auto-exits
   * back to the status it entered from (inferred from the status timeline).
   * This is the ONLY way out of needs_review — a document that becomes
   * locatable again does not exit by itself (§17 jitter guard).
   */
  async reanchorReview(input: ReanchorRequest): Promise<{ review: ReviewRecord; sha: string }> {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    this.assertSha(parsed.sha, input.expectedSha)
    const record = parsed.record
    const { anchor, documentSha } = this.buildAnchor(project, record.document, input.target)
    record.target = anchor
    record.documentSha = documentSha
    const at = nowIso()
    // Infer the restore target BEFORE pushing new entries (the inference scans
    // the timeline for the entry that entered needs_review).
    const restore = record.status === 'needs_review'
      ? preNeedsReviewStatus(record.thread.entries)
      : null
    this.pushEntry(record, {
      at,
      author: REVIEWER_AUTHOR,
      kind: 'system',
      body: 'anchor re-bound to a fresh selection',
    })
    if (restore !== null) {
      assertTransition('needs_review', restore)
      this.pushEntry(record, {
        at,
        author: REVIEWER_AUTHOR,
        kind: 'status',
        body: 'anchor re-bound; leaving needs_review',
        fromStatus: 'needs_review',
        toStatus: restore,
      })
      record.status = restore
      record.thread.status = restore
    }
    record.updatedAt = at
    const sha = this.writeWithSlug(project.path, record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: record, sha }
  }

  /**
   * Post-dispatch state write-back (design/07 §5): accepted/open -> implementing.
   * Sending to an agent IS the human acceptance, so an open review records the
   * accept Decision and ONE status entry straight to implementing — there is no
   * `accepted` stopover the user never clicked (spec §9, refactor §2.3).
   * assignee and related.agentRuns record the target session id; a Team
   * teammate dispatch (design/08) additionally records the member name in
   * assigneeMember (assignee keeps the teammate's underlying session id) and,
   * in task mode, the shared board task id in teamTaskId (§3.3).
   */
  markAgentDispatched(input: {
    projectId: string
    reviewId: string
    sessionId: string
    assigneeMember?: string | null
    teamTaskId?: string | null
    requestId?: string | null
  }): { review: ReviewRecord; sha: string } {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    const status = parsed.record.status
    if (status !== 'accepted' && status !== 'open') {
      throw new ValidationError(`only accepted/open reviews can be sent to an agent (got ${status})`)
    }
    const at = nowIso()
    // A fresh dispatch starts a new run; a completion suggestion from a
    // previous run is stale the moment the human re-dispatches (spec §9).
    parsed.record.agentCompletion = null
    const pushStatus = (from: ReviewStatus, to: ReviewStatus, body: string) => {
      this.pushEntry(parsed.record, {
        at,
        author: REVIEWER_AUTHOR,
        kind: 'status',
        body,
        fromStatus: from,
        toStatus: to,
      })
    }
    if (status === 'open') {
      const decision: ReviewDecision = {
        id: nextDecisionId(parsed.record),
        type: 'accept',
        summary: 'Accepted when sent to agent',
        decidedBy: REVIEWER_AUTHOR,
        decidedAt: at,
      }
      parsed.record.decision = decision
      parsed.record.decisions.push(decision)
      this.pushEntry(parsed.record, {
        at,
        author: REVIEWER_AUTHOR,
        kind: 'decision',
        body: 'Accepted when sent to agent',
        decisionType: 'accept',
        decisionId: decision.id,
      })
    }
    const hasMember = input.assigneeMember !== undefined && input.assigneeMember !== null && input.assigneeMember !== ''
    const hasTask = input.teamTaskId !== undefined && input.teamTaskId !== null && input.teamTaskId !== ''
    const dispatchNote = hasMember
      ? hasTask
        ? `dispatched to teammate ${input.assigneeMember} (session ${input.sessionId}) · team task ${input.teamTaskId}`
        : `dispatched to teammate ${input.assigneeMember} (session ${input.sessionId})`
      : `dispatched to agent session ${input.sessionId}`
    pushStatus(status, 'implementing', dispatchNote)
    parsed.record.status = 'implementing'
    parsed.record.thread.status = 'implementing'
    parsed.record.assignee = input.sessionId
    // Fresh attribution every dispatch: a member send records the name, a
    // plain-session send clears it (assigneeMember mirrors the latest run);
    // teamTaskId follows the same rule for task-mode dispatches.
    parsed.record.assigneeMember = input.assigneeMember ?? null
    parsed.record.teamTaskId = input.teamTaskId ?? null
    if (!parsed.record.related.agentRuns.includes(input.sessionId)) {
      parsed.record.related.agentRuns.push(input.sessionId)
    }
    parsed.record.updatedAt = at
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    if (input.requestId !== undefined && input.requestId !== null && input.requestId !== '') {
      this.registerPendingRun({
        projectId: input.projectId,
        reviewId: input.reviewId,
        sessionId: input.sessionId,
        rpcId: input.requestId,
      })
    }
    return { review: parsed.record, sha }
  }

  /**
   * §3.5 status loop-back (design/08): the shared-board task a task-mode
   * dispatch created has been marked completed by the teammate. Absorb that
   * report the same way the session path absorbs agent replies — an agent
   * comment entry plus the agentCompletion SUGGESTION (never a state change;
   * the human still verifies, spec §9). Idempotent: a second call while the
   * suggestion is pending is a no-op.
   */
  absorbTeamTaskCompletion(input: {
    projectId: string
    reviewId: string
  }): { review: ReviewRecord; sha: string; absorbed: boolean } {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    const status = parsed.record.status
    if (status !== 'implementing') {
      throw new ValidationError(`task completion can only be absorbed while implementing (got ${status})`)
    }
    if (parsed.record.teamTaskId === null || parsed.record.teamTaskId === '') {
      throw new ValidationError('review has no team task to absorb (dispatch was not task-mode)')
    }
    if (parsed.record.agentCompletion !== null) {
      // Suggestion already pending — keep the original report untouched.
      return { review: parsed.record, sha: parsed.sha, absorbed: false }
    }
    const at = nowIso()
    const taskId = parsed.record.teamTaskId
    const member = parsed.record.assigneeMember ?? 'teammate'
    const author: AuthorRef = {
      type: 'agent',
      id: member,
      displayName: member,
      // No prompt rpcId exists for board-mode runs; the task id is the run.
      agentRunId: `team-task:${taskId}`,
    }
    this.pushEntry(parsed.record, {
      at,
      author,
      kind: 'comment',
      body: `Team task ${taskId} completed by ${member} — reported via the shared board.`,
    })
    parsed.record.agentCompletion = {
      at,
      sessionId: parsed.record.assignee ?? member,
      rpcId: `team-task:${taskId}`,
      provider: null,
      model: null,
    }
    parsed.record.updatedAt = at
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha, absorbed: true }
  }

  async removeReview(input: RemoveRequest): Promise<{ removed: true }> {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    const removable: ReviewStatus[] = ['open', 'rejected', 'duplicated']
    if (!removable.includes(parsed.record.status)) {
      throw new ValidationError(`only open/rejected/duplicated reviews can be removed (got ${parsed.record.status})`)
    }
    const files = listReviewFiles(project.path).filter(entry => entry.reviewId === input.reviewId)
    for (const file of files) {
      try { unlinkSync(file.file) } catch { /* best effort */ }
    }
    // Deletion closes the review's lifecycle session (design/09 §5): archive
    // (the platform's soft-delete) so it leaves the active session area.
    await this.archiveReviewSession(parsed.record.sessionId)
    this.scheduleIndexRebuild(project)
    return { removed: true }
  }

  // -------------------------------------------------------------------------
  // Agent run correlation (session/event feed -> agent comment)
  // -------------------------------------------------------------------------

  private registerPendingRun(input: {
    projectId: string
    reviewId: string
    sessionId: string
    rpcId: string
  }): void {
    const run: PendingAgentRun = {
      projectId: input.projectId,
      reviewId: input.reviewId,
      sessionId: input.sessionId,
      rpcId: input.rpcId,
      turn: null,
      textParts: [],
      provider: null,
      model: null,
      registeredAt: Date.now(),
    }
    this.pendingRunsByRpc.set(input.rpcId, run)
    const bySession = this.pendingRunsBySession.get(input.sessionId) ?? new Set<string>()
    bySession.add(input.rpcId)
    this.pendingRunsBySession.set(input.sessionId, bySession)
    if (this.pendingRunsByRpc.size > ReviewStore.MAX_PENDING_RUNS) {
      const oldest = this.pendingRunsByRpc.keys().next().value
      if (oldest !== undefined) this.dropPendingRun(oldest)
    }
  }

  private dropPendingRun(rpcId: string): void {
    const run = this.pendingRunsByRpc.get(rpcId)
    if (run === undefined) return
    this.pendingRunsByRpc.delete(rpcId)
    const bySession = this.pendingRunsBySession.get(run.sessionId)
    if (bySession !== undefined) {
      bySession.delete(rpcId)
      if (bySession.size === 0) this.pendingRunsBySession.delete(run.sessionId)
    }
  }

  private pruneStaleRuns(now: number): void {
    for (const [rpcId, run] of this.pendingRunsByRpc) {
      if (run.turn === null && now - run.registeredAt > ReviewStore.STALE_RUN_MS) {
        this.dropPendingRun(rpcId)
      }
    }
  }

  /** turn/start: the next user/message(s) in this session belong to this turn. */
  onTurnStart(sessionId: string, turn: number): void {
    this.currentTurns.set(sessionId, turn)
    this.pruneStaleRuns(Date.now())
  }

  /** user/message: bind this rpcId run to the turn the platform opened for it. */
  onUserMessage(sessionId: string, rpcId: string | null): void {
    if (rpcId === null) return
    const run = this.pendingRunsByRpc.get(rpcId)
    if (run === undefined || run.sessionId !== sessionId) return
    run.turn = this.currentTurns.get(sessionId) ?? null
  }

  /** assistant/message: one full-snapshot text delivery for a turn step. */
  onAssistantMessage(input: {
    sessionId: string
    turn: number
    text: string
    interrupted: boolean
    provider: string | null
    model: string | null
  }): void {
    if (input.interrupted || input.text.trim() === '') return
    for (const rpcId of this.pendingRunsBySession.get(input.sessionId) ?? []) {
      const run = this.pendingRunsByRpc.get(rpcId)
      if (run === undefined || run.turn !== input.turn) continue
      run.textParts.push(input.text)
      if (input.provider !== null) run.provider = input.provider
      if (input.model !== null) run.model = input.model
    }
  }

  /**
   * turn/end: flush every completed run bound to this turn as one agent
   * comment. Non-completion reasons (abort/error/blocked/...) produce no
   * comment. Agents never write decisions or change the review status.
   */
  onTurnEnd(sessionId: string, turn: number, completed: boolean): void {
    this.currentTurns.delete(sessionId)
    const rpcIds = [...(this.pendingRunsBySession.get(sessionId) ?? [])]
    for (const rpcId of rpcIds) {
      const run = this.pendingRunsByRpc.get(rpcId)
      if (run === undefined || run.turn !== turn) continue
      const body = run.textParts.join('\n\n').trim()
      this.dropPendingRun(rpcId)
      if (!completed || body === '') continue
      try {
        this.appendAgentComment({
          projectId: run.projectId,
          reviewId: run.reviewId,
          body,
          rpcId: run.rpcId,
          provider: run.provider,
          model: run.model,
          sessionId: run.sessionId,
        })
      } catch (error) {
        // Feed handling must never throw into the platform event bus.
        process.stderr.write(
          `[dsh-devbuddy-reviewer] agent comment flush failed for ${run.reviewId}: ${String(error)}\n`,
        )
      }
    }
  }

  private appendAgentComment(input: {
    projectId: string
    reviewId: string
    body: string
    rpcId: string
    provider: string | null
    model: string | null
    sessionId: string
  }): void {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    if (isTerminal(parsed.record.status)) return
    const at = nowIso()
    const author: AuthorRef = {
      type: 'agent',
      id: input.provider ?? 'agent',
      ...(input.provider !== null ? { provider: input.provider } : {}),
      ...(input.model !== null ? { displayName: input.model } : {}),
      agentRunId: input.rpcId,
    }
    this.pushEntry(parsed.record, {
      at,
      author,
      kind: 'comment',
      body: input.body,
    })
    // Agent completion is a SUGGESTION, not a state change (spec §9): when the
    // review is still being implemented, remember that the agent reported done
    // so the panel can offer a one-click confirm. The human decides; the next
    // human-driven transition clears the suggestion. Agents never decide.
    if (parsed.record.status === 'implementing') {
      parsed.record.agentCompletion = {
        at,
        sessionId: input.sessionId,
        rpcId: input.rpcId,
        provider: input.provider,
        model: input.model,
      }
    }
    parsed.record.updatedAt = nowIso()
    this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
  }

  /**
   * Validate a client-supplied anchor draft against the live document and
   * materialize the persisted ReviewAnchor (design/03 §3.1). Shared by review
   * creation and manual re-anchoring so both paths enforce the same rules:
   * containment, existence, and LF-normalized offset/exactness checks.
   */
  private buildAnchor(
    project: ProjectRecord,
    document: string,
    draft: ReviewAnchorDraft,
  ): { anchor: ReviewAnchor; documentSha: string | null } {
    const selectedText = draft.textual.selectedText
    const lineStart = draft.positional.lineStart
    const lineEnd = draft.positional.lineEnd
    if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
      throw new ValidationError('lineStart/lineEnd must be positive integers with lineEnd >= lineStart')
    }
    // Document containment + existence (the selection came from a real file).
    resolveDocument(project.path, document)
    const doc = readDocument(project.path, document)
    if (!doc.exists) throw new ValidationError(`document does not exist: ${document}`)

    // New clients submit LF-normalized offsets (the left editor normalizes
    // CRLF); validate against the normalized document for an exact bound.
    const lfContent = doc.content.replace(/\r\n/g, '\n')
    const rawOffsetStart = draft.positional.offsetStart
    const rawOffsetEnd = draft.positional.offsetEnd
    const isPoint = selectedText === ''
    let offsetStart: number | undefined
    let offsetEnd: number | undefined
    if (isPoint) {
      // Zero-length caret anchor: identical offsets, empty selection.
      const caret = rawOffsetStart
      if (typeof caret !== 'number'
        || !Number.isInteger(caret)
        || rawOffsetEnd !== caret
        || caret < 0
        || caret > lfContent.length) {
        throw new ValidationError('point anchor requires an integer caret offset within the document')
      }
      offsetStart = caret
      offsetEnd = caret
    } else {
      if (selectedText.trim() === '') throw new ValidationError('selectedText must be non-empty')
      if (selectedText.length > MAX_SELECTED_CHARS) {
        throw new ValidationError(`selectedText must be at most ${MAX_SELECTED_CHARS} characters`)
      }
      if (rawOffsetStart !== undefined && rawOffsetEnd !== undefined) {
        if (!Number.isInteger(rawOffsetStart) || !Number.isInteger(rawOffsetEnd)
          || rawOffsetStart < 0 || rawOffsetEnd < rawOffsetStart
          || rawOffsetEnd > lfContent.length
          || lfContent.slice(rawOffsetStart, rawOffsetEnd) !== selectedText) {
          throw new ValidationError('offsetStart/offsetEnd must match selectedText in the document')
        }
        offsetStart = rawOffsetStart
        offsetEnd = rawOffsetEnd
      }
    }

    const prefix = draft.textual.prefix ?? ''
    const suffix = draft.textual.suffix ?? ''
    const fingerprintValue = sha256(prefix + selectedText + suffix)
    const positional: ReviewAnchor['positional'] = offsetStart !== undefined
      ? { lineStart, lineEnd, offsetStart, offsetEnd }
      : { lineStart, lineEnd }
    const anchor: ReviewAnchor = {
      structural: {
        section: draft.structural.section ?? null,
        headingPath: Array.isArray(draft.structural.headingPath)
          ? draft.structural.headingPath.map(String)
          : [],
      },
      textual: { selectedText, prefix, suffix },
      positional,
      fingerprint: { algorithm: 'sha256', value: fingerprintValue },
    }
    return { anchor, documentSha: doc.sha }
  }

  /**
   * Anchor auto-triage (design/06 §12, ticket 04). Called on the read path.
   * Debounced: nothing is written unless the fresh resolution actually changes
   * the persisted anchor position or the review must enter needs_review — an
   * unchanged document is a strict no-op, so reads never amplify into writes.
   *
   * The write is guarded by a fresh sha check: a concurrent writer wins and the
   * next read simply re-tries the same triage outcome.
   */
  private applyAnchorTriage(
    project: ProjectRecord,
    parsed: ParsedReviewFile & { sha: string },
    resolution: AnchorResolution,
  ): { record: ReviewRecord; resolution: AnchorResolution } {
    const record = parsed.record
    const positionalChanged = resolution.lineStart !== null && resolution.lineEnd !== null
      && (record.target.positional.lineStart !== resolution.lineStart
        || record.target.positional.lineEnd !== resolution.lineEnd)
    const decision = decideAnchorTriage({
      state: resolution.state,
      status: record.status,
      positionalChanged,
    })
    if (decision.action === 'none') return { record, resolution }

    let fresh: ParsedReviewFile & { sha: string }
    try {
      fresh = this.readRecord(project, record.reviewId)
    } catch {
      return { record, resolution }
    }
    if (fresh.sha !== parsed.sha) return { record, resolution }

    const at = nowIso()
    // Mutate a copy: this runs inside read paths, so a failed triage write must
    // never hand the caller a half-triaged record. On any failure we return the
    // record exactly as read (spec §12/§16: skip silently, retry next read).
    const triaged: ReviewRecord = {
      ...record,
      target: { ...record.target, positional: { ...record.target.positional } },
      thread: { ...record.thread, entries: [...record.thread.entries] },
    }
    if (decision.action === 'auto-needs-review') {
      // Every non-terminal state must be able to reach needs_review (spec
      // §5.2); if the table ever disagrees, degrade instead of throwing out of
      // a read path.
      try {
        assertTransition(triaged.status, 'needs_review')
      } catch {
        return { record, resolution }
      }
      this.pushEntry(triaged, {
        at,
        author: REVIEWER_AUTHOR,
        kind: 'status',
        body: decision.note,
        fromStatus: triaged.status,
        toStatus: 'needs_review',
      })
      triaged.status = 'needs_review'
      triaged.thread.status = 'needs_review'
    } else {
      // Position follow: adopt the fresh line range. Fuzzy matches report no
      // offsets, so stale offsets from the old text are dropped rather than
      // lying about the match.
      triaged.target.positional = {
        lineStart: resolution.lineStart as number,
        lineEnd: resolution.lineEnd as number,
        ...(resolution.matchOffsetStart !== null && resolution.matchOffsetEnd !== null
          ? { offsetStart: resolution.matchOffsetStart, offsetEnd: resolution.matchOffsetEnd }
          : {}),
      }
      if (decision.action === 'system-note') {
        this.pushEntry(triaged, {
          at,
          author: REVIEWER_AUTHOR,
          kind: 'system',
          body: decision.note,
        })
      }
    }
    triaged.updatedAt = at
    try {
      this.writeWithSlug(project.path, triaged, parsed.extra)
    } catch {
      // Concurrent writer, read-only tree, or any other write failure: leave
      // the review as read and let the next read retry the same triage.
      return { record, resolution }
    }
    this.scheduleIndexRebuild(project)
    // The triage just rewrote the anchor; re-resolve so callers see the
    // resolution that matches the persisted state (usually settles to valid).
    const doc = readDocument(project.path, triaged.document)
    return { record: triaged, resolution: resolveAnchor(triaged.target, doc.content) }
  }

  /**
   * Evidence chain (design/06 §8): fold `DevBuddy-Review: <id>` commit trailers
   * into `related.commits`. Read-only git, best effort; existing entries are
   * kept and hashes are de-duplicated. Called from human-driven transitions, so
   * the scan runs synchronously with the write (no detached background write).
   */
  private async backfillReviewCommits(projectPath: string, record: ReviewRecord): Promise<void> {
    const hits = await scanReviewCommits(projectPath, record.reviewId)
    for (const hit of hits) {
      if (!record.related.commits.includes(hit.hash)) record.related.commits.push(hit.hash)
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Document-scoped display numbers (design/03 §7): records written by older
   * builds carry number=0. Lazily assign them per document in createdAt (then
   * reviewId) order, skipping numbers already taken. Pure read — the assigned
   * value is persisted only when the record is next written.
   */
  private backfillNumbers(projectPath: string): Map<string, number> {
    const assigned = new Map<string, number>()
    const groups = new Map<string, Array<{ reviewId: string; number: number; createdAt: string }>>()
    for (const { reviewId } of listReviewFiles(projectPath)) {
      try {
        const { record } = readReviewFile(projectPath, reviewId)
        const group = groups.get(record.document) ?? []
        group.push({ reviewId, number: record.number, createdAt: record.createdAt })
        groups.set(record.document, group)
      } catch {
        // Skip unreadable files; the write-path allocation scans again.
      }
    }
    for (const group of groups.values()) {
      const used = new Set<number>()
      for (const entry of group) {
        if (entry.number > 0) {
          used.add(entry.number)
          assigned.set(entry.reviewId, entry.number)
        }
      }
      const missing = group
        .filter(entry => entry.number <= 0)
        .sort((a, b) => (a.createdAt === b.createdAt
          ? a.reviewId.localeCompare(b.reviewId)
          : a.createdAt.localeCompare(b.createdAt)))
      let next = 1
      for (const entry of missing) {
        while (used.has(next)) next++
        used.add(next)
        assigned.set(entry.reviewId, next)
      }
    }
    return assigned
  }

  /**
   * Allocate the document-scoped monotonic number (design/03 §3.1): serialized
   * per project+document via max-scan over same-document records. Deleted
   * numbers are never reused.
   */
  private allocateReviewNumber(projectPath: string, document: string): Promise<number> {
    const lockKey = `${projectPath}:${document}`
    const run = async (): Promise<number> => {
      let max = 0
      for (const { reviewId } of listReviewFiles(projectPath)) {
        try {
          const { record } = readReviewFile(projectPath, reviewId)
          if (record.document === document) max = Math.max(max, record.number)
        } catch {
          // Ignore unreadable files while allocating.
        }
      }
      return max + 1
    }
    const previous = this.sequenceLocks.get(lockKey) ?? Promise.resolve()
    const next = previous.then(run, run)
    this.sequenceLocks.set(lockKey, next.then(() => undefined, () => undefined))
    return next
  }

  /** Allocate REV-XXXX: in-process serialization per project + max-scan. */
  private allocateReviewId(projectPath: string): Promise<string> {
    const run = async (): Promise<string> => {
      const maxId = listReviewFiles(projectPath).reduce((max, entry) => {
        const num = Number(entry.reviewId.slice('REV-'.length))
        return Number.isFinite(num) ? Math.max(max, num) : max
      }, 0)
      return `REV-${String(maxId + 1).padStart(4, '0')}`
    }
    const previous = this.sequenceLocks.get(projectPath) ?? Promise.resolve()
    const next = previous.then(run, run)
    this.sequenceLocks.set(projectPath, next.then(() => undefined, () => undefined))
    return next
  }

  private readRecord(project: ProjectRecord, reviewId: string): ParsedReviewFile & { sha: string } {
    return readReviewFile(project.path, reviewId)
  }

  private assertSha(currentSha: string, expectedSha?: string | null): void {
    if (expectedSha !== undefined && expectedSha !== null && expectedSha !== currentSha) {
      throw new ConflictError('review was updated elsewhere; reload and retry')
    }
  }

  /**
   * Append a timeline entry with a stable max+1 ENTRY id, then mirror the
   * review status into the thread and re-derive participants so the in-memory
   * record returned to callers matches what serializeReviewFile would persist.
   */
  private pushEntry(record: ReviewRecord, entry: Omit<ThreadEntry, 'id'> & { id?: string }): ThreadEntry {
    const full: ThreadEntry = { ...entry, id: entry.id ?? nextEntryId(record.thread.entries) }
    record.thread.entries.push(full)
    record.thread.status = record.status
    record.thread.participants = deriveParticipants(record.thread.entries)
    return full
  }

  /**
   * Persist a record. writeReviewFile keeps the existing slugged file name or
   * derives REV-XXXX-slug.md from title/document on first write.
   */
  private writeWithSlug(
    projectPath: string,
    record: ReviewRecord,
    extra: ParsedReviewFile['extra'] = {},
  ): string {
    return writeReviewFile(projectPath, record, extra).sha
  }

  private scanSummaries(project: ProjectRecord): ReviewSummary[] {
    const numbers = this.backfillNumbers(project.path)
    const summaries: ReviewSummary[] = []
    for (const { reviewId } of listReviewFiles(project.path)) {
      try {
        const { record } = readReviewFile(project.path, reviewId)
        if (record.number <= 0) record.number = numbers.get(reviewId) ?? record.number
        summaries.push(toSummary(record))
      } catch {
        // Skip corrupt files rather than failing the whole list.
      }
    }
    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return summaries
  }

  /** Debounced full-scan index rebuild (index.json is purely derived). */
  private scheduleIndexRebuild(project: ProjectRecord): void {
    const timer = this.indexTimers.get(project.id)
    if (timer !== undefined) clearTimeout(timer)
    this.indexTimers.set(project.id, setTimeout(() => {
      this.indexTimers.delete(project.id)
      try {
        const index: IndexFile = {
          version: 1,
          projectId: project.id,
          updatedAt: nowIso(),
          reviews: this.scanSummaries(project),
        }
        const dir = resolve(project.path, REVIEWS_DIRNAME)
        mkdirSync(dir, { recursive: true })
        const file = resolve(dir, 'index.json')
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
        writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
        renameSync(tmp, file)
      } catch (error) {
        process.stderr.write(`[dsh-devbuddy-reviewer] index rebuild failed: ${String(error)}\n`)
      }
    }, INDEX_REBUILD_DEBOUNCE_MS))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Title truncation budget for the session-name fallback (comment first line). */
const SESSION_TITLE_MAX = 40

/**
 * Compose the review's lifecycle session title: `[类型]标题` (design/09 §4).
 * Falls back title → comment first non-empty line → reviewId.
 */
function reviewSessionTitle(record: ReviewRecord): string {
  const label = REVIEW_TYPE_LABELS[record.type] ?? record.type
  let body: string
  if (record.title !== null && record.title.trim() !== '') {
    body = record.title.trim()
  } else {
    const firstLine = record.comment
      .split('\n')
      .map(line => line.trim())
      .find(line => line !== '')
    body = firstLine ?? record.reviewId
  }
  if (body.length > SESSION_TITLE_MAX) body = `${body.slice(0, SESSION_TITLE_MAX)}…`
  return `[${label}]${body}`
}

function toSummary(record: ReviewRecord): ReviewSummary {
  return {
    reviewId: record.reviewId,
    number: record.number,
    document: record.document,
    type: record.type,
    severity: record.severity,
    status: record.status,
    title: record.title,
    section: record.target.structural.section,
    lineStart: record.target.positional.lineStart,
    lineEnd: record.target.positional.lineEnd,
    tags: record.tags,
    relatedParties: record.relatedParties,
    author: record.author,
    assignee: record.assignee,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function splitFilter(value: string | undefined): Set<string> | null {
  if (value === undefined || value === '') return null
  return new Set(value.split(',').map(part => part.trim()).filter(part => part !== ''))
}
