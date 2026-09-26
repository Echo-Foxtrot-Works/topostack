import { RPC_ERRORS, RpcError } from "./protocol";

/**
 * The in-chat preview, served as an MCP App (`ui://` resource) that hosts such
 * as Claude and ChatGPT render beside the conversation. The page is the
 * generator build's `mcp-app/terrain-preview.html`: it runs the geometry engine
 * in the chat's iframe, so the Worker still generates nothing. The key names
 * follow the MCP Apps extension; the deprecated flat key is sent as well until
 * hosts drop it.
 */
export const PREVIEW_URI = "ui://topostack/terrain-preview.html";
const APP_MIME_TYPE = "text/html;profile=mcp-app";
const ASSET_PATH = "/mcp-app/terrain-preview.html";
const API_ORIGIN_PLACEHOLDER = "%TOPOSTACK_API_ORIGIN%";

/** Tool metadata that opens the preview beside the tool's result. */
export const PREVIEW_TOOL_META = { ui: { resourceUri: PREVIEW_URI }, "ui/resourceUri": PREVIEW_URI };

/** The preview may fetch terrain, archives and lake outlines from the map API, and nothing else. */
function previewResourceMeta(apiOrigin: string) {
  return { ui: { csp: { connectDomains: [apiOrigin], resourceDomains: [] }, prefersBorder: true } };
}

export function previewListing(apiOrigin: string) {
  return {
    uri: PREVIEW_URI,
    name: "terrain-preview",
    title: "TopoStack model preview",
    description: "Interactive preview of a planned model, generated in the chat from real terrain.",
    mimeType: APP_MIME_TYPE,
    _meta: previewResourceMeta(apiOrigin),
  };
}

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function readPreview(assets: Fetcher | undefined, apiOrigin: string) {
  const response = assets ? await assets.fetch(new Request(new URL(ASSET_PATH, "https://assets.invalid"))) : undefined;
  if (!response?.ok) {
    await response?.body?.cancel();
    throw new RpcError(RPC_ERRORS.internal, "The preview is not built on this server. Run the generator build to include it.");
  }
  const html = await response.text();
  if (!html.includes(API_ORIGIN_PLACEHOLDER)) throw new RpcError(RPC_ERRORS.internal, "The preview page is missing its map address placeholder.");
  return { contents: [{ uri: PREVIEW_URI, mimeType: APP_MIME_TYPE, text: html.replaceAll(API_ORIGIN_PLACEHOLDER, escapeAttribute(apiOrigin)), _meta: previewResourceMeta(apiOrigin) }] };
}
