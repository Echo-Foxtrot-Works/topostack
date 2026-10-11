/** Generate deliberate assembly test jobs; these are synthetic and never navigation data. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, buildFabricationPackage, createSyntheticSource, generateGeometry, registerAirspaceStage } from "@topostack/core";
import { buildAirspaceStack } from "@topostack/core/airspace";

registerAirspaceStage(buildAirspaceStack);
const output = resolve(process.argv[2] ?? ".topostack/airspace-fabrication-fixtures");
const config = { ...DEFAULT_PROJECT, name: "Airspace assembly test", widthMm: 180, heightMm: 120, verticalExaggeration: 5, optimizeMaterialUse: false, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false, showAssemblyLabels: false, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false, location: { label: "Synthetic assembly fixture", lat: 40, lon: -104.9, zoom: 12, bounds: { west: -105, east: -104.8, south: 39.9, north: 40.1 } } };
const source = createSyntheticSource(config, 64);
for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) source.elevation.values[y * 64 + x] = 1000 + Math.max(0, 600 - Math.hypot(x - 8, y - 30) * 45);
source.elevation.min = Math.min(...source.elevation.values); source.elevation.max = Math.max(...source.elevation.values);
const terrain = generateGeometry(config, source);
const baseM = terrain.layers[0].elevationM, stepM = terrain.layers[1].elevationM - baseM;
const feetAt = (step) => Math.round((baseM + step * stepM) / 0.3048);
const square = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
source.airspaceStatus = "available";
source.airspaceVolumes = [
  { id: "stem", name: "TEST STEM", aviationClass: "class-b", floor: { ref: "msl", ft: feetAt(8) }, ceiling: { ref: "msl", ft: feetAt(22) }, polygons: [{ outer: square(0, -45, 60, -5), holes: [] }] },
  { id: "cap", name: "TEST WIDENING CAP", aviationClass: "class-b", floor: { ref: "msl", ft: feetAt(14) }, ceiling: { ref: "msl", ft: feetAt(22) }, polygons: [{ outer: square(0, -45, 80, 50), holes: [] }] },
];
const fixtures = [];
const acceptance = [
  "# Airspace fabrication acceptance record",
  "",
  "Copy this template to acceptance-record.md before recording observations. Regeneration replaces templates, not your record.",
  "",
  "Status: pending. Generated jobs and software tests do not establish physical acceptance.",
  "",
  "Candidate commit: ____  Release version: ____  Operator: ____  Date: ____",
  "",
  "Laser/machine and software version: ____  Rod stock: ____  Adhesive and cure time: ____",
  "",
  "For each job, copy its observations-template.md to observations.md and record measurements, photos, pass/fail and any repeat needed.",
  "",
  "| Job | Guide | Observations | Result |",
  "| --- | --- | --- | --- |",
];
for (const thicknessMm of [1, 3, 10]) for (const form of ["plates", "tiers", "volumes"]) for (const joint of ["segments", "through"]) {
  const name = `${form}-${joint}-${thicknessMm}mm`;
  const project = { ...config, name: `Assembly test ${name}`, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form, thicknessMm, rod: { ...DEFAULT_AIRSPACE_STACK.rod, joint } } };
  const geometry = generateGeometry(project, source);
  const stack = geometry.airspaceStack;
  assert(stack?.levels.length && stack.columns.length, `Empty test fixture: ${name}`);
  assert(stack.backingSheet, `Fixture must exercise backing sockets: ${name}`);
  // The exporter rejects synthetic production jobs. Give it a clone only to
  // create this explicitly named test job; never change the fixture provenance.
  const job = buildFabricationPackage({ ...geometry, sourceKind: "real" }, project);
  const directory = join(output, name); await mkdir(directory, { recursive: true });
  for (const file of job.files) {
    if (file.filename.endsWith("-project.json")) {
      const manifest = JSON.parse(await file.blob.text());
      manifest.testFixture = { synthetic: true, physicalValidation: "pending" };
      await writeFile(join(directory, file.filename), JSON.stringify(manifest, null, 2) + "\n");
    } else await writeFile(join(directory, file.filename), Buffer.from(await file.blob.arrayBuffer()));
  }
  await writeFile(join(directory, "TEST-FIXTURE.txt"), "SYNTHETIC ASSEMBLY TEST ONLY. These invented sectors are not FAA data. Measure your actual stock and set laser power/speed for it. Record fit, socket depth, hole clearance, glue stability and unsupported reach. Do not treat software geometry checks as physical validation.\n");
  await writeFile(join(directory, "observations-template.md"), [
    `# ${name} physical observations`, "", "Status: pending", "",
    "Candidate commit: ____  Operator: ____  Date: ____", "",
    `Requested acrylic: ${thicknessMm} mm; form: ${form}; rods: ${joint}.`, "",
    "| Observation | Measurement and evidence | Result |", "| --- | --- | --- |",
    ...["Actual acrylic/wood thickness and rod dimensions/material", "Laser settings, kerf, hole/socket dimensions and fit clearance", "Socket depth, seated rod length, backing adhesion and breakout", "Piece underside heights against the assembly guide", "Widening support: sag/rocking before and after curing", "Engraving, frost windows, rod locators and navigation notice", "Adhesive, cure duration, haze, bond separation and cracking"].map((label) => `| ${label} | ____ | pending |`),
    "", "Photos/evidence paths: ____", "", "Overall pass/fail and changes before repeating: ____", "",
  ].join("\n"));
  const guide = job.files.find((file) => file.filename.endsWith("-assembly-guide.html"));
  assert(guide, `Missing assembly guide: ${name}`);
  acceptance.push(`| ${name} | [Guide](${name}/${guide.filename}) | [Template](${name}/observations-template.md) | pending |`);
  fixtures.push({ name, form, joint, thicknessMm, directory, levels: stack.levels.length, pieces: stack.levels.flatMap((level) => level.pieces).length, backingSheet: stack.backingSheet, warnings: geometry.warnings });
  console.log(`Prepared ${name}`);
}
await writeFile(join(output, "fixtures.json"), JSON.stringify({ synthetic: true, physicalValidation: "pending", fixtures }, null, 2) + "\n");
await writeFile(join(output, "acceptance-template.md"), acceptance.join("\n") + "\n");
console.log(`Saved assembly fixtures to ${output}`);
