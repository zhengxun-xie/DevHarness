import type { UserConfig } from 'tsdown'

/**
 * DevTask standalone plugin build — two artifacts from one tsdown invocation:
 *
 *   1. lib/index.js  — Node ESM, the host half (registered via cordis.patch.yml).
 *      Serves /api/devtask/* loopback JSON routes; no runtime npm deps.
 *   2. lib/client.js — browser CJS closure-factory consumed by the DSH module
 *      loader: it must start with `window.__ModuleLoader__.load({ id, factory })`
 *      and resolve the platform-seeded runtime rows through the injected
 *      require. Everything else is inlined.
 *
 * Styles ship as a TypeScript string the React tree injects once into
 * document.head (scoped by the `dtk-` prefix), so no CSS-module pipeline is
 * needed outside the DSH workspace build.
 */

const PLUGIN_ID = 'dsh-devtask'

/**
 * Shared runtime rows the DSH module loader answers for browser bundles.
 * React comes from the platform seed (see dsh-client-web `seed.ts`); the
 * primitives row is seeded by the same table.
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

export default [host, client]