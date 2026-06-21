#!/usr/bin/env node
/**
 * CI publish step invoked by changesets/action after a "Version Packages" PR
 * merges. Packages the extension once, then publishes the resulting .vsix to:
 *   - the VS Code Marketplace (requires VSCE_PAT)
 *   - Open VSX (optional; only when OVSX_PAT is set)
 *
 * vsce reads VSCE_PAT and ovsx reads OVSX_PAT from the environment, so no
 * tokens are passed on the command line.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const vsix = `${pkg.name}.vsix`;

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {stdio: 'inherit'});
}

// 1. Build the .vsix once.
run('pnpm', ['exec', 'vsce', 'package', '--no-dependencies', '-o', vsix]);

// 2. Publish to the VS Code Marketplace (required).
if (!process.env.VSCE_PAT) {
  console.error('VSCE_PAT is not set; cannot publish to the VS Code Marketplace.');
  process.exit(1);
}
run('pnpm', ['exec', 'vsce', 'publish', '--no-dependencies', '--packagePath', vsix]);

// 3. Publish to Open VSX (optional).
if (process.env.OVSX_PAT) {
  run('pnpm', ['exec', 'ovsx', 'publish', vsix, '--no-dependencies']);
} else {
  console.log('OVSX_PAT not set; skipping Open VSX publish.');
}
