import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

/** Absolute path of the production Excalidraw stylesheet. */
const EXCALIDRAW_CSS_FILE = fileURLToPath(new URL(
  './node_modules/@excalidraw/excalidraw/dist/prod/index.css',
  import.meta.url,
))

/** Virtual module id (no `.css` suffix → tsdown's css guard never sees it). */
const EXCALIDRAW_CSS_VIRTUAL = '\0excalidraw-index-css.js'

/**
 * Bundle plugin that turns the side-effect-only
 * `import '@excalidraw/excalidraw/index.css'` into a JS module that
 * default-exports the stylesheet text. The DSH module loader serves a
 * single client.js with no extra assets, so the CSS cannot ship as a
 * separate style.css; the editor injects it through a <style> tag at mount.
 */
const excalidrawCssInlinePlugin = {
  name: 'excalidraw-css-inline',
  resolveId(source: string): string | null {
    return source === '@excalidraw/excalidraw/index.css' ? EXCALIDRAW_CSS_VIRTUAL : null
  },
  load(id: string): string | null {
    if (id !== EXCALIDRAW_CSS_VIRTUAL) return null
    const css = readFileSync(EXCALIDRAW_CSS_FILE, 'utf8')
    return `export default ${JSON.stringify(css)};`
  },
}

/**
 * DevBuddy LEFT-sidebar standalone plugin build — two artifacts from one
 * tsdown invocation:
 *
 *   1. lib/index.js  — Node ESM, the host half (registered via cordis.patch.yml).
 *      Serves /api/devbuddy-left/* loopback JSON routes; no runtime npm deps.
 *   2. lib/client.js — browser CJS closure-factory consumed by the DSH module
 *      loader: it must start with `window.__ModuleLoader__.load({ id, factory })`
 *      and resolve the platform-seeded runtime rows (react, ui-primitives)
 *      through the injected require. Everything else is inlined.
 *
 * Styles ship as a TypeScript string the React tree injects once into
 * document.head (scoped by the `dbl-` prefix), so no CSS-module pipeline is
 * needed outside the DSH workspace build.
 */

const PLUGIN_ID = 'dsh-devbuddy-left'

/**
 * Shared runtime rows the DSH module loader answers for browser bundles.
 * React comes from the platform seed (see dsh-client-web `seed.ts`); the
 * primitives row — including MarkdownText — is seeded by the same table, so
 * the factory resolves it through the injected require instead of inlining
 * it (parity with dsh-better-sidebar, which consumes MarkdownText the same
 * way). Build-time types still come from the devDependency.
 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
])

const host: UserConfig = {
  name: `${PLUGIN_ID}/host`,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  // Package is type:module; emit .js (ESM) instead of tsdown's .mjs default.
  fixedExtension: false,
  dts: false,
  clean: true,
  sourcemap: true,
}

const client: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: id => CLIENT_EXTERNALS.has(id),
    alwaysBundle: id => !CLIENT_EXTERNALS.has(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/**
 * Separate Excalidraw bundle — built as a self-contained CJS file that the
 * host serves at `GET /api/devbuddy-left/excalidraw-bundle.js`.  The main
 * client.js fetches and evaluates this on demand (when a drawing is
 * opened), keeping the plugin's activation path free of Excalidraw's
 * dynamic imports (which previously required `inlineDynamicImports` on the
 * main client and broke the cordis slot-reconcile during boot).
 *
 * React / react-dom / jsx-runtime are externalized (resolved at load time
 * via the loader's synthetic `require`).  All Excalidraw internal dynamic
 * imports (locales, mermaid, …) are inlined into this single file.
 */
const excalidrawBundle: UserConfig = {
  name: `${PLUGIN_ID}/excalidraw-bundle`,
  entry: { 'excalidraw-bundle': 'src/client/excalidraw-bundle-entry.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  plugins: [excalidrawCssInlinePlugin],
  dts: false,
  clean: false,
  sourcemap: false,
  deps: {
    neverBundle: id => CLIENT_EXTERNALS.has(id),
    alwaysBundle: id => !CLIENT_EXTERNALS.has(id),
  },
  outputOptions: {
    entryFileNames: 'excalidraw-bundle.js',
    inlineDynamicImports: true,
  },
}

export default [host, client, excalidrawBundle]
