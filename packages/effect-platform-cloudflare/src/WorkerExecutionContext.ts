import { Context, Effect } from "effect";

export interface NativeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerExecutionContextService {
  /**
   * Runs fully provided work in an independent scope and keeps the current
   * Cloudflare event alive until it settles.
   */
  waitUntil<A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<void>;
}

export class WorkerExecutionContext extends Context.Service<
  WorkerExecutionContext,
  WorkerExecutionContextService
>()("effect-platform-cloudflare/WorkerExecutionContext") {}

export const fromNativeExecutionContext = (
  context: NativeExecutionContext,
): WorkerExecutionContextService => ({
  waitUntil: <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.sync(() => {
      const completion = Effect.runPromiseExit(Effect.scoped(effect)).then(() => undefined);
      context.waitUntil(completion);
    }),
});
