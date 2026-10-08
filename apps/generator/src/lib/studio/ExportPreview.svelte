<script lang="ts">
  import { getEmbedded, getAutomaticNesting } from "$lib/studio/embed-context";
  import GenerationProgress from "$lib/studio/GenerationProgress.svelte";
  import type { NestingProgress } from "$lib/atomm/automatic-nesting";
  import { buildProjectPackage, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
  import { buildAtommPackage, loadGuideFonts } from "$lib/studio/export-policy";
  import SvgViewport from "$lib/studio/SvgViewport.svelte";

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
  let preparing = $state("Preparing export preview…");

  type Built = { layoutNote: string; url: string; filename: string; bytes: number; width: number; height: number; cut: boolean; score: boolean; fill: boolean; files: Array<{ filename: string; bytes: number }> };
  let built = $state.raw<Built | undefined>();
  let failure = $state("");

  function formatBytes(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    preparing = isEmbedded() && project.outputMode === "stack" ? "Step 1 of 2 · Arranging sheets…" : "Preparing export preview…";
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const layout = isEmbedded() && automaticNesting ? await automaticNesting.prepare(current.geometry, current.project) : undefined;
          if (cancelled) return;
          packaging = true;
          preparing = "Step 2 of 2 · Preparing export preview…";
          const guideFonts = await loadGuideFonts();
          if (cancelled) return;
          const output = isEmbedded()
            ? await buildAtommPackage(current.geometry, layout?.project ?? current.project, guideFonts, layout?.sheetPlan)
            : buildProjectPackage(current.geometry, current.project, { guideFonts });
          const svg = await output.master.blob.text();
          if (cancelled) return;
          // The image fills the file's own viewBox size, so the sheet keeps its proportions.
          const [, , width = current.geometry.widthMm, height = current.geometry.heightMm] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(/\s+/).map(Number);
          // Real line widths (0.1 mm and up) rasterize to faint dots at fit zoom,
          // so the on-screen copy draws every line as a hairline. The file itself is unchanged.
          const display = svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>*{vector-effect:non-scaling-stroke;stroke-width:1px}</style>`);
          show({ layoutNote: layout?.layoutNote ?? "", url: URL.createObjectURL(new Blob([display], { type: "image/svg+xml" })), filename: output.master.filename, bytes: output.master.blob.size, width, height,
            cut: /stroke="#FE0002"/i.test(svg), score: /stroke="#2366FF"/i.test(svg), fill: /fill="#2366FF"/i.test(svg), files: output.files.map((file) => ({ filename: file.filename, bytes: file.blob.size })) });
          failure = "";
        } catch (error) {
          if (!cancelled) { show(undefined); failure = error instanceof Error ? error.message : "The export preview could not be prepared."; }
        }
      })();
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  });

  const totalBytes = $derived(built?.files.reduce((total, file) => total + file.bytes, 0) ?? 0);
</script>

<div class="export-preview" aria-busy={!built && !failure && !blocked}>
  {#if built}
    <div class="export-sheet">
      <SvgViewport widthMm={built.width} heightMm={built.height} topLeft label="export" svgLabel={`Export preview of ${built.filename}`} controlsLabel="Export preview zoom controls" resetLabel="Reset export view">
        <rect x="0" y="0" width={built.width} height={built.height} fill="#fff" />
        <image href={built.url} x="0" y="0" width={built.width} height={built.height} />
      </SvgViewport>
    </div>
    <section class="export-manifest" aria-label="Export contents">
      <h2>Export contents</h2>
      {#if built.layoutNote}<p class="export-layout-note">{built.layoutNote}</p><p class="export-layout-credit">Nesting by <a href="https://github.com/JeroenGar/sparrow" target="_blank" rel="noreferrer">sparrow</a></p>{/if}
      <p class="export-manifest-row"><span>Open in Studio</span><strong>1 editable SVG</strong><small>Entire layout · {formatBytes(built.bytes)}</small></p>
      <details>
        <summary><span>Download</span><strong>Complete project bundle</strong><small>{built.files.length} files · {formatBytes(totalBytes)} total</small><span class="export-files-toggle">View included files <span aria-hidden="true">⌄</span></span></summary>
        <ul>{#each built.files as file (file.filename)}<li><span title={file.filename}>{file.filename}</span><small>{formatBytes(file.bytes)}</small></li>{/each}</ul>
      </details>
      <div class="export-key">{#if built.cut}<span><i class="export-key-cut" aria-hidden="true"></i>Red line · Cut</span>{/if}{#if built.score}<span><i class="export-key-score" aria-hidden="true"></i>Blue line · Score</span>{/if}{#if built.fill}<span><i class="export-key-fill" aria-hidden="true"></i>Blue fill · Engrave</span>{/if}</div>
    </section>
  {:else if !failure && !blocked && !busy && isEmbedded()}
    {#if progress.previews.length}
      <div class="atomm-nesting-drafts" aria-label="Nesting layout in progress">
        {#each progress.previews as sheet, index (index)}
          <figure>
            <svg viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`} role="img" aria-label={`Sheet ${index + 1}: ${sheet.parts.length} pieces${sheet.provisional ? ", pending optimization" : ""}`}>
              <rect width={sheet.widthMm} height={sheet.heightMm} fill="white" />
              {#each sheet.parts as part, partIndex (partIndex)}<path d={part.path}><title>{part.label}</title></path>{/each}
            </svg>
            <figcaption>Sheet {index + 1}{sheet.provisional ? " · pending" : ""}</figcaption>
          </figure>
        {/each}
      </div>
    {/if}
    <GenerationProgress class={progress.previews.length ? "nesting-progress has-drafts" : "nesting-progress"}
      title={!packaging && project.outputMode === "stack" ? "Arranging sheets" : "Preparing export preview"}
      detail={!packaging && project.outputMode === "stack" ? (progress.sheetCount ? `${progress.sheetCount} sheets · ${Math.round(progress.utilization * 100)}% material used · layout ${progress.updates}` : "Preparing pieces for your material size…") : "Building the artwork and download files…"}
      step={project.outputMode === "stack" ? (packaging ? 2 : 1) : undefined} total={2}
      onCancel={progress.running && progress.sheetCount ? () => automaticNesting?.stop() : undefined} cancelLabel="Use current layout" />
  {:else}
    <p class="export-preview-state" role="status">{failure || blocked || (busy ? "The export preview appears once the terrain is ready." : preparing)}</p>
  {/if}
</div>
