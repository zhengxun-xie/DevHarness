/**
 * DevReviewer wire protocol — shared verbatim by the Node host half and
 * the browser client half (the client build inlines this module). Keep this
 * file free of node:* imports so it is safe to bundle into the CJS client.
 *
 * Storage contract (see design/03-data-model.md):
 *   ~/.dsh/devbuddy/registry.json          shared project registry (left writes)
 *   ~/.dsh/devbuddy/reviewer-state.json    reviewer-active project (this plugin)
 *   <project>/.devbuddy/reviews/REV-XXXX-slug.md
 *   <project>/.devbuddy/reviews/index.json
 */

export const DEVREVIEWER_API_PREFIX = '/api/devreviewer'

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

/**
 * Short Chinese label per review type, used to prefix the review's 1:1
 * lifecycle session title (`[建议]项目开发自动化工作流`, design/09 §4).
 * Mirrors the client zh locale (`type.*`) so host-side naming and UI agree.
 */
export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  question: '讨论',
  suggestion: '建议',
  bug: '缺陷',
  design_issue: '设计',
  requirement_issue: '需求',
  implementation_issue: '实现',
  test_issue: '测试',
  exploration: '探索',
}

/** Review「关联方」attribute: which party (employee / agent) is associated with
 *  this review. An empty list means 自动 (auto-detect) — the default. */
export type RelatedParty = 'employee_a' | 'agent_a'

/** Valid related-party codes (the UI multi-select options). */
export const RELATED_PARTIES: readonly RelatedParty[] = ['employee_a', 'agent_a']

/** Type guard for a raw string against the known related-party codes. */
export function isRelatedParty(value: string): value is RelatedParty {
  return (RELATED_PARTIES as readonly string[]).includes(value)
}

/** Normalize arbitrary input to a deduped, known-values-only related-party list. */
export function normalizeRelatedParties(values: readonly unknown[]): RelatedParty[] {
  const out: RelatedParty[] = []
  for (const value of values) {
    if (typeof value === 'string' && isRelatedParty(value) && !out.includes(value)) {
      out.push(value)
    }
  }
  return out
}

export type ReviewStatus =
  | 'open'
  | 'needs_review'
  | 'accepted'
  | 'implementing'
  | 'verifying'
  | 'resolved'
  | 'rejected'
  | 'duplicated'

/**
 * Legacy write-side statuses, dropped by the lifecycle convergence (spec §5/§11):
 * `discussing` merged into `open`, `implemented` merged into `verifying`.
 * Files written by older builds may still carry them — they are recognized on
 * READ and normalized via LEGACY_STATUS_MAP, but the write path never emits
 * them. The target set is a strict subset of the old enum, so older plugin
 * builds reading new files never hit their silent `asStatus` fallback.
 */
export type LegacyReviewStatus = 'discussing' | 'implemented'

export const LEGACY_STATUS_MAP: Record<LegacyReviewStatus, ReviewStatus> = {
  discussing: 'open',
  implemented: 'verifying',
}

/**
 * Canonical status set — the SINGLE source for status membership (design/06b
 * E1: this list was previously duplicated across lifecycle.ts, review-files.ts
 * and three client files; every other module must import from here).
 */
export const STATUSES: readonly ReviewStatus[] = [
  'open',
  'needs_review',
  'accepted',
  'implementing',
  'verifying',
  'resolved',
  'rejected',
  'duplicated',
]

export const TERMINAL_STATUSES: readonly ReviewStatus[] = ['resolved', 'rejected', 'duplicated']

/** Set form for cheap membership checks (typed permissive: string callers OK). */
export const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set<string>(TERMINAL_STATUSES)

/** Non-terminal statuses counted as "open" in badges and warnings. */
export const OPEN_STATUSES: readonly ReviewStatus[] = STATUSES.filter(
  (status) => !TERMINAL_STATUS_SET.has(status),
)

export function isTerminal(status: ReviewStatus): boolean {
  return TERMINAL_STATUS_SET.has(status)
}

export function isOpen(status: ReviewStatus): boolean {
  return !isTerminal(status)
}

/** Any status name that may legally appear on disk (canonical set + legacy). */
export type StoredReviewStatus = ReviewStatus | LegacyReviewStatus

/** Read whitelist: the write set plus the legacy aliases (design 06 §11). */
export const STORED_STATUSES: readonly StoredReviewStatus[] = [
  ...STATUSES,
  ...(Object.keys(LEGACY_STATUS_MAP) as LegacyReviewStatus[]),
]

/**
 * Read-time normalization (design 06 §11 / refactor §8.1): legacy names
 * collapse onto the canonical set; anything unrecognized falls back to `open`
 * (the historical `asStatus` behavior). Write paths must never need this.
 */
export function normalizeStatus(status: string): ReviewStatus {
  const mapped = (LEGACY_STATUS_MAP as Record<string, ReviewStatus | undefined>)[status]
  if (mapped !== undefined) return mapped
  return (STATUSES as readonly string[]).includes(status) ? (status as ReviewStatus) : 'open'
}

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

/**
 * Decision types. `defer`/`wont_fix` were dropped (design/06b E2: they had no
 * production path — dead enums).
 */
export const DECISION_TYPES = ['accept', 'reject', 'duplicate'] as const
export type DecisionType = (typeof DECISION_TYPES)[number]

export interface ReviewDecision {
  /** Stable id, DEC-#### within the review (append-only, never reused). */
  id: string
  type: DecisionType
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
  fromStatus?: StoredReviewStatus
  toStatus?: StoredReviewStatus
  /** Present on kind === 'decision' entries: accept | reject | duplicate. */
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

/**
 * Set when a dispatched agent turn completes while the review is
 * `implementing` (spec §9). It is a SUGGESTION, never a state change: the
 * human confirms it, and the next human-driven transition clears it. Stored on
 * the record so the panel can render the confirmation bar after a reload.
 */
export interface AgentCompletion {
  at: string
  /** Agent session the completion report came from. */
  sessionId: string
  /** Prompt rpcId of the dispatched run. */
  rpcId: string
  provider: string | null
  model: string | null
}

/**
 * The ONE display predicate for the "agent reported completion, awaiting your
 * verification" bar (spec §9): a suggestion only counts while the review is
 * still being implemented, and only a human transition clears it.
 */
export function hasAgentCompletionSuggestion(
  record: Pick<ReviewRecord, 'status' | 'agentCompletion'>,
): boolean {
  return record.status === 'implementing' && record.agentCompletion !== null
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
  /** 关联方 codes (human / agent), multi-select; empty = unset. */
  relatedParties: RelatedParty[]
  target: ReviewAnchor
  /** Projection of the opening-comment author id; kept for list filtering. */
  author: string
  /** Full opening-comment author identity; also the first thread participant. */
  authorRef: AuthorRef
  /**
   * The review's 1:1 lifecycle session (design/09): created and named
   * `[类型]标题` when the review is created; archived on delete/close,
   * unarchived on reopen. Distinct from `assignee` (the last dispatch target);
   * null when unbound (degraded service, or a pre-binding legacy review).
   */
  sessionId: string | null
  /** Target session id of the last agent dispatch (session or teammate). */
  assignee: string | null
  /**
   * Team member name when the last dispatch targeted an Agent Teams teammate
   * (design/08); null for plain-session dispatches. `assignee` keeps holding
   * the teammate's underlying session id for compatibility.
   */
  assigneeMember: string | null
  /**
   * Shared task-board task id created by the last task-mode team dispatch
   * (design/08 §3.3); null when the dispatch was mailbox-only or a plain
   * session prompt.
   */
  teamTaskId: string | null
  related: ReviewRelated
  /**
   * Latest decision — projection of `decisions[decisions.length - 1]`,
   * retained for v1/v2 layout compatibility. Canonical history is
   * `decisions`; keep the two in sync on every write (a single value alone
   * cannot hold the decision history needed for Reopen, design/06b E3).
   */
  decision: ReviewDecision | null
  /** Append-only decision history (spec reviewer-lifecycle-refactor §10). */
  decisions: ReviewDecision[]
  /**
   * Pending "agent reported completion" suggestion; null when there is nothing
   * to confirm. Cleared by the next human-driven transition (spec §9).
   */
  agentCompletion: AgentCompletion | null
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
  relatedParties: RelatedParty[]
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
  relatedParties?: RelatedParty[]
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
  /** Replaces the whole related-party list; omit to leave unchanged. */
  relatedParties?: RelatedParty[]
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
  /**
   * Who is asking. Absent means the human reviewer (the panel). An agent must
   * declare itself so the host can enforce the human-only rules for critical
   * reviews (spec §5/§9); agents never decide, and never resolve or reopen.
   */
  author?: AuthorRef
}

export interface TransitionResponse {
  review: ReviewRecord
  sha: string
}

/**
 * Manual re-anchor (design/06 §12, ticket 04): bind the review to a fresh
 * selection. When the review sits in `needs_review` the host auto-exits back to
 * the status it entered from.
 */
export interface ReanchorRequest {
  projectId: string
  reviewId: string
  target: ReviewAnchorDraft
  expectedSha?: string | null
}

export interface ReanchorResponse {
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

/** One markdown document discovered by the project-directory scan. */
export interface DocFileEntry {
  /** Path relative to the project directory; matches ReviewSummary.document. */
  path: string
  /** Display title: the file basename without the .md/.markdown extension. */
  title: string
}

/** GET /docs response: every .md/.markdown under the project directory. */
export interface ListDocsResponse {
  documents: DocFileEntry[]
}

export interface SendToAgentRequest {
  projectId: string
  reviewId: string
  sessionId?: string | null
  /**
   * Agent Teams teammate name (design/08). When set the host dispatches
   * through the Team mailbox instead of the session-controller path; takes
   * precedence over sessionId.
   */
  member?: string | null
  /**
   * Task-board mode (design/08 §3.3): when true (with a member target) the
   * host also creates a shared team task carrying the full instruction and
   * appends a completion protocol, then notifies the member to claim it.
   */
  createTask?: boolean
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
  /** Team member name when the dispatch targeted a teammate (design/08). */
  member?: string | null
  /** true when the Team mailbox retained the message (member not live). */
  queued?: boolean
  /** Created board task when the dispatch ran in task mode (design/08 §3.3). */
  task?: { id: string; revision: number } | null
}

// ---------------------------------------------------------------------------
// Agent Teams roster (design/08 §3.2): feeds the client member picker.
// ---------------------------------------------------------------------------

/** Roster row mirrored from the platform TeamMemberView. */
export interface TeamMemberSummary {
  id: string
  name: string
  role: 'lead' | 'teammate'
  status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  description?: string
  model?: string
}

/** GET /agent/team response; available:false hides the member picker. */
export interface TeamRosterResponse {
  available: boolean
  leadSessionId: string | null
  members: TeamMemberSummary[]
}

/** Task-board status row mirrored for the §3.5 loop-back display. */
export interface TeamTaskSummary {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  subject?: string
  ownerName?: string
}

/** GET /agent/team/task-status response (§3.5 loop-back poll). */
export interface TeamTaskStatusResponse {
  /** false when the team service / live Lead is unavailable — stop polling. */
  available: boolean
  /** null when the task id is not on any reachable board. */
  status: TeamTaskSummary['status'] | null
  task: TeamTaskSummary | null
}

/** POST /agent/team/absorb request: absorb a completed board task report. */
export interface AbsorbTaskCompletionRequest {
  projectId: string
  reviewId: string
}

/** POST /agent/team/absorb response. */
export interface AbsorbTaskCompletionResponse {
  absorbed: boolean
  /** Degrade reason when the board was not reachable or the task not completed. */
  reason?: 'unavailable' | 'no-task' | 'not-completed' | 'already-absorbed'
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
  source: 'devreviewer'
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
  source: 'devreviewer'
  type: 'DEVBUDDY_DOC_TREE_REQUEST'
  projectId: string
}

/**
 * Left sidebar -> Reviewer: user-driven project switch notice. The left
 * panel broadcasts it after switching its active project (browser-style tab
 * strip) so the Reviewer follows onto the same project; both panels keep
 * one active project. Distinct from DocTreeMessage: a DocTree broadcast
 * also happens on mount / card toggles and must NOT move the Reviewer's
 * selection (only this notice does).
 */
export interface ProjectSwitchMessage {
  source: 'devbuddy-left'
  type: 'DEVBUDDY_PROJECT_SWITCH'
  projectId: string
}

/**
 * Reviewer -> left sidebar: on-demand request for the focused editor caret.
 * Sent when the user clicks "add comment" without a selection; the left
 * replies with CaretMessage carrying a zero-length anchor draft for the
 * textarea that currently owns focus (or stays silent when none does).
 */
export interface CaretRequestMessage {
  source: 'devreviewer'
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
  | ProjectSwitchMessage
  | CaretMessage
