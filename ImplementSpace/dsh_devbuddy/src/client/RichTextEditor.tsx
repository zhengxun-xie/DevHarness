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
 *     positions a `dbl-rv-fab` bubble over the selection. Collapsed carets,
 *     selections inside codeBlock, and IME composition are skipped — a
 *     collapsed caret uses the Reviewer's quick-action "add comment" button
 *     via the caret-provider handshake instead.
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
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { ChainedCommands } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { TableCell, TableHeader, TableRow, Table } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'

import {
  lfToPmPos,
  pmPosToLf,
  type MarkHandlers,
} from './doc-alignment.ts'
import { DrawingBlock } from './drawing-block.ts'
import {
  DrawingBlockContext,
  type DrawingBlockContextValue,
} from './DrawingBlockView.tsx'
import { ExcalidrawModal } from './ExcalidrawModal.tsx'
import { AiSuggestionModal } from './AiSuggestionModal.tsx'
import { api } from './api.ts'
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

/**
 * Repair structurally-empty list items.
 *
 * The Markdown parser (marked) turns an empty list item ("2. ") into a
 * listItem with NO children — no paragraph inside. Such a node has
 * `inlineContent === false`, so ProseMirror cannot place a text selection
 * inside it and clicking it drops the caret into the next block instead.
 * This plugin re-inserts an empty paragraph into any content-less
 * listItem/taskItem after every transaction and once on create.
 */
function buildEmptyListItemFix(state: EditorState): Transaction | null {
  const fixes: number[] = []
  state.doc.descendants((node, pos) => {
    if ((node.type.name === 'listItem' || node.type.name === 'taskItem') && node.content.size === 0) {
      fixes.push(pos)
    }
  })
  if (fixes.length === 0) return null
  const paragraph = state.schema.nodes.paragraph
  if (paragraph === undefined) return null
  const tr = state.tr
  // Insert from the last position backwards so earlier offsets stay valid.
  for (let i = fixes.length - 1; i >= 0; i--) {
    tr.insert(fixes[i] + 1, paragraph.create())
  }
  tr.setMeta('addToHistory', false)
  return tr
}

const EmptyListItemFix = Extension.create({
  name: 'emptyListItemFix',

  onCreate() {
    const tr = buildEmptyListItemFix(this.editor.state)
    if (tr !== null) this.editor.view.dispatch(tr)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emptyListItemFix'),
        appendTransaction: (_transactions, _oldState, newState) => {
          return buildEmptyListItemFix(newState)
        },
      }),
    ]
  },
})

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
  drawing: string
  undo: string
  redo: string
  /** Excalidraw modal + inline block copy. */
  drawTitle: string
  drawClose: string
  drawSaving: string
  drawLoadError: string
  drawSaveError: string
  drawEdit: string
  drawEmpty: string
  drawMissing: string
  drawError: string
  /** AI quick-action button + menu items. */
  ai: string
  aiPolish: string
  aiTranslate: string
  aiSummarize: string
  aiContinue: string
  aiExplain: string
  aiLoading: string
  aiNoSelection: string
  aiPlaceholder: string
  aiUnavailable: string
  /** Second popover row: the user's own revision instruction. */
  aiRevise: string
  aiRevisePlaceholder: string
  /** AI suggestion preview modal copy. */
  aiDialogOriginal: string
  aiDialogSuggestion: string
  aiCancel: string
  aiApply: string
  aiFollowUp: string
  aiFollowUpPlaceholder: string
  aiFollowUpSend: string
  aiRegenerating: string
}

export interface RichTextEditorProps {
  /** Project id, needed for embedded drawing file operations. */
  projectId: string
  /** Node file name (e.g. "CoreRequirements.md") — the AI session's identity. */
  documentName: string
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
  /** LF offset to restore caret position after a mode switch (null = skip). */
  restoreCaret?: number | null
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

/** AI quick-action identifiers. 'custom' is the popover's own revision row. */
type AiAction = 'polish' | 'translate' | 'summarize' | 'continue' | 'explain' | 'custom'

/** Actions that replace the current selection vs. insert after it. */
const AI_REPLACE_ACTIONS = new Set<AiAction>(['polish', 'translate', 'custom'])

/**
 * How much surrounding plain text to send with each request. The agent needs
 * the document around the caret to continue/explain/summarize meaningfully;
 * the window keeps the prompt bounded on long documents.
 */
const AI_CONTEXT_BEFORE = 4000
const AI_CONTEXT_AFTER = 2000

/** One AI request: the action, the target text, and its surrounding context. */
interface AiAssistRequest {
  projectId: string
  document: string
  action: AiAction
  selection: string
  contextBefore?: string
  contextAfter?: string
  followUp?: string
  /** The user's own revision instruction ('custom' action only). */
  instruction?: string
}

/**
 * Run one AI action against the document's long-lived session (host-side).
 * The host creates-or-reuses the "[AI优化]<document>" session and collects the
 * assistant reply, so consecutive turns (incl. follow-ups) keep context.
 * Throws when the channel is unavailable or no reply arrived.
 */
async function aiAssist(request: AiAssistRequest): Promise<string> {
  const result = await api.aiDispatch(request)
  if (!result.delivered || result.text === null || result.text === '') {
    throw new Error('ai-unavailable')
  }
  return result.text
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
 * link/table/drawing + AI quick-action + undo/redo. The AI button opens a
 * two-row popover: the fixed quick actions, then a free-form revision row
 * (修改意见 input + 修改 button) that runs the AI on the current selection —
 * or, when nothing is selected, on the document at the caret.
 * Each command runs on
 * `editor.chain().focus()` so clicking a button returns focus to the editor
 * and restores its selection. The parent re-renders the editor on every
 * transaction (tick state), so `isActive` states and undo availability stay
 * current.
 */
function RichTextToolbar({ editor, labels, onInsertDrawing, projectId, documentName }: {
  editor: Editor
  labels: RichTextToolbarLabels
  onInsertDrawing: () => void
  projectId: string
  documentName: string
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

  // --- AI quick-action popover state ---
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiRunning, setAiRunning] = useState<AiAction | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  /** Second row: the user's own revision instruction (修改意见). */
  const [aiInstruction, setAiInstruction] = useState('')
  /** Fixed viewport coordinates of the portaled menu. */
  const [aiMenuPos, setAiMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const aiBtnRef = useRef<HTMLButtonElement | null>(null)
  const aiMenuRef = useRef<HTMLDivElement | null>(null)

  /** Recompute the menu position from the button's viewport rect. */
  const updateAiMenuPos = useCallback((): void => {
    const btn = aiBtnRef.current
    if (btn === null) return
    const rect = btn.getBoundingClientRect()
    // Keep the menu inside the viewport: clamp the right edge; flip above the
    // button when there isn't enough room below. Two rows now: quick actions +
    // the revision input row.
    const MENU_W = 340
    const MENU_H = 76
    const x = Math.max(4, Math.min(rect.left, window.innerWidth - MENU_W - 4))
    const below = rect.bottom + 2
    const y = below + MENU_H <= window.innerHeight ? below : Math.max(4, rect.top - MENU_H - 2)
    setAiMenuPos({ x, y })
  }, [])

  // Open: compute initial position; keep aligned on scroll / resize.
  useEffect(() => {
    if (!aiMenuOpen) return
    updateAiMenuPos()
    // Capture phase: scroll may happen inside any panel container.
    window.addEventListener('scroll', updateAiMenuPos, true)
    window.addEventListener('resize', updateAiMenuPos)
    return () => {
      window.removeEventListener('scroll', updateAiMenuPos, true)
      window.removeEventListener('resize', updateAiMenuPos)
    }
  }, [aiMenuOpen, updateAiMenuPos])

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!aiMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (aiBtnRef.current !== null && aiBtnRef.current.contains(target)) return
      if (aiMenuRef.current !== null && aiMenuRef.current.contains(target)) return
      setAiMenuOpen(false)
      setAiError(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setAiMenuOpen(false); setAiError(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [aiMenuOpen])

  // --- AI suggestion preview modal state ---
  const [aiModal, setAiModal] = useState<{
    action: AiAction
    from: number
    to: number
    original: string
    suggestion: string
  } | null>(null)

  const runAiAction = useCallback(async (action: AiAction, instruction?: string): Promise<void> => {
    setAiMenuOpen(false)
    setAiError(null)
    const custom = instruction?.trim() ?? ''
    // The revision row is a no-op without a real instruction; its button and
    // Enter handler are disabled in that state, this is the second line.
    if (action === 'custom' && custom === '') return
    const { from, to } = editor.state.selection
    const doc = editor.state.doc
    const selectedText = doc.textBetween(from, to, '\n')
    // 'continue' and the revision row's 'custom' work at the cursor; the
    // fixed selection actions need a selection.
    if (action !== 'continue' && action !== 'custom' && selectedText === '') {
      setAiError(labels.aiNoSelection)
      return
    }
    // Ship the surrounding document text: without it the agent has no context
    // to continue/explain/summarize against ('continue' would only see the
    // selection, which is empty when the caret is simply placed).
    const contextBefore = doc.textBetween(0, from, '\n').slice(-AI_CONTEXT_BEFORE)
    const contextAfter = doc.textBetween(to, doc.content.size, '\n').slice(0, AI_CONTEXT_AFTER)
    setAiRunning(action)
    try {
      const result = await aiAssist({
        projectId,
        document: documentName,
        action,
        selection: selectedText,
        contextBefore,
        contextAfter,
        ...(action === 'custom' ? { instruction: custom } : {}),
      })
      if (editor.isDestroyed) return
      // Preview first: open the suggestion modal instead of mutating the doc.
      setAiModal({ action, from, to, original: selectedText, suggestion: result })
    } catch (error) {
      // Route-side rejections carry a concrete reason (e.g. 'unknown action');
      // append it after the generic line instead of swallowing it.
      const detail = error instanceof Error && error.message !== '' && error.message !== 'ai-unavailable'
        ? error.message
        : ''
      setAiError(detail === '' ? labels.aiUnavailable : `${labels.aiUnavailable}（${detail}）`)
    } finally {
      setAiRunning(null)
    }
  }, [editor, projectId, documentName, labels.aiNoSelection, labels.aiUnavailable])

  /** Submit the revision row: run the AI on the selection (or at the caret
   *  when nothing is selected) with the typed instruction. */
  const runCustomRevision = useCallback((): void => {
    const instruction = aiInstruction.trim()
    if (instruction === '') return
    setAiInstruction('')
    void runAiAction('custom', instruction)
  }, [aiInstruction, runAiAction])

  /** Apply: write the user's final (possibly edited) suggestion back to the doc. */
  const applyAiSuggestion = useCallback((finalText: string): void => {
    const modal = aiModal
    setAiModal(null)
    if (modal === null || editor.isDestroyed) return
    const chain = editor.chain().focus()
    if (AI_REPLACE_ACTIONS.has(modal.action)) {
      // Replace the captured selection with the final text.
      chain.setTextSelection({ from: modal.from, to: modal.to }).deleteSelection()
      if (finalText !== '') chain.insertContent(finalText)
    } else if (finalText !== '') {
      // Insert after the selection / cursor.
      chain.insertContentAt(modal.to, finalText)
    }
    chain.run()
  }, [aiModal, editor])

  /** Follow-up: re-run the AI with an extra instruction, return the new text. */
  const followUpAi = useCallback(async (instruction: string): Promise<string> => {
    if (aiModal === null) throw new Error('AI modal closed')
    // The session already holds the prior turn (with its context), so a
    // follow-up only needs the instruction.
    return aiAssist({
      projectId,
      document: documentName,
      action: aiModal.action,
      selection: aiModal.original,
      followUp: instruction,
    })
  }, [aiModal, projectId, documentName])

  const aiMenuItems: { action: AiAction; label: string }[] = [
    { action: 'polish', label: labels.aiPolish },
    { action: 'translate', label: labels.aiTranslate },
    { action: 'summarize', label: labels.aiSummarize },
    { action: 'continue', label: labels.aiContinue },
    { action: 'explain', label: labels.aiExplain },
  ]

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
      button('drawing', labels.drawing, '✎', false, onInsertDrawing),
    ],
    [
      button('undo', labels.undo, '↶', false, () => chain().undo().run(),
        !editor.can().undo()),
      button('redo', labels.redo, '↷', false, () => chain().redo().run(),
        !editor.can().redo()),
    ],
  ]

  return (
    <Fragment>
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
      {groups.map((group, gi) => {
        // Insert AI button before the undo/redo group.
        if (gi === groups.length - 1) {
          return (
            <Fragment key={gi}>
              <span className="dbl-rt-tsep" />
              <span className="dbl-rt-tgroup">
                <button
                  ref={aiBtnRef}
                  type="button"
                  className="dbl-rt-tbtn dbl-rt-ai-btn"
                  title={labels.ai}
                  aria-label={labels.ai}
                  aria-haspopup="menu"
                  aria-expanded={aiMenuOpen}
                  data-active={aiMenuOpen}
                  disabled={aiRunning !== null}
                  // eslint-disable-next-line react/jsx-no-bind
                  onClick={() => { setAiMenuOpen(v => !v); setAiError(null) }}
                >
                  {aiRunning !== null ? labels.aiLoading : labels.ai}
                </button>
              </span>
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
          )
        }
        return (
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
        )
      })}
    </div>
    {aiError !== null && (
      <div className="dbl-rt-ai-err dbl-rt-ai-err-inline">{aiError}</div>
    )}
    {aiMenuOpen && createPortal(
      <div
        ref={aiMenuRef}
        className="dbl-rt-ai-menu"
        role="menu"
        style={{ left: aiMenuPos.x, top: aiMenuPos.y }}
      >
        <div className="dbl-rt-ai-row" role="presentation">
          {aiMenuItems.map(item => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className="dbl-rt-ai-item"
              disabled={aiRunning !== null}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void runAiAction(item.action) }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {/* Second row: free-form revision instruction + 修改 button. */}
        <div className="dbl-rt-ai-row dbl-rt-ai-custom" role="presentation">
          <input
            type="text"
            className="dbl-rt-ai-input"
            value={aiInstruction}
            placeholder={labels.aiRevisePlaceholder}
            aria-label={labels.aiRevisePlaceholder}
            disabled={aiRunning !== null}
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event => setAiInstruction(event.target.value)}
            // eslint-disable-next-line react/jsx-no-bind
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runCustomRevision()
              }
            }}
          />
          <button
            type="button"
            role="menuitem"
            className="dbl-rt-ai-item dbl-rt-ai-send"
            disabled={aiRunning !== null || aiInstruction.trim() === ''}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={runCustomRevision}
          >
            {labels.aiRevise}
          </button>
        </div>
      </div>,
      document.body,
    )}
    {aiModal !== null && createPortal(
      <AiSuggestionModal
        actionLabel={aiModal.action === 'custom'
          ? labels.aiRevise
          : (aiMenuItems.find(item => item.action === aiModal.action)?.label ?? labels.ai)}
        original={aiModal.original}
        initialSuggestion={aiModal.suggestion}
        labels={{
          original: labels.aiDialogOriginal,
          suggestion: labels.aiDialogSuggestion,
          cancel: labels.aiCancel,
          apply: labels.aiApply,
          followUp: labels.aiFollowUp,
          followUpPlaceholder: labels.aiFollowUpPlaceholder,
          followUpSend: labels.aiFollowUpSend,
          regenerating: labels.aiRegenerating,
          error: labels.aiUnavailable,
        }}
        onFollowUp={followUpAi}
        onApply={applyAiSuggestion}
        onCancel={() => setAiModal(null)}
      />,
      document.body,
    )}
    </Fragment>
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
      projectId,
      documentName,
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
      restoreCaret,
    } = props

    // --- Embedded drawing modal: open reference + thumbnail refresh bump ---
    const [drawingSrc, setDrawingSrc] = useState<string | null>(null)
    const [changedSrc, setChangedSrc] = useState<string | null>(null)
    const [changedAt, setChangedAt] = useState(0)

    const handleDrawingSaved = useCallback((src: string): void => {
      setChangedSrc(src)
      setChangedAt(Date.now())
    }, [])

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
        EmptyListItemFix,
        Placeholder.configure({ placeholder: '' }),
        Markdown.configure({ markedOptions: { gfm: true } }),
        DrawingBlock,
        ReviewMarksExtension.configure({
          reviewRows: [],
          handlers: reviewHandlers,
        }),
      ],
      content: value,
      contentType: 'markdown',
      editorProps: {
        attributes: { class: 'dbl-rt-editor-content' },
        /**
         * Keep the caret where the user clicked on empty blocks. ProseMirror
         * delegates placement to the browser, which drops the caret into the
         * next block when the clicked block is empty (empty list items, empty
         * paragraphs). Intercept when the resolved position sits in — or
         * directly wraps — an empty textblock and clamp the selection there.
         */
        handleClick(view, pos) {
          const $pos = view.state.doc.resolve(pos)
          for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth)
            if (node.type.isTextblock) {
              // Inside a textblock: only take over when it is empty.
              if (node.content.size > 0) return false
              const sel = TextSelection.create(view.state.doc, $pos.before(depth) + 1)
              view.dispatch(view.state.tr.setSelection(sel).setMeta('pointer', true))
              return true
            }
            // At a wrapper boundary (e.g. a listItem): if its only child is an
            // empty textblock, place the caret inside that child.
            const first = node.firstChild
            if (node.childCount === 1 && first !== null &&
                first.type.isTextblock && first.content.size === 0) {
              const sel = TextSelection.create(view.state.doc, $pos.before(depth) + 2)
              view.dispatch(view.state.tr.setSelection(sel).setMeta('pointer', true))
              return true
            }
          }
          return false
        },
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

    // --- Restore caret after a mode switch (source → richtext) ---
    // The LF offset saved by NodeCard before the switch is converted to a PM
    // position via the alignment model, then the selection is set and scrolled
    // into view. Runs once per mount when `restoreCaret` is a non-null number.
    useEffect(() => {
      if (editor === null) return
      if (restoreCaret === null || restoreCaret === undefined) return
      const lf = restoreCaret
      const raf = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        // Build the alignment model synchronously so lfToPmPos can resolve.
        refreshReviewMarksModel(editor)
        const model = editor.storage.reviewMarks?.model ?? null
        if (model === null) return
        const pmPos = lfToPmPos(model, lf)
        if (pmPos === null) return
        editor.chain().focus().setTextSelection(pmPos).run()
        // Scroll the restored position into view.
        const view = editor.view
        view.dispatch(view.state.tr.scrollIntoView())
      })
      return () => cancelAnimationFrame(raf)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor])

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

    // --- Insert drawing: allocate a new scene file, reference it, open it ---
    const handleInsertDrawing = useCallback((): void => {
      if (editor === null) return
      ;(async (): Promise<void> => {
        try {
          const result = await api.createDrawing(projectId)
          if (editor.isDestroyed) return
          editor.chain().focus().insertDrawingBlock({ src: result.src }).run()
          setDrawingSrc(result.src)
        } catch {
          // The create/insert failed; the document is left untouched.
        }
      })()
    }, [editor, projectId])

    // --- Context consumed by every DrawingBlockView NodeView ---
    const drawingContextValue = useMemo<DrawingBlockContextValue>(() => ({
      projectId,
      openDrawing: (src: string) => setDrawingSrc(src),
      changedSrc,
      changedAt,
      editLabel: toolbarLabels.drawEdit,
      emptyLabel: toolbarLabels.drawEmpty,
      missingLabel: toolbarLabels.drawMissing,
      errorLabel: toolbarLabels.drawError,
    }), [projectId, changedSrc, changedAt, toolbarLabels])

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
        // NOTE: no isFocused check here — the ProseMirror selection state
        // persists after blur, and the mode-switch caret save must read it
        // even though clicking the 源码/富文本 button has already unfocused
        // the editor. Callers that require an active caret (the Reviewer
        // handshake) check isFocused() themselves before calling.
        if (editor === null) return null
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
      <DrawingBlockContext.Provider value={drawingContextValue}>
      <div ref={wrapRef} className="dbl-rt-editor">
        {editor !== null && (
          <RichTextToolbar
            editor={editor}
            labels={toolbarLabels}
            onInsertDrawing={handleInsertDrawing}
            projectId={projectId}
            documentName={documentName}
          />
        )}
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
      {drawingSrc !== null && (
        <ExcalidrawModal
          projectId={projectId}
          src={drawingSrc}
          labels={{
            title: toolbarLabels.drawTitle,
            close: toolbarLabels.drawClose,
            saving: toolbarLabels.drawSaving,
            loadError: toolbarLabels.drawLoadError,
            saveError: toolbarLabels.drawSaveError,
          }}
          onClose={() => setDrawingSrc(null)}
          onSaved={handleDrawingSaved}
        />
      )}
      </DrawingBlockContext.Provider>
    )
  },
)
