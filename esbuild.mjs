/**
 * Bundles the VS Code extension host (src/extension.ts) and its shared connector
 * code (src/*.ts) into a single CommonJS file the extension host can require.
 * The standalone CLI still runs the raw .ts directly under Node >=24; only the
 * extension needs bundling because the VS Code extension host does not do native
 * TypeScript type-stripping.
 */

import {build} from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // `vscode` is provided by the extension host at runtime; never bundle it.
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const {context} = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  console.log('[esbuild] watching extension…');
} else {
  await build(options);
}
