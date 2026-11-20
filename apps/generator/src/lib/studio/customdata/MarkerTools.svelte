<script lang="ts">
  import { Crosshair, ImageUp, MapPin, Plus, Shapes, Trash2 } from "@lucide/svelte";
  import { Field } from "@loidolt/theme-svelte";
  import { displayLength, markerIconPolygons, MAP_MARKER_SIZE_MM, MAP_MARKER_MIN_SIZE_MM, MAP_MARKER_MAX_SIZE_MM, MAX_CUSTOM_DATA_NAME_LENGTH, type MarkerIconV1 } from "@topostack/core";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import { MARKER_OPTIONS } from "$lib/studio/options";
  import * as edits from "$lib/studio/project-edits";
  import { MAX_LATITUDE, MAX_LONGITUDE } from "$lib/domain/coordinates";
  import { polygonsPath, symbolPath } from "$lib/studio/svg-path";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  /**
   * Points the maker places: their coordinates, size and symbol.
   *
   * Placing one is a click on the map, so the button only has to make sure a
   * map is showing. The custom data view has its own, which is why it asks for
   * map mode rather than switching there outright.
   */

  const studio = getStudio();
  const { applyCustomDataEdit, importMarkerIcon, navigateChoice, renameCustomData, shownLength, storedLength } = studio;

  // One file input serves every card's upload button; this is the marker that asked.
  let iconInput: HTMLInputElement;
  let iconTarget = "";
  let uploading = $state(false);
  const icons = $derived(studio.project.markerIcons ?? []);
  const iconPath = (icon: MarkerIconV1) => polygonsPath(markerIconPolygons(icon, { x: 0, y: 0 }, 20));

  function chooseIcon(markerId: string): void {
    iconTarget = markerId;
    iconInput.click();
  }
</script>

<div class="marker-editor">
  <div class="subgroup-heading subgroup-heading--action">
    <p><MapPin size={14} />{t("customdata.markersHeading")} <span>{studio.project.markers.length}</span></p>
    <span class="marker-add-actions">
      <button type="button" class="marker-add-button" aria-pressed={studio.placingMarker} title={t("customdata.placeMarkersTitle")} onclick={() => { studio.placingMarker = !studio.placingMarker; if (studio.placingMarker && studio.mode !== "custom") studio.mode = "map"; }} disabled={!studio.placingMarker && !edits.canAddMarker(studio.project)}><Crosshair size={13} />{studio.placingMarker ? t("customdata.donePlacing") : t("customdata.placeOnMap")}</button>
      <button type="button" class="marker-add-button" onclick={() => applyCustomDataEdit(edits.addMarker(studio.project, crypto.randomUUID()))} disabled={!edits.canAddMarker(studio.project)}><Plus size={13} />{t("customdata.addMarker")}</button>
    </span>
  </div>
  {#if studio.placingMarker}
    <p class="custom-data-tool-status" role="status">{t("customdata.placingStatus")}</p>
  {/if}
  {#if studio.project.markers.length === 0 && !studio.placingMarker}
    <small class="marker-empty">{t("customdata.markersEmpty")}</small>
  {:else}
    <div class="marker-list">
      {#each studio.project.markers as marker, index (marker.id)}
        <div class="marker-card">
          <div class="marker-card__header">
            <!-- The card is titled by its name; blank, it shows the number it is called by until one is typed. -->
            <input class="custom-data-name" type="text" value={marker.name ?? ""} maxlength={MAX_CUSTOM_DATA_NAME_LENGTH} placeholder={t("customdata.markerPlaceholder", { number: index + 1 })} aria-label={t("customdata.markerNameLabel", { number: index + 1 })} oninput={(event) => renameCustomData(edits.renameMarker(studio.project, marker.id, event.currentTarget.value))} />
            <button type="button" aria-label={marker.name ? t("customdata.removeNamed", { name: marker.name }) : t("customdata.removeMarkerNumbered", { number: index + 1 })} title={t("customdata.removeMarker")} onclick={() => applyCustomDataEdit(edits.removeMarker(studio.project, marker.id))}><Trash2 size={14} /></button>
          </div>
          <div class="field-stack marker-coordinate-fields">
            <Field label={t("customdata.latitude")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("customdata.markerLatitude", { number: index + 1 })} value={marker.lat} min={-MAX_LATITUDE} max={MAX_LATITUDE} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { lat: event.currentTarget.valueAsNumber }))} onValueChange={(lat) => lat !== marker.lat && applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { lat }))} /><em>°</em></span>{/snippet}</Field>
            <Field label={t("customdata.longitude")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("customdata.markerLongitude", { number: index + 1 })} value={marker.lon} min={-MAX_LONGITUDE} max={MAX_LONGITUDE} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { lon: event.currentTarget.valueAsNumber }))} onValueChange={(lon) => lon !== marker.lon && applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { lon }))} /><em>°</em></span>{/snippet}</Field>
          </div>
          <LengthField label={t("customdata.markerSize", { number: index + 1 })} fieldLabel={t("customdata.markerSizeField")} unit={studio.shownLengthUnit} value={shownLength(marker.sizeMm ?? MAP_MARKER_SIZE_MM)} min={displayLength(MAP_MARKER_MIN_SIZE_MM, studio.project.units)} max={displayLength(MAP_MARKER_MAX_SIZE_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 0.5} onCommit={(shown) => { const sizeMm = storedLength(shown); if (sizeMm !== (marker.sizeMm ?? MAP_MARKER_SIZE_MM)) applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { sizeMm })); }} />
          <div class="marker-symbol-options" role="radiogroup" aria-label={t("customdata.markerSymbolGroup", { number: index + 1 })}>
            {#each MARKER_OPTIONS as option}
              {@const symbolLabel = t(`customdata.markerSymbol.${option.value}` as MessageKey)}
              <button type="button" role="radio" aria-label={symbolLabel} title={symbolLabel} aria-checked={marker.symbol === option.value} data-state={marker.symbol === option.value ? "on" : "off"} tabindex={marker.symbol === option.value ? 0 : -1} onclick={() => applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { symbol: option.value }))} onkeydown={navigateChoice}>
                <svg viewBox="-11 -11 22 22" aria-hidden="true"><path d={symbolPath(option.paths)} fill-rule="evenodd" /></svg>
              </button>
            {/each}
            {#each icons as icon (icon.id)}
              {@const chosen = marker.symbol === "custom" && marker.iconId === icon.id}
              <button type="button" role="radio" class="marker-symbol-options__icon" aria-label={icon.name} title={icon.name} aria-checked={chosen} data-state={chosen ? "on" : "off"} tabindex={chosen ? 0 : -1} onclick={() => applyCustomDataEdit(edits.updateMarker(studio.project, marker.id, { symbol: "custom", iconId: icon.id }))} onkeydown={navigateChoice}>
                <svg viewBox="-11 -11 22 22" aria-hidden="true"><path d={iconPath(icon)} fill-rule="evenodd" /></svg>
              </button>
            {/each}
          </div>
          <button type="button" class="marker-icon-upload" onclick={() => chooseIcon(marker.id)} disabled={uploading || !edits.canAddMarkerIcon(studio.project)}><ImageUp size={12} />{uploading ? t("customdata.readingSvg") : t("customdata.useSvgForMarker")}</button>
        </div>
      {/each}
    </div>
  {/if}
  {#if icons.length}
    <div class="marker-icon-list" aria-label={t("customdata.markerIconsLabel")}>
      <div class="subgroup-heading"><p><Shapes size={14} />{t("customdata.iconsHeading")} <span>{icons.length}</span></p></div>
      {#each icons as icon (icon.id)}
        <div class="marker-icon-row">
          <svg viewBox="-11 -11 22 22" aria-hidden="true"><path d={iconPath(icon)} fill-rule="evenodd" /></svg>
          <input class="custom-data-name" type="text" value={icon.name} maxlength={MAX_CUSTOM_DATA_NAME_LENGTH} aria-label={t("customdata.iconNameLabel", { name: icon.name })} onchange={(event) => renameCustomData(edits.renameMarkerIcon(studio.project, icon.id, event.currentTarget.value))} />
          <span class="marker-icon-anchor" role="radiogroup" aria-label={t("customdata.iconAnchorGroup", { name: icon.name })}>
            {#each [{ value: "center", label: t("customdata.iconAnchorCenter") }, { value: "bottom", label: t("customdata.iconAnchorBase") }] as const as option}
              {@const chosen = (icon.anchor ?? "center") === option.value}
              <button type="button" role="radio" aria-checked={chosen} data-state={chosen ? "on" : "off"} tabindex={chosen ? 0 : -1} title={option.value === "bottom" ? t("customdata.iconAnchorBaseTitle") : t("customdata.iconAnchorCenterTitle")} onclick={() => applyCustomDataEdit(edits.setMarkerIconAnchor(studio.project, icon.id, option.value))} onkeydown={navigateChoice}>{option.label}</button>
            {/each}
          </span>
          <button type="button" class="marker-icon-remove" aria-label={t("customdata.removeIconNamed", { name: icon.name })} title={t("customdata.removeIconTitle")} onclick={() => applyCustomDataEdit(edits.removeMarkerIcon(studio.project, icon.id))}><Trash2 size={14} /></button>
        </div>
      {/each}
    </div>
  {/if}
  <input bind:this={iconInput} data-marker-icon-import class="ldt-visually-hidden" type="file" tabindex="-1" aria-hidden="true" accept=".svg,image/svg+xml" onchange={(event) => { const input = event.currentTarget; uploading = true; void importMarkerIcon(input.files?.[0], iconTarget).finally(() => { input.value = ""; uploading = false; }); }} />
  <small class="marker-note">{t("customdata.markerNote")}</small>
</div>
