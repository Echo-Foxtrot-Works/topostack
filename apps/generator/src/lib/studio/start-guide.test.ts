import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, START_GUIDE_KEY, guideStepAtStartup, rememberGuideDone, rememberGuideStep } from "$lib/studio/start-guide";

function store(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[START_GUIDE_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

const fresh = { restoredProject: false, openedLink: false };

describe("start guide", () => {
  it("opens on the first step for a browser with nothing to restore", () => {
    expect(guideStepAtStartup(store(), fresh)).toBe(GUIDE_STEPS[0]);
  });

  it("stays closed for a maker who already has a saved project", () => {
    expect(guideStepAtStartup(store(), { restoredProject: true, openedLink: false })).toBeUndefined();
  });

  it("stays closed when a link opened a design", () => {
    expect(guideStepAtStartup(store(), { restoredProject: false, openedLink: true })).toBeUndefined();
    expect(guideStepAtStartup(store("look"), { restoredProject: true, openedLink: true })).toBeUndefined();
  });

  it("resumes the remembered step, even over the project it saved", () => {
    const storage = store();
    rememberGuideStep(storage, "look");
    expect(guideStepAtStartup(storage, { restoredProject: true, openedLink: false })).toBe("look");
  });

  it("never returns once finished or skipped", () => {
    const storage = store();
    rememberGuideDone(storage);
    expect(guideStepAtStartup(storage, fresh)).toBeUndefined();
  });

  it("treats an unknown saved value as no progress", () => {
    expect(guideStepAtStartup(store("step-9"), fresh)).toBe("type");
    expect(guideStepAtStartup(store("step-9"), { restoredProject: true, openedLink: false })).toBeUndefined();
  });

  it("stays closed when storage is unavailable", () => {
    const blocked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(guideStepAtStartup(blocked, fresh)).toBeUndefined();
    expect(() => rememberGuideStep(blocked, "place")).not.toThrow();
    expect(() => rememberGuideDone(blocked)).not.toThrow();
  });
});
