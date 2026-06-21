---
"vscode-agent-platform-connector": patch
---

Fix image attachments being dropped. The provider now forwards image content parts to Vertex: Gemini receives them as `image_url` data URIs and Claude as base64 `image` source blocks, so vision-capable models can see attached images.
