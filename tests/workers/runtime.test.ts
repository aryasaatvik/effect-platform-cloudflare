import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { HttpWorker } from "../../packages/effect-platform-cloudflare/src/index.ts";

class TestEnvironment extends Context.Service<TestEnvironment, Record<string, never>>()(
  "test/workerd/TestEnvironment",
) {}
class IsolateProbe extends Context.Service<IsolateProbe, number>()("test/workerd/IsolateProbe") {}
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

  it("pins a shared cold initialization and keeps isolate and request memo maps separate", async () => {
    const counts = { builds: 0, acquires: 0, releases: 0 };
    const dependency = Layer.effect(
      Probe,
      Effect.acquireRelease(
        Effect.sync(() => ++counts.acquires),
        () =>
          Effect.sync(() => {
            counts.releases += 1;
          }),
      ),
    );
    const isolateLayer = Layer.effect(
      IsolateProbe,
      Effect.gen(function* () {
        counts.builds += 1;
        yield* Effect.sleep("10 millis");
        return yield* Probe;
      }),
    ).pipe(Layer.provide(dependency));
    const appLayer = Layer.mergeAll(
      dependency,
      HttpRouter.add(
        "GET",
        "/",
        Effect.gen(function* () {
          const isolate = yield* IsolateProbe;
          const request = yield* Probe;
          return HttpServerResponse.text(`${isolate}:${request}`);
        }),
      ),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: TestEnvironment,
      isolateLayer,
      disableLogger: true,
    });
    const contexts = [createExecutionContext(), createExecutionContext()];
    const pinned: Array<Array<Promise<unknown>>> = [[], []];
    const responses = await Promise.all(
      contexts.map((context, index) =>
        handler(
          new Request("https://example.test/"),
          {},
          {
            waitUntil(promise) {
              pinned[index]!.push(promise);
              context.waitUntil(promise);
            },
          },
        ),
      ),
    );
    await Promise.all(contexts.map(waitOnExecutionContext));
    expect((await Promise.all(responses.map((response) => response.text()))).sort()).toEqual([
      "1:2",
      "1:3",
    ]);
    expect(counts).toEqual({ builds: 1, acquires: 3, releases: 2 });
    expect(pinned.map((promises) => promises.length)).toEqual([2, 2]);
  });

  it("closes failed isolate acquisitions before retrying with fresh resources", async () => {
    const counts = { attempts: 0, acquires: 0, releases: 0 };
    const dependency = Layer.effect(
      Probe,
      Effect.acquireRelease(
        Effect.sync(() => ++counts.acquires),
        () =>
          Effect.sync(() => {
            counts.releases += 1;
          }),
      ),
    );
    const isolateLayer = Layer.effect(
      IsolateProbe,
      Effect.gen(function* () {
        const value = yield* Probe;
        if (++counts.attempts === 1) return yield* Effect.die("failed cold initialization");
        return value;
      }),
    ).pipe(Layer.provide(dependency));
    const handler = HttpWorker.toWebHandler(
      HttpRouter.add(
        "GET",
        "/",
        IsolateProbe.pipe(Effect.map((value) => HttpServerResponse.text(String(value)))),
      ),
      { environment: TestEnvironment, isolateLayer, disableLogger: true },
    );
    const failedContext = createExecutionContext();
    expect((await handler(new Request("https://example.test/"), {}, failedContext)).status).toBe(
      500,
    );
    await waitOnExecutionContext(failedContext);
    expect(counts).toEqual({ attempts: 1, acquires: 1, releases: 1 });
    const recoveredContext = createExecutionContext();
    expect(
      await (await handler(new Request("https://example.test/"), {}, recoveredContext)).text(),
    ).toBe("2");
    await waitOnExecutionContext(recoveredContext);
    expect(counts).toEqual({ attempts: 2, acquires: 2, releases: 1 });
  });

  it("preserves HEAD, router misses, and failed route responses", async () => {
    const handler = HttpWorker.toWebHandler(
      Layer.mergeAll(
        HttpRouter.add("*", "/", Effect.succeed(HttpServerResponse.text("body"))),
        HttpRouter.add("GET", "/fail", Effect.fail("route failure")),
      ),
      { environment: TestEnvironment, disableLogger: true },
    );
    for (const [path, method, status] of [
      ["/", "HEAD", 200],
      ["/missing", "GET", 404],
      ["/fail", "GET", 500],
    ] as const) {
      const context = createExecutionContext();
      const response = await handler(
        new Request(`https://example.test${path}`, { method }),
        {},
        context,
      );
      expect(response.status).toBe(status);
      if (method === "HEAD") expect(await response.text()).toBe("");
      await waitOnExecutionContext(context);
    }
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
    const appLayer = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/",
        Effect.acquireRelease(Effect.void, () =>
          Effect.sleep("10 millis").pipe(
            Effect.andThen(
              Effect.sync(() => {
                finalized = true;
              }),
            ),
          ),
        ).pipe(Effect.andThen(Effect.never)),
      ),
      HttpRouter.add("GET", "/ok", Effect.succeed(HttpServerResponse.text("healthy"))),
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

    const nextContext = createExecutionContext();
    const next = await handler(new Request("https://example.test/ok"), {}, nextContext);
    expect(next.status).toBe(200);
    expect(await next.text()).toBe("healthy");
    await waitOnExecutionContext(nextContext);
  });
});
