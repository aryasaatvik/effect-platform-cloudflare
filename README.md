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
bun install --frozen-lockfile
bun run check
bun run build
bun run test:artifact
bun run release:check
```

`check` runs formatting, lint, the root TypeScript check (including scripts/config), offline lifecycle
tests, and the offline publish-gate proof. `build` emits supported JavaScript and declarations in
`dist`. `test:artifact` builds, packs, installs into a temporary consumer, and checks published
exports, declarations, and runtime behavior. It may read the package registry to install Effect.
`test:workers` runs the separate real workerd suite. `release:check` runs all these gates sequentially.
Both ordinary and generated version PRs run the full release check in CI. Use the Bun version in
`packageManager`; GitHub Actions reads that same pin.

## Releasing

Releases use [Tegami](https://tegami.fuma-nama.dev), GitHub Actions, and npm trusted publishing.
Run validation locally and commit a pending changelog under `.tegami/` with the implementation.
Manually run `prepare-release.yml` to open a version PR against `main`; merging that PR publishes
the approved version with npm provenance and creates its GitHub release. See [docs/releasing.md](docs/releasing.md) for setup,
review, and verification.

## License

MIT
