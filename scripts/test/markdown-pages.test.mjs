import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownFile, pageMarkdown } from "../lib/markdown-pages.mjs";

const page = (main) => `<!doctype html><html><head>
<title>Lake Depth Map | TopoStack</title>
<meta name="description" content="A lake: with &quot;quotes&quot;.">
<link rel="canonical" href="https://topostack.app/guides/lake">
<script>app()</script>
</head><body><nav><a href="./">Home</a></nav>${main}<footer>Footer links</footer></body></html>`;

test("only reading pages get a Markdown twin", () => {
  assert.equal(markdownFile("index.html"), "index.md");
  assert.equal(markdownFile("guides/agent-api.html"), "guides/agent-api.md");
  for (const file of ["studio.html", "404.html", "mcp-app/terrain-preview.html", "robots.txt"]) assert.equal(markdownFile(file), null);
});

test("converts the main content with front matter and absolute links", () => {
  const markdown = pageMarkdown(page(`<main>
    <details><summary>Browse guides</summary><nav><a href="../guides">All guides</a></nav></details>
    <h1>Lake depth</h1>
    <p>Read <a href="../guides/export-files">the export guide</a> or <a href="#steps">jump</a>.</p>
    <img src="../images/lake.png" alt="A lake"><img src="../images/divider.png" alt="">
    <button>Copy</button><svg><text>icon</text></svg>
    <table><tbody><tr><th scope="row">Location</th><td>Mahnomen County</td></tr><tr><th scope="row">Source</th><td><a href="https://example.org/">DNR</a></td></tr></tbody></table>
    <table><thead><tr><th>Size</th><th>Scale</th></tr></thead><tbody><tr><td>305 mm</td><td>1:8,400</td></tr></tbody></table>
  </main>`));
  assert.match(markdown, /^---\ntitle: "Lake Depth Map \| TopoStack"\ndescription: "A lake: with \\"quotes\\"."\nurl: "https:\/\/topostack.app\/guides\/lake"\n---\n\n# Lake depth\n/);
  assert.ok(markdown.includes("[the export guide](https://topostack.app/guides/export-files)"));
  assert.ok(markdown.includes("[jump](#steps)"));
  assert.ok(markdown.includes("![A lake](https://topostack.app/images/lake.png)"));
  assert.ok(markdown.includes("**Location:** Mahnomen County"));
  assert.ok(markdown.includes("**Source:** [DNR](https://example.org/)"));
  assert.match(markdown, /\| Size \| Scale \|\n\| --- \| --- \|\n\| 305 mm \| 1:8,400 \|/);
  for (const absent of ["Browse guides", "Footer links", "Home", "Copy", "icon", "divider", "app()", "<table"]) assert.ok(!markdown.includes(absent), absent);
});

test("pages without a main element, such as redirect stubs, get none", () => {
  assert.equal(pageMarkdown("<html><head><meta http-equiv=\"refresh\" content=\"0;url=/\"></head></html>"), null);
});
