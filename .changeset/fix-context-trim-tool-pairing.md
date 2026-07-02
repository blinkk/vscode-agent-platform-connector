---
'vscode-agent-platform-connector': patch
---

Fix a second cause of the Anthropic tool-pairing 400 ("tool_use ids were found
without tool_result blocks" / "unexpected tool_use_id in tool_result blocks").
`fitRequestToContext`'s oldest-message trimming (used to keep long
conversations within the model's context window) could drop an assistant
`tool_use` turn while keeping its paired `tool_result` reply, or vice versa,
producing an invalid sequence upstream. Trimming now treats a `tool_use`
assistant turn and its immediately-following `tool_result` turn as one atomic
unit that is always dropped or kept together.
