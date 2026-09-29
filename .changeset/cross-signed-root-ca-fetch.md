---
'vscode-agent-platform-connector': patch
---

Fix `fetch failed` on MDM-managed macOS devices with a cross-signed root CA

With `http.systemCertificates` enabled (the default), VS Code replaces the
global `fetch` with one that hands undici an explicit CA list built as
`[...tls.rootCertificates, ...OS trust store]`. A centrally managed macOS
device can carry a _cross-signed_ copy of a root in that store — one whose
issuer is a legacy root that Node's bundled set does not include. When the
upstream serves that cross-signed chain, OpenSSL follows the cross-signed edge
and dead-ends with `unable to get issuer certificate`, so every request the
extension makes fails with an opaque `fetch failed`.

Upstream calls now retry against the unwrapped `fetch` VS Code stashes on
`globalThis` before patching, but only after a request fails with that specific
chain error. The normal path is unchanged, so VS Code's proxy resolution
(`http.proxySupport`, which defaults to `override`) still applies for everyone
else, and certificate verification stays fully enabled on both paths.
