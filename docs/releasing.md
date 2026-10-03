# Releasing

Tegami manages the changelog, version pull requests, npm publication, package Git tags, and GitHub
Releases. GitHub Actions publishes from `main` using npm trusted publishing and automatic
provenance. The package tag convention is `effect-platform-cloudflare@<version>`.

## Queue and review a release

1. Commit a pending changelog under `.tegami/` with the implementation. Follow `AGENTS.md` for its
   format.
2. After the change merges into `main`, `.github/workflows/publish.yml` runs the release checks and
   `bun run tegami ci`. Pending changelogs produce or update the `tegami/version-packages` branch
   and a version PR against `main`.
3. Review the generated package version, `CHANGELOG.md`, and `.tegami/publish-lock.yaml`. Merge the
   version PR only when its changes and checks are approved.
4. The next `main` publish run publishes the approved lock to npm, then pushes the package tag and
   creates the GitHub Release. Private workspace examples are excluded from publishing.

The ordinary CI workflow runs `release:check` on PRs with read-only permissions. It validates the
publish lock with `tegami publish --dry-run` only when the lock exists. A version PR created with
`GITHUB_TOKEN` may need a maintainer to approve its CI run; approve the run on the PR page before
merging if GitHub requests it.

For an attended local version PR, start from clean, current `main` with GitHub authentication:

```sh
bun install --frozen-lockfile
GH_TOKEN="$(gh auth token)" bun run version:packages
```

This command creates or updates the version PR; it does not publish npm packages. Do not edit
generated package changelogs or `.tegami/publish-lock.yaml` by hand.

## One-time trusted publisher setup

Configure the npm package `effect-platform-cloudflare` with this GitHub Actions trusted publisher:

| Field                | Value                        |
| -------------------- | ---------------------------- |
| Organization or user | `aryasaatvik`                |
| Repository           | `effect-platform-cloudflare` |
| Workflow filename    | `publish.yml`                |
| Environment          | Leave blank                  |
| Publishing method    | `npm publish`                |

Enable **Allow GitHub Actions to create and approve pull requests** in the repository's Actions
workflow permissions settings, so Tegami can create its version PR. The workflows specify their own
job permissions; the repository's default token permission can remain read-only.

The publish job uses GitHub-hosted Ubuntu, Node 24 with npm >=11.5.1, and Bun 1.4.0. It needs
`contents: write` for the version branch/tags/releases, `pull-requests: write` for version PRs, and
`id-token: write` for npm OIDC authentication. It runs only on this repository's `main` push or
manual dispatch from `main`, checks out the triggering commit, and does not persist checkout
credentials. The GitHub token is provided only to the final Tegami command. Publication is
serialized; a running publish job is not canceled by a newer push.

No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. Tegami packs with Bun and publishes with npm;
npm exchanges the workflow identity for short-lived publish credentials and generates provenance
for this public package/repository. A local `npm whoami` result does not verify this workflow's
trusted publisher. See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Verify or recover a release

Check npm, the tag, and the GitHub Release separately:

```sh
npm view effect-platform-cloudflare version dist-tags dist --json
gh release view "effect-platform-cloudflare@$(bun -e 'console.log(require("./packages/effect-platform-cloudflare/package.json").version)')"
bun run tegami check-publish
```

Verify the registry tarball contents/integrity and install it into a clean consumer before updating
applications. A successful workflow is not a substitute for registry and consumer verification.

For an approved lock already on `main`, or after correcting a publisher/setup failure, dispatch the
workflow from `main`:

```sh
gh workflow run publish.yml --ref main
```

Inspect npm, the Git tag, the GitHub Release, and Tegami's publish status before rerunning a
partially completed release. Tegami skips already completed tasks; do not bump or re-tag solely to
retry a failed publish. Manual dispatches against other refs are skipped. Workflow identity,
permission exchange, PR creation, and publication must be verified on GitHub-hosted runners.
