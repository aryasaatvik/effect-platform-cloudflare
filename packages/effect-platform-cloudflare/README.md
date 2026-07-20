# effect-platform-cloudflare

Build Cloudflare Worker HTTP handlers from Effect applications without coupling the application to
a deployment framework.

```ts
import { Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { makeFetchHandler, WorkerEnvironment } from "effect-platform-cloudflare";

interface Env {
  readonly API_ORIGIN: string;
}

const httpApp = Effect.gen(function* () {
  const environment = yield* WorkerEnvironment;
  const env = environment as unknown as Env;
  return HttpServerResponse.text(`upstream: ${env.API_ORIGIN}`);
});

const fetch = makeFetchHandler<never, never, never, Env>({
  layer: Layer.empty,
  httpApp,
});

export default { fetch };
```

`WorkerEnvironment` deliberately stores the raw binding record without claiming a package-level
environment type. Applications validate or narrow it at their boundary.

## Worker lifecycle

`makeFetchHandler` builds the supplied layer at isolate scope and caches successful initialization.
A failed initialization is not cached. Each event creates a fresh request scope, and the full
request Exit is registered with Cloudflare's native `ExecutionContext.waitUntil`.

Normal responses close request resources before the handler promise resolves. Streaming responses
transfer scope ownership to the response body so resources remain live until the stream closes or
fails. Request abort signals interrupt the Effect application with
`HttpServerError.ClientAbort.annotation`, allowing Effect's HTTP machinery to render status 499.

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
