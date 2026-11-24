<script lang="ts">
  import { Crosshair, ImageUp, Move, Shapes, Trash2 } from "@lucide/svelte";
  import { graphicOperationsFor, iconShapePolygons, lengthUnit, displayLength, MAX_CUSTOM_DATA_NAME_LENGTH, type CustomGraphicV1, type GraphicOperation } from "@topostack/core";
  import * as edits from "$lib/studio/project-edits";
  import { graphicPlaceableId } from "$lib/studio/placement/placeables";
  import { polygonsPath } from "$lib/studio/svg-path";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * Artwork the maker uploads to put on the piece itself: a logo, a badge, a
   * decoration. The library lives here; placing, turning and sizing happen on
   * the preview, in placement mode, where the piece can be seen.
   */

  const studio = getStudio();
  const { applyCustomDataEdit, importGraphic, navigateChoice, renameCustomData, placeGraphic, startPlacement } = studio;
  const OPERATION_LABELS: Record<GraphicOperation, string> = { engrave: "Engrave", score: "Score", cut: "Cut" };

  let input: HTMLInputElement;
  let uploading = $state(false);
  const graphics = $derived(studio.project.customGraphics ?? []);
  const placed = $derived(studio.project.placedGraphics ?? []);
  const placing = $derived(studio.placement !== undefined);
  const thumbnail = (graphic: Pick<CustomGraphicV1, "shapes">, rotationDeg = 0) => polygonsPath(iconShapePolygons(graphic.shapes, { x: 0, y: 0 }, 20, rotationDeg * Math.PI / 180));
  const graphicFor = (graphicId: string) => graphics.find((graphic) => graphic.id === graphicId);
  const usesOf = (graphicId: string) => placed.filter((item) => item.graphicId === graphicId).length;
  const size = (sizeMm: number) => `${Number(displayLength(sizeMm, studio.project.units).toFixed(studio.project.units === "imperial" ? 2 : 0))} ${lengthUnit(studio.project.units)}`;
</script>

<div class="marker-editor graphic-editor">
  <div class="subgroup-heading subgroup-heading--action">
    <p><Shapes size={14} />Library <span>{graphics.length}</span></p>
    <button type="button" class="marker-add-button" onclick={() => input.click()} disabled={uploading || !edits.canAddCustomGraphic(studio.project)}><ImageUp size={13} />{uploading ? "Reading SVG…" : "Upload SVG"}</button>
  </div>
  {#if graphics.length === 0}
    <small class="marker-empty">Upload an SVG, such as a logo or a badge, then place it on the piece. {studio.project.outputMode === "engraving" ? "Engrave it as a filled shape or score its outline." : "Each graphic can be engraved, scored as an outline, or cut out of the sheet it sits on."}</small>
  {:else}
    <div class="marker-icon-list" aria-label="Uploaded graphics">
      {#each graphics as graphic (graphic.id)}
        {@const uses = usesOf(graphic.id)}
        <div class="marker-icon-row graphic-row">
          <svg viewBox="-11 -11 22 22" aria-hidden="true"><path d={thumbnail(graphic)} fill-rule="evenodd" /></svg>
          <input class="custom-data-name" type="text" value={graphic.name} maxlength={MAX_CUSTOM_DATA_NAME_LENGTH} aria-label={`Name for graphic ${graphic.name}`} onchange={(event) => renameCustomData(edits.renameCustomGraphic(studio.project, graphic.id, event.currentTarget.value))} />
          <button type="button" class="graphic-place" title="Add it to the piece and position it on the preview" onclick={() => placeGraphic(graphic.id)} disabled={!edits.canPlaceGraphic(studio.project) || (placing && studio.placementPhase !== "editing")}><Crosshair size={13} />Place</button>
          <button type="button" class="marker-icon-remove" aria-label={`Remove graphic ${graphic.name}`} title={uses ? `Remove graphic; its ${uses === 1 ? "use" : `${uses} uses`} on the piece go too` : "Remove graphic"} onclick={() => applyCustomDataEdit(edits.removeCustomGraphic(studio.project, graphic.id))}><Trash2 size={14} /></button>
        </div>
      {/each}
    </div>
  {/if}
  {#if placed.length}
    <div class="marker-icon-list" aria-label="Graphics on the piece">
      <div class="subgroup-heading"><p><Move size={14} />On the piece <span>{placed.length}</span></p></div>
      {#each placed as item, index (item.id)}
        {@const graphic = graphicFor(item.graphicId)}
        {#if graphic}
          {@const label = `${graphic.name} ${index + 1}`}
          <div class="graphic-placed">
            <div class="graphic-placed__header">
              <svg viewBox="-11 -11 22 22" aria-hidden="true"><path d={thumbnail(graphic, item.rotationDeg)} fill-rule="evenodd" /></svg>
              <span class="graphic-placed__name">{graphic.name}<small>{size(item.sizeMm)} · {Math.round(item.rotationDeg)}°</small></span>
              <button type="button" class="graphic-place" title="Move, size and turn it on the preview" onclick={() => startPlacement(graphicPlaceableId(item.id))} disabled={placing}><Move size={13} />Move</button>
              <button type="button" class="marker-icon-remove" aria-label={`Remove ${label} from the piece`} title="Remove from the piece" onclick={() => applyCustomDataEdit(edits.removePlacedGraphic(studio.project, item.id))} disabled={placing}><Trash2 size={14} /></button>
            </div>
            <!-- While placing, the preview's toolbar owns these; its draft would overwrite a change here. -->
            <span class="marker-icon-anchor graphic-operation" role="radiogroup" aria-label={`What the laser does with ${label}`}>
              {#each graphicOperationsFor(studio.project.outputMode) as operation (operation)}
                {@const chosen = item.operation === operation}
                <button type="button" role="radio" aria-checked={chosen} data-state={chosen ? "on" : "off"} tabindex={chosen ? 0 : -1} disabled={placing} onclick={() => applyCustomDataEdit(edits.updatePlacedGraphic(studio.project, item.id, { operation }))} onkeydown={navigateChoice}>{OPERATION_LABELS[operation]}</button>
              {/each}
            </span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
  <input bind:this={input} data-graphic-import class="ldt-visually-hidden" type="file" tabindex="-1" aria-hidden="true" accept=".svg,image/svg+xml" onchange={(event) => { const target = event.currentTarget; uploading = true; void importGraphic(target.files?.[0]).finally(() => { target.value = ""; uploading = false; }); }} />
  <small class="marker-note">Graphics sit on whichever sheet shows at each point, like markers. Engraved graphics are filled; strokes become outlines and white areas are left out. {studio.project.outputMode === "engraving" ? "Changing a layered cut graphic to a flat engraving scores its outline." : "A cut opens the sheet so the one below shows through; islands inside a cut through the bottom sheet fall out."}</small>
</div>
