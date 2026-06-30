---
'vscode-agent-platform-connector': patch
---

Recover from context-window overflow errors by trimming and retrying. When a
long session exceeds the model's context window, the connector now parses the
actual token counts from the upstream 400, re-trims the oldest history with a
tighter budget, and retries (up to 3 times) instead of failing the turn.
