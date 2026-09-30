# Atomm 0.7.1 validation — 2026-09-29

The patch removes duplicated horizontal padding from nested depth-limit switches, the engraving-font row, and custom line-width rows. It retains the 0.7.0 Nesting material correction. The reviewer's unspecified “Not aligned:” cannot be conclusively attributed to any one of these findings.

## Validation

- All 39 existing Atomm browser cases passed across Chromium, Firefox and WebKit.
- The new expanded-row regression passed in all three browsers after correcting its accessible-name selector and including the flat-mode border-width field in its expected count. It measures visible parameter label start edges and control end edges in Layered relief and Flat engraving at 1600, 1280, 700, 390 and 320 px, in LTR and RTL: 60 combinations. The first suite invocation included an earlier version of this new test; its two test-authoring failures were corrected and the finalized regression was rerun across all three browsers.
- All 650 generator tests passed: 498 unit and 152 client tests. All 135 release/tooling tests passed.
- Workspace typechecking and final lint passed. Svelte reported zero errors and warnings. Version/changelog checks agree on 0.7.1.
- Production Atomm packaging passed the submission environment check, artifact/SDK/endpoint verification, and checksum generation.
- The standalone production build and web bundle budget passed. Running the standalone budget checker directly on the pruned Atomm build is incompatible with its requirement for standalone WebMCP assets; the Atomm artifact is checked by its dedicated verifier.

## Exact artifact double-check

Extracted and served `topostack-atomm-v0.7.1.zip` in an iframe, with a minimal SDK stand-in and API requests blocked so layout is measured against the bundled preview. The three affected groups align with the Cut size reference in all 30 browser/width/direction combinations. No CSS was injected. Maximum numerical offset was less than 0.00004 px.

- SHA-256: `faaf772af8e4298d730e80cf75068e57cfbd5ac135506461a42410d8897a0c69`
- Bytes: 3,227,007
- [Measurements](measurements.json)
- [Font selector](font-release.png)
- [Depth limit](depth-release.png)
- [Custom line widths](linework-release.png)

The release receipt accurately marks the working tree dirty; previously prepared 0.7.0 changes and this patch are not committed by this task. No upload, submission, native Studio launch, or hosted acceptance is claimed. Use the current [review-readiness checklist](../../../atomm/review-readiness.md) for the handoff and media verification.
