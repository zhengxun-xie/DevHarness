/**
 * Tiptap block node for an embedded Excalidraw drawing reference.
 *
 * On-disk representation (in the markdown document) is one line:
 *
 *   ![[diagram-1.excalidraw]]
 *
 * `@tiptap/markdown` knows nothing about wikilinks, so this extension
 * contributes:
 *   - `markdownTokenizer` — a marked block-level tokenizer that recognizes a
 *     line of that exact shape (the `src` field rides on the token);
 *   - `parseMarkdown` — token → drawingBlock JSON node with a `src` attr;
 *   - `renderMarkdown` — node → the same reference line.
 *
 * The node is atom/selectable/draggable and renders through a React NodeView
 * (`DrawingBlockView`) that shows a fitted thumbnail; clicking it opens the
 * full editor in a modal. The scene JSON itself lives in the referenced
 * `.excalidraw` file inside the project — it never enters the markdown.
 */
import { Node } from '@tiptap/core'
import type { NodeConfig } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DrawingBlockView } from './DrawingBlockView.tsx'

/** Node / token name. */
export const DRAWING_BLOCK_NAME = 'drawingBlock'

/**
 * One reference line at the start of the remaining source. The reference
 * is its own line; trailing spaces are allowed; the terminating newline is
 * consumed as part of `raw` so marked advances past it.
 */
const DRAWING_LINE = /^!\[\[([^\[\]\r\n]+\.excalidraw)\]\][^\S\r\n]*(?:\r?\n|$)/

/** Extra markdown fields not part of @tiptap/core's NodeConfig typing. */
interface MarkdownNodeFields {
  markdownTokenName: string
  markdownTokenizer: {
    name: string
    level: 'block' | 'inline'
    start?: (src: string) => number
    tokenize: (src: string) => ({ type: string; raw: string; src: string } | undefined)
  }
  parseMarkdown: (token: { src?: unknown }) => unknown
  renderMarkdown: (node: { attrs?: { src?: unknown } }) => string
}

/** Insert a drawing block carrying `src`. */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawingBlock: {
      insertDrawingBlock: (options: { src: string }) => ReturnType
    }
  }
}

export const DrawingBlock = Node.create({
  name: DRAWING_BLOCK_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-src'),
        renderHTML: (attributes: { src: string | null }) => ({
          'data-src': attributes.src ?? '',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-drawing-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-drawing-block': '' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingBlockView)
  },

  addCommands() {
    return {
      insertDrawingBlock:
        ({ src }) => ({ chain }) => chain().insertContent({
          type: this.name,
          attrs: { src },
        }).run(),
    }
  },

  // --- @tiptap/markdown integration (fields read via getExtensionField) ---
  markdownTokenName: DRAWING_BLOCK_NAME,
  markdownTokenizer: {
    name: DRAWING_BLOCK_NAME,
    level: 'block',
    // The pattern uses ^ (start-of-string anchor), so it only matches at the
    // beginning of a block — it never starts mid-paragraph. Return -1 so
    // marked's startBlock logic skips this extension entirely; otherwise
    // @tiptap/markdown's default startCb creates a throwaway Lexer that
    // hijacks the shared Tokenizer's `.lexer` reference, corrupting inline
    // tokenization for all blocks after the first paragraph.
    start: () => -1,
    tokenize(src: string) {
      const match = DRAWING_LINE.exec(src)
      if (match === null) return undefined
      return { type: DRAWING_BLOCK_NAME, raw: match[0], src: match[1] }
    },
  },
  parseMarkdown(token: { src?: unknown }) {
    return {
      type: DRAWING_BLOCK_NAME,
      attrs: { src: typeof token.src === 'string' ? token.src : '' },
    }
  },
  renderMarkdown(node: { attrs?: { src?: unknown } }) {
    const src = node.attrs?.src
    return `![[${typeof src === 'string' ? src : ''}]]`
  },
} as NodeConfig & MarkdownNodeFields)
