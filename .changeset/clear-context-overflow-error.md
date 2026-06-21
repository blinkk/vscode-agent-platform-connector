---
'vscode-agent-platform-connector': patch
---

Help VS Code keep conversations within the model's context window and explain
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
