# vscode-agent-platform-connector

## 0.3.0

### Minor Changes

- b243398: Add Claude Fable 5 and Claude Sonnet 5 to the built-in model catalog, each with a base and extended-reasoning ("High") variant.

## 0.2.1

### Patch Changes

- b61ec44: Recover from context-window overflow errors by trimming and retrying. When a
  long session exceeds the model's context window, the connector now parses the
  actual token counts from the upstream 400, re-trims the oldest history with a
  tighter budget, and retries (up to 3 times) instead of failing the turn.

## 0.2.0

### Minor Changes

- - Add a local Anthropic-compatible proxy (`--proxy`) so the GitHub Copilot CLI
    can use Claude on Vertex through the connector.
  - Prune older images from Claude requests to stay within the model's image
    limits, keeping long multimodal conversations working.
  - Re-label the high-effort model variants in the picker as "… – High" (e.g.
    "Claude Opus 4.8 – High") for clarity.
  - Add Prettier as the shared formatter, wired into ESLint and VS Code
    format-on-save so editor auto-fix and CLI output stay in sync.

## 0.1.5

### Patch Changes

- 2eb3eb2: Prevent "conversation is too long" failures by fitting requests to the model's
  context window. The Claude models now advertise their true 1,000,000-token input
  limit (was an overly conservative 200,000), and a new last-line safeguard trims
  the oldest non-system messages when the estimated request would still exceed the
  limit — so a runaway conversation degrades gracefully instead of failing with an
  upstream Vertex 400. System messages and the final user turn are always kept.

## 0.1.4

### Patch Changes

- fe1d0c8: Stop leaking VS Code/Copilot internal `cache_control` markers into tool-result
  text. Tool results can nest prompt-cache breakpoint data parts; the converter
  previously JSON-stringified them into the text sent upstream, which surfaced a
  raw `{"$mid":...,"mimeType":"cache_control","data":"..."}` blob in the model's
  view of the conversation. These internal control parts are now skipped when
  extracting tool-result text.

## 0.1.3

### Patch Changes

- bca8976: Help VS Code keep conversations within the model's context window and explain
  overflows clearly.

  - Token counting now includes image attachments (previously counted as zero) and
    adds a small per-message/part framing overhead, so the estimate is
    conservative rather than optimistic. This lets VS Code's chat client trim or
    summarize history before the request overflows the model, instead of after.
  - When an overflow does happen, the Vertex 400 now surfaces a clear, actionable
    message (including the token counts when available) telling the user to start a
    new chat, trim large context, or switch to a larger-context model — instead of
    the misleading generic "check your project, location, and model settings" hint.
  - Explicitly drop VS Code/Copilot internal control parts (e.g. `cache_control`
    prompt-cache markers) during message conversion so they are never forwarded to
    the upstream model. These were already ignored, but the guard is now named and
    intentional, hardening against accidental forwarding in future changes.

## 0.1.2

### Patch Changes

- 27c98bd: Fix image attachments being dropped. The provider now forwards image content parts to Vertex: Gemini receives them as `image_url` data URIs and Claude as base64 `image` source blocks, so vision-capable models can see attached images.

## 0.1.1

### Patch Changes

- Make the "Project" item in the status menu interactive: clicking "Project: Not set" (or the current project) now opens a validated input prompt to set the GCP project, which is saved to your VS Code settings.

## 0.1.0

Initial preview release.

### Added

- Native VS Code Language Model Chat Provider (`vscode.lm.registerLanguageModelChatProvider`)
  exposing Gemini and Claude on Gemini Enterprise Agent Platform (formerly
  Vertex AI), billed to your own GCP project.
- Built-in models: Gemini 3.5 Flash, Claude Opus 4.8 (+ thinking), Claude
  Sonnet 4.5 (+ thinking).
- gcloud-based authentication with two modes: `adc` (Application Default
  Credentials) and `isolated` (the connector's own private credential store).
- Streaming responses with tool/function calling for both Gemini (OpenAI
  Chat Completions shape) and Claude (Anthropic Messages shape).
- `customModels` setting to expose additional Model Garden models without a code
  change.
- Local, per-day **estimated cost tracking** shown in the status bar tooltip and
  status menu (resets at local midnight; never queries the billing API).
- Status bar item, output channel, and commands: Settings, Show Logs,
  Check Models, Sign In (isolated credentials).
- Actionable upstream error messages (enable API / role / Model Garden links).
