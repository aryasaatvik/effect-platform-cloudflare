import { Context } from "effect";

export type WorkerEnvironmentValue = Readonly<Record<string, unknown>>;

/** Cloudflare bindings supplied to the first event in an isolate. */
export class WorkerEnvironment extends Context.Service<WorkerEnvironment, WorkerEnvironmentValue>()(
  "effect-platform-cloudflare/WorkerEnvironment",
) {}
