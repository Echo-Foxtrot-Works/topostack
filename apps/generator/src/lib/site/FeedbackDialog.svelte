<script lang="ts">
  import { untrack } from 'svelte';
  import { isFeedbackEmail } from '@topostack/data-contracts/feedback';
  import { FEEDBACK_TYPES, ISSUE_TRACKER, feedbackLink, feedbackReport, sendFeedback, type FeedbackContext, type FeedbackResult, type FeedbackType } from '$lib/site/feedback';
  let { open, initialType = 'bug', context, onClose }: { open: boolean; initialType?: FeedbackType; context?: FeedbackContext; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let type = $state<FeedbackType>(untrack(() => initialType));
  let summary = $state('');
  let details = $state('');
  let replyTo = $state('');
  let website = $state('');
  let includeContext = $state(false);
  let sending = $state(false);
  let result = $state<FeedbackResult>();
  let copyStatus = $state('');
  const body = $derived(feedbackReport(type, details, includeContext ? context : undefined));
  const link = $derived(feedbackLink(type, summary, body));
  const replyValid = $derived(!replyTo.trim() || isFeedbackEmail(replyTo.trim()));
  const valid = $derived(Boolean(summary.trim() && details.trim()) && replyValid);
  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
  // Editing the report clears stale copy and send-failure messages.
  $effect(() => { void body; void summary; void replyTo; copyStatus = ''; untrack(() => { if (result !== 'sent') result = undefined; }); });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || sending) return;
    sending = true;
    const outcome = await sendFeedback({ kind: type, summary: summary.trim(), details: details.trim(), ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}), ...(includeContext && context ? { context } : {}), ...(website ? { website } : {}) });
    sending = false;
    result = outcome;
    if (outcome === 'sent') { summary = ''; details = ''; replyTo = ''; includeContext = false; }
  }
  function writeAnother() { result = undefined; }
  async function copyReport() {
    try { await navigator.clipboard.writeText(`# [${FEEDBACK_TYPES[type].prefix}] ${summary.trim()}\n\n${body}`); copyStatus = 'Report copied.'; }
    catch { copyStatus = 'Copy is unavailable. Select and copy the report in the preview below.'; }
  }
</script>

<dialog bind:this={dialog} class="feedback-dialog" aria-labelledby="feedback-title" aria-describedby="feedback-description" onclose={onClose}>
  <header><h2 id="feedback-title">Help improve TopoStack</h2><button class="close" type="button" aria-label="Close feedback" onclick={() => dialog.close()}>×</button></header>
  {#if result === 'sent'}
    <p id="feedback-description" role="status">Thanks! Your feedback was sent to the TopoStack maintainer.</p>
    <div class="actions"><button class="primary" type="button" onclick={() => dialog.close()}>Close</button><button type="button" onclick={writeAnother}>Send more feedback</button></div>
  {:else}
  <p id="feedback-description">Report a problem, suggest a feature, or flag terrain and lake data for investigation. No account needed.</p>
  <form onsubmit={submit} novalidate>
    <div class="fields">
      <label>Feedback type<select bind:value={type}>{#each Object.entries(FEEDBACK_TYPES) as [value, option]}<option {value}>{option.label}</option>{/each}</select></label>
      <label>Summary<input bind:value={summary} maxlength="120" required placeholder="A short description" /></label>
      <label>Details<textarea bind:value={details} maxlength="4000" required rows="5" aria-describedby="feedback-hint"></textarea></label>
      <p class="hint" id="feedback-hint">{FEEDBACK_TYPES[type].hint}</p>
      <label>Email for a reply (optional)<input type="email" bind:value={replyTo} maxlength="254" autocomplete="email" placeholder="you@example.com" aria-invalid={!replyValid} aria-describedby="feedback-email-hint" /></label>
      <p class="hint" id="feedback-email-hint">{replyValid ? 'Leave blank to stay anonymous. Used only to answer this report.' : 'Enter a valid email address or leave it blank.'}</p>
      <label class="trap" aria-hidden="true">Leave this field empty<input bind:value={website} name="website" tabindex="-1" autocomplete="off" /></label>
      {#if context}
        <label class="context-option"><input type="checkbox" bind:checked={includeContext} />Include location, settings, and data sources</label>
        <p class="hint">Optional. Includes coordinates and source diagnostics, but no project name or custom markers. Review the exact details below.</p>
      {/if}
    </div>
    <p class="privacy">Your report is emailed privately to the TopoStack maintainer. It is not published.</p>
    <div class="actions">
      <button class="primary" type="submit" disabled={!valid || sending} aria-busy={sending}>{sending ? 'Sending…' : 'Send feedback'}</button>
    </div>
  </form>
  {#if result === 'rate-limited' || result === 'failed'}
    <p class="send-error" role="alert">{result === 'rate-limited' ? 'Too much feedback at once. Wait a minute and try again, or' : 'Feedback could not be sent. Try again, or'} <a href={link.url} target="_blank" rel="noopener noreferrer">{link.needsPaste ? 'open a GitHub issue and paste the report' : 'continue on GitHub'} ↗<span class="ldt-sr-only"> (opens in a new tab)</span></a>. <button type="button" class="link-button" onclick={copyReport}>Copy report</button></p>
  {/if}
  {#if copyStatus}<p role="status">{copyStatus}</p>{/if}
  <details open={copyStatus.startsWith('Copy is unavailable')}><summary>Review report{includeContext ? ' and shared context' : ''}</summary><textarea class="report-preview" aria-label="Report preview" readonly rows="9" value={body}></textarea></details>
  <p class="existing">Prefer a public issue? {#if valid}<a href={link.url} target="_blank" rel="noopener noreferrer">Continue on GitHub ↗<span class="ldt-sr-only"> (opens in a new tab)</span></a> (account required){:else}Fill in the summary and details to open a prefilled GitHub issue{/if} · <a href={ISSUE_TRACKER} target="_blank" rel="noopener noreferrer">Browse existing feedback ↗<span class="ldt-sr-only"> (opens in a new tab)</span></a></p>
  {/if}
</dialog>

<style>
  .feedback-dialog { box-sizing: border-box; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); margin: auto; padding: 24px; overflow: auto; border: 1px solid var(--loidolt-border); border-radius: 12px; background: var(--loidolt-background); color: var(--loidolt-text); font: 14px/1.5 var(--loidolt-font-body, sans-serif); box-shadow: 0 20px 80px #0005; }
  .feedback-dialog::backdrop { background: #0008; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { font-size: 21px; line-height: 1.3; margin: 0; }
  p { margin: 12px 0; }
  .fields { display: grid; gap: 12px; }
  label { display: grid; gap: 6px; font-weight: 500; }
  input:not([type=checkbox]), select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--loidolt-border); border-radius: 5px; background: var(--loidolt-surface); color: var(--loidolt-text); padding: 10px; font: inherit; }
  textarea { resize: vertical; }
  .context-option { display: flex; align-items: center; gap: 8px; }
  input[type=checkbox] { flex-shrink: 0; width: 18px; height: 18px; }
  .hint { margin: -6px 0 0; font-size: 12px; color: var(--loidolt-text-muted); }
  .trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .send-error { padding: 12px; border: 1px solid var(--loidolt-border); border-radius: 5px; font-size: 12px; }
  .link-button { display: inline; min-height: 0; padding: 0; border: 0; background: none; color: var(--loidolt-text-accent); text-decoration: underline; font-size: inherit; }
  .privacy { padding: 12px; background: var(--loidolt-surface); border-radius: 5px; font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
  button, .primary { display: inline-flex; justify-content: center; align-items: center; min-height: 40px; padding: 8px 12px; border: 1px solid var(--loidolt-border); border-radius: 5px; font: inherit; cursor: pointer; background: var(--loidolt-surface); color: var(--loidolt-text); text-decoration: none; }
  .primary { background: var(--loidolt-accent); color: var(--loidolt-on-accent); }
  button:disabled { opacity: .5; cursor: default; }
  .close { padding: 0; min-width: 40px; font-size: 24px; background: transparent; border: 0; }
  a { color: var(--loidolt-text-accent); }
  :is(button, a, input, textarea, select, summary):focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 3px; }
  summary { cursor: pointer; }
  .report-preview { margin-top: 12px; max-height: 230px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--loidolt-surface); padding: 12px; font-size: 11px; user-select: text; }
  .existing { font-size: 12px; color: var(--loidolt-text-muted); }
  @media (max-width: 450px) { .feedback-dialog { padding: 16px; } }
</style>
