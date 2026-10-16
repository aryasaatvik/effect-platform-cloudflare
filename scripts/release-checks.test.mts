import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tegami, type TegamiPlugin } from "tegami";
import { releaseChecks } from "./release-checks.mts";
for (const exitCode of [1, 0]) {
  test(`release:check exit ${exitCode} controls publication`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cloudflare-release-gate-"));
    const userConfig = process.env.NPM_CONFIG_USERCONFIG;
    const rejectNetwork = () => {
      throw new Error("Unexpected outbound fetch");
    };
    const fetchTrap = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(rejectNetwork, { preconnect: rejectNetwork }),
    );
    let published = false;
    const substitute: TegamiPlugin = {
      name: "local-publication-substitute",
      enforce: "pre",
      publishPreflight() {
        return { shouldPublish: true };
      },
      resolvePlanStatus() {
        return "pending";
      },
      beforePublishAll() {
        published = true;
        throw new Error("Local publication reached");
      },
    };
    try {
      // Graph resolution reads npm configuration even with the remote publisher removed.
      process.env.NPM_CONFIG_USERCONFIG = join(cwd, ".npmrc");
      await writeFile(process.env.NPM_CONFIG_USERCONFIG, "");
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "effect-platform-cloudflare",
          version: "1.0.0",
          scripts: { "release:check": `bun -e 'process.exit(${exitCode})'` },
        }),
      );
      await mkdir(join(cwd, ".tegami"));
      await writeFile(
        join(cwd, ".tegami/publish-lock.yaml"),
        "core:packages:\n  - id: npm:effect-platform-cloudflare\n    updated: true\nnpm:packages:\n  - id: npm:effect-platform-cloudflare\n",
      );
      const paper = tegami({ cwd, npm: { client: "bun" }, plugins: [releaseChecks(), substitute] });
      const context = await paper._internal.context();
      expect(context.graph.get("npm:effect-platform-cloudflare")).toBeDefined();
      context.plugins = context.plugins.filter((plugin) => plugin.name !== "npm");
      await expect(paper.publish()).rejects.toThrow(
        exitCode ? "Release gate failed" : "Local publication reached",
      );
      expect(published).toBe(exitCode === 0);
      expect(fetchTrap).not.toHaveBeenCalled();
    } finally {
      fetchTrap.mockRestore();
      if (userConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
      else process.env.NPM_CONFIG_USERCONFIG = userConfig;
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
