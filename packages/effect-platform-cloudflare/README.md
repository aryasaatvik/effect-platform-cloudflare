# effect-platform-cloudflare

Run an Effect HTTP router as a Cloudflare Worker without coupling the application to a deployment
framework.

```sh
bun add effect-platform-cloudflare effect@4.0.0
```

The `0.2.x` line supports stable Effect `4.x`, starting with `4.0.0`. Effect prereleases and
other major versions are outside the supported peer range.

```ts
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpWorker } from "effect-platform-cloudflare";

interface Env {
  readonly API_ORIGIN: string;
}

class WorkerBindings extends Context.Service<WorkerBindings, Env>()("app/WorkerBindings") {}

const AppLayer = HttpRouter.add(
  "GET",
  "/",
  Effect.gen(function* () {
    const env = yield* WorkerBindings;
    return HttpServerResponse.text(`upstream: ${env.API_ORIGIN}`);
  }),
);

const fetch = HttpWorker.toWebHandler(AppLayer, {
  environment: WorkerBindings,
});

export default { fetch } satisfies ExportedHandler<Env>;
```

`HttpWorker.toWebHandler` is the Cloudflare equivalent of Effect's
`HttpRouter.toWebHandler`. It takes the router application layer directly, adds the router runtime,
renders failures, logs requests by default, and returns a standard Worker fetch handler.

The application owns the environment service key. The handler infers its `Env` parameter from that
key and provides the exact bindings through the Effect context without a cast. Both
`Context.Service` and `Context.Reference` keys are supported.

## Layer lifetimes

The application layer is built in a fresh scope for every request. Put request-owned resources such
as database connections in that graph so they cannot cross workerd event contexts.

Use `isolateLayer` only for services that are safe to share across every request handled by the
same Worker isolate:

```ts
const fetch = HttpWorker.toWebHandler(AppLayer, {
  environment: WorkerBindings,
  isolateLayer: HostServicesLayer,
});
```

Successful isolate initialization is cached. A failed build is closed and retried on the next
request. The isolate context deliberately omits Effect's `CurrentMemoMap`, so request-time layer
builds receive a fresh memo map.

## HTTP behavior

The handler uses Effect's HTTP server machinery for failure rendering, tracing, response logging,
HEAD requests, and streaming scope transfer. Set `disableLogger: true` to disable the default
response logger, or pass `middleware` using the same shape accepted by Effect's router Web handler.

Every request is interrupted with `HttpServerError.ClientAbort.annotation` when its Web Request
signal aborts. Its full Effect `Exit` is registered with Cloudflare's native
`ExecutionContext.waitUntil`, allowing finalizers to finish even when the caller disconnects.

## Background work

The Effect service is named `WorkerExecutionContext` and exposes only one operation:

```ts
const program = Effect.gen(function* () {
  const context = yield* WorkerExecutionContext;
  yield* context.waitUntil(fullyProvidedEffect);
});
```

The Effect passed to `waitUntil` must have no remaining requirements. It runs in an independent
scope, and the promise registered with Cloudflare never rejects. The native execution context is
not exposed through the Effect service.
