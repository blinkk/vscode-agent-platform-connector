---
'vscode-agent-platform-connector': minor
---

Add a Google AI Studio (Gemini API) backend alongside Vertex. Models can now set
`backend: 'gemini-api'` to route through the AI Studio OpenAI-compatible endpoint,
billed to the API key's account instead of the GCP project. Ships two new picker
entries — **Gemini 3.5 Flash (Gemini API)** and **Gemini 3.1 Pro Preview (Gemini
API)** — and lets `customModels` opt into the same backend.

The API key is stored in VS Code's SecretStorage (OS keychain), not in
`settings.json`. Set it with the new **Set Gemini API Key** command; when no key
is stored the connector falls back to the `GEMINI_API_KEY` env var.
