/**
 * Lazy loader for the Excalidraw bundle.
 *
 * The main client.js no longer statically imports `@excalidraw/excalidraw`;
 * instead it calls `loadExcalidrawBundle()` when a drawing is opened.  The
 * bundle is built as a separate CJS file (`lib/excalidraw-bundle.js`) and
 * served by the host at `GET /api/devbuddy-left/excalidraw-bundle.js`.
 *
 * The bundle uses `require('react')`, `require('react-dom')`, and
 * `require('react/jsx-runtime')` for its externals, plus a module-scope
 * `require('crypto')` from `uuid`'s Node entry (see the shim below).  At load
 * time we provide a synthetic `require` that resolves those to the
 * platform-seeded React instances the main client.js already received from
 * the module loader (crypto maps onto Web Crypto), then evaluate the CJS code
 * in a `Function` sandbox and return `module.exports`.
 *
 * The sandbox additionally injects `process` and `Buffer` shims: the bundle's
 * React build reads `process.env.NODE_ENV`, its Emscripten runtime probes
 * `process.versions`, and its bundled `nanoid` fills its entropy pool with
 * `Buffer.allocUnsafe` during the editor's first render. Without the shims
 * those bare globals throw `ReferenceError` at eval or render time.
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

/**
 * Minimal `node:crypto` shim backed by the browser's Web Crypto.
 *
 * The CJS bundle carries `uuid`'s Node entry (`dist-node/v4.js`), which does
 * `require("crypto")` at module scope and calls `randomFillSync` (plus a
 * `default` access through ESM interop). Browsers have no Node crypto, so the
 * synthetic require serves this shim; every call maps 1:1 onto Web Crypto.
 */
const cryptoShim: Record<string, unknown> = {
  randomUUID: (): string => {
    const g = globalThis.crypto
    if (typeof g.randomUUID === 'function') return g.randomUUID()
    // RFC 4122 v4 from getRandomValues (fallback for non-secure contexts).
    const b = new Uint8Array(16)
    g.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  },
  randomFillSync: <T extends ArrayBufferView>(buf: T): T => {
    globalThis.crypto.getRandomValues(buf)
    return buf
  },
}
cryptoShim.default = cryptoShim

/**
 * Minimal `process` shim for the Excalidraw bundle's browser evaluation.
 *
 * The CJS bundle carries React's `process.env.NODE_ENV` dev/prod checks and
 * Excalidraw's Emscripten/WASM runtime, which probes `process` to pick the
 * Node vs. web environment. The bundle is evaluated in a bare `Function`
 * sandbox (parameters `require` / `module` / `exports` only) where `process`
 * is undefined, so an unguarded `process.env` reads throws
 * `ReferenceError: process is not defined` at bundle eval time. `versions` is
 * deliberately empty (no `.node` string) so Emscripten keeps its existing WEB
 * path — identical to the state where `process` is simply absent.
 */
const processShim: Record<string, unknown> = {
  env: { NODE_ENV: 'production' },
  browser: true,
  versions: {},
  platform: 'browser',
  argv: [],
  // Only reachable on Emscripten's Node path, already disabled by the empty
  // `versions`; these no-op stubs are a defensive fallback should that check
  // ever resolve against a bare `process` reference.
  on: (): void => {},
  off: (): void => {},
  exit: (): void => {},
  cwd: (): string => '',
}

/**
 * Minimal `Buffer` shim for the Excalidraw bundle's browser evaluation.
 *
 * Excalidraw's dependency tree ships the Node flavour of `nanoid`, whose
 * entropy pool is filled with `Buffer.allocUnsafe(...)` on the editor's first
 * render (element-id generation) — an unguarded reference that throws
 * `ReferenceError: Buffer is not defined` in the sandbox. A SheetJS crc32
 * helper additionally does `new Buffer(str)` for long strings, and the font
 * inliner prefers `Buffer.from(bytes).toString("base64")` over `btoa`
 * whenever `Buffer` exists — so once defined, those call shapes must WORK.
 *
 * The shim is a Uint8Array subclass: byte indexing, `.length`, and
 * `crypto.getRandomValues` (via the `crypto` require shim) all behave, and
 * `toString` gains real utf8/base64 decoding.
 */
class ShimBuffer extends Uint8Array {
  toString(encoding = 'utf8'): string {
    if (encoding === 'utf8' || encoding === 'utf-8') return new TextDecoder().decode(this)
    // base64 — chunked to stay below engine argument-count limits.
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < this.length; i += CHUNK) {
      binary += String.fromCharCode(...this.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  }
}

function shimBufferFromBytes(bytes: Uint8Array): ShimBuffer {
  const out = new ShimBuffer(bytes.length)
  out.set(bytes)
  return out
}

/** Node-shaped Buffer façade over ShimBuffer. Callable with or without `new`. */
type BufferShimFn = {
  (value: string | Uint8Array | ArrayBuffer, encoding?: string): ShimBuffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (value: any, encoding?: string): ShimBuffer
  from(value: string | Uint8Array | ArrayBuffer, encoding?: string): ShimBuffer
  alloc(size: number): ShimBuffer
  allocUnsafe(size: number): ShimBuffer
  allocUnsafeSlow(size: number): ShimBuffer
  isBuffer(value: unknown): boolean
  byteLength(value: string): number
}
const BufferShim = function Buffer(
  value: string | Uint8Array | ArrayBuffer,
  encoding?: string,
): ShimBuffer {
  if (typeof value === 'string') {
    if (encoding === 'base64') {
      const binary = atob(value)
      const out = new ShimBuffer(binary.length)
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
      return out
    }
    return shimBufferFromBytes(new TextEncoder().encode(value))
  }
  if (value instanceof Uint8Array) return shimBufferFromBytes(value)
  return new ShimBuffer(value)
} as BufferShimFn
BufferShim.from = (value, encoding) => BufferShim(value, encoding)
BufferShim.alloc = size => new ShimBuffer(size)
BufferShim.allocUnsafe = size => new ShimBuffer(size)
BufferShim.allocUnsafeSlow = size => new ShimBuffer(size)
BufferShim.isBuffer = value => value instanceof ShimBuffer
BufferShim.byteLength = value => new TextEncoder().encode(value).length

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
      if (mod === 'crypto') return cryptoShim
      throw new Error(`excalidraw bundle: unresolvable require "${mod}"`)
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const factory = new Function(
      'require', 'module', 'exports', 'process', 'Buffer',
      code + '\nreturn module.exports;',
    ) as (
      req: typeof require,
      mod: { exports: Record<string, unknown> },
      exp: Record<string, unknown>,
      proc: Record<string, unknown>,
      buf: BufferShimFn,
    ) => ExcalidrawBundleAPI

    const moduleObj = { exports: {} as Record<string, unknown> }
    cached = factory(require, moduleObj, moduleObj.exports, processShim, BufferShim)
    return cached
  })()

  return inflight
}
