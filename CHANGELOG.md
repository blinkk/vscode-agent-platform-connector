# vscode-agent-platform-connector

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
