/**
 * Excalidraw scene parsing + inline thumbnail rendering for drawing block
 * NodeViews.
 *
 * The scene JSON is restored through Excalidraw's own `restoreElements` /
 * `restore` (the same pipeline the editor uses on open), then rasterized to
 * a fitted PNG via `exportToBlob`. Empty scenes return null so the block
 * shows a lightweight placeholder until something is drawn.
 *
 * The Excalidraw API is loaded lazily through `excalidraw-loader.ts` — the
 * bundle is served by the host and is NOT part of the main client.js.
 */
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import { loadExcalidrawBundle, type ExcalidrawBundleAPI } from './excalidraw-loader.ts'

/** Maximum rendered thumbnail width; the sidebar column is ~300px. */
const THUMBNAIL_MAX_WIDTH = 280
/** Minimum export dimension so an empty scene never yields a 0x0 image. */
const MIN_DIMENSION = 80
/** Pixels of scene padding kept around the drawing bounds. */
const SCENE_PADDING = 24

export interface RestoredScene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appState: Record<string, any>
  files: BinaryFiles
}

/** Parse + restore a serialized Excalidraw scene. Throws on bad JSON. */
export function restoreScene(jsonText: string, api: ExcalidrawBundleAPI): RestoredScene {
  const raw = JSON.parse(jsonText) as {
    elements?: unknown
    appState?: unknown
    files?: unknown
  }
  const elements = api.restoreElements(
    Array.isArray(raw.elements) ? raw.elements : [],
    null,
  )
  const appState = api.restore(
    (raw.appState ?? {}),
    elements,
    null,
  )
  const files = (raw.files ?? {}) as BinaryFiles
  return { elements, appState, files }
}

/**
 * Render a fitted PNG thumbnail of the scene. Returns an object URL (caller
 * revokes on unmount), or null when the scene has no visible elements.
 */
export async function renderDrawingThumbnail(jsonText: string): Promise<string | null> {
  const api = await loadExcalidrawBundle()
  const scene = restoreScene(jsonText, api)
  const visible = scene.elements.filter(element => !element.isDeleted)
  if (visible.length === 0) return null

  const minX = Math.min(...visible.map(e => e.x))
  const minY = Math.min(...visible.map(e => e.y))
  const maxX = Math.max(...visible.map(e => e.x + e.width))
  const maxY = Math.max(...visible.map(e => e.y + e.height))

  const contentWidth = Math.max(MIN_DIMENSION, maxX - minX)
  const contentHeight = Math.max(MIN_DIMENSION, maxY - minY)
  const width = contentWidth + SCENE_PADDING * 2
  const height = contentHeight + SCENE_PADDING * 2
  const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / width)

  // The export frames the full canvas; offset elements so the drawing sits
  // inside the padded bounds.
  const shifted = scene.elements.map(element => ({
    ...element,
    x: element.x - minX + SCENE_PADDING,
    y: element.y - minY + SCENE_PADDING,
  }))

  const blob = await api.exportToBlob({
    elements: shifted,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: scene.files,
    getDimensions: () => ({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      // Crucial: getDimensions must also emit the shrink factor. Supplying
      // smaller width/height alone shrinks the canvas but keeps the elements
      // at full-scale coordinates, so only the top-left corner survives.
      scale,
    }),
    mimeType: 'image/png',
  })
  return URL.createObjectURL(blob)
}
