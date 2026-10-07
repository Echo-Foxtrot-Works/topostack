import { afterEach, describe, expect, it, vi } from "vitest";

/** The module reads its environment once, at load, so each case loads a fresh copy. */
async function load(env: { url?: string; port?: string; dev: boolean }) {
  vi.resetModules();
  vi.stubEnv("VITE_MAP_API_URL", env.url ?? "");
  vi.stubEnv("VITE_MAP_API_PORT", env.port ?? "");
  vi.stubEnv("DEV", env.dev);
  return import("$lib/domain/api-base");
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("map API base", () => {
  it("serves from the app's own origin when a production build names none", async () => {
    expect((await load({ dev: false })).apiBase()).toBe("");
  });

  it("targets the local Worker in development, on the port the dev script chose", async () => {
    expect((await load({ dev: true })).apiBase()).toBe("http://localhost:8787");
    expect((await load({ dev: true, port: "8899" })).apiBase()).toBe("http://localhost:8899");
  });

  it("reduces a configured URL to its origin, ahead of the development default", async () => {
    expect((await load({ dev: true, url: "https://maps.example.test/" })).apiBase()).toBe("https://maps.example.test");
    expect((await load({ dev: false, url: "  " })).apiBase()).toBe("");
  });

  it.each([
    "ftp://maps.example.test",
    "https://user:secret@maps.example.test",
    "https://maps.example.test/api",
    "https://maps.example.test/?cache=0",
    "https://maps.example.test/#tiles",
  ])("refuses to start with %s as the configured API", async (url) => {
    await expect(load({ dev: false, url })).rejects.toThrow(/HTTP\(S\) origin without credentials, a path, query, or fragment/);
  });

  it("lets an embedded preview point every loader at another origin", async () => {
    const { apiBase, configureApiBase } = await load({ dev: false });
    configureApiBase("https://topostack.example.test:8443/");
    expect(apiBase()).toBe("https://topostack.example.test:8443");
    expect(() => configureApiBase("")).toThrow("An API origin is required.");
    expect(() => configureApiBase("https://other.example.test/path")).toThrow(/without credentials, a path/);
    expect(() => configureApiBase("not a url")).toThrow();
    // A rejected origin leaves the last good one in place.
    expect(apiBase()).toBe("https://topostack.example.test:8443");
  });
});
