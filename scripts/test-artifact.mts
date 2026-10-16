import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../packages/effect-platform-cloudflare/package.json" with { type: "json" };
const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = await mkdtemp(join(tmpdir(), "cloudflare-artifact-"));
const run = (command: string, args: string[], directory = cwd) =>
  execFileSync(command, args, { cwd: directory, stdio: "inherit" });
try {
  // Build belongs to test:artifact; do not run prepack a second time.
  run(
    "bun",
    ["pm", "pack", "--ignore-scripts", "--filename", join(cwd, "package.tgz")],
    join(root, "packages/effect-platform-cloudflare"),
  );
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "effect-platform-cloudflare": "./package.tgz",
        effect: packageJson.devDependencies.effect,
      },
    }),
  );
  run("bun", ["install", "--ignore-scripts"]);
  await writeFile(
    join(cwd, "consumer.mts"),
    `
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpWorker, WorkerExecutionContext, type NativeExecutionContext } from "effect-platform-cloudflare";
import metadata from "effect-platform-cloudflare/package.json" with { type: "json" };
class Environment extends Context.Service<Environment, { value: string }>()("artifact/Environment") {}
const context: NativeExecutionContext = { waitUntil: (promise) => { void promise; } };
// @ts-expect-error waitUntil accepts a Promise, not a string.
const invalid: NativeExecutionContext = { waitUntil: (_promise: string) => {} };
void invalid;
if (metadata.name !== "effect-platform-cloudflare") throw new Error("Wrong packed metadata");
if (!WorkerExecutionContext) throw new Error("Missing WorkerExecutionContext export");
const handler = HttpWorker.toWebHandler(HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("packed ready"))),
  { environment: Environment, disableLogger: true });
if (await (await handler(new Request("https://artifact.test/"), { value: "ok" }, context)).text() !== "packed ready") throw new Error("Packed handler failed");
`,
  );
  await writeFile(
    join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "NodeNext",
        target: "ES2024",
        skipLibCheck: true,
        types: [],
        lib: ["ESNext", "DOM"],
        resolveJsonModule: true,
      },
      include: ["consumer.mts"],
    }),
  );
  run("bun", [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"]);
  run("node", ["consumer.mts"]);
} finally {
  await rm(cwd, { recursive: true, force: true });
}
