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
4. Add a `CHANGELOG.md` entry under `[Unreleased]` for user-facing changes.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
