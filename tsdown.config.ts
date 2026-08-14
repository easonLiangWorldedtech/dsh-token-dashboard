import { defineConfig } from 'tsdown'

// Dual-face build (same shape as the reference community plugins):
// - host half   src/index.ts         -> lib/index.js   (runs in the node host process)
// - client half src/client/index.ts  -> lib/client.js  (served to the browser at
//   /plugins/token-dashboard/client.js; bundled per the dsh.client declaration)
// Type declarations come from tsc -b (tsconfig.json -> lib/types), not tsdown.
// Build order in package.json: tsdown first (cleans lib), then tsc -b emits types.
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
    entry: { client: 'src/client/index.ts' },
    format: ['esm'],
    platform: 'browser',
    dts: false,
    outDir: 'lib',
    sourcemap: true,
  },
])
