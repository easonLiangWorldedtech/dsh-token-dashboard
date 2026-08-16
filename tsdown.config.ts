import { defineConfig } from 'tsdown'

// Dual-face build (same shape as the reference community plugins):
// - host half   src/index.ts         -> lib/index.js   (runs in the node host process)
// - client half src/client/index.ts  -> lib/client.js  (served to the browser at
//   /plugins/token-dashboard/client.js; a closure-factory bundle, see below)
// Type declarations come from tsc -b (tsconfig.json -> lib/types), not tsdown.
// Build order in package.json: tsdown first, then tsc -b emits types.

// Client-half platform modules: the specifiers the web shell shares into the
// frozen module table. They stay external and resolve at factory-run time
// through the require() the module loader injects. Mirrors the shell's seed
// table (reference: dsh-web-ui shared/web-platform.ts); the runtime/client
// subpath rides the same table as a documented exemption.
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    fixedExtension: false,   // emit .js even for the node half (package is type: module)
    dts: false,              // types come from tsc -b
    deps: { onlyBundle: false }, // never bundle node_modules deps — the host profile resolves them
    outDir: 'lib',
    sourcemap: true,
  },
  {
    // Persistent usage Worker: a second Node entry loaded by the host half via
    // `new Worker(new URL('./usage-worker.js', import.meta.url))`. It must be
    // present in the published package, so it is part of the normal build.
    entry: { 'usage-worker': 'src/host/usage-worker.ts' },
    format: ['esm'],
    platform: 'node',
    fixedExtension: false,
    dts: false,
    deps: { onlyBundle: false },
    outDir: 'lib',
    sourcemap: true,
    clean: false,
  },
  {
    // Local maintenance CLI: dsh-token-dashboard status/verify/rebuild/...
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    fixedExtension: false,
    dts: false,
    deps: { onlyBundle: false },
    outDir: 'lib',
    sourcemap: true,
    clean: false,
  },
  {
    // The browser half is NOT a plain ESM module: the shell executes the file
    // as a classic script and expects it to register itself via
    // window.__ModuleLoader__.load({id, factory}). The banner/intro/footer wrap
    // rolldown's cjs output into exactly that closure-factory shape — without
    // it the GUI boot fails with "loaded without registering".
    name: 'client',
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    dts: false,              // dts here would wrap the banner/footer into .d.cts and break parsing
    outDir: 'lib',
    sourcemap: true,
    clean: false,            // a clean here would wipe the node-half lib/index.js above
    external: [...CLIENT_EXTERNALS],
    // tsdown auto-externalizes package deps; anything NOT in the module table
    // must inline instead — a require() the table cannot answer throws at boot.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id as never) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js', // cjs format would otherwise name it client.cjs
      banner: 'window.__ModuleLoader__.load({ id: "@apodemakeles/dsh-token-dashboard", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
