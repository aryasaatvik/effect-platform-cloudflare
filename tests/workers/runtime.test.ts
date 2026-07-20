import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { HttpWorker } from "../../packages/effect-platform-cloudflare/src/index.ts";

class TestEnvironment extends Context.Service<TestEnvironment, Record<string, never>>()(
  "test/workerd/TestEnvironment",
) {}
class Probe extends Context.Service<Probe, number>()("test/workerd/Probe") {}

describe("Cloudflare Worker runtime", () => {
  it("runs an Effect HTTP router under a real workerd execution context", async () => {
    const handler = HttpWorker.toWebHandler(
      HttpRouter.add("*", "/*", Effect.succeed(HttpServerResponse.text("workerd ready"))),
      { environment: TestEnvironment, disableLogger: true },
    );
    const context = createExecutionContext();

    const response = await handler(new Request("https://example.test/"), {}, context);
    await waitOnExecutionContext(context);

    expect(await response.text()).toBe("workerd ready");
  });

  it("builds and closes router resources independently for concurrent requests", async () => {
    const counts = { acquires: 0, releases: 0 };
    const probeLayer = Layer.effect(
      Probe,
      Effect.acquireRelease(
        Effect.gen(function* () {
          yield* Effect.sleep("10 millis");
          counts.acquires += 1;
          return counts.acquires;
        }),
        () =>
          Effect.sync(() => {
            counts.releases += 1;
          }),
      ),
    );
    const appLayer = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/",
        Probe.pipe(Effect.map((id) => HttpServerResponse.text(String(id)))),
      ),
      probeLayer,
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: TestEnvironment,
      disableLogger: true,
    });
    const contexts = [createExecutionContext(), createExecutionContext(), createExecutionContext()];

    const responses = await Promise.all(
      contexts.map((context) => handler(new Request("https://example.test/"), {}, context)),
    );
    await Promise.all(contexts.map(waitOnExecutionContext));

    expect((await Promise.all(responses.map((response) => response.text()))).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(counts).toEqual({ acquires: 3, releases: 3 });
  });

  it("keeps a streaming request scope alive until the body settles", async () => {
    let finalized = false;
    const gate: Deferred.Deferred<void> = Effect.runSync(Deferred.make<void>());
    const appLayer = HttpRouter.add(
      "GET",
      "/",
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalized = true;
          }),
        );
        return HttpServerResponse.stream(
          Stream.fromEffect(Deferred.await(gate)).pipe(
            Stream.map(() => "streamed"),
            Stream.encodeText,
          ),
          { contentType: "text/plain; charset=utf-8" },
        );
      }),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: TestEnvironment,
      disableLogger: true,
    });
    const context = createExecutionContext();

    const response = await handler(new Request("https://example.test/"), {}, context);
    expect(finalized).toBe(false);

    Effect.runSync(Deferred.succeed(gate, undefined));
    expect(await response.text()).toBe("streamed");
    await waitOnExecutionContext(context);
    expect(finalized).toBe(true);
  });

  it("interrupts an aborted request and runs its finalizer", async () => {
    let finalized = false;
    const appLayer = HttpRouter.add(
      "GET",
      "/",
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          finalized = true;
        }),
      ).pipe(Effect.andThen(Effect.never)),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: TestEnvironment,
      disableLogger: true,
    });
    const controller = new AbortController();
    const context = createExecutionContext();
    const responsePromise = handler(
      new Request("https://example.test/", { signal: controller.signal }),
      {},
      context,
    );

    await scheduler.wait(10);
    controller.abort();

    expect((await responsePromise).status).toBe(499);
    await waitOnExecutionContext(context);
    expect(finalized).toBe(true);
  });
});
