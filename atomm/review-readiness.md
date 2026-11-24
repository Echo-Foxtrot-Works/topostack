# Atomm review revision — 0.13.1 — 2026-11-20

0.13.1 replaces 0.12.0–0.13.0 for this review. It adds the platform's 18 languages to everything 0.12.2 contained; 0.13.1 fixes the unit and view switches, which in 0.13.0 split "Imperial" mid-word and let longer translations run past their button. Tested in the live platform's Local debug in all 18 languages with the DevTool Simulator.

## Listing media v11

The listing media were recaptured from the 0.13.1 embed as v11, so the screenshots match what reviewers open. v10 had been captured before 0.12.1. Cards 7–9 now show the 0.12.1 property cards with their `shadow-100` lift and the 0.12.2 Export view, with the sheets beside the **Export contents** card. Step 1 of card 7 shows a search for Crater Lake instead of the unfiltered lake list, which opens on survey ids. The models and backdrops are fresh renders of the same projects (`media-projects-v11.json`). The short and detailed descriptions now mention the 18 languages and the per-piece SVG groups.

## Languages since 0.13.0

The platform requires every user-visible string in all 18 languages and switches through each during review. 0.13.0 reads `atomm.app.getLocale()` once before the workbench renders and shows the whole embed in that language: zh, en, zh-hant, de, es, fr, it, ja, ko, ru, uk, sl, th, pl, cs, id, vi and pt-BR. Every parameter label, hint, aria-label, tooltip, status line, warning, export message and Tips slide is translated, numbers use the locale's format and `<html lang>` follows the locale. There is no language switcher in the generator, as the platform asks. The Tips images carry no interface text (only map labels such as place names). Downloaded files (README, assembly guide, SVG titles) remain English.

Checked before submission: a pseudo-locale run of the embed with every section expanded and every switch on finds no English copy; each of the 17 translated locales opens with translated section titles and no control or rail overflowing; every message in every locale renders with correct plural forms. Exercise it with the DevTool Simulator's Preview language, as the platform documents. The translations are reviewed for structure and terminology (`docs/localization-review.md`); native-speaker review is pending.

0.12.2 replaced 0.12.0 and 0.12.1. It only added the Export view and 3D fixes below to 0.12.1.

0.12.1 replaced 0.12.0. 0.12.0 was tested inside the live platform (Developer Console › Local debug) before submission and two platform specs published after our design sync were found unmet; 0.12.1 meets them. Everything below about 0.12.0 still applies.

## Export view and 3D in 0.12.2

- The Export view lays the sheets out beside the **Export contents** card instead of under it; the zoom cluster keeps the canvas corner. Below a 640 px canvas the card folds to one line with a toggle (`aria-expanded`) and the sheets start below it.
- The 3D preview refits when the canvas changes size, until the user moves the camera.
- Checked in the live platform's Local debug at about 790 px and 430 px canvas widths.

## Platform spec updates met in 0.12.1

- **SVG export grouping spec (platform v1.7.0, 2026-11-18).** Every SVG, for both Download and Open in Studio, is now written part by part: one root-level `<g>` per cut piece holding its outline, holes, engraving, score lines and assembly id, with a `data-name` for Studio's object list. Part groups are siblings; no group wraps a sheet or an operation across pieces. Inside a part, one container per operation carries the colour-spec stroke (`#FE0002` cut, `#2366FF` line engraving). The flat engraving is one part. Checked on a real Open in Studio export: 177 sibling part groups, every one with its own cut contour.
- **Property cards (platform v1.6.0).** Settings cards have 8 px corners and the `shadow-100` lift; the Tips hover fill and the select list stacking match the current layout 3 template.
- **Controls.** The two airspace rod settings are segmented controls like Road appearance, not native selects that truncated their options. Switch descriptions sit under their labels. Helper text meant to be read uses the secondary text colour (4.5:1).
- **Messages.** Unnamed lakes are "Lake 1", "Lake 2" everywhere instead of map ids; Airspace in 3D says why nothing was built; the Open in Studio note ends the layout line as a sentence; the Export file list keeps the end of each file name visible.

Localization: see "Languages since 0.13.0" above.

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

1. Open each parameter section in Layered relief and Flat engraving. Labels share one start edge and controls one end edge, including the new Water, public-land and Aviation rows; numeric fields keep their 92 px width and two-option settings are segmented controls.
2. In Water, turn on **Acrylic water inserts**. The 3D view shows the lake as acrylic. In Export, both Nesting material cards lay out sheets. Verify that Open in Studio sends the wood layout and that Download includes the separate acrylic files.
3. Choose a US national park (for example Crater Lake). In Map features, turn on public land boundaries and paint; the 2D and Export views show the outlines and the paint-mask artwork.
4. Choose a place near an airport (for example Colorado Springs). In Aviation (US), turn on airspace; then turn on **Airspace in 3D** and check the acrylic levels and rods in 3D and Export.
5. Switch to Export, change the material size, finish nesting, and exercise the real host's Open in Studio and Download controls.
6. Check a narrow frame, a phone-width frame and RTL layout. There is no horizontal overflow, and the view switch, Tips and export controls stay reachable.

## Media

Use only the v11 media named in `listing.md` and `media-provenance.json`. There is a still cover built for the 272 × 204 grid card and nine gallery cards. They show Crater Lake and five other places, plus acrylic water inserts, public-land paint and acrylic airspace. All of it is rendered by this revision's embedded studio from live terrain and survey data, and the backdrops are each place's own engraving artwork. The cover is a still image; no cover video is uploaded. The SDK mount/export hook used for capture is a stand-in, so the media does not claim native Studio validation.

## Platform handoff

Upload `topostack-atomm-v0.13.1.zip` from the `atomm-v0.13.1` GitHub release as the application and `topostack-listing-upload-v0.13.1.zip` from the same release for current copy and media. Inspect the uploaded build and exercise its real export controls before submitting for review. Local preparation does not itself upload or resubmit the release, and reviewer acceptance remains unverified.

## Validation completed

0.12.1, 2026-11-19: the build was loaded in the live platform through Developer Console › Local debug and exercised by hand (acrylic inserts, public-land boundaries, paint and leave-out, airspace in acrylic, Export view, Open in Studio dialog, keyboard focus). The Open in Studio SVG was checked against the grouping spec. Typecheck, lint, every workspace's tests, the build and both bundle budgets passed; see the pull request for the Atomm and airspace browser suites.

0.12.0:

Run on the candidate branch (`dev` at `5bce26f` plus this revision's changes), 2026-11-18, and the full gate again on `dev` at `8e9cc6f` (code and v10 media together), 2026-11-19:

- `e2e/atomm.spec.ts`: all 42 cases passed in Chromium, Firefox and WebKit, including the parameter alignment regression (both output modes, five widths, LTR and RTL). The suite was rerun after the Open in Studio label change: 42 of 42 again.
- A frame audit of the embed made 48 checks across three browsers and seven frame sizes, from 1600 × 1000 down to 320 × 640 and phone landscape, with every section expanded. It found no horizontal overflow, no control outside the parameter rail, no standalone rail or sheet, no LightBurn text and no page errors. See [the report](../docs/reports/atomm-0.12.0-review/README.md).
- Workspace typecheck, zero-warning lint, every workspace's unit tests and the script tests passed. So did the production build, the web and Worker bundle budgets, `version:check` and `changelog:verify`.
- Production Atomm packaging against `https://topostack.app` passed environment, SDK and endpoint verification, and the listing packager verified all 10 v10 media hashes, sizes and dimensions. This was a pre-release build still numbered 0.11.1. The 0.12.0 ZIP, checksum and receipt come from production CI after promotion, and its SHA-256 is recorded with the release.
- All 10 v10 listing PNGs (the cover and nine gallery cards) were visually reviewed (scaled to 1000 × 750, and the cover also at the 272 × 204 grid size) and are 3200 × 2400. The listing packager verified their hashes, sizes and dimensions.
