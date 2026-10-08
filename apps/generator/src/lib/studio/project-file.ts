import { parseProject, type ProjectConfigV1 } from "@topostack/core";

const MAX_PROJECT_FILE_BYTES = 2_000_000;
/** A project file carrying traced depth charts is mostly their depth grids. */
const MAX_PROJECT_BUNDLE_BYTES = 24_000_000;

/**
 * Reads an exported project file: the project itself, and any traced depth
 * charts it carries saved into this browser's chart library. Throws with a
 * message for the status line when the file is too large or unreadable.
 */
export async function readProjectFile(file: File): Promise<{ project: ProjectConfigV1; savedCharts: number }> {
  if (file.size > MAX_PROJECT_BUNDLE_BYTES) throw new Error("Project file must be 24 MB or smaller.");
  const parsed: unknown = JSON.parse(await file.text());
  const envelope = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  const charts = envelope && Array.isArray(envelope.charts) ? envelope.charts : [];
  // Only a file carrying traced depth charts may be large; everything else keeps the old ceiling.
  if (!charts.length && file.size > MAX_PROJECT_FILE_BYTES) throw new Error("Project file must be 2 MB or smaller.");
  const project = parseProject(envelope && "project" in envelope ? envelope.project : parsed);
  const saved = charts.length ? await (await import("$lib/storage/user-charts")).saveProjectCharts(charts, project) : { saved: 0, skipped: 0 };
  return { project, savedCharts: saved.saved };
}
