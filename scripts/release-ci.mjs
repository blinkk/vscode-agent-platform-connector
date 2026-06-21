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

/**
 * Like `run`, but tolerates a registry that already has this version. When the
 * extension was published out-of-band (e.g. manually from a workstation), the
 * registry rejects the duplicate version; treat that as a non-fatal skip so the
 * changesets action can still proceed to create the GitHub Release and tag.
 * Any other failure is re-thrown.
 */
function runAllowingAlreadyPublished(cmd, args, registry) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  try {
    execFileSync(cmd, args, {stdio: ['inherit', 'pipe', 'pipe']});
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    process.stdout.write(output);
    if (/already exists/i.test(output)) {
      console.log(
        `${pkg.name} v${pkg.version} is already published to ${registry}; ` +
          'skipping.'
      );
      return;
    }
    throw err;
  }
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
runAllowingAlreadyPublished(
  'pnpm',
  ['exec', 'vsce', 'publish', '--pat', pat, '--no-dependencies', '--packagePath', vsix],
  'the VS Code Marketplace'
);

// 3. Publish to Open VSX (optional).
if (process.env.OVSX_PAT) {
  runAllowingAlreadyPublished(
    'pnpm',
    ['exec', 'ovsx', 'publish', vsix, '--no-dependencies'],
    'Open VSX'
  );
} else {
  console.log('OVSX_PAT not set; skipping Open VSX publish.');
}
