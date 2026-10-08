# Growth baseline — 2026-10-08

Captured from production Cloudflare APIs before the week 1 channel changes were deployed. The window is **2026-10-02 00:00 through 2026-10-08 00:00, America/Denver (UTC−06:00)**: six complete days, October 2–7. The older part of a seven-day window was outside available Workers Logs retention, so this baseline intentionally uses six days. It is a baseline for the next promotion cycle, not a pre-launch baseline.

[Aggregate snapshot](data/growth-baseline-2026-10-08.json) · [Capture and interpretation runbook](../launch/measurement.md) · [Verified promotion history](../launch/activity.md)

## Traffic and use

| Metric | Provider-reported count |
| --- | ---: |
| Web Analytics visits | approximately 248 |
| Web Analytics page views | approximately 344 |
| Tracked studio entries | approximately 240 |
| Explicit generation starts | approximately 540 |
| Successful generation events | approximately 390 |
| Failed generation events | approximately 20 |
| Prepared fabrication exports | approximately 80 |
| Public landing events | approximately 90 |

**All figures are aggregate measures, not unique people.** Usage rows report a sample interval of 10; Web Analytics totals report an average sample interval of about 1.033. The provider has already weighted these counts. Production settings request a log head sampling rate of 1, but the query still reports sampled usage results; configuration alone does not make these exact counts. Other outcomes and share events were not observed in this sampled result; that does not establish zero activity. Browser saves and physical builds cannot be counted from exports.

Generation outcomes do not exhaust the starts in the window. Sampling, cancellations, unfinished generation and window boundaries can affect this relationship. Do not classify the difference as failures. An export/studio event ratio is not a joined user conversion funnel.

## Referrers and devices

| Web Analytics referrer host | Visits |
| --- | ---: |
| Not provided | approximately 207 |
| www.google.com | 16 |
| forum.lightburnsoftware.com | 11 |
| www.reddit.com | 6 |
| chatgpt.com | 5 |
| www.bing.com | 3 |

Same-site navigation contributes page views but no new visits in the provider response. An absent referrer can include direct navigation, bookmarks or stripped referrals; it is not proof that someone typed the address. Page views split into approximately 289 desktop and 55 mobile. These are Web Analytics device categories, distinct from the usage collector's viewport categories (`small` / `large`).

| Broad usage source | Tracked studio entries |
| --- | ---: |
| direct | approximately 190 |
| other | approximately 20 |
| google | approximately 10 |
| social | approximately 10 |
| ai | approximately 10 |

The observed prepared exports fall under `direct` in this sampled query. This does not prove that referrals produced no exports: earlier tracking did not identify individual venues and small groups can be absent in sampled results. The checkout's new host classification also moves LightBurn/HN referrals into `social`, where older versions recorded `other`; account for that discontinuity when comparing broad sources.

## Attribution gaps

- All observed campaign and medium values are `none`. Future posts and creator walkthroughs need the tagged links in the updated launch kit.
- The production frontend at capture predates the `channel` field. Its channel breakdown has no matching events, while those same legacy events remain in overall totals.
- Traffic and use are separate datasets; they cannot be joined into a user funnel. Static lake pages do not send public landing events.
- Search Console clicks, impressions, non-brand queries and indexed counts remain **awaiting an account export**. They are not recorded as zero. Match its reporting dates and document the reporting-timezone difference.
- No first-ever-export, repeat-user retention or time-to-first-export measurement exists in this release.

## Week 1 changes prepared

Fixed channels now distinguish individual maker forums, tagged subreddits, social platforms and ten numbered creator slots without transmitting names or arbitrary URL text. Existing sources remain available for comparison. Attribution stays with the first entry through generation and export, including recoverable tags on script-free lake referrers. The Worker accepts both legacy and new events.

README and launch draft links carry channel tags. The launch checklist now distinguishes merged implementation, verified public activity and remaining account/device/reuse checks. The [original ordinary Hacker News submission](https://news.ycombinator.com/item?id=49716578) was verified through the official item API as a 2026-09-15 post by `loidolt`; it was not titled Show HN.

After publication, verify the new payloads and capture another equal-length window before deciding which channels to expand. Attribution cannot be added retroactively to the baseline.

## Validation

Local type checks, lint, shared-contract tests, generator unit/client tests, Worker tests and operational-script tests passed. The mobile navigation attribution check passed in Chromium, Firefox and WebKit. Production frontend and dry-run Worker builds passed their existing bundle budgets; generated metadata and live production SEO response checks passed. Installed dependencies were restored from the existing lockfile to resolve stale local theme packages; dependency manifests and the lockfile were not changed.

The channel release has not been published. Search Console figures and post-release production attribution checks remain pending.
