import { MAX_PROJECT_FILE_BYTES, parseProject, type ProjectConfigV1 } from "@topostack/core";

/**
 * Reads an exported project file: the project itself, and any traced depth
 * charts it carries saved into this browser's chart library. Throws with a
 * message for the status line when the file is too large or unreadable.
 */
export async function readProjectFile(file: File): Promise<{ project: ProjectConfigV1; savedCharts: number }> {
  if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error("Project file must be 24 MB or smaller.");
  const parsed: unknown = JSON.parse(await file.text());
  const envelope = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  const charts = envelope && Array.isArray(envelope.charts) ? envelope.charts : [];
  const project = parseProject(envelope && "project" in envelope ? envelope.project : parsed);
  const saved = charts.length ? await (await import("$lib/storage/user-charts")).saveProjectCharts(charts, project) : { saved: 0, skipped: 0 };
  return { project, savedCharts: saved.saved };
}

/** Load charts only for a download that carries importable settings. */
export async function projectFileCharts(project: ProjectConfigV1) {
  if (!Object.keys(project.userDepthCharts ?? {}).length) return [];
  return (await import("$lib/storage/user-charts")).chartsForProject(project);
}
