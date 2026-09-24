import type { UserConfig } from 'tsdown'

/**
 * DevReviewer standalone plugin build — two artifacts from one tsdown
 * invocation, same dual-face pattern as dsh-devbuddy-left:
 *
 *   1. lib/index.js  — Node ESM host half (registered via cordis.patch.yml).
 *      Serves /api/devreviewer/* loopback JSON routes; no runtime npm deps.
 *   2. lib/client.js — browser CJS closure-factory consumed by the DSH module
 *      loader, registering a RIGHT sidebar tab (tabs + slots two-phase).
 *
 * Styles ship as a TypeScript string injected once into document.head
 * (scoped by the `dbr-` prefix).
 */

const PLUGIN_ID = 'dsh-devreviewer'

/** Platform-seeded runtime rows resolved through the injected require. */
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

export default [host, client]
