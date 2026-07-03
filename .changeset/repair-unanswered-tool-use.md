---
'vscode-agent-platform-connector': patch
---

Fix recurring Vertex 400 "tool_use ids were found without tool_result blocks immediately after" by synthesizing placeholder tool results for assistant tool calls whose results never landed in the chat history (e.g. a prior turn failed or was cancelled mid-tool-call). Previously one failed tool call wedged the conversation, causing every subsequent request to fail with the same 400.
