<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Use a browser agent in the studio" intro="Agents that work inside your browser tab can read and change the design open in the TopoStack studio through WebMCP, generate it, and open the export dialog for you to download the files.">
  <p>This guide covers agents that drive a browser tab, such as Chrome's built-in agent or Claude in Chrome. They work on the design you have open. To ask a chat assistant such as Claude or ChatGPT for a new model instead, see <a href={`${base}/guides/use-with-ai-assistants`}>use TopoStack with AI assistants</a>.</p>

  <h2>What WebMCP is</h2>
  <p><a href="https://webmachinelearning.github.io/webmcp/" rel="noopener noreferrer" target="_blank">WebMCP</a> lets a web page offer tools to an agent that is using the page. The agent does not have to find and click buttons. It calls the studio's own actions, with checked inputs, and reads back a clear result. The studio offers its tools only while it is open in a tab, and only to an agent working in that tab.</p>

  <h2>Turn it on</h2>
  <ul>
    <li>WebMCP is experimental. In Chrome it is available from version 146, behind a flag or an origin trial. Look for WebMCP on <code>chrome://flags</code>, or follow your agent's setup instructions.</li>
    <li>Open the <a href={`${base}/studio`}>studio</a> in the tab your agent controls. The studio registers its tools when it finds the browser's model context. There is nothing to switch on in TopoStack.</li>
    <li>The tools are not offered when the studio is embedded in another site, such as the Atomm platform.</li>
  </ul>

  <h2>The tools</h2>
  <p>Every tool name starts with <code>topostack_</code>, so it cannot be confused with another site's tools.</p>
  <table>
    <thead><tr><th scope="col">Tool</th><th scope="col">What it does</th></tr></thead>
    <tbody>
      <tr><td><code>topostack_get_design</code></td><td>Reads the open design: place, size, layered or flat output, material, exaggeration or contour count, generation state, the studio's status, whether it can be exported, and once generated the sheet count and any airspace in acrylic: its pieces, levels, height and rods. Changes nothing.</td></tr>
      <tr><td><code>topostack_search_places</code></td><td>Searches for a place by name and returns labels, coordinates and a suggested area. Changes nothing.</td></tr>
      <tr><td><code>topostack_set_area</code></td><td>Moves the design to a new area, either a center and ground width in kilometers or a bounding box, as choosing a search result does. The model is rebuilt with the next generate.</td></tr>
      <tr><td><code>topostack_update_design</code></td><td>Changes the size, shape, output, material thickness, vertical exaggeration, contour count, map details, aviation detail, airspace in acrylic, title or laser settings. It takes the same fields and ranges as the <a href={`${base}/guides/agent-api`}>project request</a>, except the area and markers. Anything left out stays as it is.</td></tr>
      <tr><td><code>topostack_generate_preview</code></td><td>Loads terrain and builds the model, as the Generate button does, then reports the sheet count or the error.</td></tr>
      <tr><td><code>topostack_undo</code></td><td>Undoes the last change, as the Undo button does.</td></tr>
      <tr><td><code>topostack_open_export</code></td><td>Opens the Export dialog, and says so if export is blocked.</td></tr>
    </tbody>
  </table>

  <h2>What stays in your hands</h2>
  <ul>
    <li>Every change an agent makes is an ordinary undo step, so Undo in the studio reverses it as it would reverse your own click.</li>
    <li>The agent can open the Export dialog but cannot download files. You choose the files and save them.</li>
    <li>Agents cannot edit markers, fonts, custom graphics, tracks or depth charts. They stay as you set them.</li>
    <li>Invalid values are refused with a message and leave the design unchanged, for example a material thickness outside 0.5–25 mm.</li>
    <li>Place names in search results come from a geocoder. The agent is told to treat them as names, not instructions.</li>
  </ul>

  <h2>A typical session</h2>
  <ol>
    <li>Ask: <em>“Make this a 250 mm circle of Crater Lake in 4 mm plywood and show me the layers.”</em></li>
    <li>The agent searches for the place, sets the area, and updates the shape, size and material thickness.</li>
    <li>It generates the preview and reports the sheet count.</li>
    <li>Check the 3D preview yourself. Adjust anything in the studio, or ask for more changes.</li>
    <li>When you are happy, ask the agent to open the export dialog, then download the files. See <a href={`${base}/guides/export-files`}>export files</a> for what each download contains.</li>
  </ol>
  <p class="note">An agent can pick the wrong place or an impractical size. Check the map area, the layer count and the size before you cut, and cut one layer as a test.</p>

  <h2>For site and agent developers</h2>
  <p>The studio checks for <code>document.modelContext</code>, or the older <code>navigator.modelContext</code>, and calls <code>registerTool</code> once for each tool. The tools are removed when the studio closes. Each tool declares an input schema and read-only or non-destructive hints. Results carry a text summary, and <code>topostack_get_design</code> and <code>topostack_generate_preview</code> also carry structured content.</p>
  <p>An agent that is not in the browser should use the <a href={`${base}/guides/mcp-server`}>remote MCP server</a> instead. It plans models and returns a studio link that opens and generates them.</p>
</Article>

<style>
  /* On a phone each row becomes a block, labelled where the column heading is hidden, as in the settings reference. */
  @media (max-width: 700px) {
    table, tbody, tr, td { display: block; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tr { padding-block: 10px; border-bottom: 1px solid var(--loidolt-border); }
    td { padding: 2px 0; border: 0; }
    td:first-child { font-weight: 600; }
    td:empty { display: none; }
    td code { overflow-wrap: anywhere; }
  }
</style>
