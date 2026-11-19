/** Test helpers that read the part-grouped SVG exports (Atomm's SVG export grouping spec). */

export type OperationName = "CUT" | "SCORE" | "ENGRAVE" | "ASSEMBLY";

/** The element starting at `start` (an opening `<g`) through its matching `</g>`. */
function groupAt(svg: string, start: number): string {
  const tags = /<g\b[^>]*?(\/?)>|<\/g>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(svg); match; match = tags.exec(svg)) {
    if (match[0] === "</g>") depth -= 1;
    else if (!match[1]) depth += 1;
    if (depth === 0) return svg.slice(start, tags.lastIndex);
  }
  throw new Error("Unbalanced <g> in SVG");
}

/** The root-level children of the document, title and desc left out. */
export function rootGroups(svg: string): string[] {
  const open = svg.indexOf(">", svg.indexOf("<svg")) + 1;
  const close = svg.lastIndexOf("</svg>");
  const body = svg.slice(open, close).replace(/<title>[\s\S]*?<\/title>|<desc>[\s\S]*?<\/desc>/g, "");
  const groups: string[] = [];
  let index = 0;
  while (index < body.length) {
    const next = body.indexOf("<", index);
    if (next === -1) break;
    if (!body.startsWith("<g", next)) throw new Error(`Root-level element that is not a part group: ${body.slice(next, next + 60)}`);
    const group = groupAt(body, next);
    groups.push(group);
    index = next + group.length;
  }
  return groups;
}

/** Every operation container for `operation`, across all parts, whole (`<g …>…</g>`). */
export function operationGroups(svg: string, operation: OperationName): string[] {
  const opening = operation === "ASSEMBLY"
    ? /<g id="[^"]*-ASSEMBLY"[^>]*data-operation="ENGRAVE"/g
    : new RegExp(`<g id="[^"]*-${operation}" data-operation="${operation}"`, "g");
  return [...svg.matchAll(opening)].map((match) => groupAt(svg, match.index));
}

/** All of an operation's content in one string, for counting paths or reading coordinates. */
export function operationBody(svg: string, operation: OperationName): string {
  return operationGroups(svg, operation).join("");
}

/** True when the operation has a container anywhere in the document. */
export function hasOperation(svg: string, operation: OperationName): boolean {
  return operationGroups(svg, operation).length > 0;
}
