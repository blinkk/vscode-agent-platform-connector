#!/usr/bin/env node
/**
 * CI publish step invoked by changesets/action after a "Version Packages" PR
 * merges. Packages the extension once, then publishes the resulting .vsix to:
 *   - the VS Code Marketplace, via a Marketplace Personal Access Token in the
 *     `VSCE_PAT` env var (or `AZURE_PAT` as a fallback). The PAT must belong to
 *     an account that is a member of the target publisher with the
 *     Marketplace > Manage scope.
 *   - Open VSX (optional; only when OVSX_PAT is set, since Open VSX uses its own
 *     token).
 *
 * For a manual publish from a workstation, export VSCE_PAT (or AZURE_PAT)
 * first, then run this script.
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

// 2. Publish to the VS Code Marketplace using a PAT.
const pat = process.env.VSCE_PAT || process.env.AZURE_PAT;
if (!pat) {
  throw new Error(
    'No Marketplace PAT found. Set VSCE_PAT (or AZURE_PAT) with a token that ' +
      'has the Marketplace > Manage scope, as a repo secret in CI or in the ' +
      'environment locally.'
  );
}
run('pnpm', [
  'exec',
  'vsce',
  'publish',
  '--pat',
  pat,
  '--no-dependencies',
  '--packagePath',
  vsix,
]);

// 3. Publish to Open VSX (optional).
if (process.env.OVSX_PAT) {
  run('pnpm', ['exec', 'ovsx', 'publish', vsix, '--no-dependencies']);
} else {
  console.log('OVSX_PAT not set; skipping Open VSX publish.');
}
