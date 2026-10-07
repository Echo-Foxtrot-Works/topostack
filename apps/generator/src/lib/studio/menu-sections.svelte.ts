import { CONFIG_SECTION_IDS, type ConfigSectionId } from "$lib/studio/preview-summary";

const MENU_STATE_KEY = "topostack-menu-sections-v1";

/**
 * Which sidebar sections are open, remembered in localStorage. Construct during
 * component setup; call `restore()` once mounted, after which every change is saved.
 */
export class MenuSections {
  open = $state<Record<ConfigSectionId, boolean>>({
    setup: true,
    size: false,
    terrain: false,
    details: false,
    customData: false,
    linework: false,
    advanced: false,
  });
  #restored = $state(false);

  constructor() {
    $effect(() => {
      const current = this.open;
      if (!this.#restored) return;
      try { localStorage.setItem(MENU_STATE_KEY, JSON.stringify(current)); } catch { /* Preferences are optional. */ }
    });
  }

  restore(): void {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(MENU_STATE_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        this.open = Object.fromEntries(CONFIG_SECTION_IDS.map((section) => [section, typeof (saved as Record<string, unknown>)[section] === "boolean" ? (saved as Record<string, boolean>)[section] : this.open[section]])) as Record<ConfigSectionId, boolean>;
      }
    } catch {
      // A malformed preference should never prevent the editor from loading.
    }
    this.#restored = true;
  }

  toggle(section: ConfigSectionId): void {
    this.open = { ...this.open, [section]: !this.open[section] };
  }

  setAll(sections: readonly ConfigSectionId[], open: boolean): void {
    this.open = { ...this.open, ...Object.fromEntries(sections.map((section) => [section, open])) };
  }
}
