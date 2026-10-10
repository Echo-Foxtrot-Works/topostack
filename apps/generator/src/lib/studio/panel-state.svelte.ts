import { PANEL_IDS, type DisclosureId, type PanelId } from "$lib/studio/preview-summary";

const PANEL_STATE_KEY = "topostack-studio-panels-v1";

const DISCLOSURE_IDS: DisclosureId[] = ["setup", ...PANEL_IDS, "customData"];

/**
 * Which settings panel the rail shows, and which blocks the platform embed has
 * open (its rails stack the panels as disclosures), remembered in localStorage.
 * Construct during component setup; call `restore()` once mounted, after which
 * every change is saved.
 */
export class PanelState {
  active = $state<PanelId>("place");
  open = $state<Record<DisclosureId, boolean>>({
    setup: true,
    place: false,
    terrain: false,
    features: false,
    water: false,
    aviation: false,
    labels: false,
    make: false,
    customData: false,
  });
  #restored = $state(false);

  constructor() {
    $effect(() => {
      const saved = { active: this.active, open: this.open };
      if (!this.#restored) return;
      try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(saved)); } catch { /* Preferences are optional. */ }
    });
  }

  restore(): void {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        const { active, open } = saved as { active?: unknown; open?: unknown };
        if (PANEL_IDS.includes(active as PanelId)) this.active = active as PanelId;
        if (open && typeof open === "object") {
          const flags = open as Record<string, unknown>;
          this.open = Object.fromEntries(DISCLOSURE_IDS.map((id) => [id, typeof flags[id] === "boolean" ? flags[id] : this.open[id]])) as Record<DisclosureId, boolean>;
        }
      }
    } catch {
      // A malformed preference should never prevent the editor from loading.
    }
    this.#restored = true;
  }

  toggle(id: DisclosureId): void {
    this.open = { ...this.open, [id]: !this.open[id] };
  }
}
