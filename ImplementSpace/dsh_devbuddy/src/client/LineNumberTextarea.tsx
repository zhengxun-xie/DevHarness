/**
 * Textarea with a CodeMirror-style line-number gutter — without CodeMirror.
 *
 * A native <textarea> keeps IME/selection behavior; line numbers are
 * positioned from a "mirror" element that shares the editor's exact box and
 * font metrics and renders every source line as a block. Each block's
 * measured offset positions its number, so SOFT-WRAPPED lines stay aligned
 * (the number tracks the whole wrapped block — CodeMirror's lineNumbers() +
 * lineWrapping semantics). Committed reviews paint on the background
 * overlay only: a severity tint plus a 2px "|" bar at each selection edge
 * (a single bar for zero-length point anchors). Glyph colors never change.
 *
 * Sizing mirrors the sidebar file editor: the surface is borderless and
 * grows WITH its content (auto-grow, with the CSS min-height giving a fresh
 * document its blank editing area); the outer panel scrolls the page rather
 * than the editor scrolling internally.
 *
 * Metric parity relies on the `.dbl-editor-ta` and `.dbl-editor-mirror`
 * rules sharing identical font/padding/wrap settings (see styles.ts).
 *
 * Reviewer integration (design/05 §5.2):
 *   - the gutter renders one #N pill PER REVIEW at the anchor's first line;
 *     several pills on one line sit side by side, each deep-links its own
 *     review via onGutterReview(lineNo, reviewId);
 *   - COMMITTED review ranges paint on the overlay, matching the preview:
 *     a background-tint rect (precise matchOffset*, whole-line fallback when
 *     the anchor drifted) plus a 2px edge bar on each side ("|"); zero-length
 *     point anchors render a single bar. A selection being dragged gets the
 *     native textarea selection highlight and nothing else — no plugin
 *     pending mark;
 *   - selecting text reports LF-normalized offsets together with the
 *     selection rect (relative to the editor box) so the owner can anchor
 *     the in-place "add review" bubble directly above the selection;
 *   - the bubble itself is rendered here (it must overlay the textarea) and
 *     reports its two actions through onAddReview / onCloseReviewPop.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { lfOffsetToRaw } from './reviewer-bridge.ts'
import { collectHeadings, sectionEndLine } from './section-folds.ts'
import { buildProjection, lfOffsetOf, mapDisplayEdit, rawOffsetOf } from './fold-projection.ts'

/** Stable empty fold set (a fresh Set each render would defeat every memo). */
const NO_FOLDS: ReadonlySet<string> = new Set()
const NO_COUNTS: ReadonlyMap<string, number> = new Map()

export type ReviewSeverity = 'info' | 'minor' | 'major' | 'critical'

/** One gutter pill: a single review anchored at the start of some line. */
export interface GutterBadgeItem {
  reviewId: string
  /** Document-scoped review number rendered as a bare digit. */
  number: number
  severity: ReviewSeverity
  /** Moved/modified/outdated/orphaned — hollow styling. */
  drifted: boolean
}

/** A committed review range painted on the overlay (raw-text offsets). */
export interface ReviewOverlayRange {
  reviewId: string
  /** 0-based half-open offsets in the textarea's RAW value. */
  start: number
  end: number
  /** When true (no precise match), the covered whole lines are tinted. */
  lineLevel: boolean
  severity: ReviewSeverity
  status: AnchorVisualStatus
}

export type AnchorVisualStatus = 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'

/** Pending selection anchor (dashed), raw-text offsets. */
export interface PendingRange {
  start: number
  end: number
}

export interface SelectionRectInfo {
  /** 0-based half-open offsets in the LF-normalized value. */
  lfStart: number
  lfEnd: number
}

export interface LineNumberTextareaProps {
  value: string
  onChange(value: string): void
  /** Gutter pills keyed by 1-based line number. */
  reviewBadges?: ReadonlyMap<number, GutterBadgeItem[]>
  /** Committed review highlights painted over the text layer. */
  reviewHighlights?: readonly ReviewOverlayRange[]
  /** Active uncommitted selection (or null) — drives the bubble only; the
   *  overlay never paints it (native selection is the sole visual). */
  pendingRange?: PendingRange | null
  /** Click on a gutter pill; receives the line and the specific review. */
  onGutterReview?: (line: number, reviewId: string) => void
  /** Non-collapsed selection settled (debounced), with its geometry. */
  onSelectionChange?: (info: SelectionRectInfo) => void
  /** Selection collapsed/emptied (owner hides the bubble + pending mark). */
  onSelectionClear?: () => void
  /** "Add review" action on the in-place bubble. */
  onAddReview?: () => void
  /** Escape / scroll / close-glyph while the bubble is visible. */
  onCloseReviewPop?: () => void
  /** Localized accessible tooltip for a pill. */
  badgeTitle?: (item: GutterBadgeItem) => string
  /** Bubble copy. */
  addReviewLabel: string
  closeLabel: string
  /** Keys of sections currently folded (see section-folds.ts). */
  foldedKeys?: ReadonlySet<string>
  /** Toggle one section's folded state. */
  onToggleFold?: (key: string) => void
  /** Tooltip for the gutter fold chevron. */
  foldLabel?: string
  unfoldLabel?: string
  /** Cover placeholder before the line count, e.g. "已折叠". */
  foldedLabel?: string
  /** LF offset to restore caret position after a mode switch (null = skip). */
  restoreCaret?: number | null
}

export interface LineNumberTextareaHandle {
  /** True when this editor's textarea currently owns document focus. */
  isFocused(): boolean
  /**
   * Current selection as LF-normalized half-open offsets. A collapsed caret
   * returns start === end (a point anchor); a non-empty selection returns the
   * full range so the cross-barrier quick action can comment on it.
   */
  getSelectionRange(): { start: number; end: number } | null
}

interface OverlayRect {
  key: string
  left: number
  top: number
  width: number
  height: number
  className: string
  lineLevel: boolean
  /** 'bg': background tint; 'start'/'end': 2px edge bars; 'point': point. */
  kind: 'bg' | 'start' | 'end' | 'point'
}

const FAB_GAP = 6
const FAB_HEIGHT = 24
const FAB_WIDTH = 108

/** Indent unit inserted by Tab (Markdown convention: 2 spaces). */
const TAB_INDENT = '  '

/** Remove one leading indent level: a tab, or up to TAB_INDENT spaces. */
function outdentLine(line: string): { text: string; removed: number } {
  if (line.startsWith('\t')) return { text: line.slice(1), removed: 1 }
  let removed = 0
  while (removed < TAB_INDENT.length && removed < line.length && line.charCodeAt(removed) === 32) {
    removed += 1
  }
  return { text: line.slice(removed), removed }
}

interface IndentEdit {
  next: string
  selectionStart: number
  selectionEnd: number
}

/**
 * VS Code-style Tab / Shift-Tab edit over a textarea's raw value. Tab indents
 * every line the selection touches (or the caret line) by TAB_INDENT;
 * Shift-Tab removes one leading indent level from each. A selection ending
 * exactly at the start of a line leaves that trailing line untouched.
 * Returns null when Shift-Tab finds nothing to remove.
 */
function tabEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  shift: boolean,
): IndentEdit | null {
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  // A selection ending right after a '\n' (column 0 of the next line) does
  // not include that next line.
  let end = selectionEnd
  if (end > selectionStart && value.charCodeAt(end - 1) === 10) end -= 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length
  const lines = value.slice(lineStart, lineEnd).split('\n')

  if (shift) {
    let removedBeforeStart = 0
    let removedTotal = 0
    const outdented = lines.map((line, index) => {
      const result = outdentLine(line)
      if (index === 0) removedBeforeStart = result.removed
      removedTotal += result.removed
      return result.text
    })
    if (removedTotal === 0) return null
    return {
      next: value.slice(0, lineStart) + outdented.join('\n') + value.slice(lineEnd),
      selectionStart: Math.max(lineStart, selectionStart - removedBeforeStart),
      selectionEnd: Math.max(lineStart, selectionEnd - removedTotal),
    }
  }

  return {
    next: value.slice(0, lineStart)
      + lines.map(line => TAB_INDENT + line).join('\n')
      + value.slice(lineEnd),
    selectionStart: selectionStart + TAB_INDENT.length,
    selectionEnd: selectionEnd + TAB_INDENT.length * lines.length,
  }
}

/** Resolve a within-line column to (text node, local offset) inside a mirror
 *  line element (a single plain text node, plus a ZWSP on empty lines). */
function mirrorTextPoint(
  lineEl: HTMLElement,
  col: number,
): { node: Node; offset: number } {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let remaining = col
  let node: Node | null = walker.nextNode()
  while (node !== null) {
    const length = (node.nodeValue ?? '').length
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    node = walker.nextNode()
  }
  return { node: lineEl, offset: lineEl.childNodes.length }
}

export const LineNumberTextarea = forwardRef<LineNumberTextareaHandle, LineNumberTextareaProps>(
function LineNumberTextarea({
  value,
  onChange,
  reviewBadges,
  reviewHighlights,
  pendingRange,
  onGutterReview,
  onSelectionChange,
  onSelectionClear,
  onAddReview,
  onCloseReviewPop,
  badgeTitle,
  addReviewLabel,
  closeLabel,
  foldedKeys,
  onToggleFold,
  foldLabel,
  unfoldLabel,
  foldedLabel,
  restoreCaret,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<readonly number[]>([])
  const [overlayRects, setOverlayRects] = useState<readonly OverlayRect[]>([])
  const [fab, setFab] = useState<{ x: number; y: number } | null>(null)

  // --- Fold projection -----------------------------------------------------
  // A <textarea> cannot hide lines, so a folded body is removed from the value
  // the textarea DISPLAYS: the content below really moves up instead of being
  // covered. `value` stays the draft (the owner's truth) and every offset that
  // crosses this boundary is mapped through `projection` (fold-projection.ts):
  // selections/reviews out (display → draft), highlights/caret in.
  const folds = foldedKeys ?? NO_FOLDS
  const projection = useMemo(() => buildProjection(value, folds), [value, folds])
  /** What the textarea shows (folded bodies removed). */
  const display = projection.text
  // Live offset model for the imperative handle below (its deps are empty, so
  // reading these directly would freeze the first render's text).
  const modelRef = useRef({ value, display, projection })
  modelRef.current = { value, display, projection }
  /** Review pills arrive keyed by DRAFT line; the gutter shows display lines. */
  const displayBadges = useMemo(() => {
    if (!projection.folded || reviewBadges === undefined) return reviewBadges
    const mapped = new Map<number, GutterBadgeItem[]>()
    reviewBadges.forEach((items, lineNo) => {
      const displayLine = projection.lineToDisplay(lineNo - 1)
      if (displayLine !== null) mapped.set(displayLine + 1, items)
    })
    return mapped
  }, [projection, reviewBadges])

  // Imperative caret query for the cross-barrier "add comment at caret"
  // handshake (DEVBUDDY_CARET_REQUEST).
  useImperativeHandle(ref, () => ({
    isFocused: () => taRef.current !== null && document.activeElement === taRef.current,
    getSelectionRange: () => {
      const ta = taRef.current
      if (ta === null) return null
      const { value: draft, display: shown, projection: proj } = modelRef.current
      // Raw display offset → LF display offset → raw draft offset → LF draft.
      const toDraftLf = (rawDisplay: number): number =>
        lfOffsetOf(draft, proj.toDraft(rawOffsetOf(shown, lfOffsetOf(shown, rawDisplay))))
      return { start: toDraftLf(ta.selectionStart), end: toDraftLf(ta.selectionEnd) }
    },
  }), [])

  // --- Restore caret after a mode switch (richtext → source) ---
  // LF offset → raw textarea offset, then focus + set selection + scroll the
  // nearest scrollable ancestor to the caret line. The textarea itself is
  // overflow:hidden / auto-growing, so ta.scrollTop is always 0 — the outer
  // panel scrolls. We use the mirror's per-line span for an exact row jump.
  //
  // ORDERING: this effect is declared ABOVE the auto-grow effect (measure →
  // grow), so on mount it runs FIRST — the textarea is still short and the
  // scroll container has nothing to scroll; scrollIntoView would clamp to a
  // no-op. grow() is therefore called here to stretch the surface to full
  // content height BEFORE scrolling. focus({preventScroll}) keeps the
  // browser from racing us with its own scroll-to-textarea-top behavior.
  useLayoutEffect(() => {
    if (restoreCaret === null || restoreCaret === undefined) return
    const ta = taRef.current
    if (ta === null) return
    // The caret offset is in DRAFT coordinates; the textarea shows `display`.
    const raw = projection.toDisplay(lfOffsetToRaw(value, restoreCaret))
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(raw, raw)
    const mirror = mirrorRef.current
    if (mirror === null) return
    grow()
    const lineIdx = display.slice(0, raw).split('\n').length - 1
    const scrollCaretIntoView = (): void => {
      const spans = mirror.querySelectorAll<HTMLElement>('[data-mirror-line]')
      const span = spans[lineIdx]
      if (span !== undefined) span.scrollIntoView({ block: 'center' })
    }
    scrollCaretIntoView()
    // One frame later: webfont settling and ResizeObserver remeasure can
    // shift line positions after the initial layout — re-center once.
    const raf = requestAnimationFrame(scrollCaretIntoView)
    return () => { cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Memoized: a fresh array on every render made rangeRects a new callback
  // identity each pass, re-running the overlay effect and feeding it back
  // through setOverlayRects — React #185 (Maximum update depth).
  const lines = useMemo(() => projection.lines, [projection])
  // Headings drive the fold affordances; declared early because gutterWidth
  // and the fold geometry both read them.
  const headings = useMemo(() => collectHeadings(lines), [lines])
  const headingByLine = useMemo(() => new Map(headings.map(h => [h.index, h])), [headings])
  // Line numbers are zero-padded to the document's widest number so every
  // tabular-nums glyph slot stays filled (e.g. line 3 in a 114-line doc
  // renders as "003").
  const lineDigits = String(lines.length).length
  // Gutter width follows the row whose pills need the most room: each pill is
  // an outlined capsule (16px min, growing with its digit count), pills sit
  // 2px apart, a 3px gap separates the cluster from the line number. Pills
  // hug the gutter's LEFT edge (4px inset); the line number is pushed to the
  // RIGHT edge (margin-left:auto) next to the document text. The width model
  // must match `.dbl-rv-badge` / `.dbl-editor-ln` in styles.ts.
  const gutterWidth = useMemo(() => {
    const lineNumWidth = lineDigits * 8 + 2
    let maxPillsWidth = 0
    displayBadges?.forEach(items => {
      let rowWidth = 0
      items.forEach((item, index) => {
        const digits = String(item.number).length
        // 16px min; each digit ~6.2px at 9.5px tabular-nums, plus 4px
        // horizontal padding and 2px border.
        rowWidth += Math.max(16, Math.ceil(digits * 6.4) + 6)
        if (index > 0) rowWidth += 2
      })
      if (rowWidth > maxPillsWidth) maxPillsWidth = rowWidth
    })
    const pillGap = maxPillsWidth > 0 ? 3 : 0
    // Reserve the fold chevron slot (14px + 2px gap) when the document has
    // headings, so heading rows never squeeze the line number.
    const chevron = headings.length > 0 ? 16 : 0
    // Folded rows also show how many lines they hide ("▸12").
    const foldCount = projection.folded ? 16 : 0
    return 4 + maxPillsWidth + pillGap + chevron + foldCount + lineNumWidth + 4
  }, [lineDigits, displayBadges, headings, projection.folded])

  /** Read each line block's offset from the mirror; identity-stable state. */
  const measureLines = useCallback(() => {
    const mirror = mirrorRef.current
    if (mirror === null) return
    const spans = mirror.querySelectorAll<HTMLElement>('[data-mirror-line]')
    const next: number[] = []
    spans.forEach(span => next.push(Math.round(span.offsetTop)))
    setPositions(prev =>
      prev.length === next.length && prev.every((p, index) => p === next[index]) ? prev : next)
  }, [])

  /**
   * Auto-grow the textarea to its full content height. The content height is
   * read from the hidden MIRROR (identical metrics, naturally full-size) —
   * never by resetting the textarea to height:auto.
   *
   * That reset momentarily collapsed a long document to two rows; the
   * synchronous layout forced when reading scrollHeight then made the browser
   * clamp the outer page scroll to its top, and restoring the height did not
   * restore the scroll position — the page jumped up and the caret landed
   * off-screen on every keystroke.
   *
   * Target is max(content, a 9-line floor ≈ 200px); the inline height is
   * written only when it actually changes (>1px), which also stops
   * ResizeObserver feedback.
   */
  const grow = useCallback(() => {
    const ta = taRef.current
    const mirror = mirrorRef.current
    if (ta === null || mirror === null) return
    // Keep in sync with .dbl-editor min-height: 9 lines × 22.1px line-height.
    const minHeight = 200
    // Folded bodies are absent from the mirror, so the natural content height
    // already IS the collapsed height — nothing to subtract.
    const target = Math.max(minHeight, Math.ceil(mirror.scrollHeight))
    if (Math.abs(ta.offsetHeight - target) > 1) {
      ta.style.height = `${target}px`
    }
  }, [])

  const measure = useCallback(() => {
    grow()
    measureLines()
  }, [grow, measureLines])

  // Measure after every content change (mirror DOM is updated before layout
  // effects run), once on mount, on fonts settling, and whenever the box
  // resizes (window/rightbar drag): soft-wrap changes move every offset.
  // Depends on `display`, not `value`: folding changes the mirror's content
  // (and height) without the draft changing at all.
  useLayoutEffect(() => { measure() }, [display, measure])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (taRef.current) ro.observe(taRef.current)
    if (mirrorRef.current) ro.observe(mirrorRef.current)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    void fonts?.ready.then(measure)
    return () => { ro.disconnect() }
  }, [measure])

  // --- Section folds -------------------------------------------------------
  /**
   * Body line count per folded heading, shown next to its chevron. Computed
   * from the DRAFT (a nested heading folded inside a folded parent has no
   * span of its own in the projection, but still reports its own count).
   */
  const foldedCounts = useMemo(() => {
    if (!projection.folded) return NO_COUNTS
    const draftLines = value.split('\n')
    const draftHeadings = collectHeadings(draftLines)
    const counts = new Map<string, number>()
    for (const heading of draftHeadings) {
      if (!folds.has(heading.key)) continue
      const end = sectionEndLine(draftHeadings, heading.index, draftLines.length)
      counts.set(heading.key, Math.max(0, end - heading.index))
    }
    return counts
  }, [projection.folded, value, folds])

  /**
   * Geometry of a raw-text character range, using mirror line blocks (same
   * metrics as the textarea) and Range rectangles over their text. Returns
   * one rect per visual line the range covers. Coordinates are relative to
   * the editor box and already include the shared text padding.
   */
  const rangeRects = useCallback((rawStart: number, rawEnd: number): Array<{
    left: number
    top: number
    width: number
    height: number
  }> => {
    const mirror = mirrorRef.current
    const editor = editorRef.current
    if (mirror === null || editor === null) return []
    const spans = mirror.querySelectorAll<HTMLElement>('[data-mirror-line]')
    const clampedStart = Math.max(0, Math.min(rawStart, display.length))
    const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, display.length))

    // Walk raw offsets to (line index, column) pairs. '\n' belongs to the
    // line it terminates; a range ending exactly on '\n' still wraps the line.
    let offset = 0
    let lineIndex = 0
    while (lineIndex < lines.length && offset + lines[lineIndex].length < clampedStart) {
      offset += lines[lineIndex].length + 1
      lineIndex += 1
    }
    const startLine = Math.min(lineIndex, lines.length - 1)
    const startCol = Math.max(0, clampedStart - offset)
    let endLine = startLine
    let endCol = startCol
    let walk = offset
    let idx = startLine
    while (idx < lines.length && walk + lines[idx].length < clampedEnd) {
      walk += lines[idx].length + 1
      idx += 1
    }
    endLine = Math.min(idx, lines.length - 1)
    endCol = Math.max(0, clampedEnd - walk)

    const editorRect = editor.getBoundingClientRect()
    const result: Array<{ left: number; top: number; width: number; height: number }> = []
    for (let li = startLine; li <= endLine; li += 1) {
      const span = spans.item(li)
      if (span === null) continue
      const lineLen = lines[li].length
      const from = li === startLine ? Math.min(startCol, lineLen) : 0
      const to = li === endLine ? Math.min(endCol, lineLen) : lineLen
      const spanRect = span.getBoundingClientRect()
      if (from >= to || lineLen === 0) {
        // Empty line or a zero-width slice: paint the whole line block.
        result.push({
          left: spanRect.left - editorRect.left,
          top: spanRect.top - editorRect.top,
          width: spanRect.width,
          height: spanRect.height || 22,
        })
        continue
      }
      // The visible mirror splits a line's text into colored mark spans;
      // resolve columns to the actual descendant text node + local offset.
      const startPoint = mirrorTextPoint(span, from)
      const endPoint = from === to ? startPoint : mirrorTextPoint(span, to)
      const range = document.createRange()
      range.setStart(startPoint.node, startPoint.offset)
      range.setEnd(endPoint.node, endPoint.offset)
      const rects = Array.from(range.getClientRects())
      for (const rect of rects) {
        if (rect.width === 0 && rect.height === 0) continue
        result.push({
          left: rect.left - editorRect.left,
          top: rect.top - editorRect.top,
          width: rect.width,
          // +1px so a soft-wrapped slice's descent is not clipped.
          height: rect.height + 1,
        })
      }
    }
    return result
  }, [lines, display])

  /**
   * Geometry of a zero-length point (caret) at a raw offset: the collapsed
   * Range rect inside the mirror line. Empty lines have no text node; the
   * point then sits at the line block's left content edge. Returns one rect
   * per visual line the (zero-width) caret occupies — normally exactly one.
   */
  const pointRects = useCallback((rawOffset: number): Array<{
    left: number
    top: number
    width: number
    height: number
  }> => {
    const mirror = mirrorRef.current
    const editor = editorRef.current
    if (mirror === null || editor === null) return []
    const spans = mirror.querySelectorAll<HTMLElement>('[data-mirror-line]')
    const clamped = Math.max(0, Math.min(rawOffset, display.length))
    let offset = 0
    let lineIndex = 0
    while (lineIndex < lines.length && offset + lines[lineIndex].length < clamped) {
      offset += lines[lineIndex].length + 1
      lineIndex += 1
    }
    const li = Math.min(lineIndex, lines.length - 1)
    const col = Math.max(0, clamped - offset)
    const span = spans.item(li)
    if (span === null) return []
    const spanRect = span.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const lineLen = lines[li].length
    if (lineLen === 0 || col === 0) {
      return [{
        left: spanRect.left - editorRect.left,
        top: spanRect.top - editorRect.top,
        width: 0,
        height: spanRect.height || 22,
      }]
    }
    const point = mirrorTextPoint(span, Math.min(col, lineLen))
    const range = document.createRange()
    range.setStart(point.node, point.offset)
    range.setEnd(point.node, point.offset)
    const rects = Array.from(range.getClientRects())
    const result = rects
      .filter(rect => !(rect.width === 0 && rect.height === 0))
      .map(rect => ({
        left: rect.left - editorRect.left,
        top: rect.top - editorRect.top,
        width: rect.width,
        height: rect.height + 1,
      }))
    if (result.length > 0) return result
    // A collapsed range at the END of a soft-wrapped line can report no rect;
    // fall back to the line block's right content edge on its last visual row.
    return [{
      left: spanRect.right - editorRect.left,
      top: spanRect.bottom - editorRect.top - (spanRect.height || 22),
      width: 0,
      height: spanRect.height || 22,
    }]
  }, [lines, display])

  /**
   * Committed highlights arrive in DRAFT offsets and must be painted in
   * display space. A range swallowed by a fold collapses to a point, which
   * would paint a stray marker, so it is dropped instead.
   */
  const displayHighlights = useMemo(() => {
    if (!projection.folded || reviewHighlights === undefined) return reviewHighlights
    const mapped: ReviewOverlayRange[] = []
    for (const range of reviewHighlights) {
      const start = projection.toDisplay(range.start)
      const end = projection.toDisplay(range.end)
      if (start === end && range.start !== range.end) continue
      mapped.push({ ...range, start, end })
    }
    return mapped
  }, [projection, reviewHighlights])

  // Paint COMMITTED highlights only whenever content, metrics, ranges or
  // wrapped positions change. Uncommitted selections rely on the native
  // textarea selection — pendingRange never reaches the overlay.
  useLayoutEffect(() => {
    const rects: OverlayRect[] = []
    for (const range of displayHighlights ?? []) {
      const statusClass = `dbl-rv-sev-${range.severity} dbl-rv-anchor-${range.status}`
      if (range.start === range.end) {
        const pieces = pointRects(range.start)
        pieces.forEach((piece, index) => {
          rects.push({
            ...piece,
            key: `rv-${range.reviewId}-pt-${index}`,
            className: `dbl-rv-bar dbl-rv-bar-point ${statusClass}`,
            lineLevel: range.lineLevel,
            kind: 'point',
          })
        })
        continue
      }
      const pieces = rangeRects(range.start, range.end)
      pieces.forEach((piece, index) => {
        rects.push({
          ...piece,
          key: `rv-${range.reviewId}-bg-${index}`,
          className: `dbl-rv-hl ${statusClass}`,
          lineLevel: range.lineLevel,
          kind: 'bg',
        })
      })
      const first = pieces[0]
      const last = pieces[pieces.length - 1]
      if (first !== undefined) {
        rects.push({
          left: first.left,
          top: first.top,
          width: 0,
          height: first.height,
          key: `rv-${range.reviewId}-bar-start`,
          className: `dbl-rv-bar dbl-rv-bar-start ${statusClass}`,
          lineLevel: range.lineLevel,
          kind: 'start',
        })
      }
      if (last !== undefined) {
        rects.push({
          left: last.left + last.width,
          top: last.top,
          width: 0,
          height: last.height,
          key: `rv-${range.reviewId}-bar-end`,
          className: `dbl-rv-bar dbl-rv-bar-end ${statusClass}`,
          lineLevel: range.lineLevel,
          kind: 'end',
        })
      }
    }
    setOverlayRects(rects)
  }, [displayHighlights, rangeRects, pointRects, positions, display])

  /** Unfold every folded section (used when an edit cannot be mapped). */
  function unfoldAll(): void {
    for (const key of folds) onToggleFold?.(key)
  }

  /**
   * Apply a textarea edit. Unfolded, the display IS the draft and the edit
   * passes straight through. Folded, the edit is mapped back to draft offsets;
   * an edit that would consume a folded section (a selection spanning one) is
   * refused and unfolds instead, so a fold can never silently delete content.
   */
  function applyEdit(ta: HTMLTextAreaElement, next: string, caret?: { start: number; end: number }): void {
    if (!projection.folded) {
      onChange(next)
      if (caret === undefined) return
      const clamp = (offset: number): number => Math.max(0, Math.min(offset, next.length))
      requestAnimationFrame(() => { ta.setSelectionRange(clamp(caret.start), clamp(caret.end)) })
      return
    }
    const mapped = mapDisplayEdit(value, projection, next)
    if (mapped === null) {
      unfoldAll()
      return
    }
    onChange(mapped.draft)
    // The projection can change shape (a heading edit re-keys its section):
    // recompute where the caret lives in the new display text.
    const caretDisplay = buildProjection(mapped.draft, folds).toDisplay(mapped.caret)
    requestAnimationFrame(() => { ta.setSelectionRange(caretDisplay, caretDisplay) })
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    applyEdit(event.target, event.target.value)
  }

  /** VS Code-style Tab indentation — never move focus out of the editor. */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const ta = event.currentTarget
    const edit = tabEdit(ta.value, ta.selectionStart, ta.selectionEnd, event.shiftKey)
    if (edit === null) return
    // Controlled textarea: the parent re-renders after this tick, so the caret
    // is restored once React has committed the new value.
    applyEdit(ta, edit.next, { start: edit.selectionStart, end: edit.selectionEnd })
  }

  /** Display raw offset → draft LF offset (the owner's offset model). */
  function displayToDraftLf(rawDisplay: number): number {
    const lfDisplay = lfOffsetOf(display, rawDisplay)
    const rawDraft = projection.toDraft(rawOffsetOf(display, lfDisplay))
    return lfOffsetOf(value, rawDraft)
  }

  /** Snapshot the current selection for the owner and position the bubble. */
  const captureSelection = useCallback(() => {
    const ta = taRef.current
    const editor = editorRef.current
    if (ta === null || editor === null || onSelectionChange === undefined) return
    if (ta.selectionStart === ta.selectionEnd) {
      setFab(null)
      onSelectionClear?.()
      return
    }
    const rawStart = ta.selectionStart
    const rawEnd = ta.selectionEnd
    const pieces = rangeRects(rawStart, rawEnd)
    if (pieces.length === 0) return
    // Bubble anchors above the FIRST selected visual line.
    const first = pieces[0]
    const above = first.top - FAB_GAP - FAB_HEIGHT >= 0
    const x = Math.max(0, first.left + first.width / 2 - FAB_WIDTH / 2)
    const y = above
      ? first.top - FAB_GAP - FAB_HEIGHT
      : first.top + first.height + FAB_GAP
    setFab({ x, y })
    onSelectionChange({
      lfStart: displayToDraftLf(rawStart),
      lfEnd: displayToDraftLf(rawEnd),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectionChange, onSelectionClear, rangeRects, display, projection, value])

  // Debounced selection broadcast: selectionchange covers keyboard/drag,
  // mouseup/keyup catch a just-finished drag promptly.
  useEffect(() => {
    if (onSelectionChange === undefined) return
    const ta = taRef.current
    if (ta === null) return
    let timer: ReturnType<typeof setTimeout> | null = null
    function schedule(): void {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(captureSelection, 200)
    }
    function onDocSelectionChange(): void {
      if (document.activeElement === ta) schedule()
    }
    document.addEventListener('selectionchange', onDocSelectionChange)
    ta.addEventListener('mouseup', schedule)
    ta.addEventListener('keyup', schedule)
    return () => {
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('selectionchange', onDocSelectionChange)
      ta.removeEventListener('mouseup', schedule)
      ta.removeEventListener('keyup', schedule)
    }
  }, [captureSelection, onSelectionChange])

  // Hide the bubble on scroll (capture: any ancestor scroll container) and
  // Escape. Focus loss deliberately does NOT clear it: the pending anchor
  // must survive clicking elsewhere until Esc/close/submit (design/05 §6).
  useEffect(() => {
    if (fab === null) return
    function onScroll(): void {
      setFab(null)
      onCloseReviewPop?.()
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setFab(null)
        onCloseReviewPop?.()
      }
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [fab, onCloseReviewPop])

  /** Keep the bubble mounted only while a pending anchor is active. */
  const showFab = fab !== null && pendingRange !== null

  /** Focus the textarea when the gutter background is clicked. */
  function focusTextarea(): void {
    taRef.current?.focus()
  }

  return (
    <div
      ref={editorRef}
      className="dbl-editor"
      style={{ '--dbl-gutter-w': `${gutterWidth}px` } as CSSProperties}
    >
      {/* Not aria-hidden: the gutter can contain focusable review pills. */}
      <div className="dbl-editor-gutter" onClick={focusTextarea}>
        {lines.map((_, index) => {
          // Hidden body lines are absent from `lines` entirely — the gutter
          // simply has fewer rows, so numbers stay aligned with the text.
          const lineNo = index + 1
          const items = displayBadges?.get(lineNo)
          const heading = headingByLine.get(index)
          const sectionFolded = heading !== undefined && foldedKeys?.has(heading.key) === true
          const hiddenCount = heading === undefined ? 0 : (foldedCounts.get(heading.key) ?? 0)
          return (
            <span
              key={index}
              className="dbl-editor-ln"
              style={{ top: positions[index] ?? index * 22 }}
            >
              {heading !== undefined && onToggleFold !== undefined && (
                <button
                  type="button"
                  className="dbl-fold-chevron"
                  title={sectionFolded ? unfoldLabel : foldLabel}
                  aria-label={sectionFolded ? unfoldLabel : foldLabel}
                  aria-expanded={!sectionFolded}
                  // eslint-disable-next-line react/jsx-no-bind
                  onClick={event => {
                    event.stopPropagation()
                    onToggleFold(heading.key)
                  }}
                >
                  {sectionFolded ? '▸' : '▾'}
                </button>
              )}
              {sectionFolded && hiddenCount > 0 && (
                <span
                  className="dbl-fold-count"
                  title={`${foldedLabel ?? ''} · ${hiddenCount}`}
                >
                  {hiddenCount}
                </span>
              )}
              {items !== undefined && items.length > 0 && (
                <span className="dbl-rv-badges">
                  {items.map(item => (
                    <button
                      key={item.reviewId}
                      type="button"
                      className={`dbl-rv-badge dbl-rv-num-${item.severity}${item.drifted ? ' dbl-rv-drifted' : ''}`}
                      title={badgeTitle?.(item) ?? String(item.number)}
                      aria-label={badgeTitle?.(item) ?? String(item.number)}
                      // eslint-disable-next-line react/jsx-no-bind
                      onClick={event => {
                        event.stopPropagation()
                        onGutterReview?.(projection.displayLineToDraft(index) + 1, item.reviewId)
                      }}
                    >
                      {item.number}
                    </button>
                  ))}
                </span>
              )}
              <span className="dbl-editor-ln-num">{String(lineNo).padStart(lineDigits, '0')}</span>
            </span>
          )
        })}
      </div>
      <textarea
        ref={taRef}
        className="dbl-editor-ta"
        value={display}
        spellCheck={false}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {/* Highlight overlay — shares the mirror's geometry; never intercepts
          pointer events. */}
      <div className="dbl-editor-overlay" aria-hidden>
        {overlayRects.map(rect => (
          <span
            key={rect.key}
            className={`${rect.className}${rect.lineLevel ? ' dbl-rv-line-level' : ''}`}
            style={{
              left: rect.left,
              top: rect.top,
              // Edge/point bars ignore the measured (often zero) width and
              // keep a fixed 2px slot via CSS.
              width: rect.kind === 'bg' ? rect.width : undefined,
              height: rect.height,
            }}
          />
        ))}
      </div>
      <div ref={mirrorRef} className="dbl-editor-mirror" aria-hidden>
        {lines.map((line, index) => (
          <span key={index} data-mirror-line className="dbl-editor-mirror-line">
            {/* Zero-width space keeps the empty line's block at full line height. */}
            {line === '' ? '​' : line}
          </span>
        ))}
      </div>
      {showFab && (
        <div className="dbl-rv-fab" style={{ left: fab.x, top: fab.y }}>
          <button
            type="button"
            className="dbl-rv-fab-main"
            // The bubble must not steal the textarea selection / collapse it.
            onMouseDown={event => event.preventDefault()}
            onClick={onAddReview}
          >
            {addReviewLabel}
          </button>
          <button
            type="button"
            className="dbl-rv-fab-x"
            aria-label={closeLabel}
            title={closeLabel}
            onMouseDown={event => event.preventDefault()}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => {
              setFab(null)
              onCloseReviewPop?.()
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
})
