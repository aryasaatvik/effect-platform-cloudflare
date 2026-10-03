## effect-platform-cloudflare@0.2.0

### Support stable Effect V4

Use Effect's stable HTTP modules and require Effect `^4.0.0`. Upgrade applications from Effect prereleases to stable V4 before using this release.

The public `HttpWorker.toWebHandler` API and Worker lifecycle behavior remain unchanged: isolated request scopes, shared isolate initialization, abort interruption, streaming ownership, and complete handler pinning through `waitUntil`.

## effect-platform-cloudflare@0.1.0

### Initial release

- Run Effect HTTP router layers as standard Cloudflare Worker fetch handlers.
- Separate isolate-safe services from request-scoped application resources.
- Preserve Effect HTTP failure rendering, request logging, HEAD responses, and streaming scopes.
- Map request aborts to `ClientAbort` and pin complete request fibers with `waitUntil`.
- Provide typed Worker bindings and a restricted `WorkerExecutionContext` service.
