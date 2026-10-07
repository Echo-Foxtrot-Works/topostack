<script lang="ts">
  import { getEmbedded } from "$lib/studio/embed-context";
  import { type Snippet } from "svelte";
  import { Switch } from "@loidolt/theme-svelte";
  let { checked = false, disabled = false, onCheckedChange, children, ...rest }: {
    checked?: boolean; disabled?: boolean; onCheckedChange?: (checked: boolean) => void;
    children?: Snippet; "aria-label"?: string;
  } = $props();
  const isEmbedded = getEmbedded();
</script>

{#if isEmbedded()}
  <label class="atomm-switch-row">
    {#if children}<span>{@render children()}</span>{/if}
    <span class="switch"><input type="checkbox" {checked} {disabled} {...rest} onchange={(event) => onCheckedChange?.(event.currentTarget.checked)} /><span class="track" aria-hidden="true"></span><span class="knob" aria-hidden="true"></span></span>
  </label>
{:else}
  <Switch {checked} {disabled} {onCheckedChange} {...rest}>{#if children}{@render children()}{/if}</Switch>
{/if}
