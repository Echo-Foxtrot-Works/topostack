import type { ExportFile, ProjectConfigV1 } from "../types.js";

export const MAX_PROJECT_FILE_BYTES = 24_000_000;
// Keep ordinary settings readable, and large coordinate arrays compact.
const PREFERRED_INDENTED_BYTES = 2_000_000;

interface ProjectEnvelope {
  schemaVersion: number;
  project: ProjectConfigV1;
  result?: object;
  attribution?: unknown;
}

/** The host supplies the chart records it read from its local library. */
function encodeProjectFile(envelope: ProjectEnvelope, charts: readonly { id: string }[]): Blob {
  const included = new Set(charts.map(chart => chart.id));
  for (const { id } of Object.values(envelope.project.userDepthCharts ?? {})) {
    if (!included.has(id)) throw new Error(`The depth chart ${id} is missing from the project backup.`);
  }
  const type = "application/json";
  const settings = JSON.stringify(envelope, null, 2);
  const chartText = charts.map(chart => JSON.stringify(chart));
  const pretty = new Blob(chartText.length
    ? [settings.slice(0, -2), ',\n  "charts": [\n    ', chartText.join(",\n    "), "\n  ]\n}"]
    : [settings], { type });
  if (pretty.size <= PREFERRED_INDENTED_BYTES) return pretty;
  const compact = JSON.stringify(envelope);
  return new Blob(chartText.length
    ? [compact.slice(0, -1), ',"charts":[', chartText.join(","), "]}"]
    : [compact], { type });
}

export function projectSettingsBlob(project: ProjectConfigV1, charts: readonly { id: string }[] = []): Blob {
  const blob = encodeProjectFile({ schemaVersion: 1, project }, charts);
  if (blob.size > MAX_PROJECT_FILE_BYTES) throw new Error("Project settings and depth charts exceed the 24 MB project file limit.");
  return blob;
}

/** Large generation receipts can travel separately so the project remains importable. */
export function packageProjectFiles(base: string, manifest: ProjectEnvelope, charts: readonly { id: string }[] = []): ExportFile[] {
  const filename = `${base}-project.json`;
  const blob = encodeProjectFile(manifest, charts);
  if (blob.size <= MAX_PROJECT_FILE_BYTES) return [{ filename, blob }];
  return [
    { filename, blob: projectSettingsBlob(manifest.project, charts) },
    { filename: `${base}-generation.json`, blob: new Blob([JSON.stringify({ schemaVersion: manifest.schemaVersion, result: manifest.result, attribution: manifest.attribution })], { type: "application/json" }) },
  ];
}
