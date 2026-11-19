import { describe, expect, it, vi } from "vitest";
import { readAtommLocale } from "$lib/atomm/atomm-locale";
import { setLocale } from "$lib/i18n/i18n.svelte";

describe("Atomm locale", () => {
  it.each([["en", "en"], ["en-US", "en"], ["ja", "ja"], ["zh-hant", "zh-Hant"], ["pt-BR", "pt-BR"]])("reads %s once and tags the document %s", async (host, tag) => {
    const getLocale = vi.fn(async () => host);
    expect(await readAtommLocale({ app: { getLocale } })).toBe(tag);
    expect(getLocale).toHaveBeenCalledOnce();
    await setLocale("en");
  });
  it("keeps the studio usable in English if the platform RPC fails", async () => {
    expect(await readAtommLocale({ app: { getLocale: async () => { throw new Error("Disconnected"); } } })).toBe("en");
  });
});
