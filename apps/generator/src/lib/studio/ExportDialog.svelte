<script lang="ts">
  import { Archive, ArrowUpRight, Download, Droplets, FileJson, FileType, Heart, Layers3, ListOrdered, PenTool, Plane, SprayCan, X } from "@lucide/svelte";
  import { IconButton } from "@loidolt/theme-svelte";
  import type { ProjectConfigV1 } from "@topostack/core";
  import type { Snippet } from "svelte";
  import type { DownloadOption } from "$lib/studio/native-export";
  import { donationUrl } from "$lib/site/support";
  import { base } from "$app/paths";

  let { open, project, summary, panelCount, nested = false, acrylicCount = 0, acrylicNested = false, airspaceCount = 0, blockedReason, preparing, phase, title, detail, onDownload, onClose, sheetLayout, onSavePreview, onCopyLink, onShare, previewImageBusy = false, previewImageStatus = "" }: {
    open: boolean;
    project: ProjectConfigV1;
    /** The same counts the top bar shows, e.g. "12 layers · 9 cut panels". */
    summary: string;
    panelCount: number;
    /** The export lays pieces out on nested stock sheets, so it counts sheets, not panels. */
    nested?: boolean;
    /** Acrylic water insert panels, or acrylic stock sheets when `acrylicNested`; 0 without inserts. */
    acrylicCount?: number;
    acrylicNested?: boolean;
    /** Airspace panels; 0 without airspace. */
    airspaceCount?: number;
    blockedReason: string | undefined;
    preparing: boolean;
    phase: string;
    title: string;
    detail: string;
    onDownload: (option: DownloadOption) => void;
    onClose: () => void;
    /** Panels, seams and sheet nesting, shown for layered projects. */
    sheetLayout?: Snippet;
    onSavePreview?: () => void;
    onCopyLink?: () => void;
    onShare?: () => void;
    previewImageBusy?: boolean;
    previewImageStatus?: string;
  } = $props();
  let dialog: HTMLDialogElement;

  const layered = $derived(project.outputMode === "stack");
  const acrylic = $derived(acrylicCount ? ` + ${acrylicCount} acrylic ${acrylicNested ? (acrylicCount === 1 ? "sheet" : "sheets") : acrylicCount === 1 ? "panel" : "panels"}` : "");
  const airspace = $derived(airspaceCount ? ` + ${airspaceCount} airspace ${airspaceCount === 1 ? "panel" : "panels"}` : "");
  const panels = $derived(`${panelCount} ${nested ? (panelCount === 1 ? "nested sheet" : "nested sheets") : panelCount === 1 ? "panel" : "panels"}${acrylic}${airspace}`);
  const heroDescription = $derived(layered
    ? `Everything to cut and build: ${panels}, assembly guide, README, settings, and source credits.`
    : "The engraving SVG with README, settings, and source credits.");
  // Specialist files, each with the situation it is for.
  const files = $derived([
    layered
      ? { id: "master", label: "Master SVG", format: "SVG", icon: FileType, hint: "Every panel on one sheet, as a single file." }
      : { id: "master", label: "Engraving SVG", format: "SVG", icon: FileType, hint: "Just the artwork, for your laser software." },
    ...(layered ? [
      { id: "panels", label: "Cut panels", format: "ZIP", icon: Layers3, hint: "One SVG per sheet: cut and engrave together." },
      { id: "engravings", label: "Engraving panels", format: "ZIP", icon: PenTool, hint: "Engraving-only copies, to engrave as a separate job." },
      { id: "paint", label: "Paint templates", format: "ZIP", icon: SprayCan, unavailable: !project.paintTemplates.length, hint: project.paintTemplates.length ? "Paper stencils for painting water." : "Turn on Water paint templates in the Water panel to add these." },
      { id: "acrylic", label: "Acrylic inserts", format: "ZIP", icon: Droplets, unavailable: !project.waterInserts, hint: project.waterInserts ? "Water inserts to cut from acrylic, as their own job." : "Turn on Acrylic water inserts in the Water panel to add these." },
      { id: "airspace", label: "Airspace", format: "ZIP", icon: Plane, unavailable: !airspaceCount, hint: airspaceCount ? "Airspace pieces to cut from acrylic, and the backing sheet the rods stand on." : project.airspaceStack ? "No airspace was built for this area." : "Turn on Airspace in 3D in the Aviation panel to add these." },
      { id: "assembly", label: "Assembly guide", format: "HTML", icon: ListOrdered, hint: "Step-by-step booklet to print or follow on screen." },
    ] : []),
  ] as { id: DownloadOption; label: string; format: string; icon: typeof Archive; hint: string; unavailable?: boolean }[]);
  const artworkDisabled = $derived(preparing || Boolean(blockedReason));
  const blockedBy = $derived(blockedReason ? "export-blocked-reason" : undefined);

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function closeFromBackdrop(event: MouseEvent): void {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
</script>

<dialog bind:this={dialog} class="ldt-dialog export-dialog" aria-labelledby="export-dialog-title" aria-describedby="export-dialog-description" onclose={onClose} onmousedown={closeFromBackdrop}>
  <header class="ldt-dialog__header">
    <div><h2 id="export-dialog-title" class="ldt-dialog__title">Export your project</h2><p id="export-dialog-description" class="ldt-dialog__description">{project.name} · {summary}</p></div>
    <IconButton label="Close export dialog" onclick={() => dialog.close()}><X size={19} /></IconButton>
  </header>
  <div class="ldt-dialog__body export-dialog-body" aria-busy={preparing}>
    {#if blockedReason}<p id="export-blocked-reason" class="export-blocked" role="status">{blockedReason} You can still save your project settings.</p>{/if}
    <button type="button" class="export-hero" disabled={artworkDisabled} aria-describedby={blockedBy} onclick={() => onDownload("all")}>
      <span class="export-hero-icon"><Archive size={26} strokeWidth={1.6} /></span>
      <span class="export-hero-copy">
        <span class="export-hero-kicker">Recommended</span>
        <strong>Complete project</strong>
        <span class="export-hero-description">{heroDescription}</span>
      </span>
      <span class="export-hero-action"><Download size={16} aria-hidden="true" /> Download ZIP</span>
    </button>
    {#if phase !== "idle"}
      <div class={`export-feedback export-feedback--${phase}`} role="status" aria-live="polite">
        <span class="export-feedback-indicator" aria-hidden="true"></span>
        <span class="export-feedback-copy"><strong>{title}</strong><small>{detail}</small></span>
      </div>
    {/if}
    {#if layered && sheetLayout}{@render sheetLayout()}{/if}
    <details class="export-more">
      <summary>Individual files <span class="export-more-count">{files.length}</span></summary>
      <div class="export-rows">
        {#each files as file (file.id)}
          <button type="button" class="export-row" disabled={artworkDisabled || file.unavailable} aria-describedby={blockedBy} onclick={() => onDownload(file.id)}>
            <span class="export-row-icon"><file.icon size={20} strokeWidth={1.6} /></span>
            <span class="export-row-copy"><strong>{file.label}</strong><span>{file.hint}</span></span>
            <span class="export-row-format">{file.format} <Download size={14} aria-hidden="true" /></span>
          </button>
        {/each}
      </div>
    </details>
    <button type="button" class="export-row export-row--settings" disabled={preparing} onclick={() => onDownload("project")}>
      <span class="export-row-icon"><FileJson size={20} strokeWidth={1.6} /></span>
      <span class="export-row-copy"><strong>Project settings</strong><span>Continue later; works before generating. Regenerate terrain after importing.</span></span>
      <span class="export-row-format">JSON <Download size={14} aria-hidden="true" /></span>
    </button>
    <p class="export-guide">Using LightBurn? <a href={`${base}/guides/lightburn`} target="_blank" rel="noopener noreferrer">Check size and processing layers<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>.</p>
    {#if onSavePreview}
      <section class="export-share" aria-labelledby="export-share-title">
        <h3 id="export-share-title">Share your design</h3>
        <p>Save a top-down software preview for a post, and include a design link so others can open your settings.</p>
        <div class="export-share-actions">
          <button type="button" class="btn btn-secondary" disabled={artworkDisabled || previewImageBusy} onclick={onSavePreview}>{previewImageBusy ? "Preparing image…" : "Save preview image"}</button>
          {#if onCopyLink}<button type="button" class="btn btn-secondary" onclick={onCopyLink}>Copy design link</button>{/if}
          {#if onShare}<button type="button" class="btn btn-secondary" onclick={onShare}>Share design</button>{/if}
        </div>
        {#if previewImageStatus}<p role="status" aria-live="polite">{previewImageStatus}</p>{/if}
      </section>
    {/if}
    <section class="export-support" aria-labelledby="export-support-title">
      <span class="export-support-icon"><Heart size={22} strokeWidth={1.6} /></span>
      <div class="export-support-copy"><h3 id="export-support-title">Help keep TopoStack growing</h3><p>If TopoStack has been useful to you, or you use it for commercial projects, consider a donation to support its development.</p><small>Donations are optional. Every export is available without donating.</small></div>
      {#if donationUrl}<a class="export-donate" href={donationUrl} target="_blank" rel="noopener noreferrer"><Heart size={16} strokeWidth={2} aria-hidden="true" /> Donate <ArrowUpRight size={16} aria-hidden="true" /><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>{/if}
    </section>
  </div>
</dialog>
