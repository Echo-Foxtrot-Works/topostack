import { generateGeometry } from "@topostack/core";
import { configureApiBase } from "$lib/domain/api-base";
import { loadTerrain } from "$lib/domain/data-provider";
import { HostBridge, type HostContext } from "./host";
import { previewConfig, previewInput, type PreviewInput } from "./preview";
import { renderContours, renderStack } from "./render";

/**
 * The in-chat preview. A chat host frames this page when the `preview_model`
 * tool runs; the page loads the terrain from TopoStack's map API, generates the
 * model with the same engine as the studio, and draws it. Nothing leaves the
 * browser except the tile requests. Untrusted text is set with textContent.
 */
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = element("title");
const place = element("place");
const figure = element("figure");
const stats = element("stats");
const status = element("status");
const open = element<HTMLButtonElement>("open");
const link = element<HTMLAnchorElement>("link");
const attribution = element("attribution");

const apiOrigin = document.querySelector<HTMLMetaElement>('meta[name="topostack-api-origin"]')?.content ?? "";
const bridge = new HostBridge(window.parent, window);
let current: PreviewInput | undefined;
/** The preview being built; a newer result or a cancelled call aborts it. */
let running: AbortController | undefined;

function applyTheme(context: HostContext | undefined): void {
  if (context?.theme === "light" || context?.theme === "dark") document.documentElement.dataset.theme = context.theme;
}

function setStatus(text: string, failed = false): void {
  status.textContent = text;
  status.dataset.state = failed ? "error" : "info";
}

function stat(label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  stats.append(term, detail);
}

function showDesign(input: PreviewInput): void {
  const { project } = input;
  title.textContent = project.name;
  place.textContent = project.location.label;
  stats.replaceChildren();
  stat("Output", project.outputMode === "engraving" ? "Flat engraving" : "Layered stack");
  stat("Size", `${project.widthMm} × ${project.heightMm} mm${project.cropShape === "circle" ? ", circle" : ""}`);
  if (project.outputMode !== "engraving") stat("Material", `${project.materialThicknessMm} mm sheets`);
  if (input.estimatedSheets !== undefined && project.outputMode !== "engraving") stat("Planned", `about ${input.estimatedSheets} sheets`);
  attribution.textContent = input.attribution ?? "Terrain: Mapzen Terrain Tiles · Map data © OpenStreetMap contributors";
  link.href = input.studioUrl;
  link.textContent = input.studioUrl;
  open.disabled = false;
  reportSize();
}

async function generate(input: PreviewInput, signal: AbortSignal): Promise<void> {
  const config = previewConfig(input.project);
  figure.replaceChildren();
  setStatus("Loading terrain…");
  const terrain = await loadTerrain(config, signal);
  if (signal.aborted) return;
  if (terrain.fallback) throw new Error("Terrain could not be loaded for this area. Open it in TopoStack to try again.");
  setStatus("Generating the model…");
  // Let the status paint before the synchronous generation starts.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const ir = generateGeometry(config, terrain.source);
  if (signal.aborted) return;
  // The markup holds numbers and fixed colors only.
  figure.innerHTML = config.outputMode === "engraving" ? renderContours(ir, { indexInterval: config.engravingIndexInterval }) : renderStack(ir);
  if (config.outputMode !== "engraving") stat("Generated", `${ir.layers.length} sheets, ${Math.round(ir.layers.length * config.materialThicknessMm)} mm tall`);
  setStatus("Roads, labels and other details are added in TopoStack, where the files are exported.");
  reportSize();
}

async function showResult(result: unknown): Promise<void> {
  running?.abort();
  const mine = new AbortController();
  running = mine;
  try {
    current = previewInput(result);
    showDesign(current);
    await generate(current, mine.signal);
  } catch (error) {
    // A superseded or cancelled run keeps quiet; the newer state already shows.
    if (mine.signal.aborted) return;
    setStatus(error instanceof Error ? error.message : "The preview failed.", true);
    reportSize();
  }
}

function reportSize(): void {
  bridge.reportSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight);
}

open.addEventListener("click", () => {
  if (!current) return;
  // The host opens links; a sandboxed frame cannot navigate the chat. When the
  // host refuses, the address stays visible to copy.
  bridge.openLink(current.studioUrl).catch(() => { link.hidden = false; reportSize(); });
});

bridge.on("ui/notifications/tool-result", (params) => void showResult(params));
bridge.on("ui/notifications/host-context-changed", (params) => applyTheme(params as HostContext));
bridge.on("ui/notifications/tool-cancelled", () => { running?.abort(); setStatus("The request was cancelled.", true); });

try {
  configureApiBase(apiOrigin);
} catch {
  setStatus("This preview was served without its map address.", true);
}
new ResizeObserver(reportSize).observe(document.body);
bridge.connect({ name: "topostack-preview", version: "1" }).then(applyTheme).catch(() => setStatus("Waiting for the chat to connect…"));
