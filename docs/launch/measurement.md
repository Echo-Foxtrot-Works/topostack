# Growth measurement

Capture the baseline before the next promotion or attribution release. Preserve it as a dated snapshot, then compare equal-length windows. The October 2026 initial capture uses **October 2–7**, six complete days in America/Denver; older Workers Logs are outside the available retention window. Do not call it a seven-day baseline or a pre-launch baseline: promotion already happened.

## Capture Cloudflare numbers

Use the existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables or ignored root `.env`. The token needs read access to Workers Observability and Web Analytics. The collector only reads APIs; it does not deploy, send usage events, change account settings or install analytics.

```sh
node --env-file-if-exists=.env scripts/verify/growth-baseline.mjs \
  2026-10-02T00:00:00-06:00 2026-10-08T00:00:00-06:00 \
  .topostack/growth/baseline-2026-10-08.json
```

Choose a new filename for every capture; existing files are never overwritten. Explicit timezone offsets are required. Use the offset appropriate to the selected dates, including daylight saving changes. The output contains only aggregate usage categories, aggregate referrer hosts, device categories and sampling information. It excludes account IDs, credentials, request IDs, raw log records, coordinates and project names. Keep raw account exports outside Git.

The collector records partial availability and exits unsuccessfully if either Cloudflare query fails. Check `status`, `actualTimeframe`, `sampled`, sample intervals and row-limit errors before using numbers. An empty result is `no-matching-events`, not proof of no visitors. A provider-clipped timeframe is a partial capture; repeat over an available range. The top-referrer table is limited to 20 hosts, so use the separate totals for overall traffic.

Cloudflare returns weighted count values. A sample interval above 1 means estimated counts; **do not multiply the reported count by the interval again**. Adaptive query sampling is reported separately. See [the Observability response definitions](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/).

Each dimension is queried separately because the provider omits records lacking a grouped field. The required `source` breakdown supplies the totals. Older events lacking `channel` remain in those totals; a channel breakdown without matches is expected before the release. Optional-field breakdowns may cover fewer records, and sampled queries may not reconcile exactly. A failed breakdown is explicitly `unavailable` and makes the usage report `partial`.

## Complete search and feedback context

Search Console is separate and requires access to its property. For the exact baseline dates, record:

- Total search clicks and impressions; non-brand clicks/impressions using the same `topostack` exclusion each week; CTR.
- Indexed counts and errors for `sitemap-pages.xml` and `sitemap-lakes.xml`.
- Top pages and non-brand queries. Search Console daily dates follow its reporting timezone; note this instead of claiming exact alignment with Denver event timestamps.
- New feedback/issues and which public threads or creator slots they came from.

Missing account data stays **awaiting export**, never zero. Search Console figures can arrive later than event data. The collector explicitly leaves `search.status` pending.

## Weekly scorecard

Compare two saved snapshots without credentials or network requests:

```sh
node scripts/verify/growth-compare.mjs \
  .topostack/growth/previous.json .topostack/growth/current.json \
  .topostack/growth/comparison.md
```

The comparison never overwrites a report. It retains unknown events/categories, reports sampling and Search Console availability, and suppresses changes for unequal or overlapping windows and clipped/unknown effective usage timeframes. Separate channel, source, landing, device and output tables show studio entries, generation outcomes and prepared exports. Channel-coverage changes flag the attribution release and broad-source classification discontinuity. No channel performance ranking or joined conversion funnel is inferred.

| Measure | Meaning |
| --- | --- |
| Web Analytics visits / page views | Provider traffic measures; retain its sampling information |
| `studio_open` | First studio entry per tracked tab session |
| `generation_started`, succeeded, failed, cancelled | Explicit generation outcomes; repeated attempts count separately |
| `export_prepared` / `export_failed` | Fabrication file handoffs or preparation failures |
| Share copied / shared / opened | Design-link distribution and opens; no joined referral funnel |
| `share_preview_prepared` | A local software-preview PNG prepared for sharing; not a fabrication export or proof of a published post |
| Source + channel + campaign + medium | Where tracked activity came from; `none` is missing/legacy, `other` unrecognized |
| Landing + device + output + delivery | Content category, viewport category, layered/engraved output and browser/Atomm handoff |

Use generation successes divided by attempts as an aggregate outcome ratio. Export handoffs per studio entry is an **event ratio**, not a user conversion rate, and may exceed 100%. Entries have output `none`; compare output-specific generation/export counts using their own events. Do not calculate layered conversion by filtering every funnel event to `output=stack`.

There is no user identifier, joined session funnel or retention cohort. The current system cannot establish unique makers, first-ever export, repeat-user retention or time to first export. DNT/GPC, blocked requests, disabled storage, retries and public-event spoofing affect counts. Static lake pages send no landing event. `export_prepared` does not prove a browser save or physical build.

## Verify the attribution release

Publish the Worker schema before or with the frontend; older browser events remain accepted. After publication, use a fresh tab session for each controlled visit:

1. Open `/guides/export-files?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=lightburn-forum`, enter the studio, generate and prepare an export.
2. Repeat with `reddit-lasercutting` and a creator link using `utm_source=social&utm_medium=video&utm_campaign=creator&utm_content=creator-01`.
3. Test a tagged `/lake/<existing-slug>` page followed by its studio link. Tags should survive if the browser supplies the same-origin referrer; record a missing referrer as a limitation.
4. In production Workers Logs, filter `message=usage_event`, `environment=production` and the channel. Check all entry/generation/export events retain their original tags.
5. Record test times so controlled activity is not mistaken for organic campaign results. With platform sampling, a missing individual log is inconclusive; use the browser's network payload and 204 response as well.

Never post new tagged campaign links before the compatible release is live. Older events have no channel and must remain distinguishable in comparisons.
