<script lang="ts">
  import { ChevronDown, Link, RotateCcw, Share2, Undo2, Redo2, Upload } from "@lucide/svelte";
  import { IconButton, Input } from "@loidolt/theme-svelte";
  import { MAX_PROJECT_NAME_LENGTH } from "@topostack/core";
  import HeaderMenu from "$lib/studio/panels/HeaderMenu.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { copyShareLink, importProject, redo, shareDesign, undo, updateProject } = studio;
  let importInput: HTMLInputElement;
  // Menu items render only once the menu opens, so this never runs during prerendering.
  const nativeShare = () => typeof navigator.share === "function";
</script>

<div class="project-identity">
  <label class="project-name"><span>{t("place.projectName")}</span><Input aria-label={t("place.projectName")} maxlength={MAX_PROJECT_NAME_LENGTH} value={studio.project.name} oninput={(event) => updateProject({ name: event.currentTarget.value })} /></label>
  <!-- The platform embed has room for its two project actions in its own rail, so they stay flat there. -->
  {#if !studio.embeddedInPlatform}
    <HeaderMenu label={t("place.projectActions")} title={t("place.projectActions")} triggerClass="ldt-button ldt-icon-button ldt-button--ghost ldt-button--sm project-menu-trigger" align="start">
      {#snippet trigger()}<ChevronDown size={16} aria-hidden="true" />{/snippet}
      <button type="button" class="ldt-menu__item" role="menuitem" onclick={() => importInput.click()}><span>{t("place.importProjectJson")}</span><Upload size={16} aria-hidden="true" /></button>
      {#if nativeShare()}
        <button type="button" class="ldt-menu__item" role="menuitem" title={t("place.shareDesignHint")} onclick={() => void shareDesign()}><span>{t("place.shareDesign")}</span><Share2 size={16} aria-hidden="true" /></button>
      {/if}
      <button type="button" class="ldt-menu__item" role="menuitem" title={t("place.copyShareLinkHint")} onclick={() => void copyShareLink()}><span>{t("place.copyShareLink")}</span><Link size={16} aria-hidden="true" /></button>
      <hr class="ldt-menu__separator" />
      <button type="button" class="ldt-menu__item" role="menuitem" aria-haspopup="dialog" disabled={!studio.booted} onclick={() => { studio.resetOpen = true; }}><span>{t("place.resetProjectEllipsis")}</span><RotateCcw size={16} aria-hidden="true" /></button>
    </HeaderMenu>
  {/if}
</div>
<div class="history-actions">
  <IconButton label={t("place.undo")} title={t("place.undoHint")} aria-keyshortcuts="Control+Z Meta+Z" onclick={undo} disabled={!!studio.placement || !studio.historyAvailability.canUndo}><Undo2 size={17} /></IconButton>
  <IconButton label={t("place.redo")} title={t("place.redoHint")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" onclick={redo} disabled={!!studio.placement || !studio.historyAvailability.canRedo}><Redo2 size={17} /></IconButton>
  {#if studio.embeddedInPlatform}
    <IconButton label={t("place.resetProject")} aria-haspopup="dialog" onclick={(event: MouseEvent) => { if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus(); studio.resetOpen = true; }} disabled={!studio.booted}><RotateCcw size={17} /></IconButton>
    <IconButton label={t("place.importProjectJson")} onclick={() => importInput.click()}><Upload size={17} /></IconButton>
  {/if}
</div>
<input bind:this={importInput} class="ldt-visually-hidden" type="file" accept="application/json,.json" onchange={(event) => { const input = event.currentTarget; void importProject(input.files?.[0]).finally(() => { input.value = ""; }); }} />
