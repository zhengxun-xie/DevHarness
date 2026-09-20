/**
 * WYSIWYG Markdown editor for the rich-text surface of a NodeCard.
 *
 * Built on Tiptap v3 (`@tiptap/react` + `useEditor`) with the official
 * `@tiptap/markdown` extension for GFM round-trip, plus the local
 * `ReviewMarksExtension` that paints reviewer marks through the ProseMirror
 * Decorations API. The editor's truth source is the parent's `draft` string
 * (Markdown); this component is a controlled editor that serializes
 * `editor.getMarkdown()` back to `onChange` (debounced) and re-parses when the
 * parent pushes a new `value` (discard / save / source-mode switch).
 *
 * Value↔editor two-way sync (the one real footgun):
 *   - Internal→external (user typing): `on('update')` → debounce 150ms →
 *     `editor.getMarkdown()` → `onChange(md)`. `lastEmittedRef` records the
 *     emitted string so the external→internal effect can tell a programmatic
 *     re-sync from a round-trip echo.
 *   - External→internal (discard / source switch / parent save): when
 *     `props.value !== lastEmittedRef.current`, call
 *     `editor.commands.setContent(value, { contentType: 'markdown' })`. A
 *     `suppressEmit` guard is held true around the call so the transaction's
 *     synchronous `update` event does not re-enter the emitter and ping-pong.
 *
 * Review marks lifecycle:
 *   - `editor.on('create' | 'update')` (debounced) → `refreshReviewMarksModel`
 *     rebuilds the LF↔PM alignment model from the live Markdown + PM doc and
 *     dispatches a `bump` meta so the decorations plugin re-runs.
 *   - `reviewRows` / `handlers` prop changes → `setReviewRows` /
 *     `setReviewHandlers` update the extension storage and bump.
 *
 * Selection → add-review bubble:
 *   - `editor.on('selectionUpdate')` (debounced 200ms) reads the PM selection,
 *     reverse-maps it to LF offsets via `pmPosToLf`, validates the slice, and
 *     positions a `dbl-rv-fab` bubble over the selection. Selections inside
 *     codeBlock, IME composition, and collapsed carets are skipped.
 *   - The bubble reuses the existing `dbl-rv-fab` styles; its "add review"
 *     action hands off to the parent's `onAddReview` (which opens the
 *     Reviewer composer with the pending anchor).
 *
 * `immediatelyRender: false` keeps the editor from rendering during React 18
 * StrictMode's first mount pass; `useEditor` returns `null` until the effect
 * commits, which is the documented React 18 + StrictMode pattern.
 */
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { ChainedCommands } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TableCell, TableHeader, TableRow, Table } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'

import {
  pmPosToLf,
  type MarkHandlers,
} from './doc-alignment.ts'
import {
  ReviewMarksExtension,
  refreshReviewMarksModel,
  setReviewHandlers,
  setReviewRows,
} from './rich-text-review-marks.ts'
import {
  normalizeContent,
  validateSelection,
  type DocumentReviewAnchor,
} from './reviewer-bridge.ts'
import type { GutterBadgeItem, SelectionRectInfo } from './LineNumberTextarea.tsx'

/** Toolbar tooltip + prompt text, localized by the parent. */
export interface RichTextToolbarLabels {
  paragraph: string
  bold: string
  italic: string
  strike: string
  code: string
  bulletList: string
  orderedList: string
  taskList: string
  blockquote: string
  codeBlock: string
  link: string
  unlink: string
  linkPrompt: string
  table: string
  undo: string
  redo: string
}

export interface RichTextEditorProps {
  /** Markdown draft — the single source of truth (mirrors LineNumberTextarea). */
  value: string
  /** Emitted with `editor.getMarkdown()` (debounced) on user edits. */
  onChange: (next: string) => void
  /** Reviewer projection for the current document; drives inline marks. */
  reviewRows: readonly DocumentReviewAnchor[]
  /** Non-collapsed settled selection, LF offsets, for the add-review bubble. */
  onSelectionChange: (info: SelectionRectInfo) => void
  /** Selection collapsed / left the editor surface. */
  onSelectionClear: () => void
  /** "Add review" action on the in-place selection bubble. */
  onAddReview: () => void
  /** Escape / scroll / close-glyph while the bubble is visible. */
  onCloseReviewPop: () => void
  /** Chip / pill click deep-link to the reviewer detail record. */
  onOpenReview: (reviewId: string) => void
  /** Localized accessible tooltip for a gutter pill. */
  badgeTitle: (item: GutterBadgeItem) => string
  /** Bubble copy. */
  addReviewLabel: string
  closeLabel: string
  /** Toolbar tooltips / link prompt copy. */
  toolbarLabels: RichTextToolbarLabels
}

export interface RichTextEditorHandle {
  /** True when this editor's ProseMirror view currently owns document focus. */
  isFocused(): boolean
  /**
   * Current selection as LF-normalized half-open offsets. A collapsed caret
   * returns start === end (a point anchor); a non-empty selection returns the
   * full range so the cross-barrier quick action can comment on it.
   * Returns null when the editor is unfocused, composing, or the doc↔LF
   * alignment cannot resolve the current selection.
   */
  getSelectionRange(): { start: number; end: number } | null
}

/** Debounce window for editor.getMarkdown() → onChange. */
const EMIT_DEBOUNCE_MS = 150
/** Debounce window for rebuilding the LF↔PM alignment model after doc edits. */
const MODEL_DEBOUNCE_MS = 120
/** Debounce window for the selection → bubble capture. */
const SELECTION_DEBOUNCE_MS = 200

/** Bubble geometry constants — mirror the preview surface (NodeCard). */
const FAB_GAP = 6
const FAB_HEIGHT = 24
const FAB_WIDTH = 108

interface ToolButtonSpec {
  key: string
  title: string
  glyph: ReactNode
  active: boolean
  disabled: boolean
  onClick: () => void
}

/**
 * Persistent formatting toolbar for the rich-text surface. Compact single
 * row sized for the narrow sidebar: block-type select (正文/H1-H3) +
 * bold/italic/strike/code + bullet/ordered/task list + quote/code-block +
 * link/table + undo/redo. Each command runs on `editor.chain().focus()` so
 * clicking a button returns focus to the editor and restores its selection.
 * The parent re-renders the editor on every transaction (tick state), so
 * `isActive` states and undo availability stay current.
 */
function RichTextToolbar({ editor, labels }: {
  editor: Editor
  labels: RichTextToolbarLabels
}): ReactNode {
  const chain = (): ChainedCommands => editor.chain().focus()

  const blockValue = editor.isActive('heading', { level: 1 }) ? 'h1'
    : editor.isActive('heading', { level: 2 }) ? 'h2'
      : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'

  const onBlockChange = (next: string): void => {
    if (next === 'p') { chain().setParagraph().run(); return }
    chain().toggleHeading({ level: Number(next.slice(1)) as 1 | 2 | 3 }).run()
  }

  const onLink = (): void => {
    if (editor.isActive('link')) { chain().unsetLink().run(); return }
    const url = window.prompt(labels.linkPrompt, 'https://')
    if (url === null) return
    const href = url.trim()
    if (href === '') return
    chain().setLink({ href }).run()
  }

  const button = (
    key: string,
    title: string,
    glyph: ReactNode,
    active: boolean,
    onClick: () => void,
    disabled = false,
  ): ToolButtonSpec => ({ key, title, glyph, active, disabled, onClick })

  const groups: ToolButtonSpec[][] = [
    [
      button('bold', labels.bold, <span className="dbl-rt-g dbl-rt-g-bold">B</span>,
        editor.isActive('bold'), () => chain().toggleBold().run()),
      button('italic', labels.italic, <span className="dbl-rt-g dbl-rt-g-italic">I</span>,
        editor.isActive('italic'), () => chain().toggleItalic().run()),
      button('strike', labels.strike, <span className="dbl-rt-g dbl-rt-g-strike">S</span>,
        editor.isActive('strike'), () => chain().toggleStrike().run()),
      button('code', labels.code, <span className="dbl-rt-g dbl-rt-g-code">{'</>'}</span>,
        editor.isActive('code'), () => chain().toggleCode().run()),
    ],
    [
      button('bullet', labels.bulletList, '●', editor.isActive('bulletList'),
        () => chain().toggleBulletList().run()),
      button('ordered', labels.orderedList, '1.', editor.isActive('orderedList'),
        () => chain().toggleOrderedList().run()),
      button('task', labels.taskList, '✓', editor.isActive('taskList'),
        () => chain().toggleTaskList().run()),
      button('quote', labels.blockquote, '❝', editor.isActive('blockquote'),
        () => chain().toggleBlockquote().run()),
      button('codeblock', labels.codeBlock, '{}', editor.isActive('codeBlock'),
        () => chain().toggleCodeBlock().run()),
    ],
    [
      button('link', editor.isActive('link') ? labels.unlink : labels.link, '↗',
        editor.isActive('link'), onLink),
      button('table', labels.table, '▦', false,
        () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
    ],
    [
      button('undo', labels.undo, '↶', false, () => chain().undo().run(),
        !editor.can().undo()),
      button('redo', labels.redo, '↷', false, () => chain().redo().run(),
        !editor.can().redo()),
    ],
  ]

  return (
    <div className="dbl-rt-toolbar" role="toolbar">
      <select
        className="dbl-rt-tselect"
        value={blockValue}
        aria-label={labels.paragraph}
        // eslint-disable-next-line react/jsx-no-bind
        onChange={event => onBlockChange(event.target.value)}
      >
        <option value="p">{labels.paragraph}</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
      </select>
      {groups.map((group, gi) => (
        <Fragment key={gi}>
          <span className="dbl-rt-tsep" />
          <span className="dbl-rt-tgroup">
            {group.map(spec => (
              <button
                key={spec.key}
                type="button"
                className="dbl-rt-tbtn"
                title={spec.title}
                aria-label={spec.title}
                aria-pressed={spec.active}
                data-active={spec.active}
                disabled={spec.disabled}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={spec.onClick}
              >
                {spec.glyph}
              </button>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/**
 * RichTextEditor — the WYSIWYG surface for a NodeCard. Combines the Tiptap
 * Markdown editor, the persistent formatting toolbar, the ReviewMarks
 * decoration extension, the selection→bubble capture, and the caret-provider
 * imperative handle.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(props, ref) {
    const {
      value,
      onChange,
      reviewRows,
      onSelectionChange,
      onSelectionClear,
      onAddReview,
      onCloseReviewPop,
      onOpenReview,
      badgeTitle,
      addReviewLabel,
      closeLabel,
      toolbarLabels,
    } = props

    // --- Stable callback refs (so effect deps don't churn on parent renders) ---
    const onChangeRef = useRef(onChange)
    useEffect(() => { onChangeRef.current = onChange }, [onChange])
    const onSelectionChangeRef = useRef(onSelectionChange)
    useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
    const onSelectionClearRef = useRef(onSelectionClear)
    useEffect(() => { onSelectionClearRef.current = onSelectionClear }, [onSelectionClear])
    const onAddReviewRef = useRef(onAddReview)
    useEffect(() => { onAddReviewRef.current = onAddReview }, [onAddReview])

    // --- Mark handlers (openReview + titleFor) — memoized for stable identity ---
    const reviewHandlers = useMemo<MarkHandlers>(() => ({
      openReview: (reviewId: string) => onOpenReview(reviewId),
      titleFor: () => '', // chips omit tooltip text in the rich-text surface
    }), [onOpenReview])

    // --- value↔editor sync state ---
    const lastEmittedRef = useRef<string>(value)
    const suppressEmitRef = useRef(false)

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: '' }),
        Markdown.configure({ markedOptions: { gfm: true } }),
        ReviewMarksExtension.configure({
          reviewRows: [],
          handlers: reviewHandlers,
        }),
      ],
      content: value,
      contentType: 'markdown',
      editorProps: {
        attributes: { class: 'dbl-rt-editor-content' },
      },
    })

    // --- External → internal: re-parse when the parent pushes a new value ---
    useEffect(() => {
      if (editor === null) return
      if (value === lastEmittedRef.current) return
      lastEmittedRef.current = value
      suppressEmitRef.current = true
      editor.commands.setContent(value, { contentType: 'markdown' })
      suppressEmitRef.current = false
      // The setContent transaction rewrites the doc — the alignment model is
      // now stale. Rebuild immediately so marks don't briefly sit on the old
      // text. (This also bumps decorations.)
      refreshReviewMarksModel(editor)
    }, [editor, value])

    // --- Internal → external: debounce editor.getMarkdown() → onChange ---
    const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
      if (editor === null) return
      const emit = (): void => {
        if (suppressEmitRef.current) return
        if (emitTimerRef.current !== null) clearTimeout(emitTimerRef.current)
        emitTimerRef.current = setTimeout(() => {
          emitTimerRef.current = null
          if (editor.isDestroyed) return
          const md = editor.getMarkdown()
          lastEmittedRef.current = md
          onChangeRef.current(md)
        }, EMIT_DEBOUNCE_MS)
      }
      editor.on('update', emit)
      return () => {
        editor.off('update', emit)
        if (emitTimerRef.current !== null) {
          clearTimeout(emitTimerRef.current)
          emitTimerRef.current = null
        }
      }
    }, [editor])

    // --- Alignment model lifecycle: rebuild on create + debounced on update ---
    const modelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
      if (editor === null) return
      const rebuild = (): void => {
        if (modelTimerRef.current !== null) clearTimeout(modelTimerRef.current)
        modelTimerRef.current = setTimeout(() => {
          modelTimerRef.current = null
          if (editor.isDestroyed) return
          refreshReviewMarksModel(editor)
        }, MODEL_DEBOUNCE_MS)
      }
      editor.on('create', rebuild)
      editor.on('update', rebuild)
      return () => {
        editor.off('create', rebuild)
        editor.off('update', rebuild)
        if (modelTimerRef.current !== null) {
          clearTimeout(modelTimerRef.current)
          modelTimerRef.current = null
        }
      }
    }, [editor])

    // --- Review rows → extension storage ---
    useEffect(() => {
      if (editor === null) return
      setReviewRows(editor, reviewRows)
    }, [editor, reviewRows])

    // --- Mark handlers → extension storage ---
    useEffect(() => {
      if (editor === null) return
      setReviewHandlers(editor, reviewHandlers)
    }, [editor, reviewHandlers])

    // --- Selection → add-review bubble ---
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const [fab, setFab] = useState<{ x: number; y: number } | null>(null)

    // Re-render on every editor transaction so the toolbar's isActive /
    // undo-availability states track the current selection (editor state
    // lives outside React).
    const [, setTick] = useState(0)
    useEffect(() => {
      if (editor === null) return
      const bump = (): void => { setTick(t => (t + 1) & 0xffff) }
      editor.on('selectionUpdate', bump)
      editor.on('transaction', bump)
      return () => {
        editor.off('selectionUpdate', bump)
        editor.off('transaction', bump)
      }
    }, [editor])

    const clearFab = useCallback((): void => {
      setFab(prev => prev === null ? prev : null)
      onSelectionClearRef.current()
    }, [])

    useEffect(() => {
      if (editor === null) return
      let timer: ReturnType<typeof setTimeout> | null = null
      const capture = (): void => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          if (editor.isDestroyed) return
          if (!editor.isFocused) { clearFab(); return }
          if (editor.view.composing) { return }
          const selection = editor.state.selection
          if (selection.empty) { clearFab(); return }
          // Skip selections inside code blocks (no review anchoring there).
          if (selection.$from.parent.type.name === 'codeBlock') { clearFab(); return }
          const model = editor.storage.reviewMarks?.model ?? null
          if (model === null) { clearFab(); return }
          const lfStart = pmPosToLf(model, selection.from)
          const lfEnd = pmPosToLf(model, selection.to)
          if (lfStart === null || lfEnd === null) { clearFab(); return }
          const source = editor.storage.reviewMarks?.source ?? ''
          if (!validateSelection(source.slice(lfStart, lfEnd))) { clearFab(); return }
          const wrap = wrapRef.current
          if (wrap === null) { clearFab(); return }
          const wrapBox = wrap.getBoundingClientRect()
          const rect = editor.view.coordsAtPos(selection.from)
          const width = rect.right - rect.left
          const x = Math.max(0,
            rect.left - wrapBox.left + width / 2 - FAB_WIDTH / 2)
          const above = rect.top - wrapBox.top - FAB_GAP - FAB_HEIGHT >= 0
          const y = above
            ? rect.top - wrapBox.top - FAB_GAP - FAB_HEIGHT
            : rect.bottom - wrapBox.top + FAB_GAP
          setFab(prev =>
            prev !== null && Math.abs(prev.x - x) < 1 && Math.abs(prev.y - y) < 1 ? prev : { x, y })
          onSelectionChangeRef.current({ lfStart, lfEnd })
        }, SELECTION_DEBOUNCE_MS)
      }
      editor.on('selectionUpdate', capture)
      return () => {
        editor.off('selectionUpdate', capture)
        if (timer !== null) clearTimeout(timer)
      }
    }, [editor, clearFab])

    // --- Bubble dismiss on scroll / Escape (focus loss is NOT a dismiss) ---
    useEffect(() => {
      if (fab === null) return
      const onScroll = (): void => { setFab(null) }
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          setFab(null)
          onCloseReviewPop()
        }
      }
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('keydown', onKey)
      }
    }, [fab, onCloseReviewPop])

    // --- Imperative handle: caret-provider resolver for the Reviewer ---
    useImperativeHandle(ref, (): RichTextEditorHandle => ({
      isFocused: () => editor !== null && editor.isFocused,
      getSelectionRange: () => {
        if (editor === null || !editor.isFocused || editor.view.composing) return null
        const model = editor.storage.reviewMarks?.model ?? null
        if (model === null) return null
        const { from, to } = editor.state.selection
        const start = pmPosToLf(model, from)
        const end = pmPosToLf(model, to)
        if (start === null || end === null) return null
        const normalized = normalizeContent(editor.getMarkdown())
        return {
          start: Math.max(0, Math.min(start, normalized.length)),
          end: Math.max(0, Math.min(end, normalized.length)),
        }
      },
    }), [editor])

    void badgeTitle

    return (
      <div ref={wrapRef} className="dbl-rt-editor">
        {editor !== null && <RichTextToolbar editor={editor} labels={toolbarLabels} />}
        <EditorContent editor={editor} />
        {fab !== null && (
          <div className="dbl-rv-fab dbl-rv-fab-richtext" style={{ left: fab.x, top: fab.y }}>
            <button
              type="button"
              className="dbl-rv-fab-main"
              onMouseDown={event => event.preventDefault()}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => {
                onAddReviewRef.current()
                setFab(null)
              }}
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
                onCloseReviewPop()
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    )
  },
)
