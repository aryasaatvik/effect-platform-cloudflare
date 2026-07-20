import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpWorker } from "effect-platform-cloudflare";

interface Env {
  readonly API: Fetcher;
}

class WorkerBindings extends Context.Service<WorkerBindings, Env>()(
  "example/lifecycle-caller/WorkerBindings",
) {}

interface ProbeState {
  readonly acquired?: boolean;
  readonly background?: boolean;
  readonly released?: boolean;
}

const poll = async (
  api: Fetcher,
  id: string,
  predicate: (state: ProbeState) => boolean,
): Promise<ProbeState> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await api.fetch(`https://api/state?id=${encodeURIComponent(id)}`);
    const state = (await response.json()) as ProbeState;
    if (predicate(state)) return state;
    await scheduler.wait(25);
  }
  throw new Error(`lifecycle state timed out for ${id}`);
};

const verify = async (env: Env) => {
  const probe = await env.API.fetch("https://api/probe");
  const probeBody = (await probe.json()) as { readonly isolate: string };

  const backgroundId = crypto.randomUUID();
  const background = await env.API.fetch(`https://api/background?id=${backgroundId}`, {
    method: "POST",
  });
  const backgroundState = await poll(env.API, backgroundId, (state) => state.background === true);

  const streamId = crypto.randomUUID();
  const stream = await env.API.fetch(`https://api/stream?id=${streamId}`);
  const streamOpenState = await poll(env.API, streamId, (state) => state.acquired === true);
  const streamBody = await stream.text();
  const streamClosedState = await poll(env.API, streamId, (state) => state.released === true);

  const abortId = crypto.randomUUID();
  const controller = new AbortController();
  const held = env.API.fetch(
    new Request(`https://api/hold?id=${abortId}`, { signal: controller.signal }),
  );
  const abortOpenState = await poll(env.API, abortId, (state) => state.acquired === true);
  controller.abort();
  const abortStatus = await held.then(
    (response) => response.status,
    () => 499,
  );
  const abortClosedState = await poll(env.API, abortId, (state) => state.released === true);

  return {
    abort: {
      acquired: abortOpenState.acquired === true,
      released: abortClosedState.released === true,
      status: abortStatus,
    },
    background: {
      accepted: background.status === 202,
      completed: backgroundState.background === true,
    },
    coldBuild: { isolate: probeBody.isolate, ready: probe.ok },
    stream: {
      acquired: streamOpenState.acquired === true,
      body: streamBody,
      released: streamClosedState.released === true,
    },
  };
};

const httpApp = Effect.gen(function* () {
  const env = yield* WorkerBindings;
  const result = yield* Effect.promise(() => verify(env));
  return yield* HttpServerResponse.json(result);
});

const Routes = HttpRouter.add("*", "/", httpApp);

const fetch = HttpWorker.toWebHandler(Routes, {
  environment: WorkerBindings,
});

export default { fetch } satisfies ExportedHandler<Env>;
