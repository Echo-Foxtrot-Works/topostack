# Atomm review revision — 0.12.0 — 2026-11-18

## What changed since 0.7.1

0.7.1 was the last revision prepared for review (it corrected the “Not aligned:” finding on 0.7.0). Releases 0.8.0 to 0.11.1 were published as packages without a review write-up. This revision covers everything an Atomm user sees since 0.7.1. The platform layout is unchanged: layout 3 with the lead rail, canvas and 320 px parameter rail, the three canvas views (2D, 3D, Export) and the pinned platform export button.

New parameter sections and controls, all in the disclosure and field styling the 0.7.1 alignment correction established:

- **Water** is its own section. It holds shorelines, water fill, lake-floor depth, and a new **Inserts and paint** group. **Acrylic water inserts** cuts each lake out of the sheet at its waterline and exports a fitted acrylic insert, with acrylic thickness, kerf and clearance fields and a switch per lake. Export shows a second **Nesting material** card for the acrylic sheets.
- **Map features** adds **Public land boundaries** (engraved outlines, names and an optional hatch) and **Public land paint** (paint-mask templates for national parks, forests, BLM land and other public lands, in the US and Canada).
- **Aviation (US)** is new. It engraves FAA airspace, airports and runways in the VFR sectional style, and **Airspace in acrylic** builds the airspace as acrylic levels on rods above the terrain.
- **Contour design** in Flat engraving can switch **Contour lines** off, for artwork that carries only map features and labels.
- **Cancel** on the terrain progress card and **Load terrain** / **Try again** in the lead rail use the updated shared theme Button. On touch devices a tapped control no longer stays highlighted.
- The Tips walkthrough images were recaptured from this revision. They show the same steps; lakes now use their most detailed shoreline.

Not part of the Atomm package: the standalone site's phone layout (bottom settings sheet, folded header), the LightBurn project export and its guides, depth-chart tracing, and the AI-assistant integrations. The embed never mounts the standalone settings rail or export dialog, and no LightBurn option or `.lbrn2` file reaches the platform export hook.

## Review exercises

1. Open each parameter section in Layered relief and Flat engraving. Labels share one start edge and controls one end edge, including the new Water, public-land and Aviation rows; selects keep their 110 px width and numeric fields their 92 px width.
2. In Water, turn on **Acrylic water inserts**. The 3D view shows the lake as acrylic. In Export, both Nesting material cards lay out sheets, and Open in Studio and Download include the acrylic pieces.
3. Choose a US national park (for example Crater Lake). In Map features, turn on public land boundaries and paint; the 2D and Export views show the outlines and the paint-mask artwork.
4. Choose a place near an airport (for example Colorado Springs). In Aviation (US), turn on airspace; then turn on **Airspace in 3D** and check the acrylic levels and rods in 3D and Export.
5. Switch to Export, change the material size, finish nesting, and exercise the real host's Open in Studio and Download controls.
6. Check a narrow frame, a phone-width frame and RTL layout. There is no horizontal overflow, and the view switch, Tips and export controls stay reachable.

## Media

Use only the v10 media named in `listing.md` and `media-provenance.json`. There is a still cover built for the 272 × 204 grid card and nine gallery cards. They show Crater Lake and five other places, plus acrylic water inserts, public-land paint and acrylic airspace. All of it is rendered by this revision's embedded studio from live terrain and survey data, and the backdrops are each place's own engraving artwork. The cover is a still image; no cover video is uploaded. The SDK mount/export hook used for capture is a stand-in, so the media does not claim native Studio validation.

## Platform handoff

Upload `topostack-atomm-v0.12.0.zip` from the `atomm-v0.12.0` GitHub release as the application and `topostack-listing-upload-v0.12.0.zip` from the same release for current copy and media. Inspect the uploaded build and exercise its real export controls before submitting for review. Local preparation does not itself upload or resubmit the release, and reviewer acceptance remains unverified.

## Validation completed

Run on the candidate branch (`dev` at `5bce26f` plus this revision's changes), 2026-11-18:

- `e2e/atomm.spec.ts`: all 42 cases passed in Chromium, Firefox and WebKit, including the parameter alignment regression (both output modes, five widths, LTR and RTL). The suite was rerun after the Open in Studio label change: 42 of 42 again.
- A frame audit of the embed made 48 checks across three browsers and seven frame sizes, from 1600 × 1000 down to 320 × 640 and phone landscape, with every section expanded. It found no horizontal overflow, no control outside the parameter rail, no standalone rail or sheet, no LightBurn text and no page errors. See [the report](../docs/reports/atomm-0.12.0-review/README.md).
- Workspace typecheck, zero-warning lint, every workspace's unit tests and the script tests passed. So did the production build, the web and Worker bundle budgets, `version:check` and `changelog:verify`.
- Production Atomm packaging against `https://topostack.app` passed environment, SDK and endpoint verification, and the listing packager verified all 19 media hashes, sizes and dimensions. This was a pre-release build still numbered 0.11.1. The 0.12.0 ZIP, checksum and receipt come from production CI after promotion, and its SHA-256 is recorded with the release.
- All 10 v10 listing PNGs (the cover and nine gallery cards) were visually reviewed (scaled to 1000 × 750, and the cover also at the 272 × 204 grid size) and are 3200 × 2400. The listing packager verified their hashes, sizes and dimensions.
