/**
 * Lazy loader for the Excalidraw bundle.
 *
 * The main client.js no longer statically imports `@excalidraw/excalidraw`;
 * instead it calls `loadExcalidrawBundle()` when a drawing is opened.  The
 * bundle is built as a separate CJS file (`lib/excalidraw-bundle.js`) and
 * served by the host at `GET /api/devbuddy-left/excalidraw-bundle.js`.
 *
 * The bundle uses `require('react')`, `require('react-dom')`, and
 * `require('react/jsx-runtime')` for its externals.  At load time we provide
 * a synthetic `require` that resolves those to the platform-seeded React
 * instances the main client.js already received from the module loader,
 * then evaluate the CJS code in a `Function` sandbox and return
 * `module.exports`.
 *
 * The result is cached for the document lifetime; the second call returns
 * the same `Promise` so concurrent opens don't double-fetch.
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'

/** Type-loose handle on the loaded Excalidraw API. */
export interface ExcalidrawBundleAPI {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  Excalidraw: React.ComponentType<any>
  serializeAsJSON: (...args: any[]) => string
  exportToBlob: (opts: any) => Promise<Blob>
  restore: (...args: any[]) => Record<string, any>
  restoreElements: (...args: any[]) => any[]
  /* eslint-enable @typescript-eslint/no-explicit-any */
  excalidrawCssText: string
}

let cached: ExcalidrawBundleAPI | null = null
let inflight: Promise<ExcalidrawBundleAPI> | null = null

/**
 * Fetch the Excalidraw bundle from the host and evaluate it, providing
 * React / react-dom / jsx-runtime through a synthetic `require`.
 *
 * @returns the cached Excalidraw API (Excalidraw component,
 * serializeAsJSON, exportToBlob, restore, restoreElements, CSS text).
 */
export function loadExcalidrawBundle(): Promise<ExcalidrawBundleAPI> {
  if (cached !== null) return Promise.resolve(cached)
  if (inflight !== null) return inflight

  inflight = (async (): Promise<ExcalidrawBundleAPI> => {
    const resp = await fetch('/api/devbuddy-left/excalidraw-bundle.js')
    if (!resp.ok) throw new Error(`excalidraw bundle fetch failed: ${resp.status}`)
    const code = await resp.text()

    const require = (mod: string): unknown => {
      if (mod === 'react') return React
      if (mod === 'react-dom') return ReactDOM
      if (mod === 'react/jsx-runtime') return jsxRuntime
      if (mod === 'react/jsx-dev-runtime') return jsxRuntime
      throw new Error(`excalidraw bundle: unresolvable require "${mod}"`)
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const factory = new Function(
      'require', 'module', 'exports',
      code + '\nreturn module.exports;',
    ) as (req: typeof require, mod: { exports: Record<string, unknown> }, exp: Record<string, unknown>) => ExcalidrawBundleAPI

    const moduleObj = { exports: {} as Record<string, unknown> }
    cached = factory(require, moduleObj, moduleObj.exports)
    return cached
  })()

  return inflight
}
