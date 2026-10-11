# Changelog and releases

TopoStack's changelog is written once, in the pull request that makes a change, and everything after that is automated: the version bump, the release commit, the tag, the GitHub release, the [/changelog](https://topostack.app/changelog) page, its [feed](https://topostack.app/changelog.xml) (Atom format, readable by any feed reader), the studio's what's-new marker, and the Atomm release notes.

## Flow

```
feature PR -> dev      adds changelog/unreleased/<branch>.md       Changelog workflow: required unless labelled no-changelog
                       dev site shows it under "Unreleased"
dev -> main PR opened  release-prepare.yml folds every fragment into changelog/releases.json,
                       bumps all workspace versions, and pushes "Release vX.Y.Z" to dev
merge to main          CI deploys production (page and feed already built from releases.json),
                       then tag-release creates tag vX.Y.Z and its GitHub release
CI run succeeds        release-atomm.yml publishes that run's package as atomm-vX.Y.Z (marked Latest),
                       with the changelog since the previous atomm-v* release
```

## Writing a fragment

```sh
npm run changelog:new -- feature "Import GPX, KML and GeoJSON"
```

This creates `changelog/unreleased/<branch-name>.md`:

```md
---
type: feature
title: Import GPX, KML and GeoJSON
---
Bring tracks, routes and waypoints from other apps into a project as custom paths and markers. See [custom markers and paths](/guides/custom-markers-and-paths).
```

- **type**: `feature` (new), `improvement`, `fix`, or `breaking`. The largest type in a release sets the SemVer bump: breaking → major, feature → minor, otherwise patch.
- **title**: one line, at most 100 characters, written for makers.
- **body**: one to three sentences, at most 600 characters, saying what someone can now do or no longer runs into. The only markup is `` `code` ``, `**bold**` (for studio labels), and `[text](/site/path)` or `[text](https://…)` links; everything else is shown as plain text.
- **pr** (optional): the pull request number. Leave it out; the release script finds it from the merge commit.

Skip the fragment only when users will not notice the change (tests, tooling, refactors, internal docs) and label the pull request `no-changelog`. Dependabot pull requests are exempt. One pull request may add several fragments.

## Commands

| Command | What it does |
| --- | --- |
| `npm run changelog:new -- <type> "<title>"` | Scaffold a fragment named after the branch |
| `npm run changelog:check -- --base origin/dev [--skip]` | Fail unless the branch adds a valid fragment (the Changelog workflow runs this) |
| `npm run changelog:pending` | Fail while fragments are waiting (guards promotion pull requests and production CI) |
| `npm run changelog:prepare -- [--dry-run] [--date YYYY-MM-DD]` | Fold fragments into a release and bump every workspace version |
| `npm run changelog:render` | Rewrite `changelog/latest.json` and `CHANGELOG.md` after editing `releases.json` |
| `npm run changelog:verify` | Check that the release files agree with each other and with the package version (CI lint job) |
| `npm run changelog:notes -- <version>` / `-- --since <version> [--until <version>]` | Release notes as Markdown |

## Files

- `changelog/unreleased/*.md`: pending fragments.
- `changelog/releases.json`: every release, newest first, validated by `@topostack/data-contracts/changelog`. It is written by `changelog:prepare`. Wording can be corrected by hand; run `changelog:render` afterwards.
- `changelog/latest.json`: the newest version and date. The page registry dates `/changelog` with it, and the studio compares it with the `topostack-changelog-seen` localStorage key. It is the only changelog file in client bundles.
- `CHANGELOG.md`: generated for readers on GitHub. Do not edit it.

Versions change only through `changelog:prepare`. `changelog:verify` fails when the newest release and the package version disagree, so a manual `npm run version:main` needs a matching release entry. The Atomm package shares the version: `atomm/version.json` is bumped with every workspace, `version:check` rejects drift, and each release publishes both `vX.Y.Z` and `atomm-vX.Y.Z`. The web-app release is not marked Latest, so the Releases page leads with the downloadable Atomm package.

## Setup

No secret is needed. `release-prepare.yml` pushes the release commit to `dev` with the built-in `GITHUB_TOKEN` (`contents: write`). GitHub does not start workflows for pushes made with that token, so the job then dispatches `ci.yml` and `changelog.yml` on `dev` (`actions: write`). Their check runs attach to the release commit, which is the promotion pull request's new head, and the dispatched CI run redeploys development because `deploy-worker` accepts `workflow_dispatch` on `dev`. The pull request's own `pull_request` runs belong to the previous head and are not repeated.

This relies on the `dev` ruleset allowing ordinary pushes from GitHub Actions (it blocks only deletion and force-pushes) and on `main` requiring a pull request but no named status checks. If `main` later requires status checks, the dispatched runs carry the same job names on the head commit. Create the `no-changelog` label once.

CI also requires `changelog:pending` to pass on `main`, including manual runs. Its lint/typecheck job gates production deployment, so an early merge before release preparation cannot deploy code under the previous version. Keep the production environment restricted to the `main` branch; development CI must still allow pending fragments.

## Recovery

- **The release commit is wrong.** Revert it on `dev`, fix or restore the fragments, and push; the next update to the promotion pull request prepares again.
- **Nothing was prepared.** The promotion pull request's Changelog check fails with "unreleased fragment(s) remain". Re-run Prepare release from the pull request's checks; if its push was rejected, check the `dev` ruleset.
- **The release commit has no checks.** Start them by hand: `gh workflow run ci.yml --ref dev` and `gh workflow run changelog.yml --ref dev`.
- **Tagging failed after deploy.** Re-run the `Tag release` job. It skips a version that is already tagged, and tags are never moved.
- **The Atomm release did not publish.** Run Publish Atomm release by hand with the production CI run ID and `atomm-vX.Y.Z`. It resumes a draft left by a partial run.
- **A fix after release.** Edit the entry in `releases.json`, run `npm run changelog:render`, and ship it like any change. The page and feed update on the next deploy; the GitHub release body is edited by hand.
