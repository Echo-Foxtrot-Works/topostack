# Atomm review revision — 0.7.1 — 2026-09-29

## Rejection and correction

The 0.7.0 review supplied only “Not aligned:” with no screenshot or category. We cannot identify the reviewer's specific target from that message. A rendered audit of the exact 0.7.0 archive found duplicated 16 px insets in three parameter groups:

- Map details → Water depth → Limit depth layers.
- Map details → Text engraving → Engraving font.
- Linework → Customize preset → numeric line widths.

The 0.7.1 patch removes the second horizontal inset within these already-inset groups. Labels and control end edges now align with neighboring parameter rows. The correction also covers the additional minor/index contour and border widths in Flat engraving. The prior Nesting material card correction is retained.

## Review exercises

1. Open Cut size and Map details. Compare the depth-limit switch with the other switches, and the font selector with Text size. Labels share the same start edge and controls share the same end edge; selects retain their specified 110 px width and numeric fields their 92 px width.
2. Open Linework → Customize preset. Compare each line-width row with its subgroup heading and other parameter cards. Repeat in Flat engraving, including contour and border widths.
3. Switch to Export and inspect Nesting material. Change sheet size, finish nesting, and exercise the real host's Open in Studio and Download controls.
4. Check a narrow frame and RTL layout. There should be no horizontal overflow or inaccessible view/Tips/export controls.

## Media

Use only the current v8 media named in `listing.md` and `media-provenance.json`. These are fresh captures of the corrected 0.7.1 UI with live Crater Lake terrain and survey data. The linework gallery now opens Customize preset so the corrected numeric fields are visible. Media includes 17 PNGs and two silent H.264 videos. The SDK mount/export hook used for capture is a stand-in; media is not a claim of native Studio validation.

## Platform handoff

Upload `apps/generator/topostack-atomm-v0.7.1.zip` as the application and use `atomm/topostack-listing-upload-v0.7.1.zip` for current copy and media. Inspect the uploaded build and exercise its real export controls before submitting for review. Local preparation does not itself upload or resubmit the release, and reviewer acceptance remains unverified.

## Validation completed

- All 39 existing Atomm browser cases passed; the final expanded-row regression passed in Chromium, Firefox and WebKit, covering both output modes across five widths in LTR and RTL (60 combinations).
- The exact packaged ZIP separately passed 30 browser/width/direction alignment checks without injected CSS. Measured offsets were zero within 0.00004 px.
- All 650 generator tests and 135 release/tooling tests passed, along with workspace typechecking, final lint, version consistency, and changelog verification. Svelte reported zero errors/warnings.
- Production Atomm packaging passed environment, SDK and endpoint verification. The standalone production build passed its web bundle budget.
- Application ZIP: 3,227,007 bytes; SHA-256 `faaf772af8e4298d730e80cf75068e57cfbd5ac135506461a42410d8897a0c69`. The receipt records the existing dirty working tree honestly; no release commit was made.
- All 17 listing PNGs were visually reviewed and are 3200 × 2400. Both silent H.264 videos are 1920 × 1440 at 60 fps and passed full decoding. The listing packager checks all 19 hashes, byte sizes and image dimensions.
- `assets/topostack-cover-loop-v8.mp4`: 7,304,387 bytes; SHA-256 `66629345573479137199c9abca643e35b4e5ec9b9a35a92094f6205dbc860aec`.
- `assets/topostack-showcase-v8.mp4`: 35,925,959 bytes; SHA-256 `0ef747b05ff3742b8ddaf55e8cdb767ff61b1084bd3eb5b425a4a016bc51292b`.
