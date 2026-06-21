# Publishing setup (Marketplace PAT)

This repo publishes to the VS Code Marketplace from GitHub Actions using a
**Marketplace Personal Access Token (PAT)** stored as the `VSCE_PAT` repo
secret. `vsce publish --pat` uses it to authenticate.

> A previous iteration used Microsoft Entra ID / OIDC workload identity
> federation. That path requires adding a service principal as a member of the
> publisher, which is not supported when the publisher is owned by a personal
> Microsoft account. The PAT flow below works regardless.

How it works at release time:

1. The version PR merges to `main`.
2. `.github/workflows/release.yml` runs the changesets action, which calls
   `pnpm run release:ci`.
3. `release-ci.mjs` packages the extension and runs `vsce publish --pat`,
   reading the token from `VSCE_PAT` (or `AZURE_PAT` as a fallback).

You only do the setup below **once**.

---

## 1. Create a Marketplace PAT

1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sigin1. Sign in to 1. Sign in to 1-> **New 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Se1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1. Sign in to 1.  1. Sign in to 1. Sign in to 1. Sign in to 1. Sign intore the PAT as a GitHub repo secret

```bash
gh secret set VSCE_PAT --repogh secret set VSCE_PAT --repogh secret set VSCE_PAT --repogh secret set VSC## 3gh secret set VSCE_PAT --repogh secret set VSCE_PAT --repogh secret set VSCEpegh secret set VSCE_PAT --repogh secret set VSCE_PAT --reecrgh secret set VSCE_PAT -et OVSXgh secret set VSCE_PAT --repogh-platgh secret set VSCE_PAT --repogh secret set VSCE_PAT --repogh secret set V.
gh secret set VSCE_PAT -e flow

1. Make a change + `pnpm changeset` + commit + push to `main`.
2. CI opens a **"Version Packages"** PR.
3. Merge it. CI bumps the version,3. Merge it. CI bumps the version,3.ia 3.e PAT.
4. Confirm at
   <https://marketplace.visualstudio.com/items?itemName=blinkk.vscode-agent-platform-connector>.

## Manual publish (fallback)

Export the PAT (or put it in a gitignored `.env` as `VSCE_PAT` / `AZURE_PAT`),
then run the publish script:

```bash
export VSCE_PAT=...        # or AZURE_PAT
node ./scripts/release-ci.mjs
```

## Troubleshooting

- **`InvalidAccessException: The requested operation is not allowed`** - the PAT
  lacks the **Marketplace > Manage** scope, or the account is not a member of the
  `blinkk` publisher.
- **`.env files should not be packaged`** - ensure `.env` is listed in
  `.vscodeignore` (it is). Never commit `.env`; it is gitignored.
