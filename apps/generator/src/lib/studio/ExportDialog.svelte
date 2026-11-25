<script lang="ts">
  import { Archive, ArrowLeft, ArrowRight, ArrowUpRight, Check, Download, Droplets, FileJson, FileType, Heart, Layers3, ListOrdered, PenTool, Plane, SprayCan, X, Zap } from "@lucide/svelte";
  import { Button, IconButton } from "@loidolt/theme-svelte";
  import { PAINT_REGION_LABELS, type ProjectConfigV1 } from "@topostack/core";
  import { tick, type Snippet } from "svelte";
  import type { DownloadOption } from "$lib/studio/native-export";
  import { donationUrl } from "$lib/site/support";
  import { basePath } from "$lib/site/paths";
  const base = basePath();

  let { open, project, summary, panelCount, nested = false, acrylicCount = 0, acrylicNested = false, airspaceCount = 0, blockedReason, preparing, phase, title, detail, onDownload, onClose, panelsStep, sheetsStep, onSavePreview, onCopyLink, onShare, previewImageBusy = false, previewImageStatus = "" }: {
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
    /** Nests and seams: the first step of a layered export. */
    panelsStep?: Snippet;
    /** Nesting pieces onto stock sheets: the second step of a layered export. */
    sheetsStep?: Snippet;
    onSavePreview?: () => void;
    onCopyLink?: () => void;
    onShare?: () => void;
    previewImageBusy?: boolean;
    previewImageStatus?: string;
  } = $props();
  let dialog: HTMLDialogElement;
  let stepBody = $state<HTMLElement>();

  const layered = $derived(project.outputMode === "stack");
  const acrylic = $derived(acrylicCount ? ` + ${acrylicCount} acrylic ${acrylicNested ? (acrylicCount === 1 ? "sheet" : "sheets") : acrylicCount === 1 ? "panel" : "panels"}` : "");
  const airspace = $derived(airspaceCount ? ` + ${airspaceCount} airspace ${airspaceCount === 1 ? "panel" : "panels"}` : "");
  const panels = $derived(`${panelCount} ${nested ? (panelCount === 1 ? "nested sheet" : "nested sheets") : panelCount === 1 ? "panel" : "panels"}${acrylic}${airspace}`);
  const heroDescription = $derived(layered
    ? `Everything to cut and build: ${panels}, assembly guide, README, settings, and source credits.`
    : "The engraving SVG with README, settings, and source credits.");
  type ExportFile = { id: DownloadOption; label: string; format: string; icon: typeof Archive; hint: string; unavailable?: boolean };
  // Project files for the two laser programs, shown beside the complete project.
  const softwareFiles = $derived([
    ...(layered ? [] : [{ id: "master", label: "Engraving SVG", format: "SVG", icon: FileType, hint: "Just the artwork, for any laser software." }]),
    { id: "xtool", label: "xTool Studio project", format: "XS", icon: Layers3, hint: layered ? "Open one named canvas per panel or nested sheet. Choose your device and material in Studio." : "Open the engraving on its own Studio canvas." },
    ...(layered ? [{ id: "lightburn-pages", label: "LightBurn project with pages", format: "LBRN2", icon: Zap, hint: "One page per panel or nested sheet in LightBurn 2.2 or later. Cut settings are shared across pages." }] : []),
    layered
      ? { id: "lightburn", label: "Separate LightBurn files", format: "ZIP", icon: Zap, hint: "One .lbrn2 per sheet plus the master, with Cut, Score and Engrave layers set up." }
      : { id: "lightburn", label: "LightBurn project", format: "LBRN2", icon: Zap, hint: "The engraving with its layers set up. Opens straight in LightBurn." },
  ] as ExportFile[]);
  // Specialist files of a layered project, each with the situation it is for.
  const files = $derived([
    ...(layered ? [
      { id: "master", label: "Master SVG", format: "SVG", icon: FileType, hint: "Every panel on one sheet, as a single file." },
      { id: "panels", label: "Cut panels", format: "ZIP", icon: Layers3, hint: "One SVG per sheet: cut and engrave together." },
      { id: "engravings", label: "Engraving panels", format: "ZIP", icon: PenTool, hint: "Engraving-only copies, to engrave as a separate job." },
      { id: "paint", label: "Paint templates", format: "ZIP", icon: SprayCan, unavailable: !project.paintTemplates.length, hint: project.paintTemplates.length ? `Paper stencils for painting ${project.paintTemplates.map((kind) => PAINT_REGION_LABELS[kind]).join(", ")}.` : "Turn on Water paint templates in the Water panel, or public land paint in Map features, to add these." },
      { id: "acrylic", label: "Acrylic inserts", format: "ZIP", icon: Droplets, unavailable: !project.waterInserts, hint: project.waterInserts ? "Water inserts to cut from acrylic, as their own job." : "Turn on Acrylic water inserts in the Water panel to add these." },
      { id: "airspace", label: "Airspace", format: "ZIP", icon: Plane, unavailable: !airspaceCount, hint: airspaceCount ? "Airspace pieces to cut from acrylic, and the backing sheet the rods stand on." : project.airspaceStack ? "No airspace was built for this area." : "Turn on Airspace in 3D in the Aviation panel to add these." },
      { id: "assembly", label: "Assembly guide", format: "HTML", icon: ListOrdered, hint: "Step-by-step booklet to print or follow on screen." },
    ] : []),
  ] as ExportFile[]);

  // One decision per step, in the order a maker meets them. Flat engravings have nothing to split or nest.
  type StepId = "panels" | "sheets" | "download" | "share";
  const steps = $derived([
    ...(layered && panelsStep ? [{ id: "panels", label: "Panels", intro: "Start with how the layers are cut into panels. The defaults suit most projects." }] : []),
    ...(layered && sheetsStep ? [{ id: "sheets", label: "Sheets", intro: "Optional: pack the pieces onto stock sheets to save material. Skip this step to get one file per panel." }] : []),
    { id: "download", label: "Download", intro: layered ? "The complete project has everything. The other files are for one program or one job." : "The complete project has everything. The other files are for one program." },
    { id: "share", label: "Share", intro: "That is everything you need to start cutting." },
  ] as { id: StepId; label: string; intro: string }[]);
  let stepId = $state<StepId>();
  const stepIndex = $derived(Math.max(0, steps.findIndex((step) => step.id === stepId)));
  const step = $derived(steps[stepIndex]!);
  const previous = $derived(steps[stepIndex - 1]);
  const next = $derived(steps[stepIndex + 1]);

  async function goTo(id: StepId): Promise<void> {
    stepId = id;
    await tick();
    // The new step starts at its top, and keyboard and screen reader users land on it.
    stepBody?.scrollTo?.({ top: 0 });
    stepBody?.focus({ preventScroll: true });
  }
  const artworkDisabled = $derived(preparing || Boolean(blockedReason));
  const blockedBy = $derived(blockedReason ? "export-blocked-reason" : undefined);

  $effect(() => {
    if (open && !dialog.open) {
      // Every export starts from the first step; the step list lets a returning maker jump ahead.
      stepId = undefined;
      dialog.showModal();
    }
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
  <nav class="export-steps" aria-label="Export steps">
    <ol>
      {#each steps as item, index (item.id)}
        <li class:export-step--done={index < stepIndex}>
          <button type="button" class="export-step-tab" aria-current={index === stepIndex ? "step" : undefined} onclick={() => void goTo(item.id)}>
            <span class="export-step-number" aria-hidden="true">{#if index < stepIndex}<Check size={13} strokeWidth={2.4} />{:else}{index + 1}{/if}</span>
            <span class="ldt-visually-hidden">Step {index + 1} of {steps.length}: {item.label}</span><span class="export-step-label" aria-hidden="true">{item.label}</span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>
  <div bind:this={stepBody} class="ldt-dialog__body export-dialog-body" role="group" aria-label={`Step ${stepIndex + 1} of ${steps.length}: ${step.label}`} tabindex="-1" aria-busy={preparing}>
    {#if blockedReason}<p id="export-blocked-reason" class="export-blocked" role="status">{blockedReason} You can still save your project settings{step.id === "download" ? "" : " in the Download step"}.</p>{/if}
    <p class="export-step-intro">{step.intro}</p>
    {#if step.id === "panels"}
      {@render panelsStep?.()}
    {:else if step.id === "sheets"}
      {@render sheetsStep?.()}
    {:else if step.id === "download"}
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
      <section class="export-software" aria-labelledby="export-software-title">
        <h3 id="export-software-title">{layered ? "Or open it in your laser software" : "Or take one file for your laser software"}</h3>
        <div class="export-rows">
          {#each softwareFiles as file (file.id)}{@render fileRow(file)}{/each}
        </div>
        <p class="export-guide">Guides: <a href={`${base}/guides/lightburn`} target="_blank" rel="noopener noreferrer">LightBurn<span class="ldt-visually-hidden"> (opens in a new tab)</span></a> · <a href={`${base}/guides/xtool-studio`} target="_blank" rel="noopener noreferrer">xTool Studio<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>.</p>
      </section>
{#if files.length}
        <details class="export-more">
          <summary>Individual files <span class="export-more-count">{files.length}</span></summary>
          <div class="export-rows">
            {#each files as file (file.id)}{@render fileRow(file)}{/each}
          </div>
        </details>
      {/if}
      <button type="button" class="export-row export-row--settings" disabled={preparing} onclick={() => onDownload("project")}>
        <span class="export-row-icon"><FileJson size={20} strokeWidth={1.6} /></span>
        <span class="export-row-copy"><strong>Project settings</strong><span>Continue later; works before generating. Regenerate terrain after importing.</span></span>
        <span class="export-row-format">JSON <Download size={14} aria-hidden="true" /></span>
      </button>
    {:else}
      {#if onSavePreview}
        <section class="export-share" aria-labelledby="export-share-title">
          <h3 id="export-share-title">Share your design</h3>
          <p>Save a top-down software preview for a post, and include a design link so others can open your settings.</p>
          <div class="export-share-actions">
            <Button class="btn btn-secondary" disabled={artworkDisabled || previewImageBusy} onclick={onSavePreview}>{previewImageBusy ? "Preparing image…" : "Save preview image"}</Button>
            {#if onCopyLink}<Button class="btn btn-secondary" onclick={onCopyLink}>Copy design link</Button>{/if}
            {#if onShare}<Button class="btn btn-secondary" onclick={onShare}>Share design</Button>{/if}
          </div>
          {#if previewImageStatus}<p role="status" aria-live="polite">{previewImageStatus}</p>{/if}
        </section>
      {/if}
      <section class="export-support" aria-labelledby="export-support-title">
        <span class="export-support-icon"><Heart size={22} strokeWidth={1.6} /></span>
        <div class="export-support-copy"><h3 id="export-support-title">Help keep TopoStack growing</h3><p>If TopoStack has been useful to you, or you use it for commercial projects, consider a donation to support its development.</p><small>Donations are optional. Every export is available without donating.</small></div>
        {#if donationUrl}<a class="export-donate" href={donationUrl} target="_blank" rel="noopener noreferrer"><Heart size={16} strokeWidth={2} aria-hidden="true" /> Donate <ArrowUpRight size={16} aria-hidden="true" /><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>{/if}
      </section>
    {/if}
  </div>
  <footer class="ldt-dialog__footer export-dialog-footer">
    {#if previous}<Button variant="ghost" onclick={() => void goTo(previous.id)}><ArrowLeft size={16} aria-hidden="true" /> Back</Button>{/if}
    <span class="export-dialog-footer-spacer"></span>
    {#if next}
      <Button variant={step.id === "download" ? "default" : "primary"} onclick={() => void goTo(next.id)}>Next: {next.label} <ArrowRight size={16} aria-hidden="true" /></Button>
    {:else}
      <Button variant="primary" onclick={() => dialog.close()}>Done</Button>
    {/if}
  </footer>
</dialog>

{#snippet fileRow(file: ExportFile)}
  <button type="button" class="export-row" disabled={artworkDisabled || file.unavailable} aria-describedby={blockedBy} onclick={() => onDownload(file.id)}>
    <span class="export-row-icon"><file.icon size={20} strokeWidth={1.6} /></span>
    <span class="export-row-copy"><strong>{file.label}</strong><span>{file.hint}</span></span>
    <span class="export-row-format">{file.format} <Download size={14} aria-hidden="true" /></span>
  </button>
{/snippet}
