/**
 * One workflow node card: status dot, file target, and a rich-text/source
 * dual-surface editing flow.
 *
 * The header chrome mirrors the sidebar file editor (dsh-better-sidebar
 * EditorHost):
 *   - a collapse chevron on the left;
 *   - a segmented [富文本 | 源码] toggle that is ALWAYS visible, so while
 *     editing in either surface you can switch over to the other (and back)
 *     without losing either draft — the active segment is highlighted
 *     exactly like the editor's mode buttons;
 *   - an amber dirty dot marks unsaved edits;
 *   - a file-diff ICON SWITCH sits next to the mode segments; pressed, the
 *     editing surface is replaced in place by a read-only single-column
 *     unified diff (DiffView — red '-' removed / green '+' added lines
 *     painted on the document itself, not a two-column comparison);
 *     pressing it again (or 保存/放弃, or clicking a mode segment) returns
 *     to the editor; switching between the two editing surfaces does NOT
 *     auto-save (both hold the shared draft); a failed write keeps the card
 *     in the editing mode so the unsaved text is never dropped; discarding
 *     just resets the draft to the saved text.
 *   - closing the tab/window while dirty auto-saves out of band
 *     (pagehide/beforeunload → sendBeacon/keepalive POST), so unsaved edits
 *     still reach disk when the web page goes away.
 *
 * Rich-text (richtext) surface: a Tiptap WYSIWYG Markdown editor
 * (`RichTextEditor`) that round-trips through `@tiptap/markdown`. The draft
 * is the single source of truth — both surfaces read/write the same React
 * state, so switching cannot drop text. Review marks are painted through the
 * ProseMirror Decorations API (see rich-text-review-marks.ts).
 *
 * Source surface: `LineNumberTextarea` with a CodeMirror-style gutter,
 * committed-review overlays, and a per-line #N gutter pill. Zero changes from
 * the previous edit surface — just renamed from `edit` to `source`.
 *
 * Reviewer integration (design/05 §2.4 CARET handshake): each surface
 * registers its own caret provider; only the currently FOCUSED surface
 * answers. The provider builds an anchor draft from the LF-normalized draft
 * selection, so the Reviewer's quick-action "add comment" button works in
 * both surfaces.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  RichTextEditor,
  type RichTextEditorHandle,
  type RichTextToolbarLabels,
} from './RichTextEditor.tsx'
import { DiffView, type DiffViewLabels } from './DiffView.tsx'
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
    'devreviewer': {
      view?: string
      projectId?: string
      reviewId?: string
      document?: string
      draftAnchor?: ReviewAnchorDraft
    }
  }
}

/** Card face: collapsed header only, WYSIWYG rich-text, or raw-text source. */
export type NodeMode = 'closed' | 'richtext' | 'source'

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

export interface NodeCardLabels {
  richtext: string
  /** Header tooltip while open: click to collapse. */
  collapse: string
  source: string
  save: string
  saved: string
  /** Discard unsaved edits and reset the draft to the saved text. */
  discard: string
  /** Tooltip of the diff icon switch; toggles the inline saved-vs-draft view. */
  diff: string
  /** Copy for the inline saved-vs-draft view. */
  diffView: DiffViewLabels
  notFound: string
  empty: string
  updated: string
  /** Dirty-dot text while edits are unsaved. */
  unsaved: string
  /** Gutter pill tooltip; {number} and {id} are replaced at render time. */
  reviewBadgeTitle: string
  /** Gutter pill tooltip suffix when the anchor drifted. */
  reviewBadgeDrifted: string
  /** In-place selection bubble: add a review for the selected text. */
  addReview: string
  /** In-place selection bubble: close button label. */
  closeReview: string
  /** Section fold chevron tooltip / collapsed-region placeholder. */
  foldSection: string
  unfoldSection: string
  foldedLines: string
  /** Rich-text surface formatting toolbar copy. */
  toolbar: RichTextToolbarLabels
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
  onModeChange?: (projectId: string, nodeId: string, mode: NodeMode) => void
  /** Registers (and unregisters via null) the edit-mode caret resolver. */
  registerCaretProvider?: (projectId: string, nodeId: string, provider: CaretProvider | null) => void
  /**
   * Registers (and unregisters via null) an auto-save handle invoked by the
   * parent right before a project switch, so unsaved edits reach disk.
   */
  registerSaveHandle?: (projectId: string, nodeId: string, handle: (() => Promise<void>) | null) => void
}

function formatTime(iso: string | null): string {
  if (iso === null) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/**
 * File-diff glyph for the header switch: a document outline with a '+' mark
 * and a '-' mark on it (monochrome currentColor; the actual red/green only
 * appears in the inline diff rows).
 */
function DiffIcon(): JSX.Element {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 1.8H4.2A1.2 1.2 0 0 0 3 3v10a1.2 1.2 0 0 0 1.2 1.2h7.6A1.2 1.2 0 0 0 13 13V5.3L9.5 1.8z" />
      <path d="M9.5 1.8v3.5H13" />
      <path d="M5.5 9.2h2.2M6.6 8.1v2.2" />
      <path d="M9.4 11.7h2.2" />
    </svg>
  )
}

export function NodeCard({
  projectId,
  meta,
  description,
  labels,
  sidebarRight,
  onModeChange,
  registerCaretProvider,
  registerSaveHandle,
}: NodeCardProps) {
  const [mode, setModeState] = useState<NodeMode>('closed')

  /** setMode + upward report, keeping the parent's doc-tree snapshot fresh. */
  const setMode = useCallback((next: NodeMode): void => {
    setModeState(next)
    onModeChange?.(projectId, meta.id, next)
  }, [projectId, meta.id, onModeChange])
  const [draft, setDraft] = useState('')
  /** Whether the draft was ever seeded; keeps unsaved edits across mode switches. */
  const [draftSeeded, setDraftSeeded] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [sha, setSha] = useState<string | null>(meta.sha)
  const [exists, setExists] = useState(meta.exists)
  const [updatedAt, setUpdatedAt] = useState<string | null>(meta.updatedAt)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Folded section keys (heading `<level>:<text>`, shared by both surfaces).
   * View-only state: it never alters the draft, and survives richtext↔source
   * switches because it lives above both editors.
   */
  const [foldedKeys, setFoldedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const toggleFold = useCallback((key: string): void => {
    setFoldedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  /** Whether the inline saved-vs-draft view replaces the editing surface. */
  const [diffOn, setDiffOn] = useState(false)
  /** Reviewer document projection; empty = no reviews (incl. reviewer absent). */
  const [reviewRows, setReviewRows] = useState<readonly DocumentReviewAnchor[]>([])
  /** Dashed pending selection anchor (raw offsets) + LF offsets for the draft. */
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(null)
  const [pendingLf, setPendingLf] = useState<{ start: number; end: number } | null>(null)
  /** LF offset saved before a mode switch so the target surface can restore it. */
  const [savedCaret, setSavedCaret] = useState<number | null>(null)

  // --- Source surface: imperative textarea handle for zero-length caret anchors ---
  const sourceEditorRef = useRef<LineNumberTextareaHandle>(null)
  // --- Rich-text surface: imperative WYSIWYG handle ---
  const rtEditorRef = useRef<RichTextEditorHandle>(null)

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
   * Overlay ranges for committed reviews on the SOURCE surface (design/05
   * §5.2). Precise matchOffset* paints the exact characters; when the anchor
   * drifted past fuzzy recovery (outdated/orphaned) or offsets are absent, the
   * range degrades to the whole anchor lines. Host offsets are LF-based; map
   * them back onto the textarea's possibly-CRLF raw value.
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

  // The projection feeds the editor gutter/overlay and the rich-text marks;
  // pull it in either open mode (marks replay via the alignment model).
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
   * Unsaved edits exist while the draft was seeded (an editing surface was
   * entered at least once) and now differs from the last saved text. The
   * draft STARTS as '' and must not count as "edited" before the user ever
   * opens an editing surface — otherwise a non-empty file would read as an
   * empty dirty draft.
   */
  const dirty = (mode === 'richtext' || mode === 'source') && draftSeeded && draft !== (content ?? '')

  // Once there is nothing to diff (saved / discarded / collapsed) the inline
  // view closes itself — the switch must never stay latched with no changes.
  useEffect(() => {
    if (!dirty) setDiffOn(false)
  }, [dirty])

  /** Fetch the node body once; later reads reuse the cached content. */
  async function loadContent(): Promise<string> {
    if (content !== null) return content
    const view = await api.readNode(projectId, meta.id)
    setContent(view.content)
    setSha(view.sha)
    setExists(view.exists)
    return view.content
  }

  /** Collapse chevron: closed opens rich-text; open collapses the body. */
  async function toggleCollapsed(): Promise<void> {
    if (mode !== 'closed') {
      setMode('closed')
      return
    }
    // Closed → open must seed the draft exactly like the segment buttons do,
    // otherwise the WYSIWYG editor mounts against the still-empty initial
    // draft and renders a blank body (bug: header expand was blank while the
    // 富文本/源码 buttons opened content fine).
    await startEdit('richtext')
  }

  /**
   * Enter an editing surface (rich-text or source). Loads the body on first
   * entry and seeds the shared draft; subsequent surface switches preserve
   * unsaved edits. Richtext↔source switching does NOT auto-save — both
   * surfaces hold the same draft in React state.
   */
  async function startEdit(target: 'richtext' | 'source'): Promise<void> {
    // Any segment click exits the inline diff view (including clicking the
    // active segment — a natural way back to the editor).
    setDiffOn(false)
    if (mode === target) return
    try {
      // Seed the draft only on the first edit entry; richtext/source switching
      // afterwards must preserve unsaved edits.
      if (!draftSeeded) {
        setDraft(content ?? await loadContent())
        setDraftSeeded(true)
      }
      // Save the current caret (LF offset) so the target surface can restore
      // it after mount — prevents the cursor from jumping to the top of the
      // document on every mode switch in long content.
      if (mode === 'richtext') {
        const range = rtEditorRef.current?.getSelectionRange() ?? null
        setSavedCaret(range !== null ? range.start : null)
      } else if (mode === 'source') {
        const range = sourceEditorRef.current?.getSelectionRange() ?? null
        setSavedCaret(range !== null ? range.start : null)
      } else {
        setSavedCaret(null)
      }
      setStatus(null)
      setMode(target)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Revert the draft to the saved text without leaving the editing surface. */
  function discardDraft(): void {
    setDraft(content ?? '')
    setStatus(null)
  }

  /** Save stays in the editing surface — mirroring the file editor's Ctrl+S. */
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
   * A settled non-collapsed selection (design/05 §1/§5.2). The surface
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
   *  `source` is the surface's current text (the draft, shared by both). */
  const openComposerForPending = useCallback((source: string): void => {
    if (pendingLf === null) return
    const normalized = normalizeContent(source)
    const start = Math.max(0, Math.min(pendingLf.start, normalized.length))
    const end = Math.max(start, Math.min(pendingLf.end, normalized.length))
    try {
      sidebarRight?.openTab('devreviewer', {
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
   * §2.4 CARET handshake): only the currently FOCUSED editing surface answers.
   * A non-empty selection anchors the review to that range; a collapsed caret
   * builds a zero-length point anchor. The reviewer's button prevents its own
   * mousedown from stealing focus before this runs.
   */
  const caretProviderSource = useCallback<CaretProvider>(() => {
    const editor = sourceEditorRef.current
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

  const caretProviderRichtext = useCallback<CaretProvider>(() => {
    const editor = rtEditorRef.current
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

  // Each surface registers its caret provider only while it is the active face.
  useEffect(() => {
    if (mode !== 'source' || registerCaretProvider === undefined) return
    registerCaretProvider(projectId, meta.id, caretProviderSource)
    return () => registerCaretProvider(projectId, meta.id, null)
  }, [projectId, mode, meta.id, caretProviderSource, registerCaretProvider])

  useEffect(() => {
    if (mode !== 'richtext' || registerCaretProvider === undefined) return
    registerCaretProvider(projectId, meta.id, caretProviderRichtext)
    return () => registerCaretProvider(projectId, meta.id, null)
  }, [projectId, mode, meta.id, caretProviderRichtext, registerCaretProvider])

  // A pending anchor belongs to one surface. Switching surfaces clears it.
  useEffect(() => {
    clearPending()
  }, [mode, clearPending])

  /**
   * Gutter pill / inline chip click: deep-link straight to the review's
   * detail record. `document` is deliberately omitted so the reviewer routes
   * to `detail` instead of the raw-md document view (request 14.1).
   */
  const openReviewById = useCallback((reviewId: string): void => {
    try {
      sidebarRight?.openTab('devreviewer', {
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

  const editing = mode === 'richtext' || mode === 'source'

  // --- Ctrl/Cmd+S shortcut ------------------------------------------------
  // In web DSH the browser would open its "save webpage" dialog. Intercept
  // the keystroke at window capture phase while this card is open, and only
  // the card whose surface actually owns focus (event target inside this
  // section) answers: preventDefault + call save(). Refs hold the latest
  // save/dirty so the listener can be bound once per open/close instead of
  // re-binding on every keystroke and reading stale closures.
  const cardRootRef = useRef<HTMLElement | null>(null)
  const headRef = useRef<HTMLDivElement | null>(null)
  const saveFnRef = useRef<() => Promise<boolean>>(save)
  const dirtyRef = useRef(dirty)
  saveFnRef.current = save
  dirtyRef.current = dirty

  useEffect(() => {
    if (mode === 'closed') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 's' || event.altKey) return
      const root = cardRootRef.current
      const target = event.target
      if (root === null || !(target instanceof Node) || !root.contains(target)) return
      // Always suppress the browser save-page dialog while focus is on this
      // card, even when there is nothing new to write.
      event.preventDefault()
      event.stopPropagation()
      if (dirtyRef.current) void saveFnRef.current()
    }
    // Capture phase: win before editor/Tiptap handlers so the intercept wins.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [mode])

  // Register an auto-save-on-switch handle with the parent. The parent
  // awaits the outgoing project's handles before the active project changes;
  // the handle saves only while this card is dirty. Placed after saveFnRef /
  // dirtyRef (the Ctrl+S effect above), which it reuses.
  useEffect(() => {
    if (registerSaveHandle === undefined) return
    const handle = async (): Promise<void> => {
      if (!dirtyRef.current) return
      await saveFnRef.current()
    }
    registerSaveHandle(projectId, meta.id, handle)
    return () => registerSaveHandle(projectId, meta.id, null)
  }, [projectId, meta.id, registerSaveHandle])

  // Latest on-disk sha for the out-of-band flush (save() updates it after write).
  const shaRef = useRef(sha)
  useEffect(() => { shaRef.current = sha }, [sha])

  /**
   * Unsaved edits independent of card face: a card can be COLLAPSED while
   * still holding a dirty draft (collapsing never auto-saves). The unload
   * flush below must answer in that state too, so unlike the UI `dirty`
   * flag this is not gated on richtext/source mode.
   */
  const hasUnsavedEdits = draftSeeded && draft !== (content ?? '')
  const unsavedRef = useRef(hasUnsavedEdits)
  useEffect(() => { unsavedRef.current = hasUnsavedEdits }, [hasUnsavedEdits])

  /**
   * Auto-save when the web page goes away with unsaved edits. `pagehide`
   * (desktop close AND mobile/bfcache teardown) and `beforeunload` (legacy
   * desktop) both fire an out-of-band POST via sendBeacon/keepalive — the
   * handler cannot await a promise. The fired flag suppresses a duplicate
   * write when both events fire for one close; it rearms on every draft
   * change (a bfcache-restored page may be edited and closed again).
   */
  const flushFiredRef = useRef(false)
  useEffect(() => {
    const flush = (): void => {
      if (flushFiredRef.current || !unsavedRef.current) return
      flushFiredRef.current = true
      api.writeNodeBeacon(projectId, meta.id, {
        content: draftRef.current,
        expectedSha: shaRef.current,
      })
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [projectId, meta.id])

  // Re-arm the unload flush whenever the draft changed after a prior flush.
  useEffect(() => {
    flushFiredRef.current = false
  }, [draft])

  // Keep --dbl-head-h (the sticky offset for the rich-text toolbar, see
  // .dbl-rt-toolbar in styles.ts) in sync with the header's real height —
  // it wraps to two rows when the sidebar is narrow or save/discard appear.
  useEffect(() => {
    const head = headRef.current
    const root = cardRootRef.current
    if (head === null || root === null) return
    const update = (): void => {
      root.style.setProperty('--dbl-head-h', `${head.offsetHeight}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(head)
    return () => { observer.disconnect() }
  }, [])

  return (
    <section ref={cardRootRef} className="dbl-node">
      {/* Whole header toggles collapse/expand; the actions cluster stops
          propagation so 富文本/源码/差异/放弃/保存 never collapse the card. */}
      <div
        ref={headRef}
        className="dbl-node-head"
        role="button"
        tabIndex={0}
        aria-expanded={mode !== 'closed'}
        title={mode === 'closed' ? labels.richtext : labels.collapse}
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
            title={mode === 'closed' ? labels.richtext : labels.collapse}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void toggleCollapsed() }}
          >
            {mode === 'closed' ? '▸' : '▾'}
          </button>
          <div className="dbl-mode" role="tablist" aria-label={meta.title}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'richtext'}
              className="dbl-mode-btn"
              data-active={mode === 'richtext'}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void startEdit('richtext') }}
            >
              {labels.richtext}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'source'}
              className="dbl-mode-btn"
              data-active={mode === 'source'}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void startEdit('source') }}
            >
              {labels.source}
            </button>
          </div>
          {editing && dirty && (
            <span className="dbl-dirty-dot" title={labels.unsaved} aria-label={labels.unsaved} />
          )}
          {editing && (
            <button
              type="button"
              className="dbl-diff-toggle"
              title={labels.diff}
              aria-label={labels.diff}
              aria-pressed={diffOn}
              data-active={diffOn}
              disabled={busy || !dirty}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => setDiffOn(value => !value)}
            >
              <DiffIcon />
            </button>
          )}
          {editing && dirty && (
            <button type="button" className="dbl-linkbtn" onClick={discardDraft} disabled={busy}>
              {labels.discard}
            </button>
          )}
          {editing && (
            <button type="button" className="dbl-linkbtn dbl-save-btn" onClick={() => { void save() }} disabled={busy}>
              {labels.save}
            </button>
          )}
        </div>
      </div>

      {/* Description + last-updated only summarize the card while collapsed;
          in richtext/source the body already shows the content, so hide both. */}
      {mode === 'closed' && description !== undefined && (
        <div className="dbl-node-desc">{description}</div>
      )}
      {mode === 'closed' && updatedAt !== null && (
        <div className="dbl-node-meta">{labels.updated}: {formatTime(updatedAt)}</div>
      )}

      {/* The diff switch swaps the editing surface for a read-only unified
          view rendered on the same document column; switching it off mounts
          the previous surface (mode is preserved). */}
      {diffOn ? (
        <DiffView savedText={content ?? ''} draftText={draft} labels={labels.diffView} />
      ) : (
        <>
          {mode === 'richtext' && (
            <RichTextEditor
              ref={rtEditorRef}
              projectId={projectId}
              documentName={meta.file}
              value={draft}
              onChange={setDraft}
              reviewRows={reviewRows}
              onSelectionChange={handleSelectionChange}
              onSelectionClear={clearPending}
              onAddReview={handleAddReview}
              onCloseReviewPop={clearPending}
              onOpenReview={openReviewById}
              badgeTitle={renderBadgeTitle}
              addReviewLabel={labels.addReview}
              closeLabel={labels.closeReview}
              foldedKeys={foldedKeys}
              onToggleFold={toggleFold}
              foldLabel={labels.foldSection}
              unfoldLabel={labels.unfoldSection}
              toolbarLabels={labels.toolbar}
              restoreCaret={savedCaret}
            />
          )}
          {mode === 'source' && (
            <LineNumberTextarea
              ref={sourceEditorRef}
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
              foldedKeys={foldedKeys}
              onToggleFold={toggleFold}
              foldLabel={labels.foldSection}
              unfoldLabel={labels.unfoldSection}
              foldedLabel={labels.foldedLines}
              restoreCaret={savedCaret}
            />
          )}
        </>
      )}
      {status !== null && <div className="dbl-status" data-kind={status.kind}>{status.text}</div>}
    </section>
  )
}
