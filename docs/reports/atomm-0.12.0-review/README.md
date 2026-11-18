# Atomm 0.12.0 review preparation — 2026-11-18

This review covers the Atomm embed as of `dev` at `5bce26f` (0.11.1 plus the 0.12.0 fragments) and the changes this review made to it. 0.7.1 was the last revision prepared for Atomm review. This one rechecks the embed after everything that landed in the standalone studio since then, and especially the work that went into 0.12.0. The reviewer-facing summary is [atomm/review-readiness.md](../../../atomm/review-readiness.md).

## Standalone changes that could reach the embed

| Change | Risk to the embed | Finding |
| --- | --- | --- |
| Phone bottom settings sheet and folded header (#277, #279) | A narrow or phone-width Atomm frame shows the standalone sheet, tab bar or warning chip | None. The embed renders `AtommWorkbench` and never mounts `SettingsRail`. The sheet rules are scoped to `.app-shell`, which the embed does not render. The folded warnings and the moved Feedback button are gated on `!embeddedInPlatform`. |
| LightBurn project export (#282) | A LightBurn option or `.lbrn2` file reaches the platform export hook | None. The option exists only in the standalone `ExportDialog`, and `createAtommExport` does not call `withLightBurnProjects`. The rendered embed, including the Export view, never mentions LightBurn. |
| Theme 0.14 Button (#276) | Platform-styled controls change size or shape | Cancel on the progress card and Load terrain / Try again keep the `btn btn-secondary` styling. The alignment regression passes. |
| Site-header rule scoping (#283) | None for the embed | — |

## Defect found and fixed

**Open in Studio silently dropped acrylic airspace.** Studio receives one file, the wood master. With acrylic water inserts the ready note already said so. With **Airspace in 3D** the acrylic levels were missing from the handoff and nothing said so, and the Export view still called the file "Entire layout". `acrylicOutsideStudio()` in `export-policy.ts` now names the acrylic left out (inserts, airspace or both). The bridge appends that to its ready note, and the Export view labels the row "Wood layout · acrylic is in Download". It is covered by unit tests in `export-policy.test.ts` and `atomm-bridge.test.ts`.

## Validation

- `e2e/atomm.spec.ts`: 42 of 42 passed across Chromium, Firefox and WebKit, against the e2e build of `5bce26f`, then again with this review's changes. This includes the 60-combination parameter alignment regression (both modes, five widths, LTR and RTL).
- Frame audit ([script](frame-audit.mjs), [results](frame-audit.json)): 48 checks across three browsers, in both output modes, at 1600×1000, 1280×900, 960×800, 700×900, 390×844, 320×640 and 844×390, plus the Export view. Every parameter section was expanded. Nothing was flagged. The checks:
  - no horizontal page overflow
  - no parameter-rail child outside the rail
  - no standalone settings rail, sheet bar or `.app-shell`
  - no LightBurn text
  - no page errors
- Screenshots: [1280×900](layered-1280x900.webp), [390×844 phone portrait](layered-390x844.webp), [844×390 phone landscape](layered-844x390.webp), [320×640 flat](flat-320x640.webp). At phone widths the canvas stacks above the lead and parameter rails, as in earlier releases.

## Refreshed material

- The Tips walkthrough images were recaptured (`scripts/dev/capture-atomm-tips.mjs`) against the production API. Only model detail changed, since lakes now use their most detailed shoreline.
- The listing media is the v9 set (`scripts/dev/capture-atomm-listing.mjs`), replacing v8 one for one. `atomm/media-provenance.json` has the capture commit and hashes.
- The listing copy now mentions public lands, acrylic water inserts, FAA aviation and contour-free engravings.

## Not claimed

This preparation does not include an upload, a submission, a check inside the real Atomm host or xTool Studio, or a fabricated test piece. Those remain the release's platform and physical acceptance steps ([release acceptance](../../release-acceptance.md)).
