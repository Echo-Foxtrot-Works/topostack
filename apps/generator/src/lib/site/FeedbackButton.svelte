<script lang="ts">
  import type { FeedbackContext, FeedbackType } from '$lib/site/feedback';
  let { label = 'Feedback', type = 'bug', edge = false, getContext }: { label?: string; type?: FeedbackType; edge?: boolean; getContext?: () => FeedbackContext } = $props();
  let Dialog = $state.raw<typeof import('$lib/site/FeedbackDialog.svelte').default>();
  let open = $state(false);
  let loading = $state(false);
  let failed = $state(false);
  let context = $state.raw<FeedbackContext>();
  let trigger: HTMLButtonElement;
  async function show() {
    trigger.focus();
    loading = true; failed = false;
    try {
      Dialog ??= (await import('$lib/site/FeedbackDialog.svelte')).default;
      context = getContext?.();
      open = true;
    } catch { failed = true; }
    finally { loading = false; }
  }
</script>

<button bind:this={trigger} type="button" class="feedback-trigger" class:feedback-trigger--edge={edge} aria-haspopup="dialog" aria-busy={loading} onclick={show}>{label}</button>
{#if failed}<span class:feedback-error--edge={edge} role="alert">Feedback could not load. <a href="https://github.com/Echo-Foxtrot-Works/topostack/issues/new/choose" target="_blank" rel="noopener noreferrer">Open GitHub issues</a> or try again.</span>{/if}
{#if Dialog}<Dialog {open} initialType={type} {context} onClose={() => { open = false; trigger.focus({ preventScroll: true }); }} />{/if}

<style>
  .feedback-trigger { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--loidolt-text-muted); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
  @media (hover: hover) {
    .feedback-trigger:hover { background: var(--loidolt-surface); color: var(--loidolt-text); }
  }
  .feedback-trigger:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 2px; }
  .feedback-trigger--edge { position: absolute; z-index: 30; top: 50%; right: 0; transform: translateY(-50%); writing-mode: vertical-rl; min-height: 100px; width: 36px; padding: 14px 8px; border: 1px solid var(--loidolt-border); border-right: 0; border-radius: 8px 0 0 8px; background: var(--loidolt-surface); color: var(--loidolt-text); box-shadow: -2px 2px 8px #0001; }
  @media (hover: hover) {
    .feedback-trigger--edge:hover { background: var(--loidolt-background); }
  }
  .feedback-trigger--edge:focus-visible { outline-offset: -3px; }
  .feedback-error--edge { position: absolute; z-index: 31; top: 50%; right: 52px; width: min(260px, calc(100% - 68px)); padding: 12px; border: 1px solid var(--loidolt-border); border-radius: 6px; background: var(--loidolt-surface); color: var(--loidolt-text); }
  @media (pointer: coarse), (max-width: 600px) { .feedback-trigger--edge { width: 44px; } }
  span { font-size: 12px; }
</style>
