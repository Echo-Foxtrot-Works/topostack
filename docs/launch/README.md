# Launch kit

TopoStack is already being shared and used by makers. This kit supports the next round of promotion and measures whether it brings people into the studio and leads to fabrication exports. Reconciled on **2026-10-08**; dated evidence and remaining unknowns are in [activity.md](activity.md).

| File | Purpose |
| --- | --- |
| [activity.md](activity.md) | Confirmed public posts and physical builds, reported activity, and remaining verification |
| [channels.md](channels.md) | Audiences, posting rules, useful angles and destination pages |
| [posts.md](posts.md) | Drafts to adapt for a specific venue; they are not a publication log |
| [creator-pitch.md](creator-pitch.md) | Individual creator outreach and numbered attribution slots |
| [media.md](media.md) | Repository media, honest captions and physical-build shot list |
| [measurement.md](measurement.md) | Baseline capture, weekly comparisons, definitions and deployment checks |

## Current status

- Campaign/medium attribution (#118), export credits (#119), native design sharing (#120), and the README storefront (#117) are merged and present in this checkout. Production logs confirm campaign/medium fields; mobile sharing and import checks remain separate verification tasks.
- Individual lake routes and child sitemaps exist. They are no longer a prerequisite to start a launch.
- The maintainer's LightBurn introduction and community Reddit recommendations are public. Users have posted physical builds. These are evidence of use, not permission to republish their photos.
- The original ordinary Hacker News submission is verified; a separate Show HN launch remains unverified. Product Hunt, creator outreach and other venues remain unverified. Unknown does not mean not done.
- Week 1 adds a fixed `channel` field using `utm_content`. **Publish the compatible Worker schema before, or together with, the browser build.** Until then, new links cannot reliably report individual channels.
- The [initial baseline](../reports/growth-baseline-2026-10-08.md) captures production traffic and use for October 2–7. Counts are sampled; Search Console data remains awaiting export.

## Ground rules

- Label every image accurately. Repository launch assets are screenshots or software renders. For a community build, obtain permission, credit the maker and retain its original caption and limitations.
- Use supported facts. The lake directory contained 8,147 records on 2026-09-24. Do not invent user counts, cut counts or broad machine compatibility from one community report.
- Disclose that you built the app in maintainer posts. Ask for feedback, never votes.
- Read the venue's current rules. A Reddit maker reports that a link-containing post was removed; an organic build post is not blanket permission for promotion.
- Publish one useful project or tutorial at a time and stay available to answer questions. Add its actual date and URL to the activity log.

## Link scheme

Keep `utm_source` broad for comparison with older reports. `utm_medium` describes the format, `utm_campaign` the initiative, and **`utm_content` identifies the channel**. Values are fixed allowlists in `packages/data-contracts/src/usage.ts`; unknown values become `other`, absent values `none`. Never put a person's name, private note or full post URL into tags.

| Placement | Source | Medium | Campaign | Content / channel |
| --- | --- | --- | --- | --- |
| r/lasercutting | social | forum | launch | reddit-lasercutting |
| r/Laserengraving | social | forum | launch | reddit-laserengraving |
| r/cartography / r/gis | social | forum | launch | reddit-cartography / reddit-gis |
| xTool / Glowforge / Creality subreddits | social | forum | launch | reddit-xtool / reddit-glowforge / reddit-crealityfalcon |
| LightBurn / Glowforge forums | social | forum | launch | lightburn-forum / glowforge-forum |
| xTool community | social | forum | launch | xtool-community |
| Hacker News | social | forum | launch | hacker-news |
| Product Hunt | other | referral | launch | product-hunt |
| Social accounts | social | social | launch | x / bluesky / mastodon / facebook / instagram / pinterest |
| Creator outreach | other | email | creator | creator-01 through creator-10 |
| Creator video description | social | video | creator | the same creator slot as the outreach |
| Atomm listing | atomm | referral | atomm | atomm |
| GitHub README | github | referral | readme | github |

Example:

`https://topostack.app/guides/export-files?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=lightburn-forum`

Known referrer hosts supply a channel when `utm_content` is absent. Referrers commonly omit paths, so only an explicit `reddit-lasercutting` tag identifies that subreddit; a reddit.com referrer reports `reddit`. Mastodon requires an explicit tag because instances use different hosts. Creator slots are assigned once and recorded in the maintainer's private outreach log; never recycle a slot during a campaign. Adding more slots requires a contract update and deployment.

First entry wins for the tab session (30-minute inactivity expiry). Static lake pages collect no browser events; the studio can recover allowlisted tags from their same-origin referrer, when provided. If that referrer is stripped, original acquisition cannot be recovered. Links to Atomm or GitHub need no TopoStack tags. Direct JSON asset downloads collect no usage event; use the example page as the measured entry point.

## Next promotion cycle

1. Capture a baseline using [measurement.md](measurement.md), then deploy and verify channel attribution. Preserve the baseline as a dated snapshot.
2. Refresh existing community conversations with meaningful improvements or a reproducible build, where allowed. Do not repeat an introduction solely because an old checkbox was empty.
3. Prepare one physical-build tutorial with a project file and measured material/machine details. Obtain permission for third-party photos first.
4. Approach a small batch of relevant creators with numbered links and a project suited to their machine. No outreach is authorized by this document itself.
5. Compare traffic, studio entries, generation outcomes and prepared exports by channel. Choose the next venue from the results and maker feedback.

## Checklist

Confirmed:

- [x] #117–#120 merged; implementations present in the repository
- [x] Production campaign/medium fields observed in usage logs
- [x] Per-lake routes implemented
- [x] Public LightBurn introduction and original Hacker News submission verified
- [x] Community Reddit recommendations and physical build posts verified

Release and account checks:

- [ ] Week 1 channel schema and frontend published together
- [ ] Tagged LightBurn, subreddit and creator test visits retain channel through studio and export in production logs
- [ ] Native sharing verified on iOS Safari and Android Chrome
- [ ] Production generation/export checked for Crater Lake and one other example
- [ ] Search Console clicks, impressions and indexed counts added to the baseline
- [ ] GitHub custom social preview and Discussions status verified if wanted
- [ ] Remaining promotion history reconciled, including any separate Show HN launch
- [ ] Permission and reusable files obtained for community builds

Every week:

- [ ] Dated baseline captured and compared with an equal-length prior window
- [ ] Search Console and feedback notes added
- [ ] Published post URLs and creator slot assignments logged
- [ ] Questions from makers turned into guide fixes or product issues
