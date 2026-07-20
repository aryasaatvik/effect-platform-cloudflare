#!/usr/bin/env bun
import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  ignore: ["effect-platform-cloudflare-monorepo", /^@effect-platform-cloudflare\/example-/],
  npm: {
    client: "bun",
  },
  plugins: [
    github({
      repo: "aryasaatvik/effect-platform-cloudflare",
      pushTags: true,
      versionPr: false,
    }),
  ],
});

await createCli(paper).parseAsync();
