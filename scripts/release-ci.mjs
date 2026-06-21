#!/usr/bin/env node
/**
 * CI publish step invoked by changesets/action after a "Version Packages" PR
 * merges. Packages the extension once, then publishes the resulting .vsix to:
 *   - the VS Code Marketplace, via Microsoft Entra ID (the prior `azure/login`
 *     OIDC step in the workflow provides the credential; vsce uses
 *     DefaultAzureCredential with `--azure-credential`). No PAT required.
 *   - Open VSX (optional; only when OVSX_PAT is set, since Open VSX is not part
 *     of Entra ID).
 *
 * For a manual publish from a workstation, run `az login` first (then this
 * script's vsce step authenticates the same way).
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

// 2. Publish to the VS Code Marketplace using Entra ID (no PAT).
run('pnpm', [
  'exec',
  'vsce',
  'publish',
  '--azure-credential',
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
