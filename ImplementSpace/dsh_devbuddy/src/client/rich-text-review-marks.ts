/**
 * Tiptap Extension that paints reviewer marks onto the rich-text (WYSIWYG)
 * surface via the ProseMirror Decorations API.
 *
 * This is the ProseMirror-doc retarget of the legacy preview-marks.ts DOM
 * injection. The alignment primitives live in doc-alignment.ts; this file
 * owns the Tiptap/ProseMirror glue: the Extension, the decoration plugin,
 * and the helpers that keep the alignment model + review rows in sync with
 * the live editor.
 *
 * Lifecycle:
 *   - `editor.on('create' | 'transaction')` (debounced) →
 *     `refreshReviewMarksModel(editor)` rebuilds the LF↔PM alignment model
 *     from `normalizeContent(editor.getMarkdown())` + the PM doc, writes it
 *     into `editor.storage.reviewMarks.model`, and dispatches a `bump` meta
 *     transaction so `props.decorations` re-runs against the new model.
 *   - `reviewRows` prop change → `setReviewRows(editor, rows)` updates the
 *     storage's options and dispatches `bump` (model is unchanged — only the
 *     mark specs are re-derived).
 *
 * Step 3 (this file): inline highlights only. Precise matchOffset* anchors
 * paint `Decoration.inline` with the `dbl-rv-anchor` class family. Point
 * anchors, line-level fallback, and the #N chip widget arrive in step 4.
 */
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import {
  buildDocAlignmentModel,
  buildMarkSpecs,
  intervalsForPairing,
  lineLevelClassName,
  markClassName,
  mergeIntervals,
  pointClassName,
  topSeverity,
  type DocAlignmentModel,
  type MarkHandlers,
  type MarkReviewLite,
  type MarkSpec,
  type ReviewRowLike,
} from './doc-alignment.ts'
import { normalizeContent } from './reviewer-bridge.ts'

declare module '@tiptap/core' {
  interface Storage {
    reviewMarks: ReviewMarksStorage
  }
}

const REVIEW_MARKS_PLUGIN_KEY = new PluginKey('reviewMarks')
/** Meta key for a no-op transaction that forces decoration recompute. */
const BUMP_META = 'reviewMarks-bump'

export interface ReviewMarksOptions {
  reviewRows: readonly ReviewRowLike[]
  handlers: MarkHandlers
}

export interface ReviewMarksStorage {
  options: ReviewMarksOptions
  /** Rebuilt on create + debounced docChanged transactions. */
  model: DocAlignmentModel | null
  /** The source string the model was built from (for debugging / staleness). */
  source: string
}

export const ReviewMarksExtension = Extension.create<ReviewMarksOptions, ReviewMarksStorage>({
  name: 'reviewMarks',

  addStorage() {
    return {
      options: {
        reviewRows: [],
        handlers: {
          openReview: () => { /* wired by RichTextEditor */ },
          titleFor: () => '',
        },
      },
      model: null,
      source: '',
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: REVIEW_MARKS_PLUGIN_KEY,
        props: {
          decorations(state: EditorState): DecorationSet {
            return buildDecorations(state, storage)
          },
          handleClick(_view, _pos, event): boolean {
            const target = event.target
            if (!(target instanceof Element)) return false
            const chip = target.closest('[data-review-id]')
            if (chip === null) return false
            const id = (chip as HTMLElement).dataset.reviewId
            if (id === undefined || id === '') return false
            storage.options.handlers.openReview(id)
            return true
          },
        },
      }),
    ]
  },
})

/**
 * Build decorations from the current alignment model + review rows.
 *
 * Three mark shapes:
 *   - Precise (non-point): `Decoration.inline` with `dbl-rv-anchor` class
 *     family, plus a `#N` chip widget at the interval end.
 *   - Point (zero-length): a single `Decoration.widget` splicing a 2px bar
 *     (`dbl-rv-point`) carrying its own chip. No inline decoration (there is
 *     no range to highlight).
 *   - Line-level fallback (outdated/orphaned/missing offsets): a softer
 *     `Decoration.inline` with `dbl-rv-hl dbl-rv-line-level`, plus a chip
 *     widget at the interval end.
 *
 * Chips are pure DOM (no ReactNodeView), mirroring preview-marks' `attachNums`.
 * Each chip binds its own click listener → handlers.openReview (handleClick
 * delegation alone proved unreliable for widget buttons); the anchor span and
 * point bar also carry data-review-id for background/bar clicks.
 */
export function buildDecorations(
  state: EditorState,
  storage: ReviewMarksStorage,
): DecorationSet {
  const model = storage.model
  if (model === null) return DecorationSet.empty
  const specs = buildMarkSpecs(storage.options.reviewRows)
  if (specs.length === 0) return DecorationSet.empty
  const handlers = storage.options.handlers

  const decorations: Decoration[] = []
  for (const pairing of model.pairings) {
    const intervals = intervalsForPairing(pairing, specs)
    const merged = mergeIntervals(intervals)
    for (const interval of merged) {
      if (interval.point) {
        // Zero-length point anchor: a 2px bar widget carries the chip inside.
        decorations.push(
          Decoration.widget(interval.from, () => buildPointElement(interval.specs, handlers), {
            side: 1,
          }),
        )
        continue
      }
      const lineLevel = interval.specs.every(spec => spec.lineLevel)
      // Precise anchors get the two 2px edge bars ("|") via the combined
      // dbl-rv-edges inset shadows — parity with the source surface's
      // start/end bars. The anchor span itself is the click target for the
      // primary review (data-review-id → handleClick).
      const className = lineLevel
        ? lineLevelClassName(interval.specs)
        : `${markClassName(interval.specs)} dbl-rv-edges`
      const inlineAttrs: { class: string; 'data-review-id'?: string } = { class: className }
      const primary = topSeverity(interval.specs)
      if (primary !== null) inlineAttrs['data-review-id'] = primary.reviewId
      decorations.push(Decoration.inline(interval.from, interval.to, inlineAttrs))
      // #N chip at the visual end of the interval. The chip-host wrapper
      // establishes the positioning context so the chip rides the end edge
      // instead of escaping to the editor root's top-right.
      decorations.push(
        Decoration.widget(interval.to, () => buildChipHost(interval.specs, handlers), {
          side: 1,
        }),
      )
    }
  }
  if (decorations.length === 0) return DecorationSet.empty
  return DecorationSet.create(state.doc, decorations)
}

/**
 * Zero-width positioning host for the chip bundle. The widget sits at a PM
 * position and cannot live INSIDE the inline anchor span, so without this
 * wrapper the absolutely-positioned `.dbl-rv-anchor-nums` would escape to
 * the nearest positioned ancestor (the whole editor root) and render at the
 * document's top-right. The host makes the chip ride the interval end edge.
 */
function buildChipHost(specs: MarkSpec[], handlers: MarkHandlers): HTMLElement {
  const host = document.createElement('span')
  host.className = 'dbl-rv-chip-host'
  host.appendChild(buildNumsWidget(specs, handlers))
  return host
}

/**
 * The #N chip bundle: a `<span class="dbl-rv-anchor-nums">` with one
 * `<button class="dbl-rv-anchor-num dbl-rv-num-{sev}">` per unique review.
 * `onMouseDown` prevents focus steal so the editor keeps its caret. The chip
 * binds its OWN click listener routing to handlers.openReview — relying on
 * ProseMirror's handleClick delegation proved unreliable for widget buttons
 * (clicks did not navigate); a direct listener is the proven preview pattern.
 */
function buildNumsWidget(specs: MarkSpec[], handlers: MarkHandlers): HTMLElement {
  const reviews = uniqueReviews(specs)
  const nums = document.createElement('span')
  nums.className = 'dbl-rv-anchor-nums'
  for (const review of reviews) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = `dbl-rv-anchor-num dbl-rv-num-${review.severity}`
    chip.textContent = String(review.number)
    chip.title = handlers.titleFor(review)
    chip.dataset.reviewId = review.reviewId
    chip.addEventListener('mousedown', event => event.preventDefault())
    chip.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      handlers.openReview(review.reviewId)
    })
    nums.appendChild(chip)
  }
  return nums
}

/**
 * Zero-length point anchor: a 2px "|" bar span whose class carries the
 * severity tint and drifted status. The bar itself is a click target for the
 * primary review (via `data-review-id`); the #N chip bundle is appended
 * inside the span so it sits right at the bar — mirroring preview-marks'
 * `insertPoint` + `attachNums(point, ...)`.
 */
function buildPointElement(specs: MarkSpec[], handlers: MarkHandlers): HTMLElement {
  const point = document.createElement('span')
  point.className = pointClassName(specs)
  const primary = topSeverity(specs)
  if (primary !== null) {
    point.dataset.reviewId = primary.reviewId
  }
  point.dataset.anchorStatus = specs[0]?.anchorStatus ?? 'valid'
  point.addEventListener('mousedown', event => event.preventDefault())
  if (primary !== null) {
    point.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      handlers.openReview(primary.reviewId)
    })
  }
  const nums = buildNumsWidget(specs, handlers)
  point.appendChild(nums)
  return point
}

/** Dedupe reviews by id preserving first-seen order (chips show once per review). */
function uniqueReviews(specs: MarkSpec[]): MarkReviewLite[] {
  const reviews = specs.flatMap(s => s.reviews)
  return reviews.filter((review, idx) =>
    reviews.findIndex(r => r.reviewId === review.reviewId) === idx,
  )
}

/**
 * Rebuild the LF↔PM alignment model from the editor's live Markdown + doc and
 * write it into the extension's storage. Dispatches a `bump` meta so the
 * decorations plugin re-runs against the new model. Safe to call on create,
 * on docChanged transactions (debounced by the caller), and after manual
 * `setContent` from the external→internal sync path.
 */
export function refreshReviewMarksModel(editor: Editor): void {
  const storage = editor.storage.reviewMarks
  if (storage === undefined) return
  const source = normalizeContent(editor.getMarkdown())
  storage.source = source
  storage.model = buildDocAlignmentModel(editor.state.doc, source)
  bumpDecorations(editor)
}

/**
 * Update the review rows the decorations are built from. Does not touch the
 * alignment model (rows only change the spec projection). Dispatches `bump`
 * so the new rows are reflected immediately.
 */
export function setReviewRows(editor: Editor, reviewRows: readonly ReviewRowLike[]): void {
  const storage = editor.storage.reviewMarks
  if (storage === undefined) return
  storage.options = { ...storage.options, reviewRows }
  bumpDecorations(editor)
}

/** Update the click/tooltip handlers (openReview, titleFor). */
export function setReviewHandlers(editor: Editor, handlers: MarkHandlers): void {
  const storage = editor.storage.reviewMarks
  if (storage === undefined) return
  storage.options = { ...storage.options, handlers }
  bumpDecorations(editor)
}

/**
 * Force the decorations plugin to re-run by dispatching a no-op transaction
 * tagged with the `bump` meta. ProseMirror's view re-invokes
 * `props.decorations(newState)` after every transaction, so this is enough
 * to refresh marks when the model or options were mutated in-place.
 */
function bumpDecorations(editor: Editor): void {
  if (editor.isDestroyed) return
  const tr = editor.state.tr.setMeta(BUMP_META, true)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}
