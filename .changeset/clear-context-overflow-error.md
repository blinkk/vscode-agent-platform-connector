---
'vscode-agent-platform-connector': patch
---

Give a clear, actionable error when a conversation exceeds the model's context
window. Previously a context-overflow 400 from Vertex surfaced the misleading
generic "check your project, location, and model settings" hint; it now reports
that the conversation is too long (including the token counts when available) and
suggests starting a new chat, trimming large context, or switching to a
larger-context model.
