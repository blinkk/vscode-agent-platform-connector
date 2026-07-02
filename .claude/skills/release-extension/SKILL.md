---
name: release-extension
version: 1.0.0
description: |
  Release + publish the Blinkk Agent Platform Chat Connector VS Code extension.
  Lands the current work via PR, lets Changesets open the version-bump PR, merges
  it to trigger the CI Marketplace publish, then creates the matching git tag +
  GitHub Release (CI does NOT create these). Use when asked to "release", "publish
  the extension", "ship a release", "cut a release", or "publish to the marketplace".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

## What this skill does

Drives the full release for this repo (`blinkk/vscode-agent-platform-connector`).
The pipeline is **Changesets + GitHub Actions**; the actual Marketplace publish
runs in CI, not locally. Do NOT run `vsce publish` from a workstation.

The release has two automated legs and one manual leg:

1. **Land the change** → push a changeset to `main`. The `release.yml` workflow
   sees the pending changeset and opens/updates a **"ci: release" Version Packages
   PR** (branch `changeset-release/main`) that bumps the version + writes CHANGELOG.
2. **Merge the Version Packages PR** → the same workflow, now finding no
   changesets, runs `pnpm run release:ci` (`scripts/release-ci.mjs`), which
   `vsce package`s and `vsce publish`es to the Marketplace using the `VSCE_PAT`
   repo secret. Open VSX is skipped unless `OVSX_PAT` is set.
3. **Create the git tag + GitHub Release manually.** CI does **not** do this —
   every historical release (v0.2.0 … v0.3.2) is authored by the human, and the
   custom publish script emits nothing Changesets recognizes, so no tag/release
   is auto-created. You must create `vX.Y.Z` yourself.

## Preconditions (check first)

- `gh auth status` is logged in (SSH remote is `github`).
- There is a changeset for the pending work: `ls .changeset/*.md` shows a file
  other than `README.md`/`config.json`. If missing, STOP and create one (or run
  `pnpm changeset`) — without it the version never bumps. Feature = `minor`,
  bugfix = `patch`.
- Working tree changes are committed (this skill assumes the code is ready).

## Steps

### 1. Verify locally, then land via PR

Run the same gates CI runs, so a red build never reaches `main`:

```bash
pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build
```

If the current work isn't on `main` yet, branch, commit (include the changeset),
push, and open a PR:

```bash
git checkout -b <type>/<slug>          # e.g. feat/gemini-api-backend
git add -A && git commit -F - <<'EOF'
<type>: <summary>

<body>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git push -u github HEAD
gh pr create --base main --head "$(git branch --show-current)" \
  --title "<type>: <summary>" --body "<PR body>"
```

Wait for CI green, then squash-merge:

```bash
gh pr checks <PR#> --watch --interval 15
gh pr merge <PR#> --squash --delete-branch
```

### 2. Merge the Version Packages PR (this publishes to the Marketplace)

Merging step 1 triggers `release.yml`, which opens/updates the version PR. Wait
for it, then inspect the bump before merging:

```bash
# Find the release PR (title "ci: release", branch changeset-release/main)
gh pr list --state open --search "ci: release in:title" --json number,headRefName

git fetch github changeset-release/main
git show github/changeset-release/main:package.json | grep '"version"'   # new version
git show github/changeset-release/main:CHANGELOG.md | head -20
```

Confirm the new version is what you expect (feature → minor, fix → patch), then
squash-merge with the conventional subject so `main` history reads
`ci: release X.Y.Z`:

```bash
gh pr merge <releasePR#> --squash --subject "ci: release X.Y.Z"
```

Watch the publish run to success:

```bash
gh run list --workflow=release.yml --limit 3 \
  --json databaseId,displayTitle,status,conclusion \
  -q '.[] | "\(.databaseId) [\(.status)/\(.conclusion // "-")] \(.displayTitle)"'
gh run watch <publishRunId> --interval 15 --exit-status
```

> **Reading the publish log:** `runAllowingAlreadyPublished` in
> `scripts/release-ci.mjs` **pipes** `vsce publish` output and only prints it on
> error. So a *successful* publish shows the `$ pnpm exec vsce publish …` echo and
> then **nothing** before "OVSX_PAT not set; skipping". Silence = success. A real
> failure throws and fails the step. Don't mistake the empty output for a no-op.

### 3. Create the git tag + GitHub Release (manual — CI won't)

```bash
git fetch github main && git reset --hard github/main     # land on "ci: release X.Y.Z"
V=$(node -p "require('./package.json').version")
# Extract this version's CHANGELOG section for the release notes:
awk "/^## ${V//./\\.}\$/{f=1;next} /^## [0-9]/{if(f)exit} f" CHANGELOG.md \
  | sed '/^### /d' > /tmp/relnotes.md
git tag -a "v$V" -m "v$V" github/main
git push github "v$V"
gh release create "v$V" --title "v$V" --notes-file /tmp/relnotes.md --latest
```

### 4. Verify the Marketplace propagated

The Marketplace API/`vsce show` lags a few minutes behind a successful upload —
poll until the new version appears (don't conclude failure from the first check):

```bash
for i in $(seq 1 8); do
  v=$(npx --yes @vscode/vsce show blinkk.vscode-agent-platform-connector 2>/dev/null \
      | grep -A1 "Version  Last" | tail -1 | awk '{print $1}')
  echo "attempt $i: marketplace latest = ${v:-unknown}"
  [ "$v" = "$V" ] && { echo "PUBLISHED ✓"; break; }
  sleep 30
done
```

## Done when

- `main` has a `ci: release X.Y.Z` commit; the Version Packages PR is merged.
- The `release.yml` publish run is green.
- `vX.Y.Z` tag + GitHub Release exist and the Release is marked Latest.
- `vsce show blinkk.vscode-agent-platform-connector` reports `X.Y.Z`.

## Gotchas / notes

- **Never** `vsce publish` locally — the `VSCE_PAT` lives only in CI. Local
  publish bypasses the pipeline and can double-publish.
- **Open VSX** is skipped unless `OVSX_PAT` is added as a repo secret; the
  Marketplace is the only target today.
- If the version PR doesn't appear after a merge to `main`, there was no pending
  changeset — add one and push again.
- Merging the Version Packages PR is the irreversible, outward-facing step
  (it publishes publicly). Confirm the version + changelog before merging it.
- CI runners warn about "Node 20 deprecated"; harmless.
