import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, Schedule, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  makeFetchHandler,
  WorkerEnvironment,
  WorkerExecutionContext,
} from "effect-platform-cloudflare";

interface Env {
  readonly STATE: DurableObjectNamespace<LifecycleState>;
}

interface ProbeState {
  readonly acquired?: boolean;
  readonly background?: boolean;
  readonly released?: boolean;
}

const stateStub = (env: Env) => env.STATE.getByName("global");

const record = (env: Env, id: string, event: keyof ProbeState): Promise<void> =>
  stateStub(env)
    .fetch(`https://state/record?id=${encodeURIComponent(id)}&event=${event}`, { method: "POST" })
    .then(() => undefined);

class IsolateIdentity extends Context.Service<IsolateIdentity, string>()(
  "example/IsolateIdentity",
) {}

const IsolateLive = Layer.effect(
  IsolateIdentity,
  Effect.gen(function* () {
    const bindings = yield* WorkerEnvironment;
    const env = bindings as unknown as Env;
    yield* Effect.promise(() => record(env, "isolate", "acquired"));
    yield* Effect.sleep("75 millis");
    return crypto.randomUUID();
  }),
);

const httpApp = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const bindings = yield* WorkerEnvironment;
  const execution = yield* WorkerExecutionContext;
  const isolate = yield* IsolateIdentity;
  const env = bindings as unknown as Env;
  const url = new URL(request.url, "https://worker.invalid");
  const id = url.searchParams.get("id") ?? crypto.randomUUID();

  switch (url.pathname) {
    case "/probe":
      return yield* HttpServerResponse.json({ isolate });
    case "/state":
      return HttpServerResponse.fromWeb(
        yield* Effect.promise(() =>
          stateStub(env).fetch(`https://state/?id=${encodeURIComponent(id)}`),
        ),
      );
    case "/background":
      yield* execution.waitUntil(
        Effect.sleep("50 millis").pipe(
          Effect.andThen(Effect.promise(() => record(env, id, "background"))),
        ),
      );
      return HttpServerResponse.empty({ status: 202 });
    case "/hold":
      return yield* Effect.acquireRelease(
        Effect.promise(() => record(env, id, "acquired")),
        () => Effect.promise(() => record(env, id, "released")),
      ).pipe(
        Effect.andThen(Effect.sleep("30 seconds")),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
      );
    case "/stream":
      yield* Effect.promise(() => record(env, id, "acquired"));
      yield* Effect.addFinalizer(() => Effect.promise(() => record(env, id, "released")));
      return HttpServerResponse.stream(
        Stream.fromIterable(["scope", " transferred", "\n"]).pipe(
          Stream.schedule(Schedule.spaced("40 millis")),
          Stream.encodeText,
        ),
        { contentType: "text/plain; charset=utf-8" },
      );
    default:
      return HttpServerResponse.text("not found", { status: 404 });
  }
});

const fetch = makeFetchHandler<IsolateIdentity, never, unknown, Env>({
  layer: IsolateLive,
  httpApp,
});

export class LifecycleState extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "unknown";
    const current = (await this.ctx.storage.get<ProbeState>(id)) ?? {};

    if (request.method === "POST" && url.pathname === "/record") {
      const event = url.searchParams.get("event");
      if (event !== "acquired" && event !== "background" && event !== "released") {
        return new Response("invalid event", { status: 400 });
      }
      await this.ctx.storage.put(id, { ...current, [event]: true });
      return new Response(null, { status: 204 });
    }

    return Response.json(current);
  }
}

export default { fetch } satisfies ExportedHandler<Env>;
