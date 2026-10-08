<script lang="ts">
  import { base } from "$app/paths";
  import type { StarterId } from "$lib/site/starters";
  import { starterById } from "$lib/site/starters";
  let { id, ready, busy, exported, onGenerate, onExport, onDismiss }: {
    id: StarterId; ready: boolean; busy: boolean; exported: boolean;
    onGenerate: () => void; onExport: () => void; onDismiss: () => void;
  } = $props();
  const starter = $derived(starterById(id)!);
</script>

<section class="starter-steps" aria-labelledby="starter-steps-title">
  <header><h2 id="starter-steps-title">Your first {id === "engraving" ? "engraving" : "relief"}</h2><button type="button" onclick={onDismiss} aria-label="Dismiss first-project checklist">Dismiss</button></header>
  <ol>
    <li>Review your size{id === "engraving" ? "." : " and actual sheet thickness."} The starter uses {starter.size}.</li>
    <li>{ready ? "Terrain generated. Check the preview and any warnings." : "Generate fresh terrain after reviewing your settings."}</li>
    <li>{exported ? "Files prepared. Open the download in your laser software." : "Export the complete project, then check its SVG dimensions in your laser software."}</li>
  </ol>
  <button type="button" class="btn btn-primary" disabled={busy} onclick={ready ? onExport : onGenerate}>{busy ? "Updating terrain…" : ready ? "Open export" : "Generate starter terrain"}</button>
  <a href={`${base}${starter.guide}`} target="_blank" rel="noopener noreferrer">Follow the {id === "engraving" ? "engraving" : id === "lake" ? "lake map" : "layered map"} guide<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
</section>

<style>
  .starter-steps { margin: 0 20px 20px; padding: 16px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 15px; }
  header button { min-height: 32px; border: 0; background: transparent; color: var(--loidolt-text-muted); font-size: 12px; }
  ol { padding-left: 18px; font-size: 12px; line-height: 1.65; color: var(--loidolt-text-muted); }
  li { margin-block: 8px; }
  a { display: block; margin-top: 12px; color: var(--loidolt-text-accent); font-size: 12px; }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 3px; }
</style>
