<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { tick } from "svelte";
  import { PANEL_IDS, PANEL_LABELS, type PanelId } from "$lib/studio/preview-summary";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * Finds a setting by name and opens the panel that holds it. The index is
   * read from the mounted panels each time, so it lists exactly the controls
   * the project shows now: a setting under a switch that is off is found
   * through its switch.
   */
  type Hit = { label: string; panel: PanelId; element: HTMLElement };

  const studio = getStudio();
  let query = $state("");
  let active = $state(0);
  let hits = $state<Hit[]>([]);
  const MAX_HITS = 8;
  const CONTROLS = "input[aria-label], select[aria-label], textarea[aria-label], [role=switch][aria-label], [role=radiogroup][aria-label], label.field-row";

  function panelOf(element: Element): PanelId | undefined {
    const id = element.closest<HTMLElement>("[data-panel]")?.dataset.panel;
    return PANEL_IDS.includes(id as PanelId) ? (id as PanelId) : undefined;
  }

  function index(): Hit[] {
    const seen = new Set<string>();
    const found: Hit[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(`.settings-panels :is(${CONTROLS})`)) {
      const label = (element.getAttribute("aria-label") ?? element.firstChild?.textContent ?? "").trim();
      const panel = panelOf(element);
      // Sliders repeat the number field beside them.
      if (!label || !panel || label.endsWith(" slider") || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      found.push({ label, panel, element });
    }
    return found;
  }

  function search(): void {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    active = 0;
    if (!terms.length) { hits = []; return; }
    hits = index()
      .filter((hit) => terms.every((term) => `${hit.label} ${PANEL_LABELS[hit.panel]}`.toLowerCase().includes(term)))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(terms[0]!)) - Number(!b.label.toLowerCase().startsWith(terms[0]!)))
      .slice(0, MAX_HITS);
  }

  async function choose(hit: Hit): Promise<void> {
    studio.activePanel = hit.panel;
    query = "";
    hits = [];
    await tick();
    const target = hit.element.matches("[role=radiogroup]") ? hit.element.querySelector<HTMLElement>("[aria-checked=true]") ?? hit.element : hit.element.matches("label") ? hit.element.closest(".field-row")?.querySelector<HTMLElement>("input, select") ?? hit.element : hit.element;
    target.scrollIntoView?.({ block: "center" });
    target.focus({ preventScroll: true });
    const row = target.closest<HTMLElement>(".field-row, .range-field, [role=radiogroup], .atomm-switch-row") ?? target;
    row.classList.remove("search-hit");
    void row.offsetWidth;
    row.classList.add("search-hit");
    window.setTimeout(() => row.classList.remove("search-hit"), 1600);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && query) { event.preventDefault(); query = ""; hits = []; return; }
    if (!hits.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose(hits[active]!);
    }
  }
</script>

<div class="settings-search">
  <label class="settings-search-field">
    <Search size={15} aria-hidden="true" />
    <input bind:value={query} type="search" placeholder="Find a setting" aria-label="Find a setting" role="combobox" aria-expanded={hits.length > 0} aria-controls="settings-search-results" aria-autocomplete="list" aria-activedescendant={hits.length ? `settings-search-hit-${active}` : undefined} autocomplete="off" spellcheck="false" oninput={search} onkeydown={keydown} />
  </label>
  {#if hits.length}
    <ul id="settings-search-results" class="settings-search-results" role="listbox" aria-label="Matching settings">
      {#each hits as hit, position (hit.label)}
        <!-- Pointer users click; keyboard users choose from the field with the arrow keys and Enter. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id={`settings-search-hit-${position}`} role="option" aria-selected={position === active} onmousedown={(event) => event.preventDefault()} onclick={() => void choose(hit)}>
          <span>{hit.label}</span><small>{PANEL_LABELS[hit.panel]}</small>
        </li>
      {/each}
    </ul>
  {:else if query.trim()}
    <p class="settings-search-empty" role="status">No setting matches “{query.trim()}”.</p>
  {/if}
</div>
