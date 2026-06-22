---
'vscode-agent-platform-connector': patch
---

Prevent "conversation is too long" failures by fitting requests to the model's
context window. The Claude models now advertise their true 1,000,000-token input
limit (was an overly conservative 200,000), and a new last-line safeguard trims
the oldest non-system messages when the estimated request would still exceed the
limit — so a runaway conversation degrades gracefully instead of failing with an
upstream Vertex 400. System messages and the final user turn are always kept.
