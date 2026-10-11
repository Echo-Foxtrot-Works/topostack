<script lang="ts">
  import { Field } from "@loidolt/theme-svelte";
  import { displayLength } from "@topostack/core";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import { getStudio, type LineWidthKey } from "$lib/studio/studio-context";

  /** One stroke width from the project's line style, shown beside the feature it draws. */
  let { label, fieldLabel, key, fallbackMm = 0, minMm = 0.05, maxMm = 1.5, fine = true }: {
    label: string;
    /** The spinbutton's own accessible name. */
    fieldLabel: string;
    key: LineWidthKey;
    /** For widths older projects leave unset. */
    fallbackMm?: number;
    minMm?: number;
    maxMm?: number;
    /** Hundredths of a millimetre; sizes such as symbols step in tenths. */
    fine?: boolean;
  } = $props();
  const studio = getStudio();
  const units = $derived(studio.project.units);
  const step = $derived(units === "imperial" ? (fine ? 0.001 : 0.01) : (fine ? 0.01 : 0.1));
</script>

<Field {label} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={fieldLabel} value={studio.shownLineWidth(studio.project.lineStyle[key] ?? fallbackMm)} min={displayLength(minMm, units)} max={displayLength(maxMm, units)} {step} onValueChange={(value) => void studio.setLineWidth(key, value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
