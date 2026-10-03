import { Context, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpWorker, WorkerExecutionContext } from "effect-platform-cloudflare";

interface Env {
  readonly GREETING: string;
}

class WorkerBindings extends Context.Service<WorkerBindings, Env>()(
  "example/http-api/WorkerBindings",
) {}

const Routes = Layer.mergeAll(
  HttpRouter.add(
    "*",
    "/",
    Effect.gen(function* () {
      const env = yield* WorkerBindings;
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

const fetch = HttpWorker.toWebHandler(Routes, {
  environment: WorkerBindings,
});

export default { fetch } satisfies ExportedHandler<Env>;
