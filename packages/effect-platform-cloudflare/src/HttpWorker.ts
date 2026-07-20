import { Cause, Context, Effect, Exit, Layer, Scope } from "effect";
import {
  HttpEffect,
  HttpMiddleware,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import {
  fromNativeExecutionContext,
  type NativeExecutionContext,
  WorkerExecutionContext,
} from "./WorkerExecutionContext.js";
import { WorkerEnvironment, type WorkerEnvironmentValue } from "./WorkerEnvironment.js";

export interface FetchHandler<Env extends object = WorkerEnvironmentValue> {
  (request: Request, env: Env, context: NativeExecutionContext): Promise<Response>;
}

export interface FetchHandlerOptions<Provided, LayerError, AppError> {
  readonly layer: Layer.Layer<Provided, LayerError, WorkerEnvironment>;
  readonly httpApp: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    AppError,
    | Provided
    | WorkerEnvironment
    | WorkerExecutionContext
    | HttpServerRequest.HttpServerRequest
    | Scope.Scope
  >;
  readonly middleware?: HttpMiddleware.HttpMiddleware;
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

export const makeFetchHandler = <
  Provided,
  LayerError,
  AppError,
  Env extends object = WorkerEnvironmentValue,
>(
  options: FetchHandlerOptions<Provided, LayerError, AppError>,
): FetchHandler<Env> => {
  type IsolateContext = Context.Context<
    Exclude<Provided | WorkerEnvironment, Layer.CurrentMemoMap>
  >;
  let built: Promise<IsolateContext> | undefined;

  const build = (env: Env, context: NativeExecutionContext) => {
    if (built === undefined) {
      const isolateScope = Scope.makeUnsafe();
      const isolateMemoMap = Layer.makeMemoMapUnsafe();
      let attempt: Promise<IsolateContext>;
      attempt = Effect.runPromiseExit(
        Layer.buildWithMemoMap(
          options.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(WorkerEnvironment, env as unknown as WorkerEnvironmentValue),
            ),
          ),
          isolateMemoMap,
          isolateScope,
        ).pipe(Effect.map(Context.omit(Layer.CurrentMemoMap))),
      ).then(async (exit) => {
        if (Exit.isSuccess(exit)) {
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

    context.waitUntil(
      promise.then(
        () => undefined,
        () => undefined,
      ),
    );
    return promise;
  };

  return (request, env, nativeContext) => {
    let response: Response | undefined;
    const requestServices = Context.mergeAll(
      Context.make(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
      Context.make(WorkerExecutionContext, fromNativeExecutionContext(nativeContext)),
    );

    const requestApp = Effect.promise(() => build(env, nativeContext)).pipe(
      Effect.flatMap((isolateContext) => options.httpApp.pipe(Effect.provide(isolateContext))),
    ) as Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      AppError,
      WorkerExecutionContext | HttpServerRequest.HttpServerRequest | Scope.Scope
    >;
    const requestEffect = handledWebResponse(requestApp, options.middleware, (delivered) => {
      response = delivered;
    }) as Effect.Effect<void, never, WorkerExecutionContext | HttpServerRequest.HttpServerRequest>;

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
