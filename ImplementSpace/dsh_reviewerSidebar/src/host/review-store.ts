/**
 * ReviewStore: all review record CRUD, id allocation, state-machine
 * enforcement and the derived index.json projection (design/03 §7-8,
 * design/06). Pure host half; every mutating path goes read -> validate ->
 * append -> tmp+rename write, guarded by expectedSha optimistic locks.
 */
import { mkdirSync, unlinkSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
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
import {
  assertTransition,
  decisionTypeFor,
  isTerminal,
} from './lifecycle.ts'
import { REVIEW_TYPES, SEVERITIES } from '../protocol.ts'
import type {
  AppendRequest,
  AuthorRef,
  CreateReviewRequest,
  DocumentHeading,
  DocumentResponse,
  DocumentReviewAnchor,
  EditReviewRequest,
  EditThreadEntryRequest,
  GetReviewResponse,
  ListReviewsResponse,
  ProjectRecord,
  ProjectsResponse,
  ReviewAnchor,
  ReviewDecision,
  ReviewRecord,
  ReviewStatus,
  ReviewSummary,
  ThreadEntry,
  RemoveRequest,
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

function nowIso(): string {
  return new Date().toISOString()
}

function emptyRelated(): ReviewRecord['related'] {
  return { decisions: [], reviews: [], code: [], tests: [], commits: [], agentRuns: [] }
}

/** Default human actor for transitions the reviewer triggers locally. */
const REVIEWER_AUTHOR: AuthorRef = { type: 'user', id: 'reviewer' }

/** Next stable ENTRY-#### by max+1 over the whole thread (never positional). */
function nextEntryId(entries: ThreadEntry[]): string {
  let max = 0
  for (const entry of entries) {
    const match = /^ENTRY-(\d+)$/.exec(entry.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return `ENTRY-${String(max + 1).padStart(4, '0')}`
}

/** Next stable DEC-#### by max+1 over canonical decisions and timeline links. */
function nextDecisionId(record: ReviewRecord): string {
  let max = record.decision !== null ? decisionNumber(record.decision.id) : 0
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

  private workspaces(): readonly WorkspaceInfo[] {
    return this.workspaceProvider !== null ? this.workspaceProvider() : []
  }

  /** Live workspace list for agent dispatch resolution. */
  snapshotWorkspaces(): readonly WorkspaceInfo[] {
    return this.workspaces()
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
    return { review: parsed.record, anchorResolution }
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
      let parsed: ParsedReviewFile
      try {
        parsed = readReviewFile(project.path, reviewId)
      } catch {
        continue
      }
      if (parsed.record.document !== document) continue
      const resolution = resolveAnchor(parsed.record.target, doc.content)
      reviews.push({
        reviewId,
        number: numbers.get(reviewId) ?? parsed.record.number,
        status: parsed.record.status,
        severity: parsed.record.severity,
        type: parsed.record.type,
        selectedText: parsed.record.target.textual.selectedText,
        lineStart: resolution.lineStart,
        lineEnd: resolution.lineEnd,
        matchOffsetStart: resolution.matchOffsetStart,
        matchOffsetEnd: resolution.matchOffsetEnd,
        anchorStatus: resolution.state,
        needsReviewCandidate: resolution.needsReviewCandidate,
      })
    }
    reviews.sort((a, b) => (a.lineStart ?? Number.MAX_SAFE_INTEGER) - (b.lineStart ?? Number.MAX_SAFE_INTEGER))
    return { path: document, content: doc.content, sha: doc.sha, exists: doc.exists, headings, reviews }
  }

  // -------------------------------------------------------------------------
  // Review writes
  // -------------------------------------------------------------------------

  async createReview(input: CreateReviewRequest): Promise<{ review: ReviewRecord }> {
    const { project } = this.useProject(input.projectId)
    const comment = input.comment.trim()
    const selectedText = input.target.textual.selectedText
    if (comment === '') throw new ValidationError('comment must be non-empty')
    const lineStart = input.target.positional.lineStart
    const lineEnd = input.target.positional.lineEnd
    if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
      throw new ValidationError('lineStart/lineEnd must be positive integers with lineEnd >= lineStart')
    }
    // Document containment + existence (the selection came from a real file).
    resolveDocument(project.path, input.document)
    const doc = readDocument(project.path, input.document)
    if (!doc.exists) throw new ValidationError(`document does not exist: ${input.document}`)

    // New clients submit LF-normalized offsets (the left editor normalizes
    // CRLF); validate against the normalized document for an exact bound.
    const lfContent = doc.content.replace(/\r\n/g, '\n')
    const rawOffsetStart = input.target.positional.offsetStart
    const rawOffsetEnd = input.target.positional.offsetEnd
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

    const prefix = input.target.textual.prefix ?? ''
    const suffix = input.target.textual.suffix ?? ''
    const fingerprintValue = sha256(prefix + selectedText + suffix)
    const positional: ReviewAnchor['positional'] = offsetStart !== undefined
      ? { lineStart, lineEnd, offsetStart, offsetEnd }
      : { lineStart, lineEnd }
    const anchor: ReviewAnchor = {
      structural: {
        section: input.target.structural.section ?? null,
        headingPath: Array.isArray(input.target.structural.headingPath)
          ? input.target.structural.headingPath.map(String)
          : [],
      },
      textual: { selectedText, prefix, suffix },
      positional,
      fingerprint: { algorithm: 'sha256', value: fingerprintValue },
    }

    const reviewId = await this.allocateReviewId(project.path)
    const number = await this.allocateReviewNumber(project.path, input.document)
    const at = nowIso()
    const authorRef: AuthorRef = { type: 'user', id: 'reviewer' }
    const record: ReviewRecord = {
      schemaVersion: 2,
      reviewId,
      number,
      document: input.document,
      documentSha: input.documentSha ?? doc.sha,
      type: input.type ?? 'suggestion',
      severity: input.severity ?? 'minor',
      title: input.title?.trim() || null,
      status: 'open',
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      target: anchor,
      author: authorRef.id,
      authorRef,
      assignee: null,
      related: emptyRelated(),
      decision: null,
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
    // First substantive follow-up moves open -> discussing (06 §2).
    if (parsed.record.status === 'open') {
      parsed.record.status = 'discussing'
      this.pushEntry(parsed.record, {
        at: nowIso(),
        author: REVIEWER_AUTHOR,
        kind: 'status',
        body: 'discussion started',
        fromStatus: 'open',
        toStatus: 'discussing',
      })
    }
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
      && input.type === undefined && input.tags === undefined) {
      throw new ValidationError('nothing to edit: provide at least one editable field')
    }
    let wordingEdited = false
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
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags)) throw new ValidationError('tags must be an array of strings')
      parsed.record.tags = input.tags.map(tag => String(tag).trim()).filter(tag => tag !== '')
    }
    const at = nowIso()
    if (wordingEdited) {
      parsed.record.commentEditedAt = at
      const opening = parsed.record.thread.entries[0]
      if (opening !== undefined && opening.kind === 'comment') opening.editedAt = at
    }
    parsed.record.updatedAt = at
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
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

    // Conditional transitions (06 §2).
    if (to === 'rejected' && (input.reason ?? '').trim() === '') {
      throw new ValidationError('reason is required when rejecting a review')
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
      author: REVIEWER_AUTHOR,
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
        decidedBy: REVIEWER_AUTHOR,
        decidedAt: at,
      }
      parsed.record.decision = decision
      this.pushEntry(parsed.record, {
        at,
        author: REVIEWER_AUTHOR,
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
    const sha = this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
    return { review: parsed.record, sha }
  }

  /**
   * Post-dispatch state write-back (design/07 §5): accepted/open -> implementing.
   * An open review first passes through accepted (the send confirmation is the
   * human acceptance), producing the accept Decision, then enters implementing.
   * assignee and related.agentRuns record the target session id.
   */
  markAgentDispatched(input: {
    projectId: string
    reviewId: string
    sessionId: string
    requestId?: string | null
  }): { review: ReviewRecord; sha: string } {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    const status = parsed.record.status
    if (status !== 'accepted' && status !== 'open') {
      throw new ValidationError(`only accepted/open reviews can be sent to an agent (got ${status})`)
    }
    const at = nowIso()
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
      pushStatus('open', 'accepted', `accepted when sending to agent session ${input.sessionId}`)
      const decision: ReviewDecision = {
        id: nextDecisionId(parsed.record),
        type: 'accept',
        summary: 'Accepted when sent to agent',
        decidedBy: REVIEWER_AUTHOR,
        decidedAt: at,
      }
      parsed.record.decision = decision
      this.pushEntry(parsed.record, {
        at,
        author: REVIEWER_AUTHOR,
        kind: 'decision',
        body: 'Accepted when sent to agent',
        decisionType: 'accept',
        decisionId: decision.id,
      })
      parsed.record.status = 'accepted'
      parsed.record.thread.status = 'accepted'
    }
    pushStatus('accepted', 'implementing', `dispatched to agent session ${input.sessionId}`)
    parsed.record.status = 'implementing'
    parsed.record.thread.status = 'implementing'
    parsed.record.assignee = input.sessionId
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
  }): void {
    const { project } = this.useProject(input.projectId)
    const parsed = this.readRecord(project, input.reviewId)
    if (isTerminal(parsed.record.status)) return
    const author: AuthorRef = {
      type: 'agent',
      id: input.provider ?? 'agent',
      ...(input.provider !== null ? { provider: input.provider } : {}),
      ...(input.model !== null ? { displayName: input.model } : {}),
      agentRunId: input.rpcId,
    }
    this.pushEntry(parsed.record, {
      at: nowIso(),
      author,
      kind: 'comment',
      body: input.body,
    })
    parsed.record.updatedAt = nowIso()
    this.writeWithSlug(project.path, parsed.record, parsed.extra)
    this.scheduleIndexRebuild(project)
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
