# Releasing

Tegami manages the changelog, version pull requests, npm publication, package Git tags, and GitHub
Releases. GitHub Actions publishes from `main` using npm trusted publishing and automatic
provenance. The package tag convention is `effect-platform-cloudflare@<version>`.

## Validate and prepare a release

Correctness gates run locally before merging implementation or version changes:

```sh
bun install --frozen-lockfile
bun run release:check
```

When a publish lock exists, also run `bun run tegami publish --dry-run`. This covers formatting,
lint, types, Node/workerd lifecycle tests, build/package checks, and the pending publication plan.
No GitHub Actions workflow runs these validation gates on PRs or pushes; authors own the checks.

1. Commit a pending changelog under `.tegami/` with the implementation. Follow `AGENTS.md` for its
   format.
2. After the implementation merges into `main`, dispatch the manual preparation workflow:

   ```sh
   gh workflow run prepare-release.yml --ref main
   ```

   Tegami consumes the pending notes, updates versions/changelogs/publish lock, pushes
   `tegami/version-packages`, and creates or updates its version PR against `main`. Preparation
   has GitHub contents/PR write permissions and no npm OIDC permission.

3. Review the generated package version, `CHANGELOG.md`, and `.tegami/publish-lock.yaml`. Run the
   local gates against that version branch, then merge only the approved changes.
4. Merging this repository's `tegami/version-packages` PR into `main` triggers publication.
   The publish workflow runs `bun run tegami publish` against the approved lock, then pushes the
   package tag and creates the GitHub Release. Private workspace examples are excluded.

For an attended local version PR, start from clean, current `main` with GitHub authentication:

```sh
GH_TOKEN="$(gh auth token)" bun run version:packages
```

Preparation creates a version PR without publishing. Do not edit generated package changelogs or
`.tegami/publish-lock.yaml` by hand.

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
workflow permissions settings, so Tegami can create its version PR. The release workflows specify their own
job permissions; the repository's default token permission can remain read-only.

The publish job uses GitHub-hosted Ubuntu, Node 24 with npm >=11.5.1, and Bun 1.4.0. It needs
`contents: write` for tags/releases, `pull-requests: read` for release-note metadata, and
`id-token: write` for npm OIDC authentication. Version branch and PR creation belong only to the
preparation job. Publication runs only after a merged `tegami/version-packages` PR from this
repository into `main`, or a manual dispatch from `main`. It checks out the triggering merged or
dispatched main commit and does not persist checkout credentials. The GitHub token is provided
only to the final Tegami command. Publication is serialized; a running job is not canceled by a
newer push.

No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The package's `prepack` script builds its
actual publish artifacts; the hosted workflow does not repeat the full local gate. Tegami packs
with Bun and publishes with npm;
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

A manual preflight can validate the existing lock without publishing:

```sh
gh workflow run publish.yml --ref main -f dry_run=true
```

Inspect npm, the Git tag, the GitHub Release, and Tegami's publish status before rerunning a
partially completed release. Tegami skips already completed tasks; do not bump or re-tag solely to
retry a failed publish. Manual dispatches against other refs are skipped. Workflow identity,
permission exchange, PR creation, and publication must be verified on GitHub-hosted runners.
