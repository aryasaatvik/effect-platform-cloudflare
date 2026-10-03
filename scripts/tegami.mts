#!/usr/bin/env bun
import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  ignore: ["effect-platform-cloudflare-monorepo", /^@effect-platform-cloudflare\/example-/],
  npm: {
    client: "bun",
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
  },
  plugins: [
    github({
      repo: "aryasaatvik/effect-platform-cloudflare",
      pushTags: true,
      versionPr: {
        branch: "tegami/version-packages",
        base: "main",
        forceCreate: true,
        create() {
          const version = this.graph.get("npm:effect-platform-cloudflare")?.version;
          return {
            title: version
              ? `chore(release): prepare effect-platform-cloudflare ${version}`
              : "chore(release): prepare effect-platform-cloudflare",
          };
        },
      },
    }),
  ],
});

await runCli(paper);
