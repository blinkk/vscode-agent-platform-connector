---
'vscode-agent-platform-connector': patch
---

Stop leaking VS Code/Copilot internal `cache_control` markers into tool-result
text. Tool results can nest prompt-cache breakpoint data parts; the converter
previously JSON-stringified them into the text sent upstream, which surfaced a
raw `{"$mid":...,"mimeType":"cache_control","data":"..."}` blob in the model's
view of the conversation. These internal control parts are now skipped when
extracting tool-result text.
