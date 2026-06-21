# Publishing setup (Microsoft Entra ID, no PAT)

This repo publishes to the VS Code Marketplace from GitHub Actions using
**Microsoft Entra ID workload identity federation (OIDC)** — there is no
long-lived Personal Access Token stored anywhere. (Global Azure DevOps PATs are
retired on December 1, 2026.)

How it works at release time:

1. The version PR merges to `main`.
2. `.github/workflows/release.yml` runs `azure/login@v2` with OIDC, which
   exchanges a GitHub-issued token for a short-lived Microsoft Entra token.
3. `vsce publish --azure-credential` uses that token to publish.

You only do the setup below **once**.

---

## Prerequisites

- An Azure subscription + Entra (Azure AD) tenant (a free Azure account is
  fine). Sign in: <https://portal.azure.com>.
- The `blinkk` publisher created at
  <https://marketplace.visualstudio.com/manage> (publisher ID must equal
  `"publisher": "blinkk"` in `package.json`).
- Azure CLI installed locally (`brew install azure-cli`) and `az login` done,
  **or** use the Azure Portal equivalents.
- `gh` authenticated for setting the repo variables.

---

## 1. Create an Entra app registration

```bash
az ad app create --display-name "vscode-agent-platform-connector-publisher"
```

Note the `appId` (this is the **client ID**) from the output. Then create a
service principal for it:

```bash
APP_ID="<appId from above>"
az ad sp create --id "$APP_ID"
```

Get your tenant ID:

```bash
az account show --query tenantId -o tsv
```

## 2. Add a federated credential for this GitHub repo

This is what lets GitHub Actions authenticate as the app without a secret.
Create a file `federated.json`:

```json
{
  "name": "github-release-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:blinkk/vscode-agent-platform-connector:ref:refs/heads/main",
  "description": "GitHub Actions release workflow on main",
  "audiences": ["api://AzureADTokenExchange"]
}
```

```bash
az ad app federated-credential create --id "$APP_ID" --parameters federated.json
```

> The `subject` must exactly match the workflow's trigger. `ref:refs/heads/main`
> covers pushes to `main` (which is where the publish step runs). If you later
> publish from tags or environments, add additional federated credentials with
> the matching subject (e.g. `repo:OWNER/REPO:environment:production`).

## 3. Authorize the identity in the Marketplace publisher

The Entra identity must be a member of the `blinkk` publisher with
**Contributor**.

1. Go to <https://marketplace.visualstudio.com/manage/publishers/blinkk>.
2. Open the **Members** (or **Security**) tab → **Add**.
3. Add the app registration (search by its display name / client ID) and assign
   the **Contributor** role.

> If the Marketplace UI only lets you add users (not app registrations
> directly), add the app's **service principal**; some tenants surface it by the
> display name set in step 1.

## 4. Set the GitHub repo variables

These are **variables**, not secrets — they are identifiers, not credentials:

```bash
gh variable set AZURE_CLIENT_ID --repo blinkk/vscode-agent-platform-connector --body "$APP_ID"
gh variable set AZURE_TENANT_ID --repo blinkk/vscode-agent-platform-connector --body "$(az account show --query tenantId -o tsv)"
```

## 5. (Optional) Open VSX

Open VSX is not part of Entra ID and still uses a token. Create one at
<https://open-vsx.org> (Settings → Access Tokens) and add it as a secret:

```bash
gh secret set OVSX_PAT --repo blinkk/vscode-agent-platform-connector
```

If `OVSX_PAT` is unset, CI simply skips the Open VSX publish.

---

## Test the release flow

1. Make a change + `pnpm changeset` + commit + push to `main`.
2. CI opens a **"Version Packages"** PR.
3. Merge it. CI bumps the version, then publishes to the Marketplace via OIDC.
4. Confirm at
   <https://marketplace.visualstudio.com/items?itemName=blinkk.vscode-agent-platform-connector>.

## Manual publish (fallback)

```bash
az login
pnpm version        # if there are pending changesets
pnpm release        # vsce publish --azure-credential
pnpm release:ovsx   # optional, needs OVSX_PAT in env
```

## Troubleshooting

- **`AADSTS70021: No matching federated identity record found`** — the
  `subject` in the federated credential doesn't match the workflow context.
  Verify it is exactly `repo:blinkk/vscode-agent-platform-connector:ref:refs/heads/main`.
- **403/401 from the Marketplace** — the app registration isn't a Contributor
  member of the `blinkk` publisher, or the publisher ID doesn't match
  `package.json`.
- **`azure/login` skipped** — `AZURE_CLIENT_ID` repo variable is empty (the
  `if: vars.AZURE_CLIENT_ID != ''` guard); set it per step 4.
