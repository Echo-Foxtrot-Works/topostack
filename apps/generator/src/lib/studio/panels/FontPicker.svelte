<script lang="ts">
  import { getEmbedded } from "$lib/studio/embed-context";
  // A select-only combobox for the engraving fonts. Eleven fonts with samples
  // made a swatch grid taller than the rest of the Labels panel, so the picker is
  // one row that opens a grouped list over the sidebar. Built like HeaderMenu:
  // the theme's Select is a native <select> that cannot draw samples, and its
  // bits-ui popover is kept out of the studio's startup bundle.
  import { tick } from "svelte";
  const isEmbedded = getEmbedded();
  import { ChevronDown } from "@lucide/svelte";
  import { fontEntry, labelDimensions, labelPathData, type TextFont } from "@topostack/core";
  import { FONT_SAMPLES } from "$lib/studio/font-samples";
  import { FONT_GROUPS } from "$lib/studio/options";

  let { label, value, inherited, onSelect }: {
    /** Accessible name of the picker. */
    label: string;
    /** The chosen font; undefined selects the inherited option. */
    value: TextFont | undefined;
    /** Offers a first option that follows another setting, such as the label font. */
    inherited?: { label: string; font: TextFont };
    onSelect: (font: TextFont | undefined) => void;
  } = $props();

  const id = $props.id();
  const INHERITED = "inherited";
  type Choice = { key: string; font: TextFont | undefined; name: string; shown: TextFont };
  const choices = $derived<Choice[]>([
    ...(inherited ? [{ key: INHERITED, font: undefined, name: inherited.label, shown: inherited.font }] : []),
    ...FONT_GROUPS.flatMap((group) => group.fonts.map((entry) => ({ key: entry.id, font: entry.id, name: entry.name, shown: entry.id }))),
  ]);
  const selected = $derived(choices.find((choice) => choice.font === value) ?? choices[0]!);
  const selectedHint = $derived(FONT_GROUPS.find((group) => group.kind === fontEntry(selected.shown).kind)?.hint ?? "");

  let open = $state(false);
  let active = $state(0);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  let list = $state<HTMLElement>();
  let typed = "";
  let typedAt = 0;

  const optionId = (key: string) => `${id}-option-${key}`;

  async function show(index = choices.indexOf(selected)) {
    active = Math.max(0, index);
    typed = "";
    open = true;
    await tick();
    list?.focus();
    scrollActive();
  }

  function close(restoreFocus: boolean) {
    open = false;
    if (restoreFocus) button?.focus();
  }

  function choose(choice: Choice) {
    close(true);
    if (choice.font !== value) onSelect(choice.font);
  }

  function scrollActive() {
    list?.querySelector(`#${CSS.escape(optionId(choices[active]!.key))}`)?.scrollIntoView?.({ block: "nearest" });
  }

  function move(next: number) {
    active = Math.min(choices.length - 1, Math.max(0, next));
    scrollActive();
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const index = choices.indexOf(selected);
    void show(event.key === "ArrowDown" ? Math.min(choices.length - 1, index + (open ? 1 : 0)) : event.key === "ArrowUp" ? Math.max(0, index - (open ? 1 : 0)) : index);
  }

  function onListKey(event: KeyboardEvent) {
    const page = 5;
    // A space while typing a name ("Hershey S…") continues the typeahead instead of choosing.
    const typing = event.timeStamp - typedAt < 1_000 && typed !== "";
    if (event.key.length === 1 && (event.key !== " " || typing)) {
      typed = typing ? typed + event.key.toLowerCase() : event.key.toLowerCase();
      typedAt = event.timeStamp;
      const match = choices.findIndex((choice) => choice.name.toLowerCase().startsWith(typed));
      if (match >= 0) move(match);
    } else if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "PageDown") move(active + page);
    else if (event.key === "PageUp") move(active - page);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(choices.length - 1);
    else if (event.key === "Enter" || event.key === " ") choose(choices[active]!);
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") { close(false); return; }
    else return;
    event.preventDefault();
  }

  const BITMAP_SAMPLE = "123m";
  function bitmapSample(font: TextFont): string {
    const style = { font, sizeMm: 3.1 };
    // Glyphs run right and down from their origin, so start the sample half its size up and left of the box centre.
    return labelPathData(BITMAP_SAMPLE, { x: -labelDimensions(BITMAP_SAMPLE, style).width / 2, y: -1.4 }, 0, 0, 0, style);
  }
</script>

{#snippet sample(font: TextFont)}
  {@const kind = fontEntry(font).kind}
  {#if kind === "bitmap"}
    <svg width="64" height="20" fill="none" stroke="currentColor" viewBox="-8.5 -2.1 17 4.2" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><path stroke-width="0.18" stroke-linecap={font === "rounded" ? "round" : "butt"} stroke-linejoin={font === "rounded" ? "round" : "miter"} d={bitmapSample(font)} /></svg>
  {:else}
    {@const typeface = FONT_SAMPLES[font]!}
    <!-- Samples are cap height 20 from the cap line, so leave room for descenders below. -->
    <!-- Filled typefaces fill their sample like the letters they engrave. -->
    <svg width="64" height="20" fill={kind === "outline" ? "currentColor" : "none"} stroke={kind === "outline" ? "none" : "currentColor"} viewBox="-2 -7 {typeface.width + 4} 34" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><path d={typeface.d} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
  {/if}
{/snippet}

{#snippet option(choice: Choice, index: number)}
  <!-- svelte-ignore a11y_click_events_have_key_events (the listbox handles keys for its options) -->
  <div id={optionId(choice.key)} class="ldt-menu__item font-option" data-highlighted={index === active ? "" : undefined} role="option" tabindex="-1" aria-selected={choice === selected} onclick={() => choose(choice)} onpointermove={() => { active = index; }}>
    {@render sample(choice.shown)}
    <span>{choice.name}</span>
  </div>
{/snippet}

<svelte:window onpointerdown={(event) => { if (open && !root?.contains(event.target as Node)) close(false); }} />

{#if isEmbedded()}
<div class="font-picker atomm-font-picker">
  <div class="field-row"><label for={`${id}-native`}>{label}</label>
    <select id={`${id}-native`} aria-describedby={`${id}-hint`} value={selected.key} onchange={(event) => onSelect(choices.find(choice => choice.key === event.currentTarget.value)!.font)}>
      {#if inherited}<option value={INHERITED}>{inherited.label}</option>{/if}
      {#each FONT_GROUPS as group (group.kind)}<optgroup label={group.label}>{#each group.fonts as entry (entry.id)}<option value={entry.id}>{entry.name}</option>{/each}</optgroup>{/each}
    </select>
  </div>
  <small id={`${id}-hint`}>{selectedHint}</small>
</div>
{:else}
<div class="font-picker" bind:this={root}>
  <button bind:this={button} type="button" class="font-picker__trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-describedby={`${id}-hint`} onclick={() => (open ? close(false) : void show())} onkeydown={onTriggerKey}>
    {@render sample(selected.shown)}
    <span>{selected.name}{#if selected.font === undefined}<small> · {fontEntry(selected.shown).name}</small>{/if}</span>
    <ChevronDown size={16} aria-hidden="true" class={open ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
  </button>
  <small id={`${id}-hint`}>{selectedHint}</small>
  {#if open}
    <div bind:this={list} id={`${id}-list`} class="ldt-menu font-picker__list" role="listbox" tabindex="-1" aria-label={label} aria-activedescendant={optionId(choices[active]!.key)} onkeydown={onListKey}>
      {#if inherited}{@render option(choices[0]!, 0)}{/if}
      {#each FONT_GROUPS as group (group.kind)}
        <div class="font-picker__group" role="group" aria-labelledby={`${id}-group-${group.kind}`}>
          <p id={`${id}-group-${group.kind}`} class="subgroup-heading">{group.label}</p>
          {#each group.fonts as entry (entry.id)}
            {@const index = choices.findIndex((choice) => choice.font === entry.id)}
            {@render option(choices[index]!, index)}
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

{/if}
