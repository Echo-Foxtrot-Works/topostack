import type { ProjectConfigV1 } from "@topostack/core";

export interface HistoryAvailability { canUndo: boolean; canRedo: boolean }

/**
 * Undo/redo stacks for project edits. Plain TypeScript: the component mirrors
 * `onChange` into its own state for the toolbar buttons.
 */
export class ProjectHistory<Entry extends object = ProjectConfigV1> {
  private pastEntries: Entry[] = [];
  private futureEntries: Entry[] = [];
  private lastEditSignature = "";
  private lastEditTime = 0;

  constructor(private readonly onChange: (availability: HistoryAvailability) => void = () => undefined, private readonly limit = 40, private readonly coalesceMs = 1200, private readonly now: () => number = () => Date.now()) {}

  private get past(): Entry[] { return this.pastEntries; }
  private set past(entries: Entry[]) { this.pastEntries = entries; this.notify(); }
  private get future(): Entry[] { return this.futureEntries; }
  private set future(entries: Entry[]) { this.futureEntries = entries; this.notify(); }
  private notify(): void { this.onChange({ canUndo: this.pastEntries.length > 0, canRedo: this.futureEntries.length > 0 }); }

  /**
   * Record `current` before an edit to `keys`. Rapid edits to the same field(s)
   * — slider drags, keystrokes — coalesce into one entry so a single drag
   * cannot flood the stack.
   */
  record(current: Entry, keys: string[]): void {
    const signature = [...keys].sort().join("|");
    const now = this.now();
    this.future = [];
    const coalesce = signature !== "" && signature === this.lastEditSignature && now - this.lastEditTime < this.coalesceMs && this.past.length > 0;
    this.lastEditSignature = signature;
    this.lastEditTime = now;
    if (coalesce) return;
    this.past = [...this.past, current].slice(-this.limit);
  }

  /** Record a discrete edit that must never merge with the previous one. */
  push(current: Entry): void {
    this.lastEditSignature = "";
    this.future = [];
    this.past = [...this.past, current].slice(-this.limit);
  }

  undo(current: Entry | ((target: Entry) => Entry)): Entry | undefined {
    const previous = this.past.at(-1);
    if (!previous) return undefined;
    this.lastEditSignature = "";
    this.future = [...this.future, typeof current === "function" ? current(previous) : current];
    this.past = this.past.slice(0, -1);
    return previous;
  }

  redo(current: Entry | ((target: Entry) => Entry)): Entry | undefined {
    const next = this.future.at(-1);
    if (!next) return undefined;
    this.lastEditSignature = "";
    this.past = [...this.past, typeof current === "function" ? current(next) : current];
    this.future = this.future.slice(0, -1);
    return next;
  }

  reset(): void {
    this.lastEditSignature = "";
    this.past = [];
    this.future = [];
  }
}
