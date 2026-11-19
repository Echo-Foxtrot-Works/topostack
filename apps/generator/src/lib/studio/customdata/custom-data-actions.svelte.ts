import { MAX_CUSTOM_GRAPHICS, MAX_MARKER_ICONS, type GeoPoint, type ProjectConfigV1, type UserDepthChartRefV1 } from "@topostack/core";
import type { UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import { isSupportedCoordinate } from "$lib/domain/coordinates";
import * as edits from "$lib/studio/project-edits";
import { t } from "$lib/i18n/i18n.svelte";
import { errorText } from "$lib/i18n/errors";

/**
 * What the maker brings to a project, as edits: placing markers, drawing
 * paths, naming both, and using traced depth charts for lakes.
 *
 * The studio owns the project, its history and its status line; this owns the
 * two armed map tools and the rules for turning clicks into edits. Kept out of
 * App.svelte so those rules can be tested without mounting the studio.
 */

export interface CustomDataHost {
  project(): ProjectConfigV1;
  /** Replaces the project without refreshing the preview, for edits geometry never reads. */
  replaceProject(next: ProjectConfigV1): void;
  recordHistory(project: ProjectConfigV1, keys: string[]): void;
  updateFabrication(patch: Partial<ProjectConfigV1>): Promise<void>;
  setStatus(message: string): void;
}

export class CustomDataActions {
  /** Map clicks place markers while on; a view with no map ends it. */
  placingMarker = $state(false);
  /**
   * The path being drawn by clicking the map, held outside the project: a
   * line needs two points to be valid, and committing every click would also
   * make each one its own undo step. The finished path lands as one edit.
   */
  lineDraft = $state.raw<{ points: GeoPoint[] } | undefined>(undefined);

  constructor(private readonly host: CustomDataHost) {}

  /** Arms marker placing, which disarms drawing: each is one click, so only one can be on. */
  setPlacingMarker(on: boolean): void {
    this.placingMarker = on;
    if (on) this.lineDraft = undefined;
  }

  /**
   * Each armed tool belongs to the view and section whose controls say it is
   * on; anywhere else a map click would do something no visible control explains.
   */
  disarmOutside(mode: string, section: string): void {
    if (!(mode === "map" || (mode === "custom" && section === "markers"))) this.placingMarker = false;
    if (!(mode === "custom" && section === "paths")) this.lineDraft = undefined;
  }

  /** Apply a marker or path edit from `project-edits`; `undefined` means the edit was rejected. */
  applyEdit(patch: Partial<ProjectConfigV1> | undefined): void {
    if (patch) void this.host.updateFabrication(patch);
  }

  /**
   * Reads an uploaded SVG into a project icon and, when a marker is named,
   * gives that marker the icon. One upload is one undo step. The reader is
   * loaded on first use; most makers never upload an icon.
   */
  async importMarkerIcon(file: File | undefined, markerId?: string): Promise<void> {
    if (!file) return;
    try {
      const { importSvgIcon } = await import("$lib/domain/svg-icon-import");
      const { icon, warnings } = await importSvgIcon(file, crypto.randomUUID());
      const project = this.host.project();
      const added = edits.addMarkerIcon(project, icon);
      if (!added) { this.host.setStatus(t("customdata.markerIconLimit", { max: MAX_MARKER_ICONS })); return; }
      const withIcon = { ...project, ...added.patch };
      const assigned = markerId ? edits.updateMarker(withIcon, markerId, { symbol: "custom", iconId: added.iconId }) : undefined;
      await this.host.updateFabrication({ ...added.patch, ...assigned });
      const name = withIcon.markerIcons?.find(({ id }) => id === added.iconId)?.name ?? icon.name;
      this.host.setStatus([t("customdata.markerIconAdded", { name }), ...warnings].join(" · "));
    } catch (error) {
      this.host.setStatus(errorText(error, t("customdata.svgReadFailed")));
    }
  }

  /**
   * Reads an uploaded SVG into the project's graphics library as one undo
   * step. Placing it is a separate step, on the preview. The reader is shared
   * with marker icons and loaded on first use.
   */
  async importGraphic(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { importSvgGraphic } = await import("$lib/domain/svg-icon-import");
      const { graphic, warnings } = await importSvgGraphic(file, crypto.randomUUID());
      const project = this.host.project();
      const added = edits.addCustomGraphic(project, graphic);
      if (!added) { this.host.setStatus(t("customdata.graphicLimit", { max: MAX_CUSTOM_GRAPHICS })); return; }
      await this.host.updateFabrication(added.patch);
      const name = added.patch.customGraphics?.find(({ id }) => id === added.graphicId)?.name ?? graphic.name;
      this.host.setStatus([t("customdata.graphicAdded", { name }), ...warnings].join(" · "));
    } catch (error) {
      this.host.setStatus(errorText(error, t("customdata.svgReadFailed")));
    }
  }

  /**
   * Names a marker or path. A name is the maker's own bookkeeping: the
   * geometry never reads it and the fingerprint leaves it out, so this records
   * an undo step and nothing else. Refreshing the preview for a keystroke
   * would be work for a picture that cannot change.
   */
  rename(patch: Partial<ProjectConfigV1> | undefined): void {
    if (!patch) return;
    const project = this.host.project();
    this.host.recordHistory(project, Object.keys(patch));
    this.host.replaceProject({ ...project, ...patch });
  }

  startLineDraft(): void {
    if (!edits.canAddCustomLine(this.host.project())) return;
    this.placingMarker = false;
    this.lineDraft = { points: [] };
  }

  extendLineDraft(point: GeoPoint): void {
    const draft = this.lineDraft;
    if (!draft) return;
    // A double-click to finish arrives as two clicks on the same spot first.
    const last = draft.points.at(-1);
    if (last && last.lat === point.lat && last.lon === point.lon) return;
    if (!isSupportedCoordinate(point.lat, point.lon)) { this.host.setStatus(t("customdata.pointOutOfRange")); return; }
    if (!edits.canExtendDrawnLine(this.host.project(), draft.points.length)) { this.host.setStatus(t("customdata.pathFull")); return; }
    this.lineDraft = { points: [...draft.points, point] };
  }

  /**
   * Adds the drawn path to the project. Closed, it is a boundary; open, a
   * trail. A path too short to keep stays in progress, with the reason, rather
   * than vanishing.
   */
  commitLineDraft(closed = false): void {
    const draft = this.lineDraft;
    if (!draft) return;
    const patch = edits.addDrawnCustomLine(this.host.project(), crypto.randomUUID(), draft.points, closed);
    if (!patch) {
      this.host.setStatus(closed ? t("customdata.boundaryTooShort") : t("customdata.trailTooShort"));
      return;
    }
    this.lineDraft = undefined;
    this.applyEdit(patch);
  }

  cancelLineDraft(): void {
    this.lineDraft = undefined;
  }

  /**
   * Keeps a traced chart in this browser's library. Nothing is carved: keeping
   * a chart and carving a lake with it are separate acts, so the maker can
   * build charts long before they frame a map.
   */
  async saveChartToLibrary(record: UserChartBathymetryV1): Promise<UserDepthChartRefV1> {
    if (!record.review) throw new Error(t("customdata.chartReviewRequired"));
    const { saveUserChart } = await import("$lib/storage/user-charts");
    const reference = await saveUserChart(record);
    this.host.setStatus(record.lake.name ? t("customdata.chartKept", { lake: record.lake.name }) : t("customdata.chartKeptUnnamed"));
    return reference;
  }

  /**
   * Carves a lake from a kept chart, under the lake's key (see
   * `depthChartLakeKey`). The terrain is stale until it regenerates.
   */
  async useChartForLake(lakeKey: string, reference: UserDepthChartRefV1): Promise<void> {
    const { loadUserChart } = await import("$lib/storage/user-charts");
    const loaded = await loadUserChart(reference.id);
    if (!loaded?.chart.review) { this.host.setStatus(t("customdata.chartNeedsReview")); return; }
    const project = this.host.project();
    // A charted lake offers no maximum-depth override, so one set before would
    // keep shaping the chart's gaps where nothing shows it. It goes with the switch.
    const waterDepthOverrides = { ...project.waterDepthOverrides };
    delete waterDepthOverrides[lakeKey];
    await this.host.updateFabrication({ userDepthCharts: { ...project.userDepthCharts, [lakeKey]: reference }, waterDepthOverrides });
    this.host.setStatus(t("customdata.chartInUse"));
  }

  /** Forgets a lake's chart reference; the saved chart stays for another project. */
  async clearDepthChart(lakeKey: string): Promise<void> {
    const remaining = { ...this.host.project().userDepthCharts };
    delete remaining[lakeKey];
    await this.host.updateFabrication({ userDepthCharts: Object.keys(remaining).length ? remaining : undefined });
  }
}
