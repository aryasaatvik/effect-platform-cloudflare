import { Context, Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { describe, expect, it } from "vitest";

import {
  HttpWorker,
  type NativeExecutionContext,
  WorkerHttpPlatform,
} from "../packages/effect-platform-cloudflare/src/index.ts";

class Bindings extends Context.Service<Bindings, { readonly GREETING: string }>()(
  "test/Bindings",
) {}

const Api = HttpApi.make("test").add(
  HttpApiGroup.make("greetings").add(
    HttpApiEndpoint.get("greet", "/greet", { success: Schema.Struct({ greeting: Schema.String }) }),
  ),
);

const GreetingsLive = HttpApiBuilder.group(Api, "greetings", (handlers) =>
  handlers.handle("greet", () => Effect.map(Bindings, (env) => ({ greeting: env.GREETING }))),
);

const context: NativeExecutionContext = { waitUntil: () => undefined };

describe("WorkerHttpPlatform.layer", () => {
  it("serves a declared HttpApi through HttpWorker.toWebHandler", async () => {
    const handler = HttpWorker.toWebHandler(
      HttpApiBuilder.layer(Api).pipe(
        Layer.provide(GreetingsLive),
        Layer.provide(WorkerHttpPlatform.layer),
      ),
      { environment: Bindings, disableLogger: true },
    );

    const first = await handler(
      new Request("https://example.test/greet"),
      { GREETING: "hi" },
      context,
    );
    const second = await handler(
      new Request("https://example.test/greet"),
      { GREETING: "hello" },
      context,
    );
    const missing = await handler(
      new Request("https://example.test/nope"),
      { GREETING: "hi" },
      context,
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ greeting: "hi" });
    expect(await second.json()).toEqual({ greeting: "hello" });
    expect(missing.status).toBe(404);
  });
});
