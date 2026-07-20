# Releasing

This repository uses [Tegami](https://tegami.fuma-nama.dev) to version
`effect-platform-cloudflare`, maintain its changelog, publish it to npm, and create GitHub releases.

## Normal release flow

1. Add a pending changelog under `.tegami/` and merge it with the implementation.
2. From a clean release branch based on `main`, run `bun run tegami version`.
3. Review the version, generated `CHANGELOG.md`, and `.tegami/publish-lock.yaml`.
4. Run `bun run release:check` and `bun run tegami publish --dry-run`.
5. Commit the generated release changes, open a release PR, and merge it.
6. Update a clean local `main`, authenticate npm and GitHub, and run `bun run tegami publish`.
7. Verify the npm version and dist-tag, GitHub tag and release, tarball contents, and a clean
   consumer install.

Do not edit generated package changelogs or `.tegami/publish-lock.yaml` by hand.

## Local publishing

Publishing requires an npm session that can publish `effect-platform-cloudflare` and a GitHub token
that can create releases in this repository:

```sh
npm login
GITHUB_TOKEN="$(gh auth token)" bun run tegami publish
```

Tegami publishes the npm package first. After the publish plan succeeds, it creates and pushes the
package tag and creates the corresponding GitHub release. A failed npm publish does not produce a
tag or release.

For `v0.1.0`, make the repository public before publishing and confirm the unscoped npm package name
is still available.

## Verification

Run before merging generated release changes:

```sh
bun install --frozen-lockfile
bun run release:check
bun run tegami publish --dry-run
```

The Tegami publish dry-run requires the generated publish lock and therefore applies to release
branches, not ordinary implementation PRs.
