# effect-platform-cloudflare

Run an Effect HTTP router as a Cloudflare Worker without coupling the application to a deployment
framework.

```sh
bun add effect-platform-cloudflare effect@4.0.0-beta.98
```

This repository is intentionally deployment-framework independent. The package turns an Effect
HTTP application into a standard module Worker `fetch` handler while preserving the Worker runtime
lifecycle:

- isolate services are built once and failed cold starts can retry
- every request receives a fresh Effect scope
- complete request execution is pinned with `ExecutionContext.waitUntil`
- client disconnects interrupt the request as `HttpServerError.ClientAbort`
- streaming responses own their request scope until the body closes
- background Effects receive their own scope through `WorkerExecutionContext`

See the [package README](packages/effect-platform-cloudflare/README.md) for usage and lifecycle
guidance.

## Workspace

- `packages/effect-platform-cloudflare` — reusable runtime package
- `examples` — deployable HTTP and lifecycle probes
- `tests` — lifecycle tests plus real workerd coverage

## Development

```sh
bun install
bun run check
bun run test
bun run test:workers
bun run build
```

## Releasing

Releases are versioned and published locally with [Tegami](https://tegami.fuma-nama.dev). Add a
pending changelog under `.tegami/`, run the local version flow, merge the generated release changes,
then publish from an authenticated checkout of `main`. See [docs/releasing.md](docs/releasing.md)
for the release and verification checklist.

## License

MIT
