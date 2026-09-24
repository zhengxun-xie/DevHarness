/**
 * Section folding for the WYSIWYG (Tiptap) surface, mirroring the source
 * surface in `LineNumberTextarea`.
 *
 * A chevron toggle is rendered as a ProseMirror widget at the start of every
 * heading. Folding hides the blocks of that heading's section (up to the next
 * heading of the same or higher level) with node decorations; the document
 * itself is never modified. Fold state lives in the parent component and is
 * read through a ref, so the plugin is created once and never reconfigured.
 *
 * Kept free of React/JSX so it can be unit-tested headlessly (jsdom).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { foldKey as sectionFoldKey } from './section-folds.ts'

/** Fold state + toggle, read live from the parent's ref. */
export interface FoldApi {
  folds: ReadonlySet<string>
  toggle: (key: string) => void
  foldTitle: string
  unfoldTitle: string
}

/** A heading found in the ProseMirror document. */
export interface PmHeading {
  pos: number
  level: number
  text: string
  nodeSize: number
}

/** Transaction meta that asks the plugin to rebuild its decorations. */
export const SECTION_FOLD_META = 'sectionFoldsChanged'

/** Class applied to every block hidden by a fold. */
export const FOLDED_BODY_CLASS = 'dbl-folded-body'

/** Class of the chevron button (both surfaces share the visual language). */
export const FOLD_CHEVRON_CLASS = 'dbl-fold-chevron-rt'

const SECTION_FOLD_KEY = new PluginKey<DecorationSet>('sectionFolding')

/** Every heading in document order. */
export function collectPmHeadings(doc: EditorState['doc']): PmHeading[] {
  const result: PmHeading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      result.push({
        pos,
        level: node.attrs.level as number,
        text: node.textContent,
        nodeSize: node.nodeSize,
      })
    }
  })
  return result
}

/** Position of the next heading with level ≤ this one, else the document end. */
export function pmSectionEnd(headings: PmHeading[], current: PmHeading, docSize: number): number {
  for (const next of headings) {
    if (next.pos <= current.pos) continue
    if (next.level <= current.level) return next.pos
  }
  return docSize
}

/**
 * Fold key of the section whose BODY contains `pos`, or null. Used by the
 * auto-unfold path: the heading line itself is excluded so the caret can
 * still rest on it.
 */
export function foldedKeyAtPos(doc: EditorState['doc'], pos: number, folds: ReadonlySet<string>): string | null {
  const headings = collectPmHeadings(doc)
  for (const heading of headings) {
    const key = sectionFoldKey(heading.level, heading.text)
    if (!folds.has(key)) continue
    const end = pmSectionEnd(headings, heading, doc.content.size)
    if (pos > heading.pos && pos < end) return key
  }
  return null
}

/**
 * Chevron widgets for every heading plus hidden-node decorations for folded
 * sections.
 *
 * `apiRef` (not a resolved API object) is read at CLICK time, and the widget
 * deliberately carries no `spec.key`: ProseMirror treats two widgets with the
 * same key as equal and would then keep the first DOM node — and with it the
 * stale toggle closure and the stale ▾/▸ glyph. Without a key each rebuild
 * produces a fresh node, and reading the ref keeps the handler correct even if
 * a node is ever reused.
 */
export function buildFoldDecorations(doc: EditorState['doc'], apiRef: { current: FoldApi }): DecorationSet {
  const headings = collectPmHeadings(doc)
  if (headings.length === 0) return DecorationSet.empty
  const decorations: Decoration[] = []
  for (const heading of headings) {
    const key = sectionFoldKey(heading.level, heading.text)
    const folded = apiRef.current.folds.has(key)
    // Chevron widget at the START OF THE HEADING (pos + 1 puts it inside the
    // heading, so it renders inline before the title instead of on its own
    // block-level line above it). ▾ open / ▸ folded.
    decorations.push(Decoration.widget(heading.pos + 1, () => {
      const api = apiRef.current
      const wrapper = document.createElement('span')
      wrapper.className = 'dbl-fold-widget'
      wrapper.contentEditable = 'false'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `dbl-fold-chevron ${FOLD_CHEVRON_CLASS}`
      button.textContent = folded ? '▸' : '▾'
      button.title = folded ? api.unfoldTitle : api.foldTitle
      button.setAttribute('aria-label', folded ? api.unfoldTitle : api.foldTitle)
      button.setAttribute('aria-expanded', String(!folded))
      // The key is carried in the DOM so an editor-level fallback handler can
      // resolve the toggle even if this exact node was rebuilt mid-click.
      button.dataset.foldKey = key
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () => apiRef.current.toggle(key))
      wrapper.appendChild(button)
      return wrapper
    }, { side: -1 }))

    if (!folded) continue
    const sectionEnd = pmSectionEnd(headings, heading, doc.content.size)
    doc.nodesBetween(heading.pos + heading.nodeSize, sectionEnd, (node, pos) => {
      if (node.isBlock) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: FOLDED_BODY_CLASS }))
      }
      return true
    })
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * Tiptap extension binding the fold plugin to a live ref. The extension must
 * be created ONCE (a new instance per render makes Tiptap see changed options
 * on every render); the ref keeps the plugin reading current state.
 */
export function makeSectionFolding(apiRef: { current: FoldApi }): Extension {
  return Extension.create({
    name: 'sectionFolding',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: SECTION_FOLD_KEY,
          state: {
            init: (_config, state) => buildFoldDecorations(state.doc, apiRef),
            apply: (tr, previous, _oldState, newState) => {
              if (tr.docChanged || tr.getMeta(SECTION_FOLD_META) !== undefined) {
                return buildFoldDecorations(newState.doc, apiRef)
              }
              return previous
            },
          },
          props: {
            decorations(state) {
              return SECTION_FOLD_KEY.getState(state) ?? DecorationSet.empty
            },
          },
        }),
      ]
    },
  })
}
