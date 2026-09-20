/**
 * React NodeView for a drawingBlock node.
 *
 * Renders a fitted PNG thumbnail of the referenced `.excalidraw` scene
 * (loaded through the DevBuddy loopback API and rasterized by
 * drawing-render.ts); empty scenes and missing files get a compact
 * placeholder. Clicking the block (or Enter/Space) opens the full editor in
 * a modal — opened through `DrawingBlockContext`, provided once by the
 * surrounding RichTextEditor.
 *
 * After a modal save the provider bumps `changedSrc`/`changedAt` so the
 * matching block re-fetches its thumbnail without reloading the document.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { api } from './api.ts'
import { renderDrawingThumbnail } from './drawing-render.ts'

export interface DrawingBlockContextValue {
  /** Project the current editor belongs to; needed to resolve drawing files. */
  projectId: string
  /** Open the full Excalidraw editor for this reference. */
  openDrawing: (src: string) => void
  /** Last modified drawing src + monotonic timestamp; 0 = never. */
  changedSrc: string | null
  changedAt: number
  /** Localized copy. */
  editLabel: string
  emptyLabel: string
  missingLabel: string
  errorLabel: string
}

export const DrawingBlockContext = createContext<DrawingBlockContextValue | null>(null)

type BlockState = 'loading' | 'empty' | 'ready' | 'missing' | 'error'

export function DrawingBlockView({ node, selected }: NodeviewPropsCompat): JSX.Element {
  const context = useContext(DrawingBlockContext)
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [blockState, setBlockState] = useState<BlockState>('loading')
  const objectUrlRef = useRef<string | null>(null)

  const open = (): void => { context?.openDrawing(src) }

  useEffect(() => {
    if (context === null) return
    let cancelled = false
    setBlockState('loading')
    setThumbnail(prev => {
      if (prev !== null) URL.revokeObjectURL(prev)
      return null
    })
    objectUrlRef.current = null
    ;(async (): Promise<void> => {
      try {
        const view = await api.readDrawing(context.projectId, src)
        if (cancelled) return
        if (!view.exists) { setBlockState('missing'); return }
        const url = await renderDrawingThumbnail(view.content)
        if (cancelled) {
          if (url !== null) URL.revokeObjectURL(url)
          return
        }
        objectUrlRef.current = url
        setThumbnail(url)
        setBlockState(url === null ? 'empty' : 'ready')
      } catch {
        if (!cancelled) setBlockState('error')
      }
    })()
    return () => {
      cancelled = true
      if (objectUrlRef.current !== null) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
    // changedAt triggers a refetch of the thumbnail after a modal save.
  }, [context, src, context?.changedAt])

  const label = blockState === 'missing'
    ? context?.missingLabel
    : blockState === 'error'
      ? context?.errorLabel
      : context?.emptyLabel

  return (
    <div
      className="dbl-draw"
      data-state={blockState}
      data-selected={selected}
      role="button"
      tabIndex={0}
      title={context?.editLabel}
      aria-label={src}
      // eslint-disable-next-line react/jsx-no-bind
      onClick={open}
      // eslint-disable-next-line react/jsx-no-bind
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      <span className="dbl-draw-glyph">✎</span>
      {blockState === 'ready' && thumbnail !== null
        ? <img className="dbl-draw-img" src={thumbnail} alt={src} draggable={false} />
        : <span className="dbl-draw-label">{label}</span>}
      <span className="dbl-draw-name">{src}</span>
    </div>
  )
}

/**
 * Structural typing around @tiptap/react's NodeViewProps: only the fields we
 * read, so this module is insensitive to minor version drift in the package.
 */
interface NodeviewPropsCompat extends Pick<NodeViewProps, 'selected'> {
  node: Pick<NodeViewProps['node'], 'attrs'>
}
