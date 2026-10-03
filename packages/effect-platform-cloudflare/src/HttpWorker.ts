import { Cause, Context, Effect, Exit, Layer, Scope } from "effect";
import { compose } from "effect/Function";
import {
  FindMyWay,
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import {
  fromNativeExecutionContext,
  type NativeExecutionContext,
  WorkerExecutionContext,
} from "./WorkerExecutionContext.js";

/** A Cloudflare Worker fetch handler backed by an Effect HTTP router. */
export interface Handler<Env extends object> {
  (request: Request, env: Env, context: NativeExecutionContext): Promise<Response>;
}

type RouteErrors<R> =
  | HttpRouter.Request.Only<"Error", R>
  | HttpRouter.Request.Only<"GlobalError", R>
  | HttpServerError.HttpServerError;

type ApplicationErrors<E, R> = E | RouteErrors<R>;

type RouteRequirements<R> =
  | Scope.Scope
  | HttpServerRequest.HttpServerRequest
  | HttpRouter.Request.Only<"Requires", R>
  | HttpRouter.Request.Only<"GlobalRequires", R>;

type MiddlewareEffect<E, R> = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  ApplicationErrors<E, R>,
  RouteRequirements<R>
>;

type RuntimeServices<Environment, IsolateProvided> =
  | Environment
  | IsolateProvided
  | WorkerExecutionContext
  | HttpServerRequest.HttpServerRequest
  | Scope.Scope;

type MissingServices<A, R, HR, Environment, IsolateProvided> =
  | Exclude<
      Exclude<HttpRouter.Request.Without<R>, HttpRouter.HttpRouter>,
      RuntimeServices<Environment, IsolateProvided> | Layer.CurrentMemoMap
    >
  | Exclude<HR, A | RuntimeServices<Environment, IsolateProvided>>;

type FullyProvided<A, R, HR, Environment, IsolateProvided> = [
  MissingServices<A, R, HR, Environment, IsolateProvided>,
] extends [never]
  ? unknown
  : {
      readonly "HttpWorker.toWebHandler missing services": MissingServices<
        A,
        R,
        HR,
        Environment,
        IsolateProvided
      >;
    };

export interface ToWebHandlerOptions<
  Env extends object,
  Environment,
  IsolateProvided,
  IsolateError,
  E,
  R,
  M extends Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>,
> {
  /** Application-owned service key used to provide the Cloudflare bindings. */
  readonly environment: Context.Key<Environment, Env>;
  /** Services constructed once per Worker isolate and shared by its requests. */
  readonly isolateLayer?: Layer.Layer<IsolateProvided, IsolateError, Environment> | undefined;
  readonly disableLogger?: boolean | undefined;
  readonly routerConfig?: Partial<FindMyWay.RouterConfig> | undefined;
  readonly middleware?: ((effect: MiddlewareEffect<E, R>) => M) | undefined;
}

type WithoutMiddleware<Env extends object, Environment, IsolateProvided, IsolateError, E, R> = Omit<
  ToWebHandlerOptions<
    Env,
    Environment,
    IsolateProvided,
    IsolateError,
    E,
    R,
    MiddlewareEffect<E, R>
  >,
  "middleware"
> & {
  readonly middleware?: undefined;
};

type MiddlewareOutput<O> = O extends {
  readonly middleware: (...args: never[]) => infer M;
}
  ? M extends Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>
    ? M
    : never
  : never;

interface ToWebHandler {
  <A, E, R, O, Env extends object, Environment, IsolateProvided = never, IsolateError = never>(
    appLayer: Layer.Layer<A, E, R>,
    options: O &
      Omit<
        ToWebHandlerOptions<
          Env,
          Environment,
          IsolateProvided,
          IsolateError,
          E,
          R,
          Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>
        >,
        "middleware"
      > & {
        readonly middleware: (
          effect: MiddlewareEffect<E, R>,
        ) => Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>;
      } & FullyProvided<
        A,
        R,
        Effect.Services<MiddlewareOutput<NoInfer<O>>>,
        Environment,
        IsolateProvided
      >,
  ): Handler<Env>;
  <A, E, R, Env extends object, Environment, IsolateProvided = never, IsolateError = never>(
    appLayer: Layer.Layer<A, E, R>,
    options: WithoutMiddleware<Env, Environment, IsolateProvided, IsolateError, E, R> &
      FullyProvided<A, R, RouteRequirements<R>, Environment, IsolateProvided>,
  ): Handler<Env>;
}

const handledWebResponse = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  middleware: HttpMiddleware.HttpMiddleware | undefined,
  deliver: (response: Response) => void,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();

    yield* HttpEffect.toHandled(
      Effect.interruptible(httpApp),
      (request, outgoing) =>
        Effect.sync(() =>
          deliver(
            HttpServerResponse.toWeb(HttpEffect.scopeTransferToStream(outgoing), {
              context,
              withoutBody: request.method === "HEAD",
            }),
          ),
        ),
      middleware,
    );
  });

const runRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  services: Context.Context<R>,
  request: Request,
): Promise<Exit.Exit<A, E>> => {
  let removeAbortListener: (() => void) | undefined;
  const done = Effect.runPromiseExitWith(services)(effect, {
    onFiberStart: (fiber) => {
      const interrupt = () =>
        fiber.interruptUnsafe(undefined, HttpServerError.ClientAbort.annotation);
      if (request.signal.aborted) {
        interrupt();
        return;
      }
      request.signal.addEventListener("abort", interrupt, { once: true });
      removeAbortListener = () => request.signal.removeEventListener("abort", interrupt);
    },
  });
  return done.finally(() => removeAbortListener?.());
};

/**
 * Builds a Cloudflare Worker fetch handler from an Effect HTTP router layer.
 *
 * The isolate layer is initialized once. The router layer is built in a fresh
 * scope for every request so request-owned resources never cross workerd event
 * contexts. Responses, aborts, logging, and streaming follow Effect's HTTP
 * server semantics.
 */
const makeWebHandler = <
  A,
  E,
  R,
  Env extends object,
  Environment,
  IsolateProvided = never,
  IsolateError = never,
>(
  appLayer: Layer.Layer<A, E, R>,
  options: ToWebHandlerOptions<
    Env,
    Environment,
    IsolateProvided,
    IsolateError,
    E,
    R,
    Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>
  >,
): Handler<Env> => {
  type IsolateContext = Context.Context<
    Exclude<IsolateProvided | Environment, Layer.CurrentMemoMap>
  >;
  let built: Promise<IsolateContext> | undefined;
  let isolateReady = false;

  const buildIsolate = (env: Env, context: NativeExecutionContext) => {
    if (built === undefined) {
      const isolateScope = Scope.makeUnsafe();
      const isolateMemoMap = Layer.makeMemoMapUnsafe();
      const isolateLayer = (options.isolateLayer ?? Layer.empty).pipe(
        Layer.provideMerge(Layer.succeed(options.environment, env)),
      ) as Layer.Layer<IsolateProvided | Environment, IsolateError>;
      let attempt: Promise<IsolateContext>;
      attempt = Effect.runPromiseExit(
        Layer.buildWithMemoMap(isolateLayer, isolateMemoMap, isolateScope).pipe(
          Effect.map(Context.omit(Layer.CurrentMemoMap)),
        ),
      ).then(async (exit) => {
        if (Exit.isSuccess(exit)) {
          isolateReady = true;
          return exit.value;
        }
        await Effect.runPromise(Scope.close(isolateScope, exit));
        if (built === attempt) {
          built = undefined;
        }
        throw Cause.squash(exit.cause);
      });
      built = attempt;
    }

    const promise = built;
    if (!isolateReady) {
      context.waitUntil(
        promise.then(
          () => undefined,
          () => undefined,
        ),
      );
    }
    return promise;
  };

  // The public overloads validate the middleware's concrete output before
  // this runtime bridge to Effect's intentionally erased HttpMiddleware type.
  let middleware = options.middleware as HttpMiddleware.HttpMiddleware | undefined;
  if (options.disableLogger !== true) {
    // `compose` is left-to-right: the logger wraps the user middleware.
    middleware = middleware ? compose(middleware, HttpMiddleware.logger) : HttpMiddleware.logger;
  }

  return (request, env, nativeContext) => {
    let response: Response | undefined;
    const requestServices = Context.mergeAll(
      Context.make(options.environment, env),
      Context.make(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
      Context.make(WorkerExecutionContext, fromNativeExecutionContext(nativeContext)),
    );

    const requestApp = Effect.promise(() => buildIsolate(env, nativeContext)).pipe(
      Effect.flatMap((isolateContext) =>
        Effect.gen(function* () {
          const routerLayer = options.routerConfig
            ? Layer.provide(
                HttpRouter.layer,
                Layer.succeed(HttpRouter.RouterConfig)(options.routerConfig),
              )
            : HttpRouter.layer;
          const appContext = yield* Layer.build(
            Layer.provideMerge(appLayer, routerLayer) as Layer.Layer<A | HttpRouter.HttpRouter, E>,
          );
          return yield* Context.get(appContext, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(Effect.provide(appContext));
        }).pipe(Effect.provide(isolateContext)),
      ),
    ) as Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E | RouteErrors<R>,
      WorkerExecutionContext | HttpServerRequest.HttpServerRequest | Scope.Scope
    >;
    const requestEffect = handledWebResponse(requestApp, middleware, (delivered) => {
      response = delivered;
    }) as Effect.Effect<
      void,
      never,
      Environment | WorkerExecutionContext | HttpServerRequest.HttpServerRequest
    >;

    const done = runRequest(requestEffect, requestServices, request);
    nativeContext.waitUntil(done);

    return done.then((exit) => {
      if (response !== undefined) {
        return response;
      }
      return Exit.isFailure(exit)
        ? Promise.reject(Cause.squash(exit.cause))
        : Promise.reject(new Error("The HTTP application completed without a response"));
    });
  };
};

export const toWebHandler: ToWebHandler = makeWebHandler as ToWebHandler;
