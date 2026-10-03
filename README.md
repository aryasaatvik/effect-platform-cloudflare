# effect-platform-cloudflare

Run an Effect HTTP router as a Cloudflare Worker without coupling the application to a deployment
framework.

```sh
bun add effect-platform-cloudflare effect
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

Releases use [Tegami](https://tegami.fuma-nama.dev), GitHub Actions, and npm trusted publishing.
Run validation locally and commit a pending changelog under `.tegami/` with the implementation.
Manually run `prepare-release.yml` to open a version PR against `main`; merging that PR publishes
the approved version with npm provenance and creates its GitHub release. See [docs/releasing.md](docs/releasing.md) for setup,
review, and verification.

## License

MIT
