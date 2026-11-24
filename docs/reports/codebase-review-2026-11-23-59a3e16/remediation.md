# Review remediation

The fixes apply to the working tree on `codex/export-fidelity-fixes` at `59a3e16`. The [review](review.md) and its [inventory](coverage.tsv) describe the earlier snapshot. The following checks exercise the corrections to its five P1, 33 P2 and 11 P3 entries and the separate deployment verification gap.

## Five priority regressions

| Failure | Verified behavior |
| --- | --- |
| Startup read could replace the saved design | An interrupted IndexedDB read retries on a new transaction. A persistent read failure pauses autosave and pagehide writes. A damaged primary is backed up before a usable unload copy becomes the working design. Browser tests reopen the design and inspect both stores. |
| Rod holes vanished from the cut file | The 5 mm minimum-feature fixture retains the smaller functional sockets and acrylic holes. The download tests measure cut geometry against the rod and socket instructions. |
| Distinct lake depths were averaged away | The 4 px and 12 px chart fixtures retain the 75 m basin. Studio refuses an unresolved chart. A previously reviewed raster that lost a constraint remains available for backup and is rejected for carving. |
| One map reused tiles from two releases | Pending reads share the archive generation. Both completion orders now produce one release or reject the operation. The old/new road-tile fixture returns roads from the new archive together. |
| Rebuilding lake vectors replaced PMTiles with SQLite | The writer preserves the format extension, verifies the finished archive and only then replaces the target. The real one-lake rebuild passes the provision verifier. A valid raster with the expected zooms and its own correct digest fails the lake-vector gate. |

## Other fixes

| Area | Changes and checks |
| --- | --- |
| Fabrication and placement | Hidden guides are clipped around openings with stroke clearance. Same-grade shared road runs engrave once. Flat graphics use supported engraving operations. The placement view includes the marks on water inserts. Dry crops do not warn about flattened deep water. |
| Panels and nesting | Split files advertise the layers they cut. Independent islands can be packed separately when their group exceeds the stock. Browser checks read the downloaded SVGs, apply each piece's matrix and compare cut identity, margins and spacing with the manifest. |
| Terrain and survey coverage | Adjacent elevation crops return the same 150 m boundary sample. A reviewed chart on one lake preserves the outage and retry for a second lake. FAA coverage uses the same world-copy intersection in Studio and agent responses. |
| Data capture and publication | ArcGIS paging, NOAA contributor eligibility and incremental lake-directory reuse check the source revision or full input pins. Partial geocoding results expire early. Conditional archive responses recheck the backing object. The active and staged FAA identities are exposed separately and pruning protects the candidate. |
| Studio state | Import supersedes a held chart lookup. Wood and acrylic stock edits survive generation. Finish-size and minimum-feature changes refresh the land and airspace filters. In the review fixtures, the edited land engraving and acrylic SVG each matched a fresh export byte for byte. |
| Agent interfaces | Rejected WebMCP area changes preserve the design. Narrow MCP bounds stay exact when looking up sources. Flat preview paths, optional borders and the planned contour interval agree with generation. |
| Public and embedded Studio | Standalone visits skip the external SDK. A framed Studio can recover registration on the same SDK object. Keyboard focus follows the replacement rail control and translated controls inherit the active language. Feedback preserves edits made during a send, respects diagnostic consent, and preserves long GitHub handoffs. Terminal NoData warnings use the active locale. |
| Guides and discovery | Marketplace copy distinguishes wood handoff from the multi-material download. Lake directory headings, Markdown discovery, the export and REST guides, feedback instructions and PNG capture instructions describe the shipped behavior. |
| Release tooling | Deployment smoke and Atomm evidence check the candidate frontend, Worker and active archives. The Atomm publisher requires a version 2 receipt with that evidence. Web release publication resumes from a verified tag. The rollback guide restores conditional release pointers. Packaged notices include all eight engraving font families. Release preparation validates its proposed changes before writing and can resume interrupted writes. |
| Media preparation | Listing caches retain their original render identity. Release listing packaging rejects reused renders. Lake preview resume hashes the prepared terrain and depth arrays and the produced image. Manifest checkpoints are serialized and replaced atomically. |

## Acceptance boundary

All 2,668 workspace tests passed with coverage thresholds enforced, including 215 mounted Studio tests and 231 Worker tests. The 189 operational script tests, 141 Python tests, 10 native Rust tests, workspace type checks, lint and export checks passed. The lake directory browser verifier covered mobile layout, saved edits and failed-load recovery. Two locally routed browser canaries measured the plaque, north arrow and scale bar in the downloaded SVGs within 0.02 mm of their displayed positions.

The full Chromium, Firefox and WebKit suite passed 368 cases without retries. Four cases are intentionally skipped because they exercise Chromium-only WebMCP integration. After the final chart rounding change, a separate rebuild passed all 45 depth-chart and generation cases across the three browsers.

The production build and bundle checks passed. Initial JavaScript used 161,979 gzip bytes against a 162,000-byte limit. The Worker used 89,270 gzip bytes with revision and active FAA checks enabled. This change raises its working-tree limit from 89,000 to 90,000 bytes. The production site verifier checked 2,854 HTML files. The Atomm ZIP and ten-image listing package passed their local distribution checks.

The Atomm tests use a simulated host. Deployed canaries, real Atomm handoff, native xTool and LightBurn import, and physical cut tolerances still need a release candidate and the corresponding environment. [Release acceptance](../../release-acceptance.md)
