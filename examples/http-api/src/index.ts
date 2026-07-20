import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  makeFetchHandler,
  WorkerEnvironment,
  WorkerExecutionContext,
} from "effect-platform-cloudflare";

interface Env {
  readonly GREETING: string;
}

const environment = Effect.map(WorkerEnvironment, (bindings) => bindings as unknown as Env);

const Routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/",
    Effect.gen(function* () {
      const env = yield* environment;
      return yield* HttpServerResponse.json({ greeting: env.GREETING, runtime: "cloudflare" });
    }),
  ),
  HttpRouter.add(
    "GET",
    "/request",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* HttpServerResponse.json({ method: request.method, url: request.url });
    }),
  ),
  HttpRouter.add(
    "GET",
    "/stream",
    HttpServerResponse.stream(
      Stream.fromIterable(["effect", " on ", "cloudflare\n"]).pipe(Stream.encodeText),
      { contentType: "text/plain; charset=utf-8" },
    ),
  ),
  HttpRouter.add(
    "POST",
    "/background",
    Effect.gen(function* () {
      const execution = yield* WorkerExecutionContext;
      yield* execution.waitUntil(Effect.sleep("25 millis"));
      return HttpServerResponse.empty({ status: 202 });
    }),
  ),
  HttpRouter.add("GET", "/failure", Effect.die("intentional example defect")),
);

const httpApp = HttpRouter.toHttpEffect(Routes).pipe(Effect.flatten);

const fetch = makeFetchHandler<never, never, unknown, Env>({
  layer: Layer.empty,
  httpApp,
});

export default { fetch } satisfies ExportedHandler<Env>;
