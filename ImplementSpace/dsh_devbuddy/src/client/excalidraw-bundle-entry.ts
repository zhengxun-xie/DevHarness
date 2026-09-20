/**
 * Entry point for the separate Excalidraw bundle (lib/excalidraw-bundle.js).
 *
 * This file is built by a dedicated tsdown config that:
 *   - inlines all Excalidraw dynamic imports (locales, mermaid, …) into one
 *     self-contained file, so the DSH module loader's single-asset rule is
 *     satisfied without touching the main client.js.
 *   - externalizes React / react-dom / jsx-runtime (resolved from the
 *     platform seed at load time via the loader's synthetic `require`).
 *   - virtualizes `@excalidraw/excalidraw/index.css` into a JS string export
 *     via the `excalidrawCssInlinePlugin` rolldown plugin.
 *
 * The main client.js no longer imports Excalidraw at all; it fetches this
 * bundle on demand through `excalidraw-loader.ts` when the user opens a
 * drawing, keeping the plugin's activation path lean.
 */
export { Excalidraw, serializeAsJSON, exportToBlob, restore, restoreElements } from '@excalidraw/excalidraw'
export { default as excalidrawCssText } from '@excalidraw/excalidraw/index.css'
