# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do not open a public GitHub
issue.

Use GitHub's [private vulnerability reporting](https://github.com/blinkk/vscode-agentplatform-chat-connector/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab), or email the
maintainers.

We will acknowledge your report and work with you on a fix and disclosure
timeline.

## How this extension handles credentials

This extension is designed to keep your credentials on your machine:

- **No secrets are embedded** in the extension or stored in editor settings.
- Authentication uses your local **`gcloud` CLI** — either your Application
  Default Credentials (`adc` mode) or a private, connector-owned gcloud config
  directory (`isolated` mode).
- Access tokens are obtained from `gcloud` on demand, cached in memory only, and
  refreshed automatically.
- **No telemetry** is collected. Usage/cost tracking is computed and stored
  **locally** (under `~/.config/blinkk-vscode-google-agent-platform-connector/`)
  and is never transmitted anywhere except directly to Google's Vertex AI
  endpoints to serve your chat requests.

Requests are sent only to Google Cloud's `*aiplatform.googleapis.com` endpoints,
billed to the GCP project you configure.
