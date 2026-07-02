# Blinkk Agent Platform Chat Connector

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/blinkk.vscode-agent-platform-connector?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=blinkk.vscode-agent-platform-connector)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/blinkk.vscode-agent-platform-connector)](https://marketplace.visualstudio.com/items?itemName=blinkk.vscode-agent-platform-connector)

Adds Gemini and Claude on Gemini Enterprise Agent Platform (formerly Vertex AI)
to VS Code chat as a **native language model provider**, using your own gcloud
credentials — no API keys stored in the editor, and no local proxy or background
service. Usage is billed to **your** GCP project, not GitHub Copilot.

## Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=blinkk.vscode-agent-platform-connector),
or from the command line:

```bash
code --install-extension blinkk.vscode-agent-platform-connector
```

You can also search **Blinkk Agent Platform Chat Connector** in the Extensions
view (`Cmd`/`Ctrl`+`Shift`+`X`).

## What it does

On activation the extension registers a Language Model Chat Provider via
`vscode.lm.registerLanguageModelChatProvider` (vendor
`blinkk-google-agent-platform`). Its models appear in the Copilot model picker
under **Manage Models… → Blinkk Agent Platform Chat Connector**, labeled with the
active GCP project, e.g. `Claude Opus 4.8 (my-project)`.

For each chat turn the provider:

- converts VS Code's request messages (text, tool calls, tool results) into the
  right upstream shape — OpenAI Chat Completions for Gemini, Anthropic Messages
  for Claude;
- attaches a fresh Google access token from gcloud (ADC or the isolated store);
- streams the response back as text and tool-call parts.

A **Blinkk Agent Platform Chat Connector** status bar item shows the active
project/auth and **today's estimated cost**, and its output channel mirrors
provider logs.

### Image handling (Claude)

Claude on Vertex AI applies a **stricter per-image dimension limit** (e.g.
2576px on the long edge) once a single request carries more than 20 image (and
document) blocks — its "many-image requests" mode. Below that threshold Claude
silently downscales oversized images; at or above it, oversized images are
**rejected** with an `invalid_request_error`. Because the rejected image stays in
the conversation history, every later turn re-sends it and fails too, which would
otherwise leave the chat permanently stuck.

To prevent this, the connector keeps each Claude request **at or below 20
images**: it retains the most recent images as real attachments and replaces
older ones with a short text placeholder
(`[N earlier images omitted to stay within image limits]`). This drops the
stricter limit so any remaining large image is downscaled automatically rather
than rejected. The trimming applies only to Claude models and is logged to the
output channel.

## Prerequisites

Before the connector can serve any model you need three things set up in the GCP
project that usage will be billed to. Each step links straight to where you can
satisfy it.

1. **Install the `gcloud` CLI** and sign in.

   - Install: <https://cloud.google.com/sdk/docs/install>
   - Then either run `gcloud auth application-default login` (ADC mode) or use
     the extension's **Sign In (isolated credentials)** command.

2. **Enable the Vertex AI / Agent Platform API** (`aiplatform.googleapis.com`)
   in your project.

   - Enable it here:
     <https://console.cloud.google.com/apis/library/aiplatform.googleapis.com>
   - Your account also needs the **Vertex AI User** role
     (`roles/aiplatform.user`). Grant roles at:
     <https://console.cloud.google.com/iam-admin/iam>

3. **Enable the models in Model Garden.** Gemini models are usually available by
   default, but Claude models must be explicitly enabled and their terms
   accepted.
   - Open Model Garden:
     <https://console.cloud.google.com/agent-platform/model-garden>
   - Enable each Claude model you intend to use (e.g. Claude Opus 4.8, Claude
     Sonnet 4.5).

Finally, set the project in the extension settings
(`blinkkAgentPlatformConnector.project`) and confirm the models with the
**Check Models** command.

## Settings

All settings live under `blinkkAgentPlatformConnector.*`:

| Setting          | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `project`        | **Required** for Vertex models. GCP project billed for usage. |
| `authMode`       | `adc` (default) or `isolated`.                                |
| `authAccount`    | Optional gcloud account to pin.                               |
| `geminiLocation` | Vertex location for Gemini (default `global`).                |
| `claudeLocation` | Vertex location for Claude (default `global`).                |
| `customModels`   | Extra models to expose beyond the built-in defaults.          |

Each setting can also be overridden by a `GOOGLE_AGENT_PLATFORM_*` environment
variable. The **Gemini API** key is _not_ a setting — it lives in secret storage;
see below.

### Backends: Vertex vs. the Gemini API

Every built-in model is served by **Vertex AI / Agent Platform** (billed to your
GCP `project` via gcloud credentials), except the two models labelled
**_(Gemini API)_** in the picker:

- **Gemini 3.5 Flash (Gemini API)**
- **Gemini 3.1 Pro Preview (Gemini API)**

These route through [Google AI Studio](https://ai.google.dev/gemini-api/docs)
instead of Vertex, authenticated with a Gemini API key and **billed to the
account that owns that key** — independently of the GCP project used for the
Vertex/Claude models.

**Setting the key.** Create one at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), then run the
**Blinkk Agent Platform Chat Connector: Set Gemini API Key** command (also
reachable from the status-bar menu). The key is stored in VS Code's
[SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) —
the OS keychain — **not** in `settings.json`, so it never lands in plaintext or
in synced/committed settings. Run the command again with an empty value to clear
it.

**Env-var fallback.** If no key is stored, the connector falls back to the
`GEMINI_API_KEY` environment variable (then a `geminiApiKey` entry in the config
file, used by the CLI/proxy). A stored key takes precedence over the env var. If
neither is set, the two Gemini API models simply don't work; every Vertex-backed
model is unaffected. The status-bar menu shows which source is in effect.

To expose additional Gemini API models yourself, add a `customModels` entry with
`"backend": "gemini-api"` (only valid with the `chat` api).

## Cost tracking

The connector keeps a local, per-day estimate of how much your chat usage costs.
It never queries the GCP billing API — everything is computed and stored on your
machine. How it works:

1. **Token counts come from the API.** At the end of each chat turn the upstream
   response reports input and output token usage (Gemini's `usage` field,
   Claude's `message_start`/`message_delta` metadata).
2. **Cost is estimated from per-model pricing.** Each model carries an
   approximate price in USD per 1M tokens, and cost is
   `(inputTokens / 1M × inputPrice) + (outputTokens / 1M × outputPrice)`. You can
   override or set pricing for your own entries via the `customModels` setting.
3. **A daily tally is persisted.** Tokens, request count, and estimated cost are
   accumulated into a single record keyed by the local calendar day and saved to
   `~/.config/blinkk-vscode-google-agent-platform-connector/usage.json`. The
   tally **resets automatically at local midnight**.
4. **It's shown in the UI.** **Today's estimated cost** (and request count)
   appears in the status bar hover tooltip and in the status menu (click the
   status bar item).

The figures are an **estimate** — pricing is approximate and tokens are whatever
the API reports. Use the official
[pricing page](https://cloud.google.com/vertex-ai/generative-ai/pricing) and your
GCP billing reports for accurate numbers.

## GitHub Copilot CLI (Claude via local proxy)

Beyond the VS Code extension, the connector can serve **Claude on Agent Platform
(Vertex AI)** to [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
through a small local proxy. Copilot CLI's "bring your own model provider" mode
speaks the Anthropic Messages wire format; the proxy accepts those requests on
loopback and streams them to Vertex using your gcloud credentials.

> Currently only the **Anthropic / Claude** path is supported (Gemini's
> OpenAI-compatible path is not yet implemented).

The same [Prerequisites](#prerequisites) apply (gcloud, the Vertex AI API, and
the Claude models enabled in Model Garden).

1. **Start the proxy.** It requires Node ≥24 (see
   [Troubleshooting](#troubleshooting) if you hit a Node-version error). Set the
   GCP project that usage is billed to, then launch it:

   ```bash
   export GOOGLE_AGENT_PLATFORM_PROJECT=my-gcp-project
   nvm-exec node bin/google-agent-platform-connector.ts --proxy
   ```

   The proxy listens on `http://127.0.0.1:8787` by default (override with the
   `GOOGLE_AGENT_PLATFORM_PROXY_PORT` env var) and logs the exact variables to
   set next. Check `http://127.0.0.1:8787/health` to see the project, auth mode,
   and available Claude model ids.

2. **Point Copilot CLI at the proxy.** In the shell where you run `copilot`, set
   these environment variables:

   ```bash
   export COPILOT_PROVIDER_TYPE=anthropic
   export COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:8787
   export COPILOT_PROVIDER_API_KEY=local-proxy   # ignored; gcloud supplies the real token
   export COPILOT_MODEL=claude-opus-4-8          # any Claude catalog id
   ```

   `COPILOT_PROVIDER_API_KEY` must be non-empty but is ignored — the proxy
   injects the real gcloud bearer token upstream. Available model ids include
   `claude-opus-4-8`, `claude-opus-4-8#thinking`, `claude-sonnet-4-5`, and
   `claude-sonnet-4-5#thinking` (or run `/model` inside the CLI).

3. **Run Copilot CLI** from a trusted directory:

   ```bash
   copilot
   ```

The proxy binds to loopback only and never trusts the inbound
`COPILOT_PROVIDER_API_KEY`. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

### Verifying the proxy is actually in use

To test if the proxy is working:

- The running `--proxy` process **logs each incoming request** as you chat.
- The CLI's `/usage` command shows a per-model token breakdown for the session.

## Commands

All commands are under the **Blinkk Agent Platform Chat Connector** category.

| Command                          | Description                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `Settings`                       | Open the extension's settings in the Settings UI.                        |
| `Show Logs`                      | Reveal the output channel.                                               |
| `Check Models`                   | Probe the configured models against Vertex.                              |
| `Sign In (isolated credentials)` | Populate the connector's isolated credential store (independent of ADC). |

## Requirements

Requires VS Code >= 1.104 (the Language Model Chat Provider API is finalized
there) and the `gcloud` CLI on your PATH. Credentials come from gcloud (ADC or
the connector's isolated store); the extension does not embed secrets.

## Privacy & telemetry

This extension collects **no telemetry**. It stores no secrets in the editor.

- Authentication uses your local `gcloud` credentials; access tokens are cached
  in memory only and never written by the extension.
- The cost/usage tally is computed and stored **locally** under
  `~/.config/blinkk-vscode-google-agent-platform-connector/` and is never
  transmitted anywhere.
- Your prompts and chat content are sent **only** to Google Cloud's
  `*aiplatform.googleapis.com` endpoints to serve your requests, billed to the
  GCP project you configure.

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Development

```bash
npm install          # or pnpm install
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest unit tests
npm run build        # esbuild → dist/extension.cjs
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the
extension loaded.

### Layout

- `src/extension.ts` — VS Code host: registers the provider, status bar, commands.
- `src/vertex.ts` — dependency-free Vertex client (auth, streaming, config).
- `src/catalog.ts` — model catalog, config schema, pricing, URL helpers.
- `src/usage.ts` — local daily usage + cost tracking.
- `bin/` — standalone CLI for `--login` / `--check` (runs raw `.ts` on Node ≥24).
- `test/` — Vitest unit tests.

### Troubleshooting

**`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` or `ERR_UNKNOWN_FILE_EXTENSION` when
running the CLI / proxy.** The `bin/` scripts run TypeScript directly and require
**Node ≥24**. A pinned version is provided in `.nvmrc`. If your shell defaults to
an older Node, or aliases `pnpm`/`corepack` through another tool, the package
manager shim can run under the wrong Node and crash before the script starts.

Use `nvm` to run the script on the pinned version. For example:

```bash
nvm-exec node bin/google-agent-platform-connector.ts --proxy
```

`nvm-exec` reads `.nvmrc` and runs `node` directly (bypassing any `pnpm`
shim/alias). Alternatively, `nvm use` first and then invoke `node` or
`corepack pnpm run proxy`.

## Packaging & publishing

```bash
npm run package        # → vscode-agent-platform-connector.vsix
```

Install the `.vsix` locally with **Extensions: Install from VSIX…**, or:

```bash
code --install-extension vscode-agent-platform-connector.vsix
```

To publish to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/),
you need a publisher (`blinkk`) and a
[Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token):

```bash
npx vsce login blinkk
npm run publish:vsce
```

Optionally also publish to [Open VSX](https://open-vsx.org/) (for Cursor /
VSCodium users):

```bash
npm run publish:ovsx -- -p <OPEN_VSX_TOKEN>
```

## License

[MIT](LICENSE)
