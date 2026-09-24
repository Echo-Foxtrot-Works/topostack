<script lang="ts">
  import { LayoutGrid, Shapes, StopCircle, X } from "@lucide/svelte";
  import { Button } from "@loidolt/theme-svelte";
  import { base } from "$app/paths";
  import { DEFAULT_SHEET_NESTING, SHEET_NEST_LIMITS, displayLength, type SheetNestRotation, type SheetNestSettingsV1 } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  let { disabled = false }: { disabled?: boolean } = $props();

  const studio = getStudio();
  const nesting = studio.sheetNesting;
  const settings = $derived<SheetNestSettingsV1>({ ...DEFAULT_SHEET_NESTING, ...studio.project.sheetNesting });
  const workArea = $derived(studio.project.workAreaWidthMm > 0 && studio.project.workAreaHeightMm > 0);
  const sheetSizeMissing = $derived((settings.sheetWidthMm || studio.project.workAreaWidthMm) <= 0 || (settings.sheetHeightMm || studio.project.workAreaHeightMm) <= 0);
  const running = $derived(nesting.status === "running");
  const rotations: Array<{ value: SheetNestRotation; label: string }> = [
    { value: "quarter", label: "Quarter turns" },
    { value: "half", label: "Half turns" },
    { value: "free", label: "Any angle" },
    { value: "none", label: "No rotation" },
  ];
  const budgets = [10, 30, 60, 120, 300];

  // Elapsed time while searching, ticking once a second.
  let now = $state(performance.now());
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => { now = performance.now(); }, 1000);
    return () => clearInterval(timer);
  });
  const elapsedS = $derived(running ? Math.min(nesting.budgetMs, now - nesting.startedAt) / 1000 : 0);
  const plan = $derived(nesting.plan);
  const summary = $derived(plan ? `${plan.sheets.length} ${plan.sheets.length === 1 ? "sheet" : "sheets"} · ${Math.round(plan.utilization * 100)}% material used` : "");

  function update(patch: Partial<SheetNestSettingsV1>): void {
    studio.updateProject({ sheetNesting: { ...settings, ...patch } });
  }
  const shown = (valueMm: number) => studio.shownLength(valueMm);
  const maxShown = $derived(displayLength(SHEET_NEST_LIMITS.sheetMm.max, studio.project.units));
</script>

<section class="sheet-layout" aria-labelledby="sheet-layout-title">
  <header class="sheet-layout-header">
    <span class="export-row-icon"><LayoutGrid size={20} strokeWidth={1.6} /></span>
    <div>
      <h3 id="sheet-layout-title">Sheet layout</h3>
      <p>Pack every piece onto as few stock sheets as possible, moved and turned to fit. The export uses the nested sheets once you have nested them.</p>
    </div>
  </header>
  <p class="sheet-layout-credit">
    Nesting by <a href="https://github.com/JeroenGar/sparrow" target="_blank" rel="noopener noreferrer">sparrow<span class="ldt-visually-hidden"> (opens in a new tab)</span></a> by Jeroen Gardeyn (KU Leuven), built on <a href="https://github.com/JeroenGar/jagua-rs" target="_blank" rel="noopener noreferrer">jagua-rs<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>. Open source (MIT and MPL-2.0) and run in your browser.
    <a href={`${base}/attribution#software`} target="_blank" rel="noopener noreferrer">Credits<span class="ldt-visually-hidden"> (opens in a new tab)</span></a> ·
    <a href={`${base}/licenses/third-party.txt`} target="_blank" rel="noopener noreferrer">Licences<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
  </p>
  <div class="sheet-layout-choice" role="radiogroup" aria-label="Sheet layout">
    <label><input type="radio" name="sheet-layout" checked={!nesting.useSheets} onchange={() => nesting.setUseSheets(false)} /> Original panels</label>
    <label><input type="radio" name="sheet-layout" checked={nesting.useSheets} onchange={() => nesting.setUseSheets(true)} /> Nested sheets</label>
  </div>
  {#if nesting.useSheets}
    <div class="sheet-layout-fields">
      <LengthField label="Sheet width" unit={studio.shownLengthUnit} value={shown(settings.sheetWidthMm)} min={0} max={maxShown} step={studio.project.units === "imperial" ? 0.1 : 1} disabled={running} onCommit={(value) => update({ sheetWidthMm: studio.storedLength(value) })} />
      <LengthField label="Sheet height" unit={studio.shownLengthUnit} value={shown(settings.sheetHeightMm)} min={0} max={maxShown} step={studio.project.units === "imperial" ? 0.1 : 1} disabled={running} onCommit={(value) => update({ sheetHeightMm: studio.storedLength(value) })} />
      <LengthField label="Spacing between pieces" fieldLabel="Spacing" unit={studio.shownLengthUnit} value={shown(settings.spacingMm)} min={0} max={shown(SHEET_NEST_LIMITS.spacingMm.max)} step={studio.project.units === "imperial" ? 0.01 : 0.5} disabled={running} onCommit={(value) => update({ spacingMm: studio.storedLength(value) })} />
      <LengthField label="Sheet edge margin" fieldLabel="Edge margin" unit={studio.shownLengthUnit} value={shown(settings.marginMm)} min={0} max={shown(SHEET_NEST_LIMITS.marginMm.max)} step={studio.project.units === "imperial" ? 0.01 : 0.5} disabled={running} onCommit={(value) => update({ marginMm: studio.storedLength(value) })} />
      <label class="field-row sheet-layout-select">Rotation
        <select value={settings.rotation} disabled={running} onchange={(event) => update({ rotation: event.currentTarget.value as SheetNestRotation })}>
          {#each rotations as rotation (rotation.value)}<option value={rotation.value}>{rotation.label}</option>{/each}
        </select>
      </label>
      <label class="field-row sheet-layout-select">Search time
        <select value={String(settings.timeBudgetS)} disabled={running} onchange={(event) => update({ timeBudgetS: Number(event.currentTarget.value) })}>
          {#each budgets as seconds (seconds)}<option value={String(seconds)}>{seconds < 60 ? `${seconds} s` : `${seconds / 60} min`}</option>{/each}
        </select>
      </label>
    </div>
    {#if settings.sheetWidthMm === 0 || settings.sheetHeightMm === 0}
      <p class="sheet-layout-note">{workArea ? "A size of 0 uses the machine work area." : "Set a sheet size, or a machine work area in Fabrication settings."}</p>
    {/if}
    <div class="sheet-layout-actions">
      {#if running}
        <Button onclick={() => nesting.stop()}><StopCircle size={16} aria-hidden="true" /> Stop and keep best</Button>
        <Button variant="ghost" onclick={() => nesting.cancel()}><X size={16} aria-hidden="true" /> Cancel</Button>
      {:else}
        <Button variant="primary" disabled={disabled || sheetSizeMissing} onclick={() => void nesting.start(studio.geometry, studio.project)}><Shapes size={16} aria-hidden="true" /> {plan ? "Nest again" : "Nest parts"}</Button>
      {/if}
    </div>
    <div class="sheet-layout-status" role="status" aria-live="polite">
      {#if running}
        <progress max={nesting.budgetMs / 1000} value={elapsedS}></progress>
        <span>Nesting… {Math.round(elapsedS)} of {nesting.budgetMs / 1000} s{summary ? ` · best so far: ${summary}` : ""}</span>
      {:else if nesting.status === "error"}
        <span class="sheet-layout-error">{nesting.error}</span>
      {:else if plan && !nesting.current}
        <span class="sheet-layout-error">The design or sheet settings changed. Nest again to export sheets; until then the export uses the original panels.</span>
      {:else if plan}
        <span>{summary}{plan.sheets.every((sheet) => sheet.method === "rectangles") ? (plan.engine.name === "sparrow" ? " · no tighter fit than bounding boxes" : " · packed by bounding boxes") : ""}</span>
      {:else}
        <span>Not nested yet. The export uses the original panels.</span>
      {/if}
      {#if nesting.fallback}<small>The nesting engine could not start here ({nesting.fallback}), so pieces were packed by their bounding boxes.</small>{/if}
    </div>
    {#if nesting.previews.length}
      <ul class="sheet-previews" aria-label="Nested sheets">
        {#each nesting.previews as sheet, index (index)}
          <li class:sheet-preview--provisional={sheet.provisional}>
            <svg viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`} role="img" aria-label={`Sheet ${index + 1}: ${sheet.parts.length} pieces${sheet.provisional ? ", not packed yet" : ""}`}>
              <rect class="sheet-preview-stock" width={sheet.widthMm} height={sheet.heightMm} />
              {#each sheet.parts as part, partIndex (partIndex)}<path d={part.path}><title>{part.label}</title></path>{/each}
            </svg>
            <span>Sheet {index + 1}{sheet.provisional ? " · pending" : ""}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
