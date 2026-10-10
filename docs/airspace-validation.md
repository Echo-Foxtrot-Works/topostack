# Airspace acceptance and assembly validation

Use these checks when changing FAA volumes, overlap ownership, labels, supports or acrylic material settings. Software checks and physical observations answer different questions; keep both records with the release.

## Build and verify the FAA candidate

Use Python 3.13 with the pinned packages in `scripts/data-build/requirements.txt`, plus `tippecanoe` and `pmtiles` on PATH. The builder verifies every input SHA and every feature against the browser data contract.

```bash
python scripts/data-build/build-faa-aviation.py --output .topostack/faa/faa-aviation-2026-10-01-v2.pmtiles
node scripts/provision/provision-aviation-data.mjs .topostack/faa/faa-aviation-2026-10-01-v2.pmtiles --verify-only --expected-sha256=de3c118977ab56157675ab15a97a7803a23971d4a7ff20113124c480a6c8f793
```

For a later release, use its new dataset registration and its build receipt’s digest. `--sources <candidate.json>` supports an isolated build before changing the committed registration. Verification can select that file with `--sources=<candidate.json>`; publication uses the committed registration.

After release approval, stage with the existing [FAA release procedure](faa-aviation.md#refreshing-for-a-new-cycle). The v2 registration and release pointer must activate together; a deployed registration naming v2 against a served v1 archive fails the deployment smoke check.

## Repeat real-data acceptance

Run from the repository root with installed workspace dependencies:

```bash
node scripts/verify/airspace-acceptance.mjs --archive .topostack/faa/faa-aviation-2026-10-01-v2.pmtiles --runs 3
```

This uses the production volume loader, actual terrain and the production geometry/exporter for Denver Class B, mixed special-use airspace near Las Vegas, and rugged Seattle terrain. Each crop checks plates, tiers and solid volumes. Its local range server binds only to loopback and never modifies a remote dataset. Terrain tiles download from the public Terrarium source on first use and are cached in `.topostack/faa/terrarium/`; the report records each tile’s URL and SHA.

The default report is `.topostack/airspace-acceptance/results.json`. Options include `--grid 64..768`, `--runs 1..10`, `--crop denver-class-b|las-vegas-mixed-sua|seattle-rugged-terrain`, and `--output <report.json>`. Three timing samples follow one warm-up by default, excluding data loading and export. Generation must be deterministic after excluding its timestamp.

An acceptance pass proves the tested geometric invariants and export path. Read the warnings: merged levels, discarded small pieces, omitted labels, support reach and stock usage can still require a different crop or assembly choice.

## Prepare and record a physical test

```bash
npm run build -w @topostack/core
node scripts/verify/airspace-fabrication-fixtures.mjs
```

The output directory defaults to `.topostack/airspace-fabrication-fixtures/`; supply another directory as the first argument. Eighteen explicitly synthetic jobs exercise all three forms, both rod joints, backing sockets, a widening stack and the 1/3/10 mm stock choices. The endpoints cover the allowed thickness range; they do not certify every stock, glue or rod combination.

For each thickness and joint combination, record:

| Observation | Record |
| --- | --- |
| Actual stock and rod dimensions | Measured acrylic thickness, wood thickness, rod size/shape and material |
| Laser fit | Kerf and clearance used, hole/socket dimensions, whether assembly requires force |
| Terrain sockets and backing | Socket depth, seated rod length, backing adhesion, any breakout or splitting |
| Assembly height | Piece underside heights against the guide, including every carried through-rod piece |
| Widening and unsupported reach | Visible sag, rocking or movement before and after glue curing |
| Engraving | Name/altitude readability, cycle/navigation notice, frost windows and visible rod locators |
| Glue result | Adhesive, cure duration, haze, bond separation or cracking |
| Result | Pass/fail, photos and the smallest change needed before repeating |

Keep stock settings and observations with `fixtures.json`. Treat its `physicalValidation: pending` as pending until cutting and assembly have actually been observed. The generated export manifests and `TEST-FIXTURE.txt` identify invented sectors; these jobs are never FAA data or navigation aids.
