import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { HttpWorker } from "../packages/effect-platform-cloudflare/src/index.ts";

class TestEnvironment extends Context.Service<TestEnvironment, Record<string, never>>()(
  "types/TestEnvironment",
) {}
class RouteService extends Context.Service<RouteService, string>()("types/RouteService") {}

const routeRequiringService = HttpRouter.add(
  "GET",
  "/",
  RouteService.pipe(Effect.map(HttpServerResponse.text)),
);

const fullyProvidedRoutes = Layer.mergeAll(
  routeRequiringService,
  Layer.succeed(RouteService, "provided"),
);

HttpWorker.toWebHandler(fullyProvidedRoutes, {
  environment: TestEnvironment,
});

// @ts-expect-error A self-contained Worker handler cannot leave route services unprovided.
HttpWorker.toWebHandler(routeRequiringService, {
  environment: TestEnvironment,
});

const environmentBackedRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.empty())),
  Layer.effectDiscard(TestEnvironment),
);

HttpWorker.toWebHandler(environmentBackedRoutes, {
  environment: TestEnvironment,
});

const fallibleRoutes = HttpRouter.add(
  "GET",
  "/",
  Effect.fail({ _tag: "ExpectedFailure" as const }),
);

HttpWorker.toWebHandler(fallibleRoutes, {
  environment: TestEnvironment,
});

HttpWorker.toWebHandler(fullyProvidedRoutes, {
  environment: TestEnvironment,
  middleware: (httpEffect) => Effect.flatMap(HttpServerRequest.HttpServerRequest, () => httpEffect),
});

HttpWorker.toWebHandler(routeRequiringService, {
  environment: TestEnvironment,
  middleware: (httpEffect) => Effect.provideService(httpEffect, RouteService, "provided"),
});

// @ts-expect-error Custom middleware must eliminate every non-runtime service requirement.
HttpWorker.toWebHandler(routeRequiringService, {
  environment: TestEnvironment,
  middleware: (httpEffect) => httpEffect,
});
