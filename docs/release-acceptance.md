# Release acceptance and rollback

Use one candidate commit and retain its CI run, Atomm ZIP, checksum, `topostack-atomm-v<atommVersion>.release.json`, and both archive provisioning receipts. A receipt with `workingTreeDirty: true` is local diagnostic evidence; build the published release from a clean commit. Record the intended Worker version ID and deployed frontend revision with the release.

## Development validation before a production PR

Development is the first deployment gate. A production CORS failure or an unpublished Atomm runtime is checked after the relevant rollout; it does not require publishing to production before testing development.

1. Integrate the current remote `dev`, commit the candidate, and run the local CI checks on that revision. Keep review logs, screenshots and temporary packages outside the checkout. Do not include parallel worktrees in the commit.
2. Push the reviewed candidate to `dev` when authorized. The `CI and Worker Deploy` workflow deploys the development frontend and API only after its required job dependencies pass. A successful build alone is not a successful deployment.
3. Verify the deployed commit at `/version.json`, then run the serving-path and browser checks against development:

   ```sh
   WORKER_URL=https://dev.topostack.app PUBLIC_APP_URL=https://dev.topostack.app EXPECTED_WORKER_ENVIRONMENT=development node scripts/verify/verify-worker-deployment.mjs
   node scripts/verify/verify-seo-http.mjs https://dev.topostack.app development
   PUBLIC_APP_URL=https://dev.topostack.app npm run test:e2e:live
   ```

4. Check the Atomm iframe origin and an unrelated origin for credential-free public reads, archive ranges and preflights. The deployment smoke includes the actual Atomm origin. Verify restricted writes remain denied, and exercise the representative terrain/lake projects below on the dev site.
5. Check `/changelog` on the development site: its Unreleased section is what the next release will say. Fix wording in the fragments on `dev` before promoting.
6. Record the deployed Worker/frontend identity and test results before opening the production PR. Opening it runs Prepare release, which pushes a `Release vX.Y.Z` commit to `dev` and re-runs development CI; confirm the new `/version.json` there. Production deployment, Atomm publication, Studio import and physical fabrication remain separate acceptance steps. See [changelog.md](changelog.md).

## Automated acceptance

1. Run the Node 22 CI jobs, including the full dependency audit, lint, type checks, coverage, production build, generated Worker types, size budgets, and Chromium/Firefox/WebKit tests.
2. Run the API smoke test and live browser export canary against the candidate deployment. Confirm both archives are present. Inspect retained browser traces and the downloaded master SVG when a canary fails.
3. Exercise mountainous, coastal, low-relief, circular, antimeridian, and dense-water selections in both output modes. Check cancellation during source discovery and successful regeneration after a one-time archive outage.
4. Measure a cold start with a modest mobile CPU/network profile. The startup byte budget includes the default 3D engine and geometry worker; it is not a timing guarantee.

## Platform and physical acceptance

Load the candidate ZIP inside the real Atomm host. Exercise download and Open in Studio, including delayed SDK loading, both output modes, and cross-origin archive requests. Mocked SDK tests do not prove the host's interpretation of exported files.

Import representative files in the intended xTool Studio version. Verify dimensions and units, cut/score/engrave operations, marker clearance gaps and filled symbols, shared nested cuts, material connectivity, kerf, and assembly order. Fabricate and measure a small representative test piece before approving larger work.

Copy [the platform acceptance record](release-acceptance-record.md) outside the checkout and complete it with evidence from the real applications. For airspace, generate [the assembly fixtures and observation templates](airspace-validation.md#prepare-and-record-a-physical-test) from the same candidate. Keep both records pending until the corresponding hands-on checks have been performed.

## Operational acceptance

Confirm configured secrets, provider quotas, GitHub environment protections, notification recipients, and the `geocode/` R2 cleanup rule. Use response-status/cache-outcome logs to alert on uncached provider failures, as well as the scheduled serving-path canaries. Confirm how client-side failure reports reach an operator; the browser monitor captures console errors/traces, but it is not comprehensive production client telemetry.

## Rollback rehearsal

1. Keep the previous release ZIP, clean source commit, Worker version ID, source dataset archives, and SHA-256 provisioning receipts available before replacing a release. Do not rely on mutable `current.pmtiles` keys as backups.
2. Restore the previous frontend/Worker candidate in development using the normal deployment pipeline. If data changed, re-provision the retained vector and lake archives with their exact pinned digests into development first. The provisioning scripts verify each digest before upload and emit a new receipt afterward.
3. Run API readiness, archive range checks, and live generation/download against that restored combination. Compare dataset versions and archive identities with the retained release receipt.
4. After the development rehearsal passes, use the existing protected production deployment process for the chosen rollback commit. Restore data through the explicit production provisioning path only if the compatible dataset differs. The current scripts update development and production when `--prod` is used; account for that behavior in the release window.
5. Repeat production smoke and browser checks, record the resulting Worker/archive identities, and retain the rollback evidence. Archive keys use a one-hour cache lifetime, so verify that ETag revalidation and new generation operations see the restored data before declaring recovery.

This runbook does not establish that account settings, host integration, or physical fabrication have already been accepted. Record the operator, date, candidate, and result of each manual check with the release.
