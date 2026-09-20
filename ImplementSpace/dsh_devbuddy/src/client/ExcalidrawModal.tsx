/**
 * Full-size Excalidraw editor shown in a modal over the DSH web surface.
 *
 * - Loads the Excalidraw bundle lazily through `excalidraw-loader.ts`
 *   (the bundle is served by the host at `/api/devbuddy-left/excalidraw-bundle.js`
 *   and is NOT part of the main client.js; this keeps the plugin's activation
 *   path free of Excalidraw's dynamic imports).
 * - Loads the referenced `.excalidraw` scene through the loopback API; a
 *   missing file starts from a blank scene.
 * - Every change is debounced (800ms) and serialized with Excalidraw's own
 *   `serializeAsJSON`, then written back to the same file. Writes are
 *   serialized (no overlapping requests); unsent edits are flushed on
 *   close (close button, backdrop click, or Escape).
 * - On a successful save the parent is told via `onSaved(src)` so the inline
 *   block refreshes its thumbnail.
 *
 * The Excalidraw stylesheet is bundled inside the Excalidraw bundle as a
 * JS string export; the modal injects it through a <style> tag once on load.
 */
import { useEffect, useRef, useState } from 'react'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { loadExcalidrawBundle, type ExcalidrawBundleAPI } from './excalidraw-loader.ts'
import { api } from './api.ts'

const SAVE_DEBOUNCE_MS = 800

/** <style> id for the injected Excalidraw stylesheet (once per document). */
const EXCALIDRAW_STYLE_ID = 'dbl-excalidraw-styles'

export interface ExcalidrawModalLabels {
  title: string
  close: string
  saving: string
  loadError: string
  saveError: string
}

export interface ExcalidrawModalProps {
  projectId: string
  src: string
  labels: ExcalidrawModalLabels
  onClose: () => void
  onSaved: (src: string) => void
}

interface SceneInitialData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements: readonly any[]
  appState: Record<string, unknown>
  files: BinaryFiles
  scrollToContent: boolean
}

export function ExcalidrawModal({
  projectId,
  src,
  labels,
  onClose,
  onSaved,
}: ExcalidrawModalProps): JSX.Element {
  const [bundle, setBundle] = useState<ExcalidrawBundleAPI | null>(null)
  const [initialData, setInitialData] = useState<SceneInitialData | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>('')

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const closedRef = useRef(false)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  // --- Lazy-load the Excalidraw bundle + inject its CSS ---
  useEffect(() => {
    let cancelled = false
    loadExcalidrawBundle()
      .then(b => {
        if (cancelled) return
        setBundle(b)
        if (document.getElementById(EXCALIDRAW_STYLE_ID) === null) {
          const tag = document.createElement('style')
          tag.id = EXCALIDRAW_STYLE_ID
          tag.dataset.plugin = 'excalidraw'
          tag.textContent = b.excalidrawCssText
          document.head.appendChild(tag)
        }
      })
      .catch(() => { if (!cancelled) setFatal(labels.loadError) })
    return () => { cancelled = true }
  }, [labels.loadError])

  // --- Load the scene file ---
  useEffect(() => {
    if (bundle === null) return
    let cancelled = false
    ;(async (): Promise<void> => {
      try {
        const view = await api.readDrawing(projectId, src)
        if (cancelled) return
        if (view.exists && view.content.trim() !== '') {
          const scene = JSON.parse(view.content) as {
            elements?: unknown
            appState?: unknown
            files?: unknown
          }
          setInitialData({
            elements: Array.isArray(scene.elements)
              ? scene.elements as SceneInitialData['elements']
              : [],
            appState: (scene.appState ?? {}) as Record<string, unknown>,
            files: (scene.files ?? {}) as BinaryFiles,
            scrollToContent: true,
          })
        } else {
          setInitialData({
            elements: [],
            appState: {},
            files: {},
            scrollToContent: false,
          })
        }
      } catch {
        if (!cancelled) setFatal(labels.loadError)
      }
    })()
    return () => { cancelled = true }
  }, [bundle, projectId, src, labels.loadError])

  const doSave = async (): Promise<void> => {
    const content = latestRef.current
    if (content === null) return
    if (inFlightRef.current) {
      // A write is in flight; retry shortly so the newest bytes still land.
      timerRef.current = setTimeout(() => { void doSave() }, 300)
      return
    }
    inFlightRef.current = true
    setNotice(labels.saving)
    try {
      await api.writeDrawing(projectId, src, content)
      setNotice('')
      onSavedRef.current(src)
    } catch {
      setNotice(labels.saveError)
    } finally {
      inFlightRef.current = false
    }
  }

  const scheduleSave = (content: string): void => {
    latestRef.current = content
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void doSave()
    }, SAVE_DEBOUNCE_MS)
  }

  const flushAndClose = async (): Promise<void> => {
    if (closedRef.current) return
    closedRef.current = true
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await doSave()
    onClose()
  }

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        void flushAndClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loading = bundle === null || initialData === null

  return (
    <div
      className="dbl-draw-modal-backdrop"
      role="presentation"
      // eslint-disable-next-line react/jsx-no-bind
      onClick={() => { void flushAndClose() }}
    >
      <div
        className="dbl-draw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={event => event.stopPropagation()}
      >
        <div className="dbl-draw-modal-head">
          <span className="dbl-draw-modal-title">✎ {labels.title}: {src}</span>
          <span className="dbl-draw-modal-notice">{notice}</span>
          <button
            type="button"
            className="dbl-linkbtn"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => { void flushAndClose() }}
          >
            {labels.close}
          </button>
        </div>
        <div className="dbl-draw-modal-body">
          {fatal !== null
            ? <div className="dbl-draw-modal-fatal">{fatal}</div>
            : loading
              ? <div className="dbl-draw-modal-fatal">{labels.saving}</div>
              : (() => {
                  const ExcalidrawComponent = bundle!.Excalidraw
                  return (
                    <ExcalidrawComponent
                      initialData={initialData}
                      excalidrawAPI={(instance: ExcalidrawImperativeAPI) => { apiRef.current = instance }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onChange={(elements: any, appState: any, files: any) => {
                        scheduleSave(bundle!.serializeAsJSON(elements, appState, files, 'local'))
                      }}
                    />
                  )
                })()
          }
        </div>
      </div>
    </div>
  )
}
