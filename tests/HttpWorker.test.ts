import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
  makeFetchHandler,
  type NativeExecutionContext,
  WorkerEnvironment,
  WorkerExecutionContext,
} from "../packages/effect-platform-cloudflare/src/index.ts";

class IsolateValue extends Context.Service<IsolateValue, string>()("test/IsolateValue") {}

interface TypedEnvironment {
  readonly VALUE: string;
}

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

describe("makeFetchHandler", () => {
  it("builds the isolate layer once and closes non-stream request resources before resolving", async () => {
    const counts = { isolateBuilds: 0, requestAcquires: 0, requestReleases: 0 };
    const layer = Layer.effect(
      IsolateValue,
      Effect.gen(function* () {
        const env = yield* WorkerEnvironment;
        counts.isolateBuilds += 1;
        return String(env.VALUE);
      }),
    );
    const handler = makeFetchHandler<IsolateValue, never, never, TypedEnvironment>({
      layer,
      httpApp: Effect.acquireRelease(
        Effect.sync(() => {
          counts.requestAcquires += 1;
        }),
        () =>
          Effect.sync(() => {
            counts.requestReleases += 1;
          }),
      ).pipe(
        Effect.flatMap(() => IsolateValue),
        Effect.map((value) => HttpServerResponse.text(value)),
      ),
    });

    const firstContext = new TestExecutionContext();
    const secondContext = new TestExecutionContext();
    const [first, second] = await Promise.all([
      handler(new Request("https://example.test/"), { VALUE: "ready" }, firstContext),
      handler(new Request("https://example.test/"), { VALUE: "ignored" }, secondContext),
    ]);

    expect(await first.text()).toBe("ready");
    expect(await second.text()).toBe("ready");
    expect(counts).toEqual({ isolateBuilds: 1, requestAcquires: 2, requestReleases: 2 });
    expect((await firstContext.settle()).every(({ status }) => status === "fulfilled")).toBe(true);
    expect((await secondContext.settle()).every(({ status }) => status === "fulfilled")).toBe(true);
  });

  it("does not cache a failed isolate initialization", async () => {
    let attempts = 0;
    const layer = Layer.effect(
      IsolateValue,
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1 ? Effect.die("cold build failed") : Effect.succeed("recovered");
      }),
    );
    const handler = makeFetchHandler({
      layer,
      httpApp: IsolateValue.pipe(Effect.map(HttpServerResponse.text)),
    });

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

  it("runs waitUntil effects in an independent scope with never-rejecting native promises", async () => {
    let completed = 0;
    const handler = makeFetchHandler({
      layer: Layer.empty,
      httpApp: Effect.gen(function* () {
        const execution = yield* WorkerExecutionContext;
        yield* execution.waitUntil(
          Effect.sync(() => {
            completed += 1;
          }).pipe(Effect.andThen(Effect.fail("observed only"))),
        );
        return HttpServerResponse.empty({ status: 202 });
      }),
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
    const handler = makeFetchHandler({
      layer: Layer.empty,
      httpApp: Effect.gen(function* () {
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
    const handler = makeFetchHandler({
      layer: Layer.empty,
      httpApp: Effect.succeed(HttpServerResponse.text("not sent")),
    });

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
    const handler = makeFetchHandler({
      layer: Layer.empty,
      httpApp: Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          finalized = true;
        }),
      ).pipe(Effect.andThen(Effect.never)),
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
