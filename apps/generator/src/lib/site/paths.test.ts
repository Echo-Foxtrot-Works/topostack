import { describe, expect, it, vi } from "vitest";

const resolve = vi.hoisted(() => vi.fn<(id: string) => string>());
vi.mock("$app/paths", () => ({ resolve }));

import { basePath } from "$lib/site/paths";

describe("basePath", () => {
  it("drops the trailing slash from the resolved site root", () => {
    resolve.mockReturnValueOnce("/");
    expect(basePath()).toBe("");
    resolve.mockReturnValueOnce("../");
    expect(basePath()).toBe("..");
    resolve.mockReturnValueOnce("/topostack/");
    expect(basePath()).toBe("/topostack");
    expect(resolve).toHaveBeenCalledWith("/");
  });
});
