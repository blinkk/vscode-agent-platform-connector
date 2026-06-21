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

| Setting          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `project`        | **Required.** GCP project billed for usage.          |
| `authMode`       | `adc` (default) or `isolated`.                       |
| `authAccount`    | Optional gcloud account to pin.                      |
| `geminiLocation` | Vertex location for Gemini (default `global`).       |
| `claudeLocation` | Vertex location for Claude (default `global`).       |
| `customModels`   | Extra models to expose beyond the built-in defaults. |

Each setting can also be overridden by a `GOOGLE_AGENT_PLATFORM_*` environment
variable.

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
