/**
 * One workflow node card: status dot, file target, and a preview/edit flow.
 *
 * The header chrome mirrors the sidebar file editor (dsh-better-sidebar
 * EditorHost):
 *   - a collapse chevron on the left;
 *   - a segmented [预览 | 编辑] toggle that is ALWAYS visible, so while
 *     editing you can switch over to the rendered Markdown preview (and
 *     back) without losing either surface — the active segment is
 *     highlighted exactly like the editor's mode buttons;
 *   - an amber dirty dot marks unsaved edits;
 *   - 保存/放弃 show only in edit mode; the explicit 保存 button stays in
 *     edit mode (same convention as the editor's Ctrl+S), while switching
 *     edit → preview AUTO-SAVES the draft first (a failed write keeps the
 *     card in edit mode so the unsaved text is never dropped); discarding
 *     just resets the draft to the saved text.
 *
 * Preview renders Markdown through the shell's platform-seeded
 * `MarkdownText` primitive — the same GFM renderer used by the sidebar
 * file browser's document preview. With unsaved edits, the preview renders
 * the live draft (state is React-local, so switching modes cannot drop it)
 * and shows an "unsaved" note.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { api } from './api.ts'
import {
  LineNumberTextarea,
  type GutterBadgeItem,
  type LineNumberTextareaHandle,
  type PendingRange,
  type ReviewOverlayRange,
  type SelectionRectInfo,
} from './LineNumberTextarea.tsx'
import {
  buildAlignmentModel,
  domRangeToSource,
  injectReviewMarks,
  unwindReviewMarks,
  type AlignmentModel,
  type MarkHandlers,
  type MarkReviewLite,
  type MarkSpec,
  type PreviewSeverity,
} from './preview-marks.ts'
import {
  buildAnchorDraft,
  getDocumentReviews,
  lfOffsetToRaw,
  normalizeContent,
  onReviewChanged,
  validateSelection,
  type CaretProvider,
  type DocumentReviewAnchor,
  type ReviewAnchorDraft,
} from './reviewer-bridge.ts'
import type { NodeMeta } from '../protocol.ts'

/**
 * Navigation params for the Reviewer tab (design/02 §5). The Reviewer plugin
 * owns the canonical augmentation in its own bundle; this structural copy lets
 * the left panel type its openTab() call without importing that plugin.
 */
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'devbuddy-reviewer': {
      view?: string
      projectId?: string
      reviewId?: string
      document?: string
      draftAnchor?: ReviewAnchorDraft
    }
  }
}

/** Card face: collapsed header only, rendered preview, or raw-text editing. */
export type NodeMode = 'closed' | 'preview' | 'edit'

/** Anchor statuses rendered with hollow gutter styling (design/05 §5.2). */
const DRIFTED_ANCHOR_STATUSES = new Set(['moved', 'modified', 'outdated', 'orphaned'])

/** Non-terminal statuses shown in the gutter; mirrors reviewer OPEN_STATUSES. */
const ACTIVE_REVIEW_STATUSES = new Set([
  'open',
  'discussing',
  'needs_review',
  'accepted',
  'implementing',
  'implemented',
  'verifying',
])

/** In-place bubble geometry over the preview surface (design/05 §1). */
const PREVIEW_FAB_GAP = 6
const PREVIEW_FAB_HEIGHT = 24
const PREVIEW_FAB_WIDTH = 108

/**
 * Remove the native selection only when it lives inside the preview root.
 * Called immediately before mark unwrap/inject rebuilds text nodes, so the
 * mutation-induced collapsed selectionchange (rangeCount may still be 1 with
 * its anchor inside root) cannot re-enter capture and clear the pending mark.
 */
function dropRootSelection(root: HTMLElement): void {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (root.contains(range.startContainer)) selection.removeAllRanges()
}

export interface NodeCardLabels {
  preview: string
  /** Header tooltip while open: click to collapse. */
  collapse: string
  edit: string
  save: string
  saved: string
  /** Discard unsaved edits and reset the draft to the saved text. */
  discard: string
  notFound: string
  empty: string
  updated: string
  /** Dirty-dot / preview-banner text while edits are unsaved. */
  unsaved: string
  /** Fence copy-button idle label (forwarded to the Markdown primitive). */
  markdownCopy: string
  /** Fence copy-button confirmation label (forwarded to the Markdown primitive). */
  markdownCopied: string
  /** Footnote section heading (forwarded to the Markdown primitive). */
  markdownFootnotes: string
  /** Gutter pill tooltip; {number} and {id} are replaced at render time. */
  reviewBadgeTitle: string
  /** Gutter pill tooltip suffix when the anchor drifted. */
  reviewBadgeDrifted: string
  /** In-place selection bubble: add a review for the selected text. */
  addReview: string
  /** In-place selection bubble: close button label. */
  closeReview: string
}

export interface NodeCardProps {
  projectId: string
  meta: NodeMeta
  /** Static description from the host node registry; falls back to file name. */
  description?: string
  labels: NodeCardLabels
  /** Right-sidebar navigation face; opens the Reviewer tab on gutter clicks. */
  sidebarRight?: ISidebarRight
  /** Reports card face changes so the parent can broadcast the doc tree. */
  onModeChange?: (nodeId: string, mode: NodeMode) => void
  /** Registers (and unregisters via null) the edit-mode caret resolver. */
  registerCaretProvider?: (nodeId: string, provider: CaretProvider | null) => void
}

function formatTime(iso: string | null): string {
  if (iso === null) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function NodeCard({
  projectId,
  meta,
  description,
  labels,
  sidebarRight,
  onModeChange,
  registerCaretProvider,
}: NodeCardProps) {
  const [mode, setModeState] = useState<NodeMode>('closed')

  /** setMode + upward report, keeping the parent's doc-tree snapshot fresh. */
  const setMode = useCallback((next: NodeMode): void => {
    setModeState(next)
    onModeChange?.(meta.id, next)
  }, [meta.id, onModeChange])
  const [draft, setDraft] = useState('')
  /** Whether the draft was ever seeded; keeps unsaved edits across mode switches. */
  const [draftSeeded, setDraftSeeded] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [sha, setSha] = useState<string | null>(meta.sha)
  const [exists, setExists] = useState(meta.exists)
  const [updatedAt, setUpdatedAt] = useState<string | null>(meta.updatedAt)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Reviewer document projection; empty = no reviews (incl. reviewer absent). */
  const [reviewRows, setReviewRows] = useState<readonly DocumentReviewAnchor[]>([])
  /** Dashed pending selection anchor (raw offsets) + LF offsets for the draft. */
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(null)
  const [pendingLf, setPendingLf] = useState<{ start: number; end: number } | null>(null)

  // --- Preview surface: rendered-markdown wrapper, alignment model, bubble ---
  const previewRef = useRef<HTMLDivElement | null>(null)
  const alignmentRef = useRef<AlignmentModel | null>(null)
  const [previewFab, setPreviewFab] = useState<{ x: number; y: number } | null>(null)

  // --- Edit surface: imperative textarea handle for zero-length caret anchors ---
  const editorRef = useRef<LineNumberTextareaHandle>(null)

  useEffect(() => {
    setSha(meta.sha)
    setExists(meta.exists)
    setUpdatedAt(meta.updatedAt)
  }, [meta.sha, meta.exists, meta.updatedAt])

  /**
   * One gutter pill PER ACTIVE REVIEW at the anchor's first line (design/05
   * §5.2): no per-line aggregation — several pills on one line sit side by
   * side, and each carries its own #N and deep-links its own review.
   */
  const gutterBadges = useMemo((): ReadonlyMap<number, GutterBadgeItem[]> => {
    const byLine = new Map<number, GutterBadgeItem[]>()
    for (const row of reviewRows) {
      if (!ACTIVE_REVIEW_STATUSES.has(row.status)) continue
      if (row.lineStart === null) continue
      const item: GutterBadgeItem = {
        reviewId: row.reviewId,
        number: row.number,
        severity: row.severity,
        drifted: DRIFTED_ANCHOR_STATUSES.has(row.anchorStatus),
      }
      const list = byLine.get(row.lineStart)
      if (list === undefined) byLine.set(row.lineStart, [item])
      else list.push(item)
    }
    return byLine
  }, [reviewRows])

  /**
   * Overlay ranges for committed reviews (design/05 §5.2). Precise
   * matchOffset* paints the exact characters; when the anchor drifted past
   * fuzzy recovery (outdated/orphaned) or offsets are absent, the range
   * degrades to the whole anchor lines. Host offsets are LF-based; map them
   * back onto the textarea's possibly-CRLF raw value.
   */
  const reviewHighlights = useMemo((): ReviewOverlayRange[] => {
    const ranges: ReviewOverlayRange[] = []
    const normalized = normalizeContent(draft)
    const lfLines = normalized.split('\n')
    for (const row of reviewRows) {
      if (!ACTIVE_REVIEW_STATUSES.has(row.status)) continue
      if (row.lineStart === null) continue
      let startLf: number
      let endLf: number
      let lineLevel = false
      if (row.matchOffsetStart !== null && row.matchOffsetEnd !== null
        && row.anchorStatus !== 'outdated' && row.anchorStatus !== 'orphaned') {
        startLf = Math.max(0, Math.min(row.matchOffsetStart, normalized.length))
        endLf = Math.max(startLf, Math.min(row.matchOffsetEnd, normalized.length))
      } else {
        lineLevel = true
        const lineEndNo = row.lineEnd ?? row.lineStart
        const startOffset = lfLines.slice(0, row.lineStart - 1).reduce((n, l) => n + l.length + 1, 0)
        const endLineText = lfLines[lineEndNo - 1] ?? ''
        endLf = startOffset + lfLines
          .slice(row.lineStart - 1, lineEndNo - 1)
          .reduce((n, l) => n + l.length + 1, 0) + endLineText.length
        startLf = startOffset
      }
      ranges.push({
        reviewId: row.reviewId,
        start: lfOffsetToRaw(draft, startLf),
        end: lfOffsetToRaw(draft, Math.max(startLf, endLf)),
        lineLevel,
        severity: row.severity,
        status: row.anchorStatus,
      })
    }
    return ranges
  }, [reviewRows, draft])

  /** Pull the reviewer projection; failure degrades silently to no marks. */
  const refreshReviews = useCallback(async (): Promise<void> => {
    try {
      setReviewRows(await getDocumentReviews(projectId, meta.file))
    } catch {
      setReviewRows([])
    }
  }, [projectId, meta.file])

  // The projection feeds the editor gutter/overlay and the preview marks;
  // pull it in either open mode (marks replay via the layout effect below).
  useEffect(() => {
    if (mode === 'closed') return
    void refreshReviews()
  }, [mode, refreshReviews])

  // Refetch when the reviewer signals a create/remove; the subscription
  // lives for the card's lifetime so an event arriving while collapsed still
  // leaves correct data for the next edit open.
  useEffect(() => onReviewChanged(message => {
    if (message.document === meta.file) void refreshReviews()
  }, projectId), [projectId, meta.file, refreshReviews])

  /**
   * Unsaved edits exist while the draft was seeded (edit entered at least
   * once) and now differs from the last saved text. The draft STARTS as ''
   * and must not count as "edited" before the user ever opens edit mode —
   * otherwise previewing a non-empty file reads as an empty dirty draft.
   */
  const dirty = mode === 'edit' && draftSeeded && draft !== (content ?? '')

  /**
   * Reference-stable Markdown chrome per locale: the primitive discards its
   * streaming render cache when this identity changes, so build it once per
   * label revision.
   */
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: labels.markdownCopy, copiedLabel: labels.markdownCopied },
    footnotes: labels.markdownFootnotes,
  }), [labels.markdownCopy, labels.markdownCopied, labels.markdownFootnotes])

  /** Fetch the node body once; later reads reuse the cached content. */
  async function loadContent(): Promise<string> {
    if (content !== null) return content
    const view = await api.readNode(projectId, meta.id)
    setContent(view.content)
    setSha(view.sha)
    setExists(view.exists)
    return view.content
  }

  /** Collapse chevron: closed opens preview; open collapses the body. */
  async function toggleCollapsed(): Promise<void> {
    if (mode !== 'closed') {
      setMode('closed')
      return
    }
    setMode('preview')
    try {
      await loadContent()
      setStatus(null)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Select the preview segment (always reachable, even while editing).
   * Switching edit → preview AUTO-SAVES the current draft first (user
   * requirement: the transition must persist the file); if the write fails
   * we stay in edit mode so the unsaved text is never dropped.
   */
  async function openPreview(): Promise<void> {
    if (mode === 'preview') return
    if (dirty) {
      const ok = await save()
      if (!ok) return
    }
    setMode('preview')
    if (content === null) {
      try {
        await loadContent()
        setStatus(null)
      } catch (error) {
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /** Select the edit segment; loads the body and seeds the draft. */
  async function startEdit(): Promise<void> {
    if (mode === 'edit') return
    try {
      // Seed the draft only on the first edit entry; preview/edit switching
      // afterwards must preserve unsaved edits.
      if (!draftSeeded) {
        setDraft(content ?? await loadContent())
        setDraftSeeded(true)
      }
      setStatus(null)
      setMode('edit')
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Revert the draft to the saved text without leaving edit mode. */
  function discardDraft(): void {
    setDraft(content ?? '')
    setStatus(null)
  }

  /** Save stays in edit mode — mirroring the file editor's Ctrl+S. Resolves
   *  true on success so the edit→preview switch can gate on the write. */
  async function save(): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.writeNode(projectId, meta.id, { content: draft, expectedSha: sha })
      setContent(draft)
      setSha(result.sha)
      setExists(true)
      setUpdatedAt(new Date().toISOString())
      setStatus({ kind: 'ok', text: labels.saved })
      // Anchors are line-based; the new revision may move or orphan them.
      void refreshReviews()
      return true
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Clear the dashed pending anchor and the in-place bubble. */
  const clearPending = useCallback((): void => {
    setPendingRange(null)
    setPendingLf(null)
  }, [])

  /**
   * A settled non-collapsed selection (design/05 §1/§5.2). The component
   * reports LF offsets; validate against the LF-normalized draft and, when
   * accepted, paint the dashed pending anchor from the raw selection bounds
   * so it survives focus loss until Esc/close/submit.
   */
  const handleSelectionChange = useCallback((info: SelectionRectInfo): void => {
    const normalized = normalizeContent(draft)
    const start = Math.max(0, Math.min(info.lfStart, normalized.length))
    const end = Math.max(start, Math.min(info.lfEnd, normalized.length))
    if (!validateSelection(normalized.slice(start, end))) {
      clearPending()
      return
    }
    setPendingLf({ start, end })
    setPendingRange({ start: lfOffsetToRaw(draft, start), end: lfOffsetToRaw(draft, end) })
  }, [draft, clearPending])

  /** Bubble "add review": hand the anchor draft to the Reviewer composer.
   *  `source` is the surface's current text (editor draft or preview body). */
  const openComposerForPending = useCallback((source: string): void => {
    if (pendingLf === null) return
    const normalized = normalizeContent(source)
    const start = Math.max(0, Math.min(pendingLf.start, normalized.length))
    const end = Math.max(start, Math.min(pendingLf.end, normalized.length))
    try {
      sidebarRight?.openTab('devbuddy-reviewer', {
        params: {
          projectId,
          document: meta.file,
          draftAnchor: buildAnchorDraft(normalized, start, end),
        },
      })
    } catch {
      // Reviewer plugin not registered — the bubble still shows locally.
    }
    clearPending()
  }, [pendingLf, projectId, meta.file, sidebarRight, clearPending])

  const handleAddReview = useCallback((): void => {
    openComposerForPending(draft)
  }, [openComposerForPending, draft])

  // Latest draft for the stable caret resolver (avoids re-registering on
  // every keystroke while the editor is focused).
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  /**
   * Resolver for the Reviewer's quick-action "add comment" button (design/05
   * §2.4 CARET handshake): only the currently FOCUSED edit-mode textarea
   * answers. A non-empty selection anchors the review to that range; a
   * collapsed caret builds a zero-length point anchor. The reviewer's button
   * prevents its own mousedown from stealing focus before this runs.
   */
  const caretProvider = useCallback<CaretProvider>(() => {
    const editor = editorRef.current
    if (editor === null || !editor.isFocused()) return null
    const range = editor.getSelectionRange()
    if (range === null) return null
    const normalized = normalizeContent(draftRef.current)
    const start = Math.max(0, Math.min(range.start, normalized.length))
    const end = Math.max(0, Math.min(range.end, normalized.length))
    return {
      projectId,
      document: meta.file,
      anchor: buildAnchorDraft(normalized, start, end),
    }
  }, [projectId, meta.file])

  // Registered only while this card face is the raw-text editor.
  useEffect(() => {
    if (mode !== 'edit' || registerCaretProvider === undefined) return
    registerCaretProvider(meta.id, caretProvider)
    return () => registerCaretProvider(meta.id, null)
  }, [mode, meta.id, caretProvider, registerCaretProvider])

  /**
   * Gutter pill / inline chip click: deep-link straight to the review's
   * detail record. `document` is deliberately omitted so the reviewer routes
   * to `detail` instead of the raw-md document view (request 14.1).
   */
  const openReviewById = useCallback((reviewId: string): void => {
    try {
      sidebarRight?.openTab('devbuddy-reviewer', {
        params: { projectId, reviewId },
      })
    } catch {
      // Reviewer plugin not registered — the pill still renders its number.
    }
  }, [projectId, sidebarRight])

  const handleGutterReview = useCallback((_line: number, reviewId: string): void => {
    openReviewById(reviewId)
  }, [openReviewById])

  /** Localized pill tooltip, with a drifted suffix when the anchor drifted. */
  const titleForReview = useCallback((number: number, reviewId: string, drifted: boolean): string => {
    const base = labels.reviewBadgeTitle
      .replace('{number}', String(number))
      .replace('{id}', reviewId)
    return drifted ? `${base} · ${labels.reviewBadgeDrifted}` : base
  }, [labels.reviewBadgeTitle, labels.reviewBadgeDrifted])

  const renderBadgeTitle = useCallback((item: GutterBadgeItem): string =>
    titleForReview(item.number, item.reviewId, item.drifted),
  [titleForReview])

  // Preview text: the saved body, or the live draft only once the draft was
  // seeded (edit entered) and differs. The draft STARTS as ''; without the
  // draftSeeded guard, a direct preview of a non-empty file compares ''
  // against the loaded content, renders the empty draft and falsely shows
  // the "unsaved" note plus "file empty" (regression fix).
  const previewUsesDraft = mode === 'preview' && draftSeeded && content !== null && draft !== content
  const previewText = previewUsesDraft ? draft : (content ?? '')
  const previewNormalized = useMemo(() => normalizeContent(previewText), [previewText])
  const previewEmpty = !exists || previewText === ''

  /**
   * Committed review marks in preview coordinates (design/05 §5.1). Precise
   * matchOffset* paints the exact rendered words; outdated/orphaned anchors or
   * missing offsets degrade to a line-level mark via lineStart/lineEnd.
   */
  const previewMarkSpecs = useMemo((): MarkSpec[] => {
    const specs: MarkSpec[] = []
    for (const row of reviewRows) {
      if (!ACTIVE_REVIEW_STATUSES.has(row.status)) continue
      if (row.lineStart === null) continue
      const review: MarkReviewLite = {
        reviewId: row.reviewId,
        number: row.number,
        severity: row.severity as PreviewSeverity,
      }
      const precise = row.matchOffsetStart !== null && row.matchOffsetEnd !== null
        && row.anchorStatus !== 'outdated' && row.anchorStatus !== 'orphaned'
      specs.push({
        start: precise ? Math.max(0, Math.min(row.matchOffsetStart as number, previewNormalized.length)) : null,
        end: precise ? Math.max(0, Math.min(row.matchOffsetEnd as number, previewNormalized.length)) : null,
        lineLevel: !precise,
        lineStart: row.lineStart,
        lineEnd: row.lineEnd ?? row.lineStart,
        anchorStatus: row.anchorStatus,
        reviews: [review],
      })
    }
    return specs
  }, [reviewRows, previewNormalized])

  /** reviewId -> anchor drifted, for inline chip tooltips. */
  const driftedById = useMemo((): ReadonlyMap<string, boolean> => {
    const map = new Map<string, boolean>()
    for (const row of reviewRows) {
      map.set(row.reviewId, DRIFTED_ANCHOR_STATUSES.has(row.anchorStatus))
    }
    return map
  }, [reviewRows])

  // Idempotent mark replay: unwind the previous injection, rebuild the
  // source↔DOM alignment, then inject committed marks. Pending selections are
  // never injected (native selection is the sole selection-stage visual), so
  // pendingLf is intentionally NOT a dependency — selecting text must not
  // re-inject marks or disturb the live native selection.
  // useLayoutEffect runs after the primitive's synchronous settled render so
  // the DOM already carries all top-level blocks.
  const previewMarkHandlers = useMemo<MarkHandlers>(() => ({
    openReview: openReviewById,
    titleFor: review => titleForReview(
      review.number,
      review.reviewId,
      driftedById.get(review.reviewId) ?? false,
    ),
  }), [openReviewById, titleForReview, driftedById])

  useLayoutEffect(() => {
    const root = previewRef.current
    if (root === null || previewEmpty) {
      alignmentRef.current = null
      return
    }
    // Re-wrapping marks rebuilds text nodes under the live DOM Selection (both
    // here and in the cleanup below). Drop any stale native selection first so
    // the rewrap does not fire a phantom collapsed selectionchange. This runs
    // only when committed marks/text change — never during active selection.
    dropRootSelection(root)
    unwindReviewMarks(root)
    const model = buildAlignmentModel(root, previewNormalized)
    alignmentRef.current = model
    injectReviewMarks(model, previewMarkSpecs, previewMarkHandlers)
    return () => {
      // Strip marks before the next replay/unmount; they live outside React.
      if (previewRef.current !== null) {
        dropRootSelection(previewRef.current)
        unwindReviewMarks(previewRef.current)
      }
      alignmentRef.current = null
    }
  }, [previewNormalized, previewEmpty, previewMarkSpecs, previewMarkHandlers])

  // A pending anchor belongs to one surface: preview offsets point at the
  // rendered body, editor offsets at the draft. Switching surfaces clears it.
  useEffect(() => {
    setPreviewFab(null)
    clearPending()
  }, [mode, clearPending])

  /** Capture a rendered-DOM selection and reverse-map it to LF offsets. */
  const capturePreviewSelection = useCallback(() => {
    const root = previewRef.current
    const model = alignmentRef.current
    if (root === null || model === null) return
    const selection = document.getSelection()
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      setPreviewFab(null)
      clearPending()
      return
    }
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      setPreviewFab(null)
      return
    }
    // Never anchor a selection starting inside code / footnotes / math.
    if (range.startContainer.parentElement?.closest('.md-code-block, section.footnotes, .katex')) {
      setPreviewFab(null)
      return
    }
    const mapped = domRangeToSource(model, range)
    if (mapped === null || !validateSelection(previewNormalized.slice(mapped.start, mapped.end))) {
      setPreviewFab(null)
      clearPending()
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const box = root.getBoundingClientRect()
    const above = rect.top - box.top - PREVIEW_FAB_GAP - PREVIEW_FAB_HEIGHT >= 0
    const x = Math.max(0,
      rect.left - box.left + rect.width / 2 - PREVIEW_FAB_WIDTH / 2)
    const y = above
      ? rect.top - box.top - PREVIEW_FAB_GAP - PREVIEW_FAB_HEIGHT
      : rect.bottom - box.top + PREVIEW_FAB_GAP
    // Equality bails: on engines where the selection survives mark rewrapping,
    // the trailing selectionchange would re-capture the same range and re-run
    // the inject effect forever. Skip state writes when nothing moved.
    if (pendingLf === null || pendingLf.start !== mapped.start || pendingLf.end !== mapped.end) {
      setPendingLf({ start: mapped.start, end: mapped.end })
      setPendingRange(null)
    }
    setPreviewFab(prev =>
      prev !== null && prev.x === x && prev.y === y ? prev : { x, y })
  }, [previewNormalized, clearPending, pendingLf])

  // Debounced selection capture on the preview surface.
  useEffect(() => {
    if (mode !== 'preview' || previewEmpty) return
    const maybeRoot = previewRef.current
    if (maybeRoot === null) return
    const rootEl: HTMLDivElement = maybeRoot
    let timer: ReturnType<typeof setTimeout> | null = null
    function schedule(): void {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(capturePreviewSelection, 200)
    }
    function onDocSelectionChange(): void {
      const selection = document.getSelection()
      if (selection !== null && selection.rangeCount > 0
        && rootEl.contains(selection.getRangeAt(0).startContainer)) {
        schedule()
      }
    }
    document.addEventListener('selectionchange', onDocSelectionChange)
    rootEl.addEventListener('mouseup', schedule)
    rootEl.addEventListener('keyup', schedule)
    return () => {
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('selectionchange', onDocSelectionChange)
      rootEl.removeEventListener('mouseup', schedule)
      rootEl.removeEventListener('keyup', schedule)
    }
  }, [mode, previewEmpty, capturePreviewSelection])

  // Scroll / Escape dismisses the preview bubble; focus loss does not.
  useEffect(() => {
    if (previewFab === null) return
    function onScroll(): void {
      setPreviewFab(null)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setPreviewFab(null)
        clearPending()
      }
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [previewFab, clearPending])

  return (
    <section className="dbl-node">
      {/* Whole header toggles collapse/expand; the actions cluster stops
          propagation so 预览/编辑/放弃/保存 never collapse the card. */}
      <div
        className="dbl-node-head"
        role="button"
        tabIndex={0}
        aria-expanded={mode !== 'closed'}
        title={mode === 'closed' ? labels.preview : labels.collapse}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={() => { void toggleCollapsed() }}
        // eslint-disable-next-line react/jsx-no-bind
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            void toggleCollapsed()
          }
        }}
      >
        <div className="dbl-node-title">
          <span className="dbl-dot" data-state={exists ? 'present' : 'missing'} title={exists ? labels.updated : labels.notFound} />
          <span>{meta.title}</span>
          <span className="dbl-node-meta">{meta.file}</span>
        </div>
        <div
          className="dbl-node-actions"
          // eslint-disable-next-line react/jsx-no-bind
          onClick={event => event.stopPropagation()}
          // eslint-disable-next-line react/jsx-no-bind
          onKeyDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            className="dbl-collapse-btn"
            title={mode === 'closed' ? labels.preview : labels.collapse}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void toggleCollapsed() }}
          >
            {mode === 'closed' ? '▸' : '▾'}
          </button>
          <div className="dbl-mode" role="tablist" aria-label={meta.title}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'preview'}
              className="dbl-mode-btn"
              data-active={mode === 'preview'}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void openPreview() }}
            >
              {labels.preview}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'edit'}
              className="dbl-mode-btn"
              data-active={mode === 'edit'}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void startEdit() }}
            >
              {labels.edit}
            </button>
          </div>
          {mode === 'edit' && dirty && (
            <span className="dbl-dirty-dot" title={labels.unsaved} aria-label={labels.unsaved} />
          )}
          {mode === 'edit' && dirty && (
            <button type="button" className="dbl-linkbtn" onClick={discardDraft} disabled={busy}>
              {labels.discard}
            </button>
          )}
          {mode === 'edit' && (
            <button type="button" className="dbl-linkbtn dbl-save-btn" onClick={() => { void save() }} disabled={busy}>
              {labels.save}
            </button>
          )}
        </div>
      </div>

      {/* Description + last-updated only summarize the card while collapsed;
          in preview/edit the body already shows the content, so hide both. */}
      {mode === 'closed' && description !== undefined && (
        <div className="dbl-node-desc">{description}</div>
      )}
      {mode === 'closed' && updatedAt !== null && (
        <div className="dbl-node-meta">{labels.updated}: {formatTime(updatedAt)}</div>
      )}

      {mode === 'preview' && (
        <div ref={previewRef} className="dbl-node-md" data-empty={previewEmpty}>
          {previewUsesDraft && (
            <div className="dbl-node-md-note">{labels.unsaved}</div>
          )}
          {previewEmpty
            ? (!exists ? labels.notFound : labels.empty)
            : <MarkdownText text={previewText} labels={markdownLabels} />}
          {previewFab !== null && pendingLf !== null && (
            <div className="dbl-rv-fab dbl-rv-fab-preview" style={{ left: previewFab.x, top: previewFab.y }}>
              <button
                type="button"
                className="dbl-rv-fab-main"
                onMouseDown={event => event.preventDefault()}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => openComposerForPending(previewText)}
              >
                {labels.addReview}
              </button>
              <button
                type="button"
                className="dbl-rv-fab-x"
                aria-label={labels.closeReview}
                title={labels.closeReview}
                onMouseDown={event => event.preventDefault()}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => {
                  setPreviewFab(null)
                  clearPending()
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
      {mode === 'edit' && (
        <LineNumberTextarea
          ref={editorRef}
          value={draft}
          onChange={setDraft}
          reviewBadges={gutterBadges}
          reviewHighlights={reviewHighlights}
          pendingRange={pendingRange}
          onSelectionChange={handleSelectionChange}
          onSelectionClear={clearPending}
          onAddReview={handleAddReview}
          onCloseReviewPop={clearPending}
          onGutterReview={handleGutterReview}
          badgeTitle={renderBadgeTitle}
          addReviewLabel={labels.addReview}
          closeLabel={labels.closeReview}
        />
      )}
      {status !== null && <div className="dbl-status" data-kind={status.kind}>{status.text}</div>}
    </section>
  )
}
