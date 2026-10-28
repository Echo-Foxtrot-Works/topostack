<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  const base = basePath();

  const endpoint = "https://topostack.app/mcp";
  const vscode = JSON.stringify({ servers: { topostack: { type: "http", url: endpoint } } }, null, 2);
  const cursor = JSON.stringify({ mcpServers: { topostack: { url: endpoint } } }, null, 2);
  const request = JSON.stringify({ requestVersion: 1, area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 20 }, placeLabel: "Mount Rainier", materialThicknessMm: 3 });
</script>

<Article title="Use TopoStack with AI assistants" intro="Ask Claude, ChatGPT or another assistant for a topographic model in plain words. It finds the place, checks how many sheets the model needs, shows you a preview, and hands you a studio link that opens and builds the model. You still review it and export the files yourself.">
  <figure>
    <img src={`${base}/images/guides/ai-assistant-preview.webp`} width="1360" height="1500" loading="lazy" decoding="async" alt="An in-chat TopoStack preview of Mount Rainier: 36 stacked sheets drawn in greens and browns, with the size, material, planned and generated sheet counts, an Open in TopoStack button and the data credits." />
    <figcaption>A plan for a 300 × 200 mm Mount Rainier in 3 mm sheets, previewed in the chat: about 35 sheets planned, 36 generated from real terrain.</figcaption>
  </figure>

  <h2>What an assistant can do</h2>
  <p>TopoStack publishes a Model Context Protocol (MCP) server at <code>{endpoint}</code>. Once your assistant is connected, you can ask for things like <em>“a 300 × 200 mm layered map of Mount Rainier in 3 mm plywood”</em> or <em>“a flat engraving of Lake Tahoe that fits a 400 mm bed”</em>. The assistant can:</p>
  <ul>
    <li>search for a place and suggest how much ground to show;</li>
    <li>check which high-resolution terrain and lake surveys cover it;</li>
    <li>plan the model: sheet count, stack height, scale and elevation range for layered output, or the contour interval for a flat engraving;</li>
    <li>show a preview of the model in the conversation, built from real terrain in your browser, where your assistant supports interactive apps;</li>
    <li>give you a studio link. Opening it loads the design and generates it straight away.</li>
  </ul>
  <p>Planning uses a coarse sample of the terrain, so the sheet count is an estimate. The count the studio shows after generating is the one you cut; they usually agree within a sheet or two, and lake depth can add sheets below the shoreline.</p>

  <h2>Connect your assistant</h2>
  <p>No account or key is needed. Menu names change between app versions; look for <em>connectors</em>, <em>integrations</em> or <em>MCP servers</em>.</p>
  <ul>
    <li><em>Claude</em> (claude.ai and the desktop app): add a custom connector with the URL <code>{endpoint}</code>.</li>
    <li><em>ChatGPT</em>: add a connector or app for a remote MCP server with the same URL, where your plan allows custom connectors.</li>
    <li><em>Claude Code</em>: run <code>claude mcp add --transport http topostack {endpoint}</code>.</li>
    <li><em>VS Code</em>: add the server to <code>.vscode/mcp.json</code>:</li>
  </ul>
  <pre><code>{vscode}</code></pre>
  <ul>
    <li><em>Cursor</em> and other clients that read an <code>mcpServers</code> file:</li>
  </ul>
  <pre><code>{cursor}</code></pre>

  <h2>From the link to your laser</h2>
  <ol>
    <li>Open the studio link the assistant gives you. The design replaces the one you had open, and Undo brings yours back.</li>
    <li>Wait for the terrain to generate, then check the 3D preview and the layer count.</li>
    <li>Adjust anything you like: roads, labels, markers, fonts and custom graphics are all in the studio.</li>
    <li>Choose <strong>Export</strong> for the SVG files. See <a href={`${base}/guides/export-files`}>export files</a> for what each download contains.</li>
  </ol>
  <p class="note">Assistants can misread a place name or pick an area that is too small or too large. Check the map area and size in the studio before you cut, and cut one layer as a test.</p>

  <h2>Browser agents in the studio</h2>
  <p>Agents that drive a browser tab, such as Chrome's built-in agent or Claude in Chrome, can use the studio directly where the browser supports WebMCP. The studio then offers tools to read the design, search for a place, change the size, output, material and details, generate, undo, and open the export dialog. Every change is an ordinary undo step, and the agent can open the export dialog but never downloads files for you. In Chrome, WebMCP is currently experimental and has to be switched on. See <a href={`${base}/guides/browser-agents`}>use a browser agent in the studio</a> for the tools and how to try them.</p>

  <h2>For developers</h2>
  <p>The same operations are available over HTTP, described by the OpenAPI document at <code>https://topostack.app/v1/openapi.json</code>. For example, to plan a model:</p>
  <pre><code>curl -X POST https://topostack.app/v1/projects/plan -H 'content-type: application/json' -d '{request}'</code></pre>
  <p>Requests are anonymous and rate limited. Nothing is generated or stored on a server: the response's studio link carries the whole design, and files are made in the browser.</p>
  <p>The <a href={`${base}/guides/mcp-server`}>MCP server reference</a> lists every tool, resource and prompt, the error codes and the rate limits. The <a href={`${base}/guides/agent-api`}>project request and HTTP API reference</a> describes each request field, studio links and the HTTP routes.</p>

  <h2>Data and credit</h2>
  <p>Every response includes attribution for the terrain, map and lake data it used, and anything you share from it should keep that credit. The full list of sources and licenses is on the <a href={`${base}/attribution`}>attribution page</a>. Your conversations stay with your assistant; TopoStack receives only the requests the assistant sends, as described in the <a href={`${base}/privacy`}>privacy notice</a>.</p>
</Article>
