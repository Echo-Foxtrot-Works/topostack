import { mount, tick, unmount } from "svelte";
import { exportBlockReason, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
import ShareArtwork from "$lib/studio/ShareArtwork.svelte";
import { startBrowserDownload } from "$lib/studio/native-export";

const WIDTH = 1200;
const STYLES = ["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "paint-order"];

/** Resolve scoped CSS while attached; no fonts, external assets or browser UI go into the image. */
export function standalonePreviewSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  for (const [index, original] of originals.entries()) {
    const copy = copies[index]!;
    const computed = getComputedStyle(original);
    copy.removeAttribute("class");
    copy.removeAttribute("style");
    copy.removeAttribute("filter");
    for (const property of STYLES) copy.setAttribute(property, computed.getPropertyValue(property));
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "1104");
  clone.setAttribute("height", "560");
  return new XMLSerializer().serializeToString(clone);
}

function lines(context: CanvasRenderingContext2D, value: string, width: number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) { result.push(line); line = word; }
    else line = next;
  }
  if (line) result.push(line);
  return result;
}

async function loadSvg(text: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { image.src = ""; reject(new Error("Preview image took too long to render. Try again.")); }, 10_000);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error("The browser could not render the preview image.")); };
      image.src = url;
    });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

/** Local, top-down software preview of the current generated design. Never a fabrication export. */
export async function prepareSharePreview(geometry: GeometryIRV1, project: ProjectConfigV1): Promise<Blob> {
  const reason = exportBlockReason(geometry, project);
  if (reason) throw new Error(reason);
  const target = document.createElement("div");
  target.style.cssText = "position:fixed;left:-10000px;top:0;width:1104px;height:560px;pointer-events:none";
  target.setAttribute("aria-hidden", "true");
  target.inert = true;
  document.body.append(target);
  let component: ReturnType<typeof mount> | undefined;
  let svg: string;
  try {
    component = mount(ShareArtwork, { target, props: { geometry, project } });
    await tick();
    const artwork = target.querySelector<SVGSVGElement>('svg[role="img"]');
    if (!artwork) throw new Error("Preview artwork is unavailable. Try generating terrain again.");
    svg = standalonePreviewSvg(artwork);
  } finally {
    if (component) await unmount(component);
    target.remove();
  }
  const image = await loadSvg(svg);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create preview images.");
  context.font = "16px sans-serif";
  const credits = lines(context, `Sources: ${geometry.attribution.map((source) => `${source.name} (${source.license})`).join(" · ")}. Full credits: topostack.app/attribution`, WIDTH - 96);
  canvas.width = WIDTH;
  canvas.height = Math.max(900, 880 + credits.length * 22);
  context.fillStyle = "#20241e"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f5f4ec"; context.font = "600 34px sans-serif";
  const title = lines(context, project.name, WIDTH - 96);
  title.slice(0, 2).forEach((line, index) => context.fillText(line, 48, 66 + index * 40));
  context.font = "18px sans-serif"; context.fillStyle = "#c0c5b6";
  context.fillText(`Software preview · ${project.outputMode === "stack" ? "Layered relief, seen from above" : "Flat contour engraving"} · ${geometry.widthMm} × ${geometry.heightMm} mm`, 48, 142);
  context.fillStyle = "#30362b"; context.fillRect(48, 168, WIDTH - 96, 560);
  context.drawImage(image, 48, 168, WIDTH - 96, 560);
  context.fillStyle = "#f5f4ec"; context.font = "600 24px sans-serif";
  context.fillText("Made with TopoStack", 48, 774);
  context.font = "18px sans-serif"; context.fillStyle = "#c0c5b6";
  context.fillText("topostack.app · Free terrain maps for laser cutting and engraving", 48, 803);
  context.font = "16px sans-serif";
  credits.forEach((line, index) => context.fillText(line, 48, 843 + index * 22));
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not save the preview image.")), "image/png"));
}

export async function saveSharePreview(geometry: GeometryIRV1, project: ProjectConfigV1): Promise<void> {
  const blob = await prepareSharePreview(geometry, project);
  const name = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topostack";
  startBrowserDownload({ blob, filename: `${name}-preview.png`, fileCount: 1 });
}
