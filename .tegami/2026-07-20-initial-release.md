---
packages:
  "npm:effect-platform-cloudflare": minor
---

## Initial release

- Run Effect HTTP router layers as standard Cloudflare Worker fetch handlers.
- Separate isolate-safe services from request-scoped application resources.
- Preserve Effect HTTP failure rendering, request logging, HEAD responses, and streaming scopes.
- Map request aborts to `ClientAbort` and pin complete request fibers with `waitUntil`.
- Provide typed Worker bindings and a restricted `WorkerExecutionContext` service.
