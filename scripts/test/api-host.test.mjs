import assert from "node:assert/strict";
import test from "node:test";
import { forbiddenHostsIn, isForbiddenApiHost } from "../lib/api-host.mjs";

test("rejects loopback, reserved placeholder, and Workers preview hosts", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]", "api.localhost", "ci.invalid", "maplibre.invalid", "invalid",
    "map.test", "box.local", "api.example", "example.com", "api.example.org", "topostack.user.workers.dev", "workers.dev"]) {
    assert.equal(isForbiddenApiHost(host), true, host);
  }
});

test("accepts deployed production hosts", () => {
  for (const host of ["topostack.app", "dev.topostack.app", "api.testing.com", "localhosting.net"]) {
    assert.equal(isForbiddenApiHost(host), false, host);
  }
});

test("finds placeholder endpoints in built code, excusing only a library's own base URL", () => {
  assert.deepEqual(forbiddenHostsIn('fetch("https://api.example.com/v1") || fetch("http://localhost:8787")'), ["api.example.com", "localhost"]);
  assert.deepEqual(forbiddenHostsIn('const api = "https://topostack.app"'), []);
  // pdf.js parses URLs against http://example.com; its chunk is recognisable by its API.
  const pdfjs = 'GlobalWorkerOptions.workerSrc=w;function r(e){return new URL(e,`http://example.com`)}';
  assert.deepEqual(forbiddenHostsIn(pdfjs), []);
  // The excuse is for that library's chunk alone, and for that host alone.
  assert.deepEqual(forbiddenHostsIn('new URL(e, "http://example.com")'), ["example.com"]);
  assert.deepEqual(forbiddenHostsIn(`${pdfjs};fetch("https://ci.invalid")`), ["ci.invalid"]);
});

test("allows MapLibre's protocol-check base only in its library chunk", () => {
  const maplibre = 'exports.setRTLTextPlugin=f;function allowed(value){return new URL(value,"https://maplibre.invalid/").protocol}';
  assert.deepEqual(forbiddenHostsIn(maplibre), []);
  assert.deepEqual(forbiddenHostsIn('const api = "https://maplibre.invalid"'), ["maplibre.invalid"]);
  assert.deepEqual(forbiddenHostsIn(`${maplibre};fetch("https://ci.invalid")`), ["ci.invalid"]);
  assert.deepEqual(forbiddenHostsIn(`${maplibre};fetch("http://localhost:8787")`), ["localhost"]);
  assert.equal(isForbiddenApiHost("maplibre.invalid"), true);
});
