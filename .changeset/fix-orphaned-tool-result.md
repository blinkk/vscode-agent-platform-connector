---
'vscode-agent-platform-connector': patch
---

Fix Anthropic 400 ("unexpected `tool_use_id` found in `tool_result` blocks") by
dropping orphaned `tool_result` blocks when building the Claude Messages body.
When VS Code trims chat history (or a prior turn failed mid-tool-call), a
`tool_result` could be left with no matching `tool_use` in the preceding
assistant turn; `buildClaudeBody` now filters unpaired results and skips the
turn when none pair, keeping the required `tool_use` -> `tool_result` adjacency.
