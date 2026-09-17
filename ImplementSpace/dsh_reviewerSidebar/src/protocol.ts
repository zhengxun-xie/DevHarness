/**
 * DevBuddy Reviewer wire protocol — shared verbatim by the Node host half and
 * the browser client half (the client build inlines this module). Keep this
 * file free of node:* imports so it is safe to bundle into the CJS client.
 *
 * Storage contract (see design/03-data-model.md):
 *   ~/.dsh/devbuddy/registry.json          shared project registry (left writes)
 *   ~/.dsh/devbuddy/reviewer-state.json    reviewer-active project (this plugin)
 *   <project>/.devbuddy/reviews/REV-XXXX-slug.md
 *   <project>/.devbuddy/reviews/index.json
 */

export const DEVBUDDY_API_PREFIX = '/api/devbuddy'

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'minor' | 'major' | 'critical'

/** UI priority order: P0 (critical) → P3 (info). */
export const SEVERITIES: readonly Severity[] = ['critical', 'major', 'minor', 'info']

export type ReviewType =
  | 'question'
  | 'suggestion'
  | 'bug'
  | 'design_issue'
  | 'requirement_issue'
  | 'implementation_issue'
  | 'test_issue'
  | 'exploration'

export const REVIEW_TYPES: readonly ReviewType[] = [
  'question',
  'exploration',
  'suggestion',
  'bug',
  'design_issue',
  'requirement_issue',
  'implementation_issue',
  'test_issue',
]

export type ReviewStatus =
  | 'open'
  | 'discussing'
  | 'needs_review'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'verifying'
  | 'resolved'
  | 'rejected'
  | 'duplicated'

/** Non-terminal statuses counted as "open" in badges and warnings. */
export const OPEN_STATUSES: readonly ReviewStatus[] = [
  'open',
  'discussing',
  'needs_review',
  'accepted',
  'implementing',
  'implemented',
  'verifying',
]

export const TERMINAL_STATUSES: readonly ReviewStatus[] = ['resolved', 'rejected', 'duplicated']

export type AnchorStatus = 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'

export interface ReviewAnchor {
  structural: { section: string | null; headingPath: string[] }
  textual: { selectedText: string; prefix: string; suffix: string }
  /**
   * lineStart/lineEnd are 1-based. offsetStart/offsetEnd are LF-normalized,
   * 0-based half-open character offsets. Both present for newly created
   * anchors; a zero-length "point" anchor has selectedText === '' and
   * offsetStart === offsetEnd (a caret position).
   */
  positional: {
    lineStart: number
    lineEnd: number
    offsetStart?: number
    offsetEnd?: number
  }
  fingerprint: { algorithm: 'sha256'; value: string }
}

/** A zero-length caret anchor: empty selection with one shared offset. */
export function isPointAnchor(anchor: Pick<ReviewAnchor, 'textual' | 'positional'>): boolean {
  return anchor.textual.selectedText === ''
    && anchor.positional.offsetStart !== undefined
    && anchor.positional.offsetStart === anchor.positional.offsetEnd
}

/** Anchor draft produced by the selection bridge (host computes fingerprint). */
export type ReviewAnchorDraft = Omit<ReviewAnchor, 'fingerprint'>

export interface ReviewDecision {
  /** Stable id, DEC-#### within the review (append-only, never reused). */
  id: string
  type: 'accept' | 'reject' | 'defer' | 'duplicate' | 'wont_fix'
  summary: string
  decidedBy: AuthorRef
  decidedAt: string
}

export interface ReviewRelated {
  decisions: string[]
  reviews: string[]
  code: string[]
  tests: string[]
  commits: string[]
  agentRuns: string[]
}

/**
 * Rich author identity (design §13 Comment / §14 Agent Comment).
 * - user:  { type:'user',  id, displayName? }
 * - agent: { type:'agent', id, provider, agentRunId, displayName? }
 * An agent author never carries Approval authority: agents may append comments
 * but cannot write a ReviewDecision.
 */
export interface AuthorRef {
  type: 'user' | 'agent'
  id: string
  /** Model/provider routing key from the platform message source (agents only). */
  provider?: string
  /** Human-readable label when the host knows one. */
  displayName?: string
  /**
   * The run this author acted in. For agents it is the prompt's requestId
   * (persisted as the user/message source rpcId); one dispatch = one run.
   */
  agentRunId?: string
}

export interface ThreadEntry {
  id: string
  at: string
  author: AuthorRef
  kind: 'comment' | 'status' | 'decision' | 'system'
  body: string
  replyTo?: string
  /** Set when this entry's body was edited after publication (GitHub-style "edited" marker). */
  editedAt?: string
  fromStatus?: ReviewStatus
  toStatus?: ReviewStatus
  /** Present on kind === 'decision' entries: accept | reject | defer | duplicate | wont_fix. */
  decisionType?: ReviewDecision['type']
  /** Links a kind === 'decision' timeline entry to its canonical ReviewDecision. */
  decisionId?: string
}

/**
 * Review Thread (design §12): an independent entity at a 1:1 relationship with
 * its review. `status` mirrors the review status; `participants` is a derived,
 * de-duplicated projection of every author who has appeared in the thread.
 */
export interface ReviewThread {
  /** Stable thread id; 1:1 with the review, so this equals reviewId. */
  id: string
  status: ReviewStatus
  participants: AuthorRef[]
  /**
   * Append-only timeline. The first entry is always the opening comment (the
   * review body), so the thread is the complete discussion record.
   */
  entries: ThreadEntry[]
}

export interface ReviewRecord {
  schemaVersion: 2
  reviewId: string
  /** Per-document monotonic number (1-based, never reused). 0 = legacy record pending lazy backfill. */
  number: number
  document: string
  documentSha: string | null
  type: ReviewType
  severity: Severity
  title: string | null
  status: ReviewStatus
  tags: string[]
  target: ReviewAnchor
  /** Projection of the opening-comment author id; kept for list filtering. */
  author: string
  /** Full opening-comment author identity; also the first thread participant. */
  authorRef: AuthorRef
  assignee: string | null
  related: ReviewRelated
  decision: ReviewDecision | null
  duplicatedOf: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  /**
   * Projection of the opening comment (thread.entries[0].body), mirrored here
   * for list/detail rendering and v1 compatibility. The authoritative copy
   * lives in the thread; edits update both.
   */
  comment: string
  proposal: string
  /** Set when comment/proposal was edited after publication ("edited" marker). */
  commentEditedAt?: string
  thread: ReviewThread
}

/** index.json row — list projection without discussion bodies. */
export interface ReviewSummary {
  reviewId: string
  /** Per-document number, rendered as #N in lists/cards. */
  number: number
  document: string
  type: ReviewType
  severity: Severity
  status: ReviewStatus
  title: string | null
  section: string | null
  lineStart: number
  lineEnd: number
  tags: string[]
  author: string
  assignee: string | null
  createdAt: string
  updatedAt: string
}

export interface AnchorResolution {
  state: AnchorStatus
  lineStart: number | null
  lineEnd: number | null
  /**
   * Matched character range in the CURRENT document (LF, 0-based half-open).
   * Available for exact ladders (valid/moved); null for fuzzy/orphaned —
   * clients then fall back to the line range.
   */
  matchOffsetStart: number | null
  matchOffsetEnd: number | null
  confidence: number
  needsReviewCandidate: boolean
}

// ---------------------------------------------------------------------------
// Shared registry read model (left sidebar owns writes)
// ---------------------------------------------------------------------------

export interface ProjectRecord {
  id: string
  name: string
  path: string
  archived?: boolean
  order?: number
  workspaceId?: string | null
}

export interface DevBuddyRegistry {
  version: number
  activeProjectId?: string | null
  projects: ProjectRecord[]
}

export interface WorkspaceInfo {
  id: string
  title: string
  path: string
  sessionCount: number
}

// ---------------------------------------------------------------------------
// Request / response bodies
// ---------------------------------------------------------------------------

export interface ErrorBody {
  error: string
}

export interface ProjectsResponse {
  projects: Array<{
    id: string
    name: string
    path: string
    active: boolean
    workspaceLinked: boolean
    openCount: number
  }>
}

export interface ActivateRequest {
  id: string
}

export interface ListReviewsResponse {
  reviews: ReviewSummary[]
}

export interface GetReviewResponse {
  review: ReviewRecord
  anchorResolution: AnchorResolution
}

export interface CreateReviewRequest {
  projectId: string
  document: string
  target: ReviewAnchorDraft
  type?: ReviewType
  severity?: Severity
  title?: string
  comment: string
  proposal?: string
  tags?: string[]
  documentSha?: string | null
}

export interface CreateReviewResponse {
  review: ReviewRecord
}

export interface AppendRequest {
  projectId: string
  reviewId: string
  body: string
  replyTo?: string
  author?: AuthorRef
  expectedSha?: string | null
}

export interface AppendResponse {
  review: ReviewRecord
  sha: string
}

/**
 * Edit a published review (GitHub-style edit): wording (comment/proposal)
 * and classification metadata (title/type/severity/tags). Anchor,
 * fingerprint, thread and status stay untouched. Terminal reviews are
 * read-only, matching the append policy.
 */
export interface EditReviewRequest {
  projectId: string
  reviewId: string
  /** New comment text; omit to leave unchanged. Must be non-empty when present. */
  comment?: string
  /** New proposal text ('' clears the section); omit to leave unchanged. */
  proposal?: string
  /** New title ('' or null clears); omit to leave unchanged. */
  title?: string | null
  /** Must be one of SEVERITIES; omit to leave unchanged. */
  severity?: Severity
  /** Must be one of REVIEW_TYPES; omit to leave unchanged. */
  type?: ReviewType
  /** Replaces the whole tag list; omit to leave unchanged. */
  tags?: string[]
  expectedSha?: string | null
}

export interface EditReviewResponse {
  review: ReviewRecord
  sha: string
}

/** Edit one discussion entry body; only kind === 'comment' entries are editable. */
export interface EditThreadEntryRequest {
  projectId: string
  reviewId: string
  entryId: string
  body: string
  expectedSha?: string | null
}

export interface EditThreadEntryResponse {
  review: ReviewRecord
  sha: string
}

export interface TransitionRequest {
  projectId: string
  reviewId: string
  to: ReviewStatus
  reason?: string
  duplicatedOf?: string
  decisionSummary?: string
  evidence?: string
  expectedSha?: string | null
}

export interface TransitionResponse {
  review: ReviewRecord
  sha: string
}

export interface RemoveRequest {
  projectId: string
  reviewId: string
}

export interface DocumentHeading {
  slug: string
  text: string
  level: number
  line: number
}

export interface DocumentReviewAnchor {
  reviewId: string
  /** Per-document number (#N badge / gutter badge / inline superscript). */
  number: number
  status: ReviewStatus
  severity: Severity
  type: ReviewType
  /** Original selected-text snapshot, used by clients to paint inline marks. */
  selectedText: string
  lineStart: number | null
  lineEnd: number | null
  matchOffsetStart: number | null
  matchOffsetEnd: number | null
  anchorStatus: AnchorStatus
  needsReviewCandidate: boolean
}

export interface DocumentResponse {
  path: string
  content: string
  sha: string | null
  exists: boolean
  headings: DocumentHeading[]
  reviews: DocumentReviewAnchor[]
}

export interface SendToAgentRequest {
  projectId: string
  reviewId: string
  sessionId?: string | null
  include?: {
    relatedDocs?: boolean
    decisions?: boolean
    code?: boolean
    tests?: boolean
    gitHistory?: boolean
  }
  dryRun?: boolean
}

/**
 * Layer 2 structured Context Payload (design/07 §Layer2): the machine-readable
 * JSON companion to the human-readable instruction (Layer 1). It separates
 * content by delivery tier — review/thread/decision and the anchor's captured
 * original text are inlined (DB-owned originals, the on-disk text may have
 * moved on), while repo-resident objects (target document, related docs) are
 * referenced by path@sha so the Agent reads the current version itself.
 */
export interface AgentContextLayer2 {
  /** Identity of the review driving this run. */
  primary: {
    review: string
    severity: Severity
    type: ReviewType
    /** Decision summary, or null when not yet decided. */
    decision: string | null
    /** Condensed thread digest (discussion points, not the full log). */
    threadDigest: string
  }
  anchor: {
    document: string
    /** Base version the anchor was captured against (document sha). */
    baseVersion: string | null
    /** Captured original text: prefix / selection / suffix. */
    selectedText: string
    prefix: string
    suffix: string
    /**
     * AnchorResolver output, pre-computed so the Agent does not re-match:
     * the resolution status and the CURRENT character range (LF, 0-based
     * half-open) when an exact ladder matched; null for fuzzy/orphaned.
     */
    resolution: {
      status: AnchorStatus
      confidence: number
      currentOffset: [number, number] | null
    }
  }
  /**
   * References to repo-resident objects: path + one-line reason, no content.
   * The Agent reads them from the worktree itself; reason says why each is
   * worth reading.
   */
  manifest: Array<{ id?: string; path: string; reason: string }>
  /** Worktree the Agent operates in, pinned to a version. */
  workspace: { repo: string; commit: string | null }
}

export interface AgentContextPayload {
  reviewId: string
  project: { id: string; name: string; path: string }
  /**
   * Layer 2 structured context. The dispatcher currently sends only the
   * `instruction` text (Layer 1); this payload is generated for dry-run
   * preview / manual copy and is the contract a future persistent Agent Run
   * will carry verbatim.
   */
  payload: AgentContextLayer2
  type: ReviewType
  severity: Severity
  review: {
    comment: string
    proposal: string
    thread: ThreadEntry[]
    decision: ReviewDecision | null
    anchor: {
      document: string
      selectedText: string
      prefix: string
      suffix: string
      headingPath: string[]
      documentSha: string | null
      anchorStatus: AnchorStatus
    }
  }
  targetDocument: { path: string; sha: string | null; content: string }
  relatedDocuments: Array<{ path: string; reason: string; content: string }>
  decisions: Array<{ path: string; content: string }>
  code: Array<{ path: string; symbols?: string[]; content: string }>
  tests: Array<{ path: string; content: string }>
  git: {
    log: Array<{ hash: string; author: string; date: string; subject: string }>
    blame: Array<{ line: number; hash: string; author: string }>
    available: boolean
  }
  truncated: boolean
  instruction: string
}

export interface SendToAgentResponse {
  context: AgentContextPayload
  sessionId: string | null
  delivered: boolean
}

// ---------------------------------------------------------------------------
// Cross-barrier postMessage contract (window.postMessage, same-origin)
// ---------------------------------------------------------------------------

/** Left sidebar -> Reviewer: current text selection anchor draft. */
export interface SelectionMessage {
  source: 'devbuddy-left'
  type: 'DEVBUDDY_SELECTION'
  projectId: string
  document: string
  anchor: ReviewAnchorDraft
}

/** Reviewer -> left sidebar: reviews on a document changed. */
export interface ReviewChangedMessage {
  source: 'devbuddy-reviewer'
  type: 'DEVBUDDY_REVIEW_CHANGED'
  projectId: string
  document: string
  reviewIds: string[]
}

/** One document node as ordered/collapsed in the left panel's tree. */
export interface DocTreeNode {
  /** File path relative to the project directory; matches ReviewSummary.document. */
  document: string
  /** Left-panel node title for the group header. */
  title: string
  /** True while the node card is collapsed — its reviews are hidden. */
  collapsed: boolean
}

/** Left sidebar -> Reviewer: full ordered document tree + collapse state. */
export interface DocTreeMessage {
  source: 'devbuddy-left'
  type: 'DEVBUDDY_DOC_TREE'
  projectId: string
  nodes: DocTreeNode[]
}

/**
 * Reviewer -> left sidebar: on-demand request for the current document tree.
 * Sent on mount / project switch so a Reviewer opening after the left's
 * catch-up broadcasts still receives the snapshot (left replies with
 * DocTreeMessage when the projectId matches its active project).
 */
export interface DocTreeRequestMessage {
  source: 'devbuddy-reviewer'
  type: 'DEVBUDDY_DOC_TREE_REQUEST'
  projectId: string
}

/**
 * Reviewer -> left sidebar: on-demand request for the focused editor caret.
 * Sent when the user clicks "add comment" without a selection; the left
 * replies with CaretMessage carrying a zero-length anchor draft for the
 * textarea that currently owns focus (or stays silent when none does).
 */
export interface CaretRequestMessage {
  source: 'devbuddy-reviewer'
  type: 'DEVBUDDY_CARET_REQUEST'
  projectId: string
}

/** Left sidebar -> Reviewer: zero-length anchor draft at the editor caret. */
export interface CaretMessage {
  source: 'devbuddy-left'
  type: 'DEVBUDDY_CARET'
  projectId: string
  document: string
  anchor: ReviewAnchorDraft
}

export type DevBuddyMessage =
  | SelectionMessage
  | ReviewChangedMessage
  | DocTreeMessage
  | CaretMessage
