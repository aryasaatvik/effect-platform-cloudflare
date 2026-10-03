---
packages:
  "npm:effect-platform-cloudflare": minor
---

### Support stable Effect V4

Use Effect's stable HTTP modules and require Effect `^4.0.0`. Upgrade applications from Effect prereleases to stable V4 before using this release.

The public `HttpWorker.toWebHandler` API and Worker lifecycle behavior remain unchanged: isolated request scopes, shared isolate initialization, abort interruption, streaming ownership, and complete handler pinning through `waitUntil`.
