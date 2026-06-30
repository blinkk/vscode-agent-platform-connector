# Contributing

Thanks for your interest in improving the Blinkk Agent Platform Chat Connector!

## Development setup

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint
pnpm test            # vitest unit tests
pnpm run build       # esbuild → dist/extension.cjs
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the
extension loaded.

> The dev CLI (`bin/`) runs raw TypeScript via Node ≥ 24 type-stripping, so a
> recent Node is required for local development. The published extension itself
> ships as a bundled `.cjs` and has no such requirement.

## Project layout

- `src/extension.ts` — VS Code host: registers the provider, status bar, commands.
- `src/vertex.ts` — dependency-free Vertex client (auth, streaming, config).
- `src/catalog.ts` — model catalog, config schema, pricing, URL helpers.
- `src/usage.ts` — local daily usage + cost tracking.
- `bin/` — standalone CLI for `--login` / `--check`.
- `test/` — Vitest unit tests.

## Pull requests

1. Keep changes focused; one logical change per PR.
2. Add or update tests for behavior changes.
3. Make sure `typecheck`, `lint`, `test`, and `build` all pass (CI runs these).
4. For any user-facing change, run `pnpm changeset` and commit the generated
   file. Pick `patch` / `minor` / `major` and write a short summary — this drives
   the version bump and `CHANGELOG.md` at release time.

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for
versioning, similar to [`@blinkk/root`](https://github.com/blinkk/rootjs).

**Automated (preferred):** Pushing to `main` runs
`.github/workflows/release.yml`. When changesets are pending it opens a
"Version Packages" PR; merging that PR publishes to the VS Code Marketplace.
Publishing authenticates with **Microsoft Entra ID via OIDC** (no stored PAT) —
see [Marketplace publishing auth](#marketplace-publishing-auth) for the one-time
Azure setup.

**Manual:** when releasing from a workstation (bypassing the CI flow), do **all**
of the following as one operation so git, GitHub, and the Marketplace stay in
sync. Skipping the tag or the GitHub Release leaves the repo looking
un-released even though the extension shipped.

1. **Pre-flight checks.** `pnpm run typecheck && pnpm run lint && pnpm test &&
   pnpm run build` — these mirror CI; do not release if any fail.
2. **Changeset.** `pnpm changeset` — describe each user-facing change (creates a
   file under `.changeset/`). Commit the code + changeset and push to `main`.
3. **Version bump.** `pnpm version` — consumes pending changesets: bumps
   `package.json` and updates `CHANGELOG.md`.
4. **Commit + tag + push.** Commit the bump as `ci: release <version>`, tag it
   `v<version>`, then push **both** the commit and the tag:

   ```bash
   git add -A && git commit -m "ci: release <version>"
   git tag v<version>
   git push origin main && git push origin v<version>
   ```

5. **GitHub Release.** The changesets CI action only creates the GitHub Release
   when the "Version Packages" PR merges, so on a manual release create it
   yourself from the new `CHANGELOG.md` section:

   ```bash
   gh release create v<version> --title "v<version>" --latest \
     --notes "<changelog notes for this version>"
   ```

6. **Publish to the Marketplace.** Load the Marketplace PAT from the gitignored
   `.env` (so it never appears on the command line or in logs) and run the same
   script CI uses:

   ```bash
   set -a && . ./.env && set +a   # loads VSCE_PAT / AZURE_PAT
   node ./scripts/release-ci.mjs  # packages + vsce publish (+ Open VSX if OVSX_PAT)
   ```

7. **Verify + clean up.** Confirm the Marketplace shows the new version
   (`pnpm exec vsce show blinkk.vscode-agent-platform-connector --json`) and the
   GitHub Release is Latest (`gh release list`), then remove the local
   `*.vsix` artifact.

### Marketplace publishing auth

Global Azure DevOps PATs are retired Dec 1, 2026, so this repo publishes with
Microsoft Entra ID workload identity federation instead. CI auth is configured
via two GitHub **repository variables** (not secrets — they are not sensitive):

- `AZURE_CLIENT_ID` — client ID of the Entra app registration / managed identity
  federated to this repo.
- `AZURE_TENANT_ID` — the Entra tenant ID.

The app registration must be added as a member of the `blinkk` Marketplace
publisher with the **Contributor** role. Open VSX (optional) still uses an
`OVSX_PAT` repo secret. See `docs/PUBLISHING.md` for the full one-time setup.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
