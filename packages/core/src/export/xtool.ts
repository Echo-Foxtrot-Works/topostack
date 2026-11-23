import { readLaserSvg, type ArtworkLayer, type ArtworkNode, type ShapeNode } from "./laser-artwork.js";

const LAYERS: Record<ArtworkLayer, { color: string; name: string }> = {
  "engrave-fill": { color: "#000000", name: "Engrave fill" },
  "engrave": { color: "#2366ff", name: "Engrave lines" },
  "assembly-fill": { color: "#00897b", name: "Assembly ids fill" },
  "assembly": { color: "#00a651", name: "Assembly ids" },
  "score": { color: "#00befe", name: "Score" },
  "cut": { color: "#fe0002", name: "Cut" },
};

/** Studio uses UUID v4 for projects and artwork, including exports from a plain HTTP origin. */
export function createXtoolId(): ReturnType<Crypto["randomUUID"]> {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pathDisplay(shape: ShapeNode, zOrder: number, groupTags: string[]) {
  const { color, name } = LAYERS[shape.layer];
  const isFill = shape.layer.endsWith("-fill");
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { points } of shape.subpaths) {
    for (const point of points) {
      x = Math.min(x, point.x);
      y = Math.min(y, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }
  // Studio applies graphicX/Y to its local path before composing transforms.
  const dPath = shape.subpaths.map(({ points, closed }) => {
    const commands = points.map((point, index) => {
      const localX = Number((point.x - x).toFixed(4));
      const localY = Number((point.y - y).toFixed(4));
      return `${index ? "L" : "M"}${localX} ${localY}`;
    });
    if (closed) commands.push("Z");
    return commands.join("");
  }).join("");
  const rgb = Number.parseInt(color.slice(1), 16);
  return {
    id: createXtoolId(), type: "PATH", name, x, y, width: right - x, height: bottom - y,
    offsetX: x, offsetY: y, graphicX: x, graphicY: y, angle: 0, scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 }, skew: { x: 0, y: 0 }, localSkew: { x: 0, y: 0 },
    lockRatio: true, visible: true, visibleState: true, enableTransform: true, lockState: false,
    zOrder, groupTags, groupTag: groupTags.at(-1), layerTag: color, layerColor: color, originColor: color,
    isFill, isClosePath: shape.subpaths.every(path => path.closed), isCompoundPath: shape.subpaths.length > 1,
    lineColor: rgb, fillColor: color, fillRule: shape.fillRule, alpha: 1, points: [], dPath,
    fill: { paintType: "color", visible: isFill, color: rgb, alpha: 1 },
    stroke: { paintType: "color", visible: !isFill, color: rgb, alpha: 1, width: 1, cap: "butt", join: "miter", miterLimit: 4, alignment: 0.5 },
    effects: [],
  };
}

/** The canvas metadata and editable display records used by Studio's .xs workspace. */
export function svgToXtoolCanvas(title: string, svg: string) {
  const displays: ReturnType<typeof pathDisplay>[] = [];
  const layerData: Record<string, { name: string; order: number; visible: boolean }> = {};
  const groupData: Record<string, { groupName: string; groupTag: string; visible: boolean; enableTransform: boolean; zOrder: number; rotation: number }> = {};
  function add(nodes: ArtworkNode[], groups: string[]) {
    for (const node of nodes) {
      if (node.kind === "group") {
        if (node.piece) {
          const id = `g-${createXtoolId()}`;
          groupData[id] = { groupName: node.name ?? "", groupTag: id, visible: true, enableTransform: true, zOrder: displays.length + 1, rotation: 0 };
          add(node.children, [...groups, id]);
        } else add(node.children, groups);
      } else {
        const display = pathDisplay(node, displays.length + 1, groups);
        displays.push(display);
        layerData[display.layerTag] ??= { name: display.name, order: Object.keys(LAYERS).indexOf(node.layer) + 1, visible: true };
      }
    }
  }
  add(readLaserSvg(svg, "down"), []);
  if (!displays.length) return undefined;
  return { id: createXtoolId(), title, layerData, groupData, displays };
}
