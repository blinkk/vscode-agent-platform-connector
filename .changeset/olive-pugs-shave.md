---
'vscode-agent-platform-connector': minor
---

Add **Gemini 3.8 Flash** to the built-in model catalog, served by Vertex /
Agent Platform (`google/gemini-3.8-flash`) with a 1M-token input window and a
65,536-token output cap.

Move **Gemini 3.1 Pro Preview** to Vertex / Agent Platform
(`google/gemini-3.1-pro-preview`), so it is billed to your GCP project and no
longer needs a `GEMINI_API_KEY`. It also loses the "(Gemini API)" picker suffix
and now shows the project instead. No built-in model uses the `gemini-api`
backend anymore; it remains available via `customModels`.

Remove the superseded **Gemini 3.5 Flash** entries (both the Vertex
`google/gemini-3.5-flash` and the Gemini API `gemini-3.5-flash` backends).

Remove **Claude Fable 5** and **Claude Fable 5 – High**.

Any removed model can be re-added via the `customModels` setting.

Correct the cost-estimate pricing for **Claude Opus 4.8**, **Claude Opus 5**
(both $15/$75 → $5/$25) and **Claude Sonnet 5** ($3/$15 → $2/$10) to match
current Agent Platform list prices. The "today's estimated cost" readout was
overstating these models by up to 3x.
