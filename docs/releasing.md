# Releasing

This repository uses [Tegami](https://tegami.fuma-nama.dev) to version
`effect-platform-cloudflare`, maintain its changelog, publish it to npm, and create GitHub releases.

## Normal release flow

1. Add a pending changelog under `.tegami/` and merge it to `main` with the implementation.
2. The `Release` workflow runs `tegami ci` and opens or updates the version PR.
3. Review the version, generated `CHANGELOG.md`, and `.tegami/publish-lock.yaml` in that PR.
4. Merge the version PR. The same workflow publishes the locked version through npm trusted
   publishing and creates the corresponding GitHub release.
5. Verify the npm version and dist-tag, provenance, GitHub tag and release, tarball contents, and a
   clean consumer install.

Do not edit generated package changelogs or `.tegami/publish-lock.yaml` by hand.

## First release only

The npm package must exist before npm can trust the GitHub workflow. After Tegami creates the
`v0.1.0` version PR:

1. Make the GitHub repository public.
2. Check out the version PR branch and authenticate the npm CLI with an account allowed to publish
   the package.
3. Run `bun run tegami npm pretrust`.
4. Commit the publish-lock update made by Tegami and push it to the version PR.
5. Merge the version PR.

`npm pretrust` publishes an empty `0.0.0-tegami-trusted-publish-setup` placeholder under the `temp`
dist-tag, configures `release.yml` as the trusted GitHub publisher, and ensures the real release is
marked `latest`. It does not publish the `v0.1.0` package contents.

## Verification

Run locally before merging release changes:

```sh
bun install --frozen-lockfile
bun run release:check
bun run tegami publish --dry-run
```

The Tegami publish dry-run requires the generated publish lock and therefore applies to version PRs,
not ordinary implementation PRs.
