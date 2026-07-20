#!/usr/bin/env bun
import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  ignore: ["effect-platform-cloudflare-monorepo", /^@effect-platform-cloudflare\/example-/],
  npm: {
    client: "bun",
    trustedPublish: {
      provider: "github",
      workflow: "release.yml",
    },
  },
  plugins: [
    github({
      repo: "aryasaatvik/effect-platform-cloudflare",
      versionPr: {
        base: "main",
        create() {
          const version = this.graph.get("npm:effect-platform-cloudflare")?.version;
          return {
            title: version ? `chore(release): v${version}` : "chore(release): version packages",
          };
        },
      },
    }),
  ],
});

await createCli(paper).parseAsync();
