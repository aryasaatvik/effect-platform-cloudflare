# effect-platform-cloudflare

An Effect HTTP runtime adapter for Cloudflare Workers.

This repository is intentionally deployment-framework independent. The package turns an Effect
HTTP application into a standard module Worker `fetch` handler while preserving the Worker runtime
lifecycle:

- isolate services are built once and failed cold starts can retry
- every request receives a fresh Effect scope
- complete request execution is pinned with `ExecutionContext.waitUntil`
- client disconnects interrupt the request as `HttpServerError.ClientAbort`
- streaming responses own their request scope until the body closes
- background Effects receive their own scope through `WorkerExecutionContext`

The package is private while the core runtime, deployable examples, and Samva integration are being
validated. Publishing, public repository visibility, and CI are deliberately deferred.

## Workspace

- `packages/effect-platform-cloudflare` — reusable runtime package
- `tests` — lifecycle tests plus a real workerd smoke test

## Development

```sh
bun install
bun run check
bun run test
bun run test:workers
bun run build
```
