import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
  HttpWorker,
  type NativeExecutionContext,
  WorkerExecutionContext,
} from "../packages/effect-platform-cloudflare/src/index.ts";

class IsolateValue extends Context.Service<IsolateValue, string>()("test/IsolateValue") {}
class IsolateDependency extends Context.Service<IsolateDependency, string>()(
  "test/IsolateDependency",
) {}

interface TypedEnvironment {
  readonly VALUE: string;
}

class TestEnvironment extends Context.Service<TestEnvironment, TypedEnvironment>()(
  "test/TestEnvironment",
) {}
class EmptyEnvironment extends Context.Service<EmptyEnvironment, Record<string, never>>()(
  "test/EmptyEnvironment",
) {}

class TestExecutionContext implements NativeExecutionContext {
  readonly promises: Array<Promise<unknown>> = [];

  waitUntil(promise: Promise<unknown>): void {
    this.promises.push(promise);
  }

  async settle(): Promise<Array<PromiseSettledResult<unknown>>> {
    const results: Array<PromiseSettledResult<unknown>> = [];
    let cursor = 0;
    while (cursor < this.promises.length) {
      const pending = this.promises.slice(cursor);
      cursor = this.promises.length;
      results.push(...(await Promise.allSettled(pending)));
    }
    return results;
  }
}

const route = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  HttpRouter.add("*", "/*", effect);

describe("HttpWorker.toWebHandler", () => {
  it("builds the isolate layer once and closes non-stream request resources before resolving", async () => {
    const counts = { isolateBuilds: 0, requestAcquires: 0, requestReleases: 0 };
    const isolateLayer = Layer.effect(
      IsolateValue,
      Effect.gen(function* () {
        const env = yield* TestEnvironment;
        counts.isolateBuilds += 1;
        return env.VALUE;
      }),
    );
    const appLayer = route(
      Effect.acquireRelease(
        Effect.sync(() => {
          counts.requestAcquires += 1;
        }),
        () =>
          Effect.sync(() => {
            counts.requestReleases += 1;
          }),
      ).pipe(
        Effect.flatMap(() => Effect.all([IsolateValue, TestEnvironment])),
        Effect.map(([value, env]) => HttpServerResponse.text(`${value}:${env.VALUE}`)),
      ),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: TestEnvironment,
      isolateLayer,
      disableLogger: true,
    });

    const firstContext = new TestExecutionContext();
    const secondContext = new TestExecutionContext();
    const [first, second] = await Promise.all([
      handler(new Request("https://example.test/"), { VALUE: "ready" }, firstContext),
      handler(new Request("https://example.test/"), { VALUE: "ignored" }, secondContext),
    ]);

    expect(await first.text()).toBe("ready:ready");
    expect(await second.text()).toBe("ready:ready");
    expect(counts).toEqual({ isolateBuilds: 1, requestAcquires: 2, requestReleases: 2 });
    expect((await firstContext.settle()).every(({ status }) => status === "fulfilled")).toBe(true);
    expect((await secondContext.settle()).every(({ status }) => status === "fulfilled")).toBe(true);

    const warmContext = new TestExecutionContext();
    const warm = await handler(
      new Request("https://example.test/"),
      { VALUE: "ignored" },
      warmContext,
    );
    expect(await warm.text()).toBe("ready:ready");
    expect(warmContext.promises).toHaveLength(1);
  });

  it("does not cache a failed isolate initialization", async () => {
    let attempts = 0;
    const isolateLayer = Layer.effect(
      IsolateValue,
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1 ? Effect.die("cold build failed") : Effect.succeed("recovered");
      }),
    );
    const handler = HttpWorker.toWebHandler(
      route(IsolateValue.pipe(Effect.map(HttpServerResponse.text))),
      {
        environment: EmptyEnvironment,
        isolateLayer,
        disableLogger: true,
      },
    );

    const failed = await handler(
      new Request("https://example.test/"),
      {},
      new TestExecutionContext(),
    );
    const recovered = await handler(
      new Request("https://example.test/"),
      {},
      new TestExecutionContext(),
    );

    expect(failed.status).toBe(500);
    expect(await recovered.text()).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("releases partial isolate builds and retries with a fresh memo map", async () => {
    const counts = { acquires: 0, releases: 0, attempts: 0 };
    const dependency = Layer.effect(
      IsolateDependency,
      Effect.acquireRelease(
        Effect.sync(() => {
          counts.acquires += 1;
          return `dependency-${counts.acquires}`;
        }),
        () =>
          Effect.sync(() => {
            counts.releases += 1;
          }),
      ),
    );
    const isolateLayer = Layer.effect(
      IsolateValue,
      Effect.gen(function* () {
        const acquired = yield* IsolateDependency;
        counts.attempts += 1;
        if (counts.attempts === 1) {
          return yield* Effect.die("cold build failed after acquisition");
        }
        return acquired;
      }),
    ).pipe(Layer.provideMerge(dependency));
    const handler = HttpWorker.toWebHandler(
      route(IsolateValue.pipe(Effect.map(HttpServerResponse.text))),
      {
        environment: EmptyEnvironment,
        isolateLayer,
        disableLogger: true,
      },
    );

    const failed = await handler(
      new Request("https://example.test/"),
      {},
      new TestExecutionContext(),
    );
    expect(failed.status).toBe(500);
    expect(counts).toEqual({ acquires: 1, releases: 1, attempts: 1 });

    const recovered = await handler(
      new Request("https://example.test/"),
      {},
      new TestExecutionContext(),
    );
    expect(await recovered.text()).toBe("dependency-2");
    expect(counts).toEqual({ acquires: 2, releases: 1, attempts: 2 });
  });

  it("runs waitUntil effects in an independent scope with never-rejecting native promises", async () => {
    let completed = 0;
    const appLayer = route(
      Effect.gen(function* () {
        const execution = yield* WorkerExecutionContext;
        yield* execution.waitUntil(
          Effect.sync(() => {
            completed += 1;
          }).pipe(Effect.andThen(Effect.fail("observed only"))),
        );
        return HttpServerResponse.empty({ status: 202 });
      }),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: EmptyEnvironment,
      disableLogger: true,
    });
    const context = new TestExecutionContext();

    const response = await handler(new Request("https://example.test/"), {}, context);
    const results = await context.settle();

    expect(response.status).toBe(202);
    expect(completed).toBe(1);
    expect(results.every(({ status }) => status === "fulfilled")).toBe(true);
  });

  it("transfers request scope ownership to a streaming response", async () => {
    let finalized = false;
    const gate: Deferred.Deferred<void, never> = Effect.runSync(Deferred.make<void>());
    const appLayer = route(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalized = true;
          }),
        );
        return HttpServerResponse.stream(
          Stream.fromEffect(Deferred.await(gate)).pipe(
            Stream.map(() => "hello world"),
            Stream.encodeText,
          ),
        );
      }),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: EmptyEnvironment,
      disableLogger: true,
    });

    const response = await handler(
      new Request("https://example.test/"),
      {},
      new TestExecutionContext(),
    );

    expect(finalized).toBe(false);
    Effect.runSync(Deferred.succeed(gate, undefined));
    expect(await response.text()).toBe("hello world");
    expect(finalized).toBe(true);
  });

  it("renders HEAD without a body", async () => {
    const handler = HttpWorker.toWebHandler(
      route(Effect.succeed(HttpServerResponse.text("not sent"))),
      {
        environment: EmptyEnvironment,
        disableLogger: true,
      },
    );

    const response = await handler(
      new Request("https://example.test/", { method: "HEAD" }),
      {},
      new TestExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("interrupts the request as ClientAbort and completes finalizers", async () => {
    let finalized = false;
    const appLayer = route(
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          finalized = true;
        }),
      ).pipe(Effect.andThen(Effect.never)),
    );
    const handler = HttpWorker.toWebHandler(appLayer, {
      environment: EmptyEnvironment,
      disableLogger: true,
    });
    const controller = new AbortController();
    const context = new TestExecutionContext();
    const responsePromise = handler(
      new Request("https://example.test/", { signal: controller.signal }),
      {},
      context,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const response = await responsePromise;
    await context.settle();

    expect(response.status).toBe(499);
    expect(finalized).toBe(true);
  });
});
