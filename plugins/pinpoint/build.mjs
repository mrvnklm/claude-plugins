// Builds the two distributable, dependency-free artifacts in bridge/:
//   src/server.mjs  -> bridge/server.mjs      (Node, MCP SDK inlined)
//   src/overlay.js  -> bridge/overlay.dist.js (browser IIFE, finder + html-to-image inlined)
// Run: node build.mjs
import { build } from 'esbuild'
import { chmodSync } from 'node:fs'

await build({
  entryPoints: ['src/server.mjs'],
  outfile: 'bridge/server.mjs',
  platform: 'node',
  target: 'node18',
  format: 'esm',
  bundle: true,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})
try { chmodSync('bridge/server.mjs', 0o755) } catch {}

await build({
  entryPoints: ['src/overlay.js'],
  outfile: 'bridge/overlay.dist.js',
  platform: 'browser',
  target: ['chrome110', 'firefox110', 'safari16'],
  format: 'iife',
  bundle: true,
  logLevel: 'info',
})

console.log('✓ built bridge/server.mjs and bridge/overlay.dist.js')
