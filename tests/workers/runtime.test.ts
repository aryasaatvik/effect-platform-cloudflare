import { Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { makeFetchHandler } from "../../packages/effect-platform-cloudflare/src/index.ts";

describe("Cloudflare Worker runtime", () => {
  it("runs an Effect HTTP response under a real workerd execution context", async () => {
    const handler = makeFetchHandler({
      layer: Layer.empty,
      httpApp: Effect.succeed(HttpServerResponse.text("workerd ready")),
    });
    const context = createExecutionContext();

    const response = await handler(new Request("https://example.test/"), {}, context);
    await waitOnExecutionContext(context);

    expect(await response.text()).toBe("workerd ready");
  });
});
