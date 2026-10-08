<script lang="ts">
  import { getEmbedded } from "$lib/studio/embed-context";
  import type { HTMLInputAttributes } from "svelte/elements";
  import { NumberField } from "@loidolt/theme-svelte";
  let { value = 0, min = -Infinity, max = Infinity, step = 1, label, disabled = false, boxed = false, onValueChange, oninput, ...rest }: Pick<HTMLInputAttributes, "id" | "oninput" | "aria-describedby"> & {
    value?: number; min?: number; max?: number; step?: number; label: string; disabled?: boolean; boxed?: boolean; onValueChange?: (value: number) => void;
  } = $props();
  const isEmbedded = getEmbedded();
  const fieldId = $props.id();
  const errorId = `${fieldId}-error`;
  let error = $state("");
  $effect(() => { void value; error = ""; });
  const describedBy = $derived([rest["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined);
  function validate(field: HTMLInputElement): boolean {
    const next = field.valueAsNumber;
    error = field.value === "" || !Number.isFinite(next) ? "Enter a number." : next < min ? `Use ${min} or more.` : next > max ? `Use ${max} or less.` : "";
    return !error;
  }
  // Step controls gestures, not valid typed values: min may not align with the step grid.
  let drag: { x: number; value: number; moved: boolean; direction: number } | undefined;
  function commit(next: number, field?: HTMLInputElement) {
    if (!Number.isFinite(next)) return;
    error = "";
    const accepted = Math.min(max, Math.max(min, Number(next.toFixed(6))));
    if (field) field.value = String(accepted);
    onValueChange?.(accepted);
  }
  function input(event: Event & { currentTarget: HTMLInputElement }) {
    const field = event.currentTarget;
    if (!validate(field)) return;
    if (oninput) oninput(event);
    else commit(field.valueAsNumber);
  }
  function finishInput(event: (Event | FocusEvent) & { currentTarget: HTMLInputElement }) {
    if (validate(event.currentTarget)) commit(event.currentTarget.valueAsNumber);
  }
  function start(event: PointerEvent & { currentTarget: HTMLInputElement }) {
    if (disabled || event.button !== 0 || event.pointerType === "touch" || document.activeElement === event.currentTarget) return;
    drag = { x: event.clientX, value, moved: false, direction: getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent & { currentTarget: HTMLInputElement }) {
    if (!drag) return;
    const distance = (event.clientX - drag.x) * drag.direction;
    if (!drag.moved && Math.abs(distance) < 3) return;
    drag.moved = true;
    event.preventDefault();
    commit(drag.value + Math.round(distance / 3) * step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1), event.currentTarget);
  }
  function finish(event: PointerEvent & { currentTarget: HTMLInputElement }) {
    if (drag?.moved) event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag = undefined;
  }
</script>

{#if isEmbedded()}
  <span class="atomm-number-control">
  <input class="atomm-number" type="number" inputmode="decimal" aria-label={label} {value} {disabled} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} step="any" {...rest} aria-describedby={describedBy} aria-invalid={error ? "true" : undefined} oninput={input} onchange={finishInput} onblur={finishInput} onpointerdown={start} onpointermove={move} onpointerup={finish} onpointercancel={finish} onkeydown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); const current = Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : value; commit(current + step * (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1), event.currentTarget); } }} />
  {#if error}<span class="atomm-number-error" id={errorId} aria-live="polite">{error}</span>{/if}
  </span>
{:else}
  <NumberField {boxed} {value} {min} {max} {step} {label} {disabled} {onValueChange} {oninput} {...rest} />
{/if}
