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

**Manual:**

1. `pnpm changeset` — describe each change (creates a file under `.changeset/`).
2. `pnpm version` — consume pending changesets: bumps `package.json` and updates
   `CHANGELOG.md`. Commit the result.
3. `az login` (so `vsce` can get an Entra token), then `pnpm release` — build,
   package, and `vsce publish --azure-credential` to the Marketplace. Use
   `pnpm release:ovsx` to also publish to Open VSX (needs `OVSX_PAT`).

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
