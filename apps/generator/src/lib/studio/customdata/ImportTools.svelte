<script lang="ts">
  import { FileUp } from "@lucide/svelte";
  import * as edits from "$lib/studio/project-edits";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  /** Reading markers and paths out of a file the maker already has. */

  const studio = getStudio();
  const { importCustomData } = studio;
  let geoInput: HTMLInputElement;
  let importing = $state(false);
</script>

<div class="custom-data-import">
  <button type="button" class="custom-data-import__button" onclick={() => geoInput.click()} disabled={importing || (!edits.canAddMarker(studio.project) && !edits.canAddCustomLine(studio.project))}><FileUp size={13} />{importing ? t("customdata.importing") : t("customdata.importButton")}</button>
  <input bind:this={geoInput} data-custom-import class="ldt-visually-hidden" type="file" tabindex="-1" aria-hidden="true" accept=".gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json" onchange={(event) => { const input = event.currentTarget; importing = true; void importCustomData(input.files?.[0]).finally(() => { input.value = ""; importing = false; }); }} />
  <small>{t("customdata.importHint")}</small>
</div>
