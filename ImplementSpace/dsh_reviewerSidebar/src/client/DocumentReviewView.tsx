/**
 * Inline review document view (design/05): read-only raw-Markdown rendering
 * with line-level review highlights driven by the host's anchor resolution.
 *
 * - valid/moved anchors: severity background tint (no underline)
 * - modified: amber background tint (manual confirmation needed)
 * - outdated/orphaned: no inline mark (target substantively changed / gone);
 *   they remain reachable from the drift list below the document
 * - terminal reviews render dimmed
 * - each review owns a document-scoped number: one bare-number badge per
 *   review in the gutter (badges precede the line number, several share a
 *   line side by side), and the mark carries the same superscript badges
 * - selecting text spawns a "add review" bubble directly above the
 *   selection (flipping below when space is tight); it builds an anchor
 *   draft and opens the composer in the panel
 *
 * Character offsets are derived from Range.toString(): every source line is
 * a block element, so the browser inserts '\n' between lines, which matches
 * the '\n'-split source model used by selection.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api.ts'
import { buildAnchorDraft, validateSelection } from './selection.ts'
import type { TranslateFunction } from './format.ts'
import { anchorLabel, severityClass, severityLabel, statusLabel } from './format.ts'
import type { ComposerDraft } from './ReviewComposer.tsx'
import type {
  DocumentResponse,
  DocumentReviewAnchor,
  Severity,
} from '../protocol.ts'
import { TERMINAL_STATUS_SET } from '../protocol.ts'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, minor: 1, major: 2, critical: 3 }
const UNMARKED: ReadonlySet<string> = new Set(['outdated', 'orphaned'])

export interface DocumentReviewViewProps {
  projectId: string
  document: string
  initialReviewId?: string | null
  refreshSignal: number
  /** When set, selections rebind this review's anchor instead of composing. */
  rebindFor?: string | null
  /** Focus line from a doc-ref link click; scroll to it on mount. */
  focusLineStart?: number
  focusLineEnd?: number
  onBack: () => void
  onOpenReview: (reviewId: string) => void
  onCompose: (draft: ComposerDraft) => void
  /** Called after a rebind succeeds; the panel refreshes and navigates. */
  onRebindDone: (reviewId: string) => void
  t: TranslateFunction
}

interface FabState {
  /** Left edge relative to the document wrapper. */
  x: number
  /** Top edge relative to the document wrapper. */
  y: number
  start: number
  end: number
}

const FAB_GAP = 6
const FAB_HEIGHT = 22

interface PopoverState {
  x: number
  y: number
  reviews: DocumentReviewAnchor[]
}

/** One character-level painted piece within a source line. */
interface LineSeg {
  /** Column within the line (0-based); points use colStart === colEnd. */
  colStart: number
  colEnd: number
  point: boolean
  reviews: DocumentReviewAnchor[]
  className: string
}

export function DocumentReviewView({
  projectId,
  document,
  initialReviewId,
  refreshSignal,
  rebindFor = null,
  focusLineStart,
  focusLineEnd,
  onBack,
  onOpenReview,
  onCompose,
  onRebindDone,
  t,
}: DocumentReviewViewProps): ReactNode {
  const [doc, setDoc] = useState<DocumentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fab, setFab] = useState<FabState | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getDocument(projectId, document)
      setDoc(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId, document])

  useEffect(() => {
    void load()
  }, [load, refreshSignal])

  // Host normalizes CRLF while parsing; the content echoed back may still
  // contain CRLF, so normalize locally to keep Range offsets aligned.
  const content = useMemo(() => (doc ? doc.content.replace(/\r\n/g, '\n') : ''), [doc])
  const lines = useMemo(() => content.split('\n'), [content])
  const lineDigits = String(lines.length).length
  const headingLines = useMemo(() => {
    const set = new Set<number>()
    doc?.headings.forEach(h => set.add(h.line))
    return set
  }, [doc])

  // Character-level marks: matchOffsetStart/End are LF-normalized, half-open
  // global offsets; line starts are derived from the '\n'-split source.
  // Reviews lacking offsets (or with a point outside text blocks) fall back
  // to whole-line coverage. Overlapping range pieces merge; point pieces stay
  // standalone even when sharing a column.
  const segByLine = useMemo(() => {
    const byLine = new Map<number, LineSeg[]>()
    if (!doc) return byLine
    const lineStartOff: number[] = []
    let off = 0
    for (const line of lines) {
      lineStartOff.push(off)
      off += line.length + 1
    }
    const pushSeg = (lineNo: number, seg: LineSeg): void => {
      const list = byLine.get(lineNo)
      if (list) list.push(seg)
      else byLine.set(lineNo, [seg])
    }
    for (const review of doc.reviews) {
      if (review.lineStart === null || review.lineEnd === null) continue
      if (UNMARKED.has(review.anchorStatus)) continue
      const ms = review.matchOffsetStart
      const me = review.matchOffsetEnd
      const isPoint = review.selectedText === '' && ms !== null && me !== null && ms === me
      if (ms !== null && me !== null && (isPoint || me > ms)) {
        for (let lineNo = review.lineStart; lineNo <= review.lineEnd; lineNo += 1) {
          const lineBase = lineStartOff[lineNo - 1]
          const lineEndOff = lineBase + (lines[lineNo - 1]?.length ?? 0)
          if (lineBase === undefined) continue
          if (isPoint) {
            if (ms < lineBase || ms > lineEndOff) continue
            pushSeg(lineNo, {
              colStart: ms - lineBase, colEnd: ms - lineBase, point: true,
              reviews: [review], className: '',
            })
          } else {
            const cs = Math.max(ms, lineBase) - lineBase
            const ce = Math.min(me, lineEndOff) - lineBase
            if (ce <= cs) continue
            pushSeg(lineNo, { colStart: cs, colEnd: ce, point: false, reviews: [review], className: '' })
          }
        }
      } else if (!isPoint) {
        // Whole-line fallback (line-level degraded anchor).
        for (let line = review.lineStart; line <= review.lineEnd; line += 1) {
          pushSeg(line, {
            colStart: 0, colEnd: lines[line - 1]?.length ?? 0,
            point: false, reviews: [review], className: '',
          })
        }
      }
    }
    for (const [lineNo, segs] of byLine) {
      const lineLen = lines[lineNo - 1]?.length ?? 0
      const points = segs.filter(s => s.point)
      const ranges = mergeLineSegs(segs.filter(s => !s.point))
      const ordered = [...ranges, ...points]
        .sort((a, b) => a.colStart - b.colStart || Number(a.point) - Number(b.point))
      byLine.set(lineNo, ordered.map(seg => {
        // Edge bars only when every contributing review actually starts/ends
        // inside this piece (merged overlaps can trim either boundary).
        const edgeStart = !seg.point && seg.reviews.every(r =>
          r.matchOffsetStart !== null
          && r.matchOffsetStart - (lineStartOff[lineNo - 1] ?? 0) === seg.colStart)
        const edgeEnd = !seg.point && seg.reviews.every(r =>
          r.matchOffsetEnd !== null
          && r.matchOffsetEnd - (lineStartOff[lineNo - 1] ?? 0) === seg.colEnd)
        return {
          ...seg,
          colStart: Math.min(seg.colStart, lineLen),
          colEnd: Math.min(seg.colEnd, lineLen),
          className: `${markClassName(seg.reviews, seg.point)}${edgeStart ? ' dbr-edge-start' : ''}${edgeEnd ? ' dbr-edge-end' : ''}`,
        }
      }))
    }
    return byLine
  }, [doc, lines])

  const gutterBadges = useMemo(() => {
    const byLine = new Map<number, DocumentReviewAnchor[]>()
    if (!doc) return byLine
    for (const review of doc.reviews) {
      if (review.lineStart === null || UNMARKED.has(review.anchorStatus)) continue
      const list = byLine.get(review.lineStart)
      if (list) list.push(review)
      else byLine.set(review.lineStart, [review])
    }
    return byLine
  }, [doc])

  const drifted = useMemo(
    () => doc?.reviews.filter(r => r.lineStart === null || UNMARKED.has(r.anchorStatus)) ?? [],
    [doc],
  )

  // Scroll to the review requested via tab params (e.g. gutter click in the
  // left sidebar or a jump from the list/detail).
  useEffect(() => {
    if (!initialReviewId || loading || doc === null) return
    const timer = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-review-ids~="${initialReviewId}"]`)
      el?.scrollIntoView({ block: 'center' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialReviewId, loading, doc])

  // Scroll to the line referenced by a doc-ref link click.
  useEffect(() => {
    if (focusLineStart === undefined || loading || doc === null) return
    const timer = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-line="${focusLineStart}"]`)
      el?.scrollIntoView({ block: 'center' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [focusLineStart, loading, doc])

  // Close the popover on any outside click.
  useEffect(() => {
    if (!popover) return
    function onDown(event: MouseEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('.dbr-popover')) {
        setPopover(null)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [popover])

  // The add-review bubble follows selection semantics: hide on scroll, on
  // Escape, and on any mousedown outside the bubble itself.
  useEffect(() => {
    if (!fab) return
    function onScroll(): void { setFab(null) }
    function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') setFab(null) }
    function onDown(event: MouseEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('.dbr-selection-fab')) {
        setFab(null)
      }
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [fab])

  function captureSelection(): void {
    const body = bodyRef.current
    const wrap = wrapRef.current
    const selection = window.getSelection()
    if (!body || !wrap || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setFab(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!body.contains(range.commonAncestorContainer)) {
      setFab(null)
      return
    }
    const start = rangeOffset(body, range.startContainer, range.startOffset)
    const end = rangeOffset(body, range.endContainer, range.endOffset)
    if (start === null || end === null || start === end) {
      setFab(null)
      return
    }
    if (validateSelection(content.slice(start, end)) !== null) {
      setFab(null)
      return
    }
    const wrapRect = wrap.getBoundingClientRect()
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setFab(null)
      return
    }
    // Above the first selected line, horizontally centered on the selection;
    // flip below when the wrapper top does not leave room for the bubble.
    const FAB_WIDTH = 96
    const x = rect.left - wrapRect.left + rect.width / 2 - FAB_WIDTH / 2
    const above = rect.top - wrapRect.top - FAB_GAP - FAB_HEIGHT >= 0
    const y = above
      ? rect.top - wrapRect.top - FAB_GAP - FAB_HEIGHT
      : rect.bottom - wrapRect.top + FAB_GAP
    setFab({ x, y, start, end })
  }

  function composeFromFab(): void {
    if (!fab || doc === null) return
    const anchor = buildAnchorDraft(content, doc.headings, fab.start, fab.end)
    setFab(null)
    window.getSelection()?.removeAllRanges()
    if (rebindFor !== null && rebindFor !== undefined) {
      // Rebind mode (design/06 §12): the same selection flow feeds the
      // re-anchor endpoint instead of creating a new review.
      void api.reanchorReview({ projectId, reviewId: rebindFor, target: anchor })
        .then(() => onRebindDone(rebindFor))
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      return
    }
    onCompose({ projectId, document, anchor })
  }

  function openGroup(group: DocumentReviewAnchor[], event: React.MouseEvent): void {
    if (group.length === 1) {
      onOpenReview(group[0].reviewId)
      return
    }
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({
      x: target.left - rect.left,
      y: target.bottom - rect.top + 2,
      reviews: group,
    })
  }

  if (loading) return <div className="dbr-loading">{t('panel.loading')}</div>
  if (doc === null) {
    return (
      <div>
        <button type="button" onClick={onBack}>← {t('document.back')}</button>
        <div className="dbr-error">{error}</div>
      </div>
    )
  }
  if (!doc.exists) {
    return (
      <div>
        <div className="dbr-crumbs">
          <button type="button" onClick={onBack}>← {t('document.back')}</button>
        </div>
        <div className="dbr-empty">{t('document.notFound')}: {document}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="dbr-crumbs">
        <button type="button" onClick={onBack}>← {t('document.back')}</button>
        <span className="dbr-detail-id">{document}</span>
      </div>
      {error !== null && <div className="dbr-error">{error}</div>}
      {rebindFor !== null && rebindFor !== undefined && (
        <div className="dbr-toast dbr-ok">{t('anchor.rebindHint')} <b>{rebindFor}</b></div>
      )}

      <div className="dbr-doc" ref={wrapRef} style={{ position: 'relative' }}>
        <div ref={bodyRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
          {lines.map((line, index) => {
            const lineNo = index + 1
            const segs = segByLine.get(lineNo)
            // Numbers render only on the anchor's first covered line, so a
            // multi-line review never repeats its badge.
            const starters = segs
              ? dedupeReviews(segs.flatMap(seg => seg.reviews))
                  .filter(review => review.lineStart === lineNo)
              : (gutterBadges.get(lineNo) ?? [])
            // Chip host: the last (rightmost) range piece on the line, or the
            // point piece when the line carries only points.
            const chipHost = segs
              ? (segs.filter(seg => !seg.point).at(-1) ?? segs.at(-1))
              : undefined
            return (
              <div
                key={lineNo}
                data-line={lineNo}
                className={`dbr-doc-line${headingLines.has(lineNo) ? ' dbr-h-heading' : ''}`}
              >
                <span className="dbr-doc-gutter">
                  {starters && starters.length > 0 && (
                    <span className="dbr-gutter-badges">
                      {starters.map(review => (
                        <button
                          key={review.reviewId}
                          type="button"
                          className={`dbr-gutter-badge dbr-num-sev-${review.severity}${TERMINAL_STATUS_SET.has(review.status) ? ' dbr-is-terminal' : ''}${review.needsReviewCandidate && review.status !== 'needs_review' ? ' dbr-is-drift' : ''}`}
                          data-review-ids={review.reviewId}
                          title={
                            `${review.number} ${review.reviewId}`
                            + (review.needsReviewCandidate && review.status !== 'needs_review'
                              ? ` · ${t('anchor.needsReview')}`
                              : '')
                          }
                          onClick={event => openGroup([review], event)}
                        >{review.number}</button>
                      ))}
                    </span>
                  )}
                  <span className="dbr-gutter-lineno">{String(lineNo).padStart(lineDigits, '0')}</span>
                </span>
                <span className="dbr-doc-code">
                  {segs && segs.length > 0
                    ? renderLineSegments(line, lineNo, segs, chipHost, starters, openGroup)
                    : (line || ' ')}
                </span>
              </div>
            )
          })}
        </div>

        {fab && (
          <button
            type="button"
            className="dbr-selection-fab"
            style={{ left: fab.x, top: fab.y }}
            onMouseDown={event => event.stopPropagation()}
            onClick={composeFromFab}
          >
            {rebindFor !== null && rebindFor !== undefined ? t('anchor.rebind') : t('document.addReview')}
          </button>
        )}

        {popover && (
          <div className="dbr-popover" style={{ left: popover.x, top: popover.y }}>
            {popover.reviews.map(review => (
              <button
                key={review.reviewId}
                type="button"
                className="dbr-popover-item"
                onClick={() => onOpenReview(review.reviewId)}
              >
                <span className={`dbr-pop-number dbr-num-sev-${review.severity}`}>{review.number}</span>
                <span className={`dbr-pill ${severityClass(review.severity)}`}>
                  {severityLabel(t, review.severity)}
                </span>
                <span className="dbr-pop-title" title={review.reviewId}>
                  {review.selectedText ? truncate(review.selectedText, 40) : review.reviewId}
                </span>
                <span className="dbr-detail-meta">{statusLabel(t, review.status)}</span>
                {review.needsReviewCandidate && review.status !== 'needs_review' && (
                  <span className="dbr-drift-chip">{t('anchor.needsReview')}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {drifted.length > 0 && (
        <div className="dbr-drift-list">
          {drifted.map(review => (
            <div key={review.reviewId} className="dbr-detail-meta">
              <a onClick={() => onOpenReview(review.reviewId)}>{review.number} · {review.reviewId}</a>
              {' · '}{anchorLabel(t, review.anchorStatus)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

function dedupeReviews(reviews: DocumentReviewAnchor[]): DocumentReviewAnchor[] {
  return reviews.filter((review, idx) =>
    reviews.findIndex(r => r.reviewId === review.reviewId) === idx)
}

/** Merge overlapping/touching range pieces within one line. */
function mergeLineSegs(segs: LineSeg[]): LineSeg[] {
  const sorted = [...segs].sort((a, b) => a.colStart - b.colStart)
  const merged: LineSeg[] = []
  for (const seg of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && seg.colStart <= last.colEnd) {
      last.colEnd = Math.max(last.colEnd, seg.colEnd)
      for (const review of seg.reviews) {
        if (!last.reviews.includes(review)) last.reviews.push(review)
      }
    } else {
      merged.push({ ...seg, reviews: [...seg.reviews] })
    }
  }
  return merged
}

function reviewIds(reviews: DocumentReviewAnchor[]): string {
  return dedupeReviews(reviews).map(r => r.reviewId).join(' ')
}

/** Highest-severity tint + drift/terminal modifiers for a piece. */
function markClassName(reviews: DocumentReviewAnchor[], point: boolean): string {
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  const classes = point
    ? [`dbr-doc-point`, `dbr-point-sev-${top.severity}`]
    : [`dbr-anchor-sev-${top.severity}`]
  if (reviews.every(r => r.anchorStatus === 'moved')) classes.push('dbr-anchor-moved')
  if (reviews.some(r => r.anchorStatus === 'modified')) classes.push('dbr-anchor-modified')
  if (reviews.every(r => TERMINAL_STATUS_SET.has(r.status))) classes.push('dbr-is-terminal')
  return classes.join(' ')
}

function inlineChips(
  reviews: DocumentReviewAnchor[],
  hostKey: string,
  openGroup: (group: DocumentReviewAnchor[], event: React.MouseEvent) => void,
): ReactNode {
  return (
    <span className="dbr-inline-nums" key={`${hostKey}-nums`}>
      {reviews.map(review => (
        <button
          key={review.reviewId}
          type="button"
          className={`dbr-inline-num dbr-num-sev-${review.severity}`}
          title={`${review.number} ${review.reviewId}`}
          onClick={event => { event.stopPropagation(); openGroup([review], event) }}
        >{review.number}</button>
      ))}
    </span>
  )
}

/** Split one source line into plain text + marked pieces (incl. points). */
function renderLineSegments(
  line: string,
  lineNo: number,
  segs: LineSeg[],
  chipHost: LineSeg | undefined,
  starters: DocumentReviewAnchor[],
  openGroup: (group: DocumentReviewAnchor[], event: React.MouseEvent) => void,
): ReactNode {
  const nodes: ReactNode[] = []
  let cursor = 0
  let index = 0
  const plain = (end: number): void => {
    if (end > cursor) nodes.push(line.slice(cursor, end))
  }
  for (const seg of segs) {
    const key = `${lineNo}-${index}`
    if (seg.point) {
      plain(seg.colStart)
      const isChipHost = chipHost === seg
      nodes.push(
        <span
          key={key}
          className={seg.className}
          data-review-ids={reviewIds(seg.reviews)}
          onClick={event => openGroup(dedupeReviews(seg.reviews), event)}
        >
          {isChipHost && starters.length > 0 && inlineChips(starters, key, openGroup)}
        </span>,
      )
      cursor = seg.colEnd
    } else {
      plain(seg.colStart)
      const text = line.slice(seg.colStart, seg.colEnd)
      const isChipHost = chipHost === seg
      nodes.push(
        <mark
          key={key}
          className={seg.className}
          data-review-ids={reviewIds(seg.reviews)}
          onClick={event => openGroup(dedupeReviews(seg.reviews), event)}
        >
          {text}
          {isChipHost && starters.length > 0 && inlineChips(starters, key, openGroup)}
        </mark>,
      )
      cursor = seg.colEnd
    }
    index += 1
  }
  if (cursor < line.length) nodes.push(line.slice(cursor))
  if (nodes.length === 0) nodes.push(' ')
  return nodes
}

/** Character offset of a Range boundary within the rendered block body. */
function rangeOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}
