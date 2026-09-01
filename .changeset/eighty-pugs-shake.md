---
'vscode-agent-platform-connector': patch
---

Fix parallel tool calls being reported to Claude as failures. VS Code delivers
each result of a parallel tool-call batch as its own message, but the Anthropic
request builder retired the whole set of pending `tool_use` ids after the first
result turn. Every later result was dropped as unpaired and then replaced with a
synthetic "Tool call did not complete" error, so working tools looked broken and
the agent serialized its work retrying them. Consecutive tool-result turns are
now merged before the request is built (and before context trimming, so a batch
is trimmed as one unit), and pending ids are retired individually as they are
answered. Synthesized placeholders are now logged and reworded to read as a
transcript gap rather than a tool failure.
