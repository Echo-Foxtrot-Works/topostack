<script lang="ts">
  import { formatNumber, t } from "$lib/i18n/i18n.svelte";
  import { getEmbedded, getAutomaticNesting } from "$lib/studio/embed-context";
  import GenerationProgress from "$lib/studio/GenerationProgress.svelte";
  import type { NestingProgress } from "$lib/atomm/automatic-nesting";
  import { buildProjectPackage, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
  import { acrylicOutsideStudio, buildAtommPackage, loadGuideFonts } from "$lib/studio/export-policy";
  import { projectFileCharts } from "$lib/studio/project-file";
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { ChevronDown } from "@lucide/svelte";

  /**
   * A file name split so a narrow list shortens the shared project prefix, not
   * the end that tells the files apart ("…-sheet-01-paint-national-park.svg").
   */
  function splitFilename(filename: string, master: string): [string, string] {
    const prefix = master.replace(/master\.svg$/, "");
    return prefix && filename.startsWith(prefix) && filename !== master ? [prefix, filename.slice(prefix.length)] : ["", filename];
  }

  /**
   * What leaves the generator: the artwork Open in Studio sends, drawn from
   * the exported file itself, and the files a download holds.
   */
  // `blocked` is the studio's exportBlockReason for these two, so the project is not fingerprinted again here.
  let { geometry, project, blocked, busy = false }: { geometry: GeometryIRV1; project: ProjectConfigV1; blocked: string | undefined; busy?: boolean } = $props();

  const isEmbedded = getEmbedded();
  const automaticNesting = getAutomaticNesting();
  let progress = $state<NestingProgress>({ running: false, previews: [], sheetCount: 0, utilization: 0, updates: 0 });
  $effect(() => automaticNesting?.subscribe(value => { progress = value; }));
  let packaging = $state(false);
  // Below this canvas width the contents card would cover most of the sheets, so it folds to one line.
  const NARROW_CANVAS_PX = 640;
  let canvasWidth = $state(Number.POSITIVE_INFINITY);
  const narrow = $derived(canvasWidth < NARROW_CANVAS_PX);
  let manifestChoice = $state<boolean | undefined>(undefined);
  const manifestOpen = $derived(manifestChoice ?? !narrow);
  let preparing = $state(t("preview.exportPreparing"));

  type Built = { layoutNote: string; sheetCount: number; url: string; filename: string; bytes: number; width: number; height: number; cut: boolean; score: boolean; fill: boolean; files: Array<{ filename: string; bytes: number }> };
  let built = $state.raw<Built | undefined>();
  let failure = $state("");

  function formatBytes(bytes: number): string {
    return bytes < 1024 ? t("preview.bytes", { value: formatNumber(bytes, { useGrouping: false }) }) : bytes < 1024 * 1024 ? t("preview.kilobytes", { value: formatNumber(Math.round(bytes / 1024), { useGrouping: false }) }) : t("preview.megabytes", { value: formatNumber(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  }

  // The shown artwork's object URL, released when a newer build replaces it or the view closes.
  let shownUrl: string | undefined;
  function show(next: Built | undefined): void {
    if (shownUrl && shownUrl !== next?.url) URL.revokeObjectURL(shownUrl);
    shownUrl = next?.url;
    built = next;
  }
  $effect(() => () => show(undefined));

  $effect(() => {
    // Packaging serializes every sheet, so it waits for a settled preview and
    // yields a frame first; a newer edit cancels it before it starts. The last
    // artwork stays up while the preview refreshes.
    if (busy) return;
    if (blocked) { show(undefined); failure = ""; return; }
    const current = { geometry, project };
    packaging = false;
    progress = { running: false, previews: [], sheetCount: 0, utilization: 0, updates: 0 };
    show(undefined);
    failure = "";
    preparing = isEmbedded() && project.outputMode === "stack" ? t("preview.exportStepArranging") : t("preview.exportPreparing");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const layout = isEmbedded() && automaticNesting ? await automaticNesting.prepare(current.geometry, current.project) : undefined;
          if (cancelled) return;
          packaging = true;
          preparing = t("preview.exportStepPreparing");
          const guideFonts = await loadGuideFonts();
          if (cancelled) return;
          const output = isEmbedded()
            ? await buildAtommPackage(current.geometry, layout?.project ?? current.project, guideFonts, layout?.sheetPlan)
            : buildProjectPackage(current.geometry, current.project, { guideFonts, charts: await projectFileCharts(current.project) });
          const svg = await output.master.blob.text();
          if (cancelled) return;
          // The image fills the file's own viewBox size, so the sheet keeps its proportions.
          const [, , width = current.geometry.widthMm, height = current.geometry.heightMm] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(/\s+/).map(Number);
          // Real line widths (0.1 mm and up) rasterize to faint dots at fit zoom,
          // so the on-screen copy draws every line as a hairline. The file itself is unchanged.
          const display = svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>*{vector-effect:non-scaling-stroke;stroke-width:1px}</style>`);
          show({ layoutNote: layout?.layoutNote ?? "", sheetCount: layout?.sheetPlan?.sheets.length ?? 0, url: URL.createObjectURL(new Blob([display], { type: "image/svg+xml" })), filename: output.master.filename, bytes: output.master.blob.size, width, height,
            cut: /stroke="#FE0002"/i.test(svg), score: /stroke="#2366FF"/i.test(svg), fill: /fill="#(?:2366FF|000000)"/i.test(svg), files: output.files.map((file) => ({ filename: file.filename, bytes: file.blob.size })) });
          failure = "";
        } catch (error) {
          if (!cancelled) { show(undefined); failure = error instanceof Error ? error.message : t("preview.exportPreviewFailed"); }
        }
      })();
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  });

  // Open in Studio sends the wood master alone; acrylic pieces are only in the download.
  const woodOnly = $derived(Boolean(acrylicOutsideStudio(geometry)));
  const totalBytes = $derived(built?.files.reduce((total, file) => total + file.bytes, 0) ?? 0);
</script>

<div class="export-preview" aria-busy={!built && !failure && !blocked} bind:clientWidth={canvasWidth} data-narrow={narrow ? "" : undefined} data-manifest={manifestOpen ? "open" : "folded"}>
  {#if built}
    <div class="export-sheet">
      <SvgViewport widthMm={built.width} heightMm={built.height} topLeft label="export" svgLabel={t("preview.exportPreviewOf", { filename: built.filename })} controlsLabel={t("preview.exportZoomControls")} resetLabel={t("preview.resetExportView")}>
        <rect x="0" y="0" width={built.width} height={built.height} fill="#fff" />
        <image href={built.url} x="0" y="0" width={built.width} height={built.height} />
      </SvgViewport>
    </div>
    <section class="export-manifest" id="export-manifest" aria-label={t("preview.exportContents")}>
      <div class="export-manifest-head">
        <h2>{t("preview.exportContents")}</h2>
        {#if narrow}
          <span class="export-manifest-summary">{built.sheetCount ? t("preview.exportSummarySheets", { sheets: built.sheetCount, files: built.files.length }) : t("preview.exportSummaryFiles", { files: built.files.length })}</span>
          <button type="button" class="btn-icon btn-icon-sm export-manifest-toggle" aria-expanded={manifestOpen} aria-controls="export-manifest-body" aria-label={manifestOpen ? t("preview.foldExportContents") : t("preview.showExportContents")} onclick={() => { manifestChoice = !manifestOpen; }}><ChevronDown size={16} aria-hidden="true" /></button>
        {/if}
      </div>
      <div class="export-manifest-body" id="export-manifest-body" hidden={!manifestOpen}>
      {#if built.layoutNote}<p class="export-layout-note">{built.layoutNote}</p><p class="export-layout-credit">{t("preview.nestingBy")} <a href="https://github.com/JeroenGar/sparrow" target="_blank" rel="noreferrer">sparrow</a></p>{/if}
      <p class="export-manifest-row"><span>{t("preview.openInStudio")}</span><strong>{t("preview.oneEditableSvg")}</strong><small>{woodOnly ? t("preview.studioWoodOnly", { size: formatBytes(built.bytes) }) : t("preview.studioEntireLayout", { size: formatBytes(built.bytes) })}</small></p>
      <details>
        <summary><span>{t("preview.download")}</span><strong>{t("preview.completeBundle")}</strong><small>{t("preview.bundleSize", { count: built.files.length, size: formatBytes(totalBytes) })}</small><span class="export-files-toggle">{t("preview.viewIncludedFiles")} <span aria-hidden="true">⌄</span></span></summary>
        <ul>{#each built.files as file (file.filename)}{@const [stem, end] = splitFilename(file.filename, built.filename)}<li><span class="export-file-name" title={file.filename}><span class="export-file-stem">{stem}</span><span class="export-file-end">{end}</span></span><small>{formatBytes(file.bytes)}</small></li>{/each}</ul>
      </details>
      <div class="export-key">{#if built.cut}<span><i class="export-key-cut" aria-hidden="true"></i>{t("preview.keyCut")}</span>{/if}{#if built.score}<span><i class="export-key-score" aria-hidden="true"></i>{t("preview.keyScore")}</span>{/if}{#if built.fill}<span><i class="export-key-fill" style:background={isEmbedded() ? undefined : "#000"} aria-hidden="true"></i>{t(isEmbedded() ? "preview.keyEngrave" : "preview.graphicOperation.engrave")}</span>{/if}</div>
    </div>
    </section>
  {:else if !failure && !blocked && !busy && isEmbedded()}
    {#if progress.previews.length}
      <div class="atomm-nesting-drafts" aria-label={t("preview.nestingInProgress")}>
        {#each progress.previews as sheet, index (index)}
          <figure>
            <svg viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`} role="img" aria-label={sheet.provisional ? t("preview.nestingSheetPending", { number: index + 1, count: sheet.parts.length }) : t("preview.nestingSheet", { number: index + 1, count: sheet.parts.length })}>
              <rect width={sheet.widthMm} height={sheet.heightMm} fill="white" />
              {#each sheet.parts as part, partIndex (partIndex)}<path d={part.path}><title>{part.label}</title></path>{/each}
            </svg>
            <figcaption>{sheet.provisional ? t("preview.sheetCaptionPending", { number: index + 1 }) : t("preview.sheetCaption", { number: index + 1 })}</figcaption>
          </figure>
        {/each}
      </div>
    {/if}
    <GenerationProgress class={progress.previews.length ? "nesting-progress has-drafts" : "nesting-progress"}
      title={!packaging && project.outputMode === "stack" ? t("preview.arrangingSheets") : t("preview.preparingExportPreview")}
      detail={!packaging && project.outputMode === "stack" ? (progress.sheetCount ? t("preview.nestingProgress", { sheets: progress.sheetCount, percent: Math.round(progress.utilization * 100), layout: progress.updates }) : t("preview.preparingPieces")) : t("preview.buildingArtwork")}
      step={project.outputMode === "stack" ? (packaging ? 2 : 1) : undefined} total={2}
      onCancel={progress.running && progress.sheetCount ? () => automaticNesting?.stop() : undefined} cancelLabel={t("preview.useCurrentLayout")} />
  {:else}
    <p class="export-preview-state" role="status">{failure || blocked || (busy ? t("preview.exportWaitsForTerrain") : preparing)}</p>
  {/if}
</div>
