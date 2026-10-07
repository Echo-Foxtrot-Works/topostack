// The browser's WebMCP model context: on `document` now, on `navigator` in
// earlier drafts. See src/lib/studio/webmcp.ts.
interface Document {
  modelContext?: import("$lib/studio/webmcp").ModelContextLike;
}

interface Navigator {
  modelContext?: import("$lib/studio/webmcp").ModelContextLike;
}
