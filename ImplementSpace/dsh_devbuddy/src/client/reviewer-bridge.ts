/**
 * Bridge to the dsh-devbuddy-reviewer plugin (design/05 §2).
 *
 * Two seams, both same-origin window.postMessage / loopback HTTP:
 *
 *   1. Change subscription — DEVBUDDY_REVIEW_CHANGED arrives whenever a
 *      review is created/removed, so the gutter pills + overlay refresh.
 *   2. Reviewer read API — GET /api/devbuddy/document (the Reviewer host
 *      half's prefix) returns the per-document anchor projection used to
 *      paint the #N pills and inline highlights. Failure is non-fatal: the
 *      editor simply shows no marks when the Reviewer plugin is absent.
 *
 * New selections never cross this bridge: the in-place "add review" bubble
 * hands a ReviewAnchorDraft straight to openTab() params. The two plugins do
 * not import one another; these shapes duplicate the wire contract from
 * dsh_reviewerSidebar/src/protocol.ts.
 */

const REVIEWER_API_PREFIX = '/api/devbuddy'
const CHANGED_TYPE = 'DEVBUDDY_REVIEW_CHANGED'
const DOC_TREE_TYPE = 'DEVBUDDY_DOC_TREE'
const DOC_TREE_REQUEST_TYPE = 'DEVBUDDY_DOC_TREE_REQUEST'
const CARET_TYPE = 'DEVBUDDY_CARET'
const CARET_REQUEST_TYPE = 'DEVBUDDY_CARET_REQUEST'
const SOURCE_REVIEWER = 'devbuddy-reviewer'
const SOURCE_LEFT = 'devbuddy-left'

export const MAX_SELECTION_CHARS = 4000

// ---------------------------------------------------------------------------
// Wire shapes (kept structurally identical to the Reviewer protocol)
// ---------------------------------------------------------------------------

export interface ReviewAnchorDraft {
  structural: { section: string | null; headingPath: string[] }
  textual: { selectedText: string; prefix: string; suffix: string }
  /** lineStart/lineEnd 1-based; offsetStart/offsetEnd LF 0-based half-open. */
  positional: {
    lineStart: number
    lineEnd: number
    offsetStart?: number
    offsetEnd?: number
  }
}

export interface ReviewChangedMessage {
  source: typeof SOURCE_REVIEWER
  type: typeof CHANGED_TYPE
  projectId: string
  document: string
  reviewIds: string[]
}

/** Gutter projection row from GET /api/devbuddy/document. */
export interface DocumentReviewAnchor {
  reviewId: string
  /** Per-document number shown on gutter/inline markers (#N). */
  number: number
  status: string
  severity: 'info' | 'minor' | 'major' | 'critical'
  type: string
  /** Original selected-text snapshot. */
  selectedText: string
  lineStart: number | null
  lineEnd: number | null
  /** Precise 0-based half-open offsets in the LF-normalized document. */
  matchOffsetStart: number | null
  matchOffsetEnd: number | null
  anchorStatus: 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'
  needsReviewCandidate: boolean
}

interface DocumentResponse {
  reviews: DocumentReviewAnchor[]
}

/** Reply payload for a caret request: document plus a point anchor draft. */
export interface CaretSnapshot {
  projectId: string
  document: string
  anchor: ReviewAnchorDraft
}

/** Editor-supplied resolver: returns the focused editor's point anchor. */
export type CaretProvider = () => CaretSnapshot | null

// ---------------------------------------------------------------------------
// Anchor draft construction
// ---------------------------------------------------------------------------

/** Drop a trailing CR so CRLF docs share the '\n'-only offset model. */
export function normalizeContent(raw: string): string {
  return raw.replace(/\r\n/g, '\n')
}

/**
 * Map a 0-based offset in the LF-normalized text back onto the raw (possibly
 * CRLF) text: a CRLF pair consumes one LF character but two raw characters.
 */
export function lfOffsetToRaw(raw: string, lfOffset: number): number {
  let rawIndex = 0
  let lf = 0
  while (rawIndex < raw.length && lf < lfOffset) {
    if (raw.charCodeAt(rawIndex) === 13 && raw.charCodeAt(rawIndex + 1) === 10) {
      rawIndex += 2
    } else {
      rawIndex += 1
    }
    lf += 1
  }
  return rawIndex
}

export function validateSelection(selectedText: string): boolean {
  return selectedText.length > 0
    && selectedText.trim().length > 0
    && selectedText.length <= MAX_SELECTION_CHARS
}

/** 1-based line number of a character offset (offset 0 → line 1). */
function lineAtOffset(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

interface Heading {
  text: string
  level: number
  line: number
}

/**
 * Scan ATX headings (lines starting with 1-6 '#'), fence-aware — '#' inside
 * a ``` fence never counts. Mirrors the Reviewer host's parseHeadings.
 */
function scanHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = []
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null
      continue
    }
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(raw)
    if (fenceMatch !== null) {
      fence = fenceMatch[2][0].repeat(3)
      continue
    }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (match !== null) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 })
    }
  }
  return headings
}

/** Heading stack (outermost first) active at a 1-based line. */
function headingPathAt(headings: readonly Heading[], line: number): {
  section: string | null
  headingPath: string[]
} {
  const stack: Heading[] = []
  for (const heading of headings) {
    if (heading.line > line) break
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    stack.push(heading)
  }
  if (stack.length === 0) return { section: null, headingPath: [] }
  return { section: stack[0].text, headingPath: stack.map(h => h.text) }
}

function sourceLine(lines: readonly string[], line1: number): string {
  return (lines[line1 - 1] ?? '').trim()
}

/** Build an anchor draft from raw source and textarea selection offsets. */
export function buildAnchorDraft(
  content: string,
  selStart: number,
  selEnd: number,
): ReviewAnchorDraft {
  const selectedText = content.slice(selStart, selEnd)
  const lineStart = lineAtOffset(content, selStart)
  const lineEnd = lineAtOffset(content, Math.max(selStart, selEnd - 1))
  const lines = content.split('\n')
  const { section, headingPath } = headingPathAt(scanHeadings(lines), lineStart)
  const prefix = lineStart > 1 ? sourceLine(lines, lineStart - 1) : ''
  const suffix = lineEnd < lines.length ? sourceLine(lines, lineEnd + 1) : ''
  return {
    structural: { section, headingPath },
    textual: { selectedText, prefix, suffix },
    positional: { lineStart, lineEnd, offsetStart: selStart, offsetEnd: selEnd },
  }
}

// ---------------------------------------------------------------------------
// postMessage seams
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Subscribe to DEVBUDDY_REVIEW_CHANGED; returns an unsubscribe function. */
export function onReviewChanged(
  handler: (message: ReviewChangedMessage) => void,
  projectFilter?: string,
): () => void {
  const listener = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (!isRecord(data)
      || data.source !== SOURCE_REVIEWER
      || data.type !== CHANGED_TYPE
      || typeof data.projectId !== 'string'
      || typeof data.document !== 'string'
      || !Array.isArray(data.reviewIds)) {
      return
    }
    if (projectFilter !== undefined && data.projectId !== projectFilter) return
    handler({
      source: SOURCE_REVIEWER,
      type: CHANGED_TYPE,
      projectId: data.projectId,
      document: data.document,
      reviewIds: data.reviewIds.filter((id): id is string => typeof id === 'string'),
    })
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

/** One ordered document node with the card's current collapse state. */
export interface DocTreeNode {
  document: string
  title: string
  collapsed: boolean
}

/**
 * Broadcast the active project's full ordered document tree plus each card's
 * collapse state. The Reviewer groups/sorts its list by this snapshot and
 * hides reviews belonging to collapsed nodes (request 14.6/14.7).
 */
export function postDocTree(projectId: string, nodes: readonly DocTreeNode[]): void {
  window.postMessage({
    source: SOURCE_LEFT,
    type: DOC_TREE_TYPE,
    projectId,
    nodes: nodes.map(node => ({ ...node })),
  }, window.location.origin)
}

/**
 * Answer a late-opening Reviewer's on-demand snapshot request. The listener
 * is global (once per left panel); the callback resolves the requested
 * project's current tree, or null when that project is not active here.
 * Returns an unsubscribe function.
 */
export function onDocTreeRequest(
  resolve: (projectId: string) => { projectId: string; nodes: readonly DocTreeNode[] } | null,
): () => void {
  const listener = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (!isRecord(data)
      || data.source !== SOURCE_REVIEWER
      || data.type !== DOC_TREE_REQUEST_TYPE
      || typeof data.projectId !== 'string') {
      return
    }
    const snapshot = resolve(data.projectId)
    if (snapshot !== null) postDocTree(snapshot.projectId, snapshot.nodes)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

/**
 * Reply to a caret request with a zero-length anchor draft. Sent directly by
 * the focused editor (no broadcast); the Reviewer asked for the caret of the
 * textarea currently owning focus.
 */
export function postCaret(projectId: string, document: string, anchor: ReviewAnchorDraft): void {
  window.postMessage({
    source: SOURCE_LEFT,
    type: CARET_TYPE,
    projectId,
    document,
    anchor,
  }, window.location.origin)
}

/**
 * Subscribe to the Reviewer's on-demand caret request. The resolver returns
 * a zero-length anchor draft for the currently focused edit-mode textarea, or
 * null when no editor owns focus / the project does not match.
 */
export function onCaretRequest(
  resolve: (projectId: string) => { projectId: string; document: string; anchor: ReviewAnchorDraft } | null,
): () => void {
  const listener = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (!isRecord(data)
      || data.source !== SOURCE_REVIEWER
      || data.type !== CARET_REQUEST_TYPE
      || typeof data.projectId !== 'string') {
      return
    }
    const snapshot = resolve(data.projectId)
    if (snapshot !== null) postCaret(snapshot.projectId, snapshot.document, snapshot.anchor)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

// ---------------------------------------------------------------------------
// Reviewer read API
// ---------------------------------------------------------------------------

/**
 * Fetch the Reviewer host's per-document anchor projection. Rejects (so the
 * caller can degrade to no badges) when the Reviewer plugin is not loaded.
 */
export async function getDocumentReviews(
  projectId: string,
  document: string,
): Promise<DocumentReviewAnchor[]> {
  const params = new URLSearchParams({ projectId, path: document })
  const response = await fetch(`${REVIEWER_API_PREFIX}/document?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`reviewer document request failed: ${response.status}`)
  const body = await response.json() as DocumentResponse
  return Array.isArray(body.reviews) ? body.reviews : []
}
