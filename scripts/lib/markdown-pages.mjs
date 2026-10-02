import domino from "@mixmark-io/domino";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";

/**
 * The Markdown twin of a prerendered page, served by the Worker when a client
 * asks for `Accept: text/markdown` (workers/map-api/src/routes/pages.ts).
 *
 * Only the page's `<main>` is converted: navigation, the footer and anything
 * interactive stay behind. Links and images are made absolute against the
 * page's canonical URL so an agent can follow them without the HTML around it.
 */

/** Pages with no reading content of their own: the studio app and the 404 shell. */
const SKIPPED_PAGES = new Set(["404.html", "studio.html"]);

/** Elements that carry no readable text, or only make sense in a browser. */
const DROPPED = "script, style, noscript, template, svg, canvas, iframe, video, audio, button, form, input, select, textarea, nav, dialog, [hidden], [aria-hidden=\"true\"]";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
turndown.use(tables);

/** `guides/agent-api.html` → `guides/agent-api.md`; null for pages that get no twin. */
export function markdownFile(htmlFile) {
  if (!htmlFile.endsWith(".html") || SKIPPED_PAGES.has(htmlFile) || htmlFile.startsWith("mcp-app/")) return null;
  return htmlFile.replace(/\.html$/, ".md");
}

// A JSON string is a valid YAML double-quoted scalar, and escapes anything that
// would otherwise end the front matter.
const yamlString = (value) => JSON.stringify(value.replace(/\s+/g, " ").trim());

/**
 * A table of facts (each row a `<th scope="row">` label and its value) has no
 * header row, so GFM cannot express it and turndown would keep the raw HTML.
 * It reads the same as a list of `**Label:** value` items.
 */
function factsToList(document, table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  const isFacts = rows.length > 0 && rows.every((row) => row.cells.length === 2 && row.cells[0].tagName === "TH" && row.cells[0].getAttribute("scope") === "row");
  if (!isFacts) return;
  const list = document.createElement("ul");
  for (const row of rows) {
    const [label, value] = Array.from(row.cells);
    const item = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${label.textContent.trim()}:`;
    // domino's DOM predates append() and replaceWith().
    item.appendChild(strong);
    item.appendChild(document.createTextNode(" "));
    for (const child of Array.from(value.childNodes)) item.appendChild(child);
    list.appendChild(item);
  }
  table.parentNode.replaceChild(list, table);
}

/** Markdown for one prerendered page, or null when it has no `<main>` (a redirect stub). */
export function pageMarkdown(html) {
  const document = domino.createDocument(html);
  const main = document.querySelector("main");
  if (!main) return null;
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const absolute = (value) => {
    if (!canonical || !value || value.startsWith("#")) return value;
    try { return new URL(value, canonical).toString(); } catch { return value; }
  };
  // The guide pages open with a collapsible guides menu; its summary would be
  // left behind as a stray line once the menu's nav is dropped.
  for (const menu of Array.from(main.querySelectorAll("details"))) if (menu.querySelector("nav")) menu.remove();
  for (const element of Array.from(main.querySelectorAll(DROPPED))) element.remove();
  for (const table of Array.from(main.querySelectorAll("table"))) factsToList(document, table);
  for (const link of Array.from(main.querySelectorAll("a[href]"))) link.setAttribute("href", absolute(link.getAttribute("href")));
  for (const image of Array.from(main.querySelectorAll("img"))) {
    // An image without alternative text is decoration; it says nothing in Markdown.
    if (!image.getAttribute("alt")?.trim()) image.remove();
    else image.setAttribute("src", absolute(image.getAttribute("src")));
  }
  const title = document.querySelector("title")?.textContent ?? "";
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const frontMatter = ["---", `title: ${yamlString(title)}`];
  if (description) frontMatter.push(`description: ${yamlString(description)}`);
  if (canonical) frontMatter.push(`url: ${yamlString(canonical)}`);
  frontMatter.push("---", "");
  const body = turndown.turndown(main).replace(/\n{3,}/g, "\n\n").trim();
  return `${frontMatter.join("\n")}\n${body}\n`;
}
