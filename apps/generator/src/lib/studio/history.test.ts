import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { ProjectHistory, type HistoryAvailability } from "./history";

const version = (widthMm: number): ProjectConfigV1 => ({ ...DEFAULT_PROJECT, widthMm });

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => { time += ms; } };
}

describe("ProjectHistory", () => {
  it("undoes and redoes edits in order and returns undefined at either end", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    expect(history.undo(version(1))).toBeUndefined();
    expect(history.redo(version(1))).toBeUndefined();

    history.push(version(1));
    history.push(version(2));
    expect(history.undo(version(3))).toEqual(version(2));
    expect(history.undo(version(2))).toEqual(version(1));
    expect(history.undo(version(1))).toBeUndefined();
    expect(history.redo(version(1))).toEqual(version(2));
    expect(history.redo(version(2))).toEqual(version(3));
    expect(history.redo(version(3))).toBeUndefined();
    expect(history.undo(version(3))).toEqual(version(2));
  });

  it("reports availability on every change", () => {
    const changes: HistoryAvailability[] = [];
    const history = new ProjectHistory((availability) => changes.push(availability));
    history.push(version(1));
    expect(changes.at(-1)).toEqual({ canUndo: true, canRedo: false });
    history.undo(version(2));
    expect(changes.at(-1)).toEqual({ canUndo: false, canRedo: true });
    history.redo(version(1));
    expect(changes.at(-1)).toEqual({ canUndo: true, canRedo: false });
    history.reset();
    expect(changes.at(-1)).toEqual({ canUndo: false, canRedo: false });
  });

  it("does not notify when undo or redo has nothing to restore", () => {
    const onChange = vi.fn();
    const history = new ProjectHistory(onChange);
    history.undo(version(1));
    history.redo(version(1));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the redo stack on a new edit", () => {
    const history = new ProjectHistory();
    history.push(version(1));
    history.undo(version(2));
    history.push(version(1));
    expect(history.redo(version(5))).toBeUndefined();

    const time = clock();
    const recorded = new ProjectHistory(undefined, 40, 1200, time.now);
    recorded.record(version(1), ["widthMm"]);
    recorded.undo(version(2));
    recorded.record(version(1), ["heightMm"]);
    expect(recorded.redo(version(9))).toBeUndefined();
  });

  it("coalesces rapid edits to the same keys, in any order, into one entry", () => {
    const time = clock(1000);
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    history.record(version(1), ["widthMm", "heightMm"]);
    time.advance(500);
    history.record(version(2), ["heightMm", "widthMm"]);
    time.advance(500);
    history.record(version(3), ["widthMm", "heightMm"]);
    expect(history.undo(version(4))).toEqual(version(1));
    expect(history.undo(version(1))).toBeUndefined();
  });

  it("measures the coalescing window from the latest edit, not the first", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    history.record(version(1), ["widthMm"]);
    for (let step = 2; step < 6; step += 1) {
      time.advance(1000);
      history.record(version(step), ["widthMm"]);
    }
    expect(history.undo(version(6))).toEqual(version(1));
    expect(history.undo(version(1))).toBeUndefined();
  });

  it("starts a new entry after the window, for different keys, or for an empty key list", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    history.record(version(1), ["widthMm"]);
    time.advance(1200);
    history.record(version(2), ["widthMm"]);
    history.record(version(3), ["heightMm"]);
    history.record(version(4), []);
    history.record(version(5), []);
    const restored: Array<ProjectConfigV1 | undefined> = [];
    let current = version(6);
    for (let step = 0; step < 6; step += 1) {
      const previous = history.undo(current);
      restored.push(previous);
      if (previous) current = previous;
    }
    expect(restored.map((project) => project?.widthMm)).toEqual([5, 4, 3, 2, 1, undefined]);
  });

  it("never merges an edit across push, undo, redo or reset", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    history.record(version(1), ["widthMm"]);
    history.push(version(2));
    history.record(version(3), ["widthMm"]);
    expect(history.undo(version(4))).toEqual(version(3));
    history.record(version(3), ["widthMm"]);
    expect(history.undo(version(5))).toEqual(version(3));
    expect(history.undo(version(3))).toEqual(version(2));

    history.reset();
    history.record(version(7), ["widthMm"]);
    expect(history.undo(version(8))).toEqual(version(7));
  });

  it("does not coalesce the first edit after the stack was emptied", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 40, 1200, time.now);
    history.record(version(1), ["widthMm"]);
    expect(history.undo(version(2))).toEqual(version(1));
    // undo cleared the signature, so the next same-key edit still records.
    history.record(version(1), ["widthMm"]);
    expect(history.undo(version(2))).toEqual(version(1));
  });

  it("keeps only the newest entries up to the limit", () => {
    const history = new ProjectHistory(undefined, 3);
    for (let step = 1; step <= 5; step += 1) history.push(version(step));
    const restored: number[] = [];
    let current = version(6);
    for (let previous = history.undo(current); previous; previous = history.undo(current)) {
      restored.push(previous.widthMm);
      current = previous;
    }
    expect(restored).toEqual([5, 4, 3]);
  });

  it("applies the limit to coalesced records too", () => {
    const time = clock();
    const history = new ProjectHistory(undefined, 2, 1200, time.now);
    history.record(version(1), ["a"]);
    history.record(version(2), ["b"]);
    history.record(version(3), ["c"]);
    expect(history.undo(version(4))?.widthMm).toBe(3);
    expect(history.undo(version(3))?.widthMm).toBe(2);
    expect(history.undo(version(2))).toBeUndefined();
  });

  it("does not mutate a key list passed to record", () => {
    const history = new ProjectHistory();
    const keys = ["widthMm", "heightMm"];
    history.record(version(1), keys);
    expect(keys).toEqual(["widthMm", "heightMm"]);
  });
});
