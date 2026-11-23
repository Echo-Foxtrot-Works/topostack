import { boundsOverlap, type Bounds2D } from "./geometry2d.js";

interface Branch<T> extends Bounds2D { children?: Branch<T>[]; items?: T[] }

export function boundsOf(items: Bounds2D[]): Bounds2D {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) {
    box.minX = Math.min(box.minX, item.minX); box.maxX = Math.max(box.maxX, item.maxX);
    box.minY = Math.min(box.minY, item.minY); box.maxY = Math.max(box.maxY, item.maxY);
  }
  return box;
}

/** Bulk-load a read-only bounding-box tree. Queries stop on the first matching item. */
export function spatialIndex<T extends Bounds2D>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.minX - b.minX);
  const sliceSize = 16 * Math.ceil(Math.sqrt(sorted.length / 16));
  let level: Branch<T>[] = [];
  for (let i = 0; i < sorted.length; i += sliceSize) {
    const slice = sorted.slice(i, i + sliceSize).sort((a, b) => a.minY - b.minY);
    for (let j = 0; j < slice.length; j += 16) {
      const leaf = slice.slice(j, j + 16);
      level.push({ ...boundsOf(leaf), items: leaf });
    }
  }
  while (level.length > 16) {
    const parents: Branch<T>[] = [];
    for (let i = 0; i < level.length; i += 16) {
      const children = level.slice(i, i + 16);
      parents.push({ ...boundsOf(children), children });
    }
    level = parents;
  }
  const root = { ...boundsOf(level), children: level };
  function nearby(node: Branch<T>, box: Bounds2D, visit: (item: T) => boolean): boolean {
    if (!boundsOverlap(node, box)) return false;
    return node.items ? node.items.some(item => boundsOverlap(item, box) && visit(item)) : node.children!.some(child => nearby(child, box, visit));
  }
  return (box: Bounds2D, visit: (item: T) => boolean): boolean => nearby(root, box, visit);
}
