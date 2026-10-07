<script lang="ts">
  import { Button, Checkbox, Field, Input, Select } from "@loidolt/theme-svelte";
  import type { Snippet } from "svelte";
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { draft } from "./chart-draft.svelte";
  import { exportReviewDraft, generateReviewedDepths, generationIssues, resultIsCurrent, reviewSourceKey, session, unitLabel } from "./chart-tracing.svelte";
  import { joinReviewContours, reviewAlignment, reviewGeometryIssues, type ChartReview, type ReviewContour } from "$lib/domain/chart-review";
  import type { Point2 } from "@topostack/chart-trace/local-frame";

  let { previews }: { previews: Snippet } = $props();
  let previewing = $state(false);
  let section = $state<"contours" | "alignment" | "checks">("contours");
  let lastResult: typeof draft.result;
  $effect(() => {
    if (draft.result && resultIsCurrent() && draft.result !== lastResult) {
      lastResult = draft.result; previewing = true; drawing = undefined; aligning = false;
    } else if (!resultIsCurrent()) previewing = false;
  });
  let selected = $state("");
  let joining = $state(false);
  let joinHover = $state("");
  let joinNote = $state("");
  let drawing = $state<Point2[] | undefined>();
  let drawTarget = $state("");
  let aligning = $state(false);
  let cursor = $state<Point2>([0, 0]);
  let vertex = $state(0);
  let error = $state("");
  let history = $state<string[]>([]);
  let future = $state<string[]>([]);
  let svg = $state<SVGSVGElement>();
  let toolsBody = $state<HTMLDivElement>();
  const current = $derived(draft.review?.contours.find(c => c.id === selected));
  const issues = $derived(generationIssues());
  const pathIssues = $derived(draft.review && draft.image ? reviewGeometryIssues(draft.review, { image: draft.image, units: draft.units, labels: draft.reads, surface: Number(draft.surface), interval: Number(draft.interval) }).filter(issue => issue.contourIds.length) : []);
  const stale = $derived(draft.reviewSourceKey !== reviewSourceKey());
  const locked = $derived(session.busy || session.keeping || stale || previewing);
  const joinPreview = $derived.by(() => {
    if (!joining || !current || !joinHover) return undefined;
    const target = draft.review?.contours.find(c => c.id === joinHover && !c.excluded);
    if (!target) return undefined;
    try {
      const joined = joinReviewContours(current, target);
      return { target: target.id, connection: [joined.points[current.points.length - 1]!, joined.points[current.points.length]!] };
    } catch (cause) {
      return { target: target.id, error: cause instanceof Error ? cause.message : "These paths cannot be joined." };
    }
  });
  $effect(() => { if (locked) cancelJoin(); });
  function cancelJoin(): void { joining = false; joinHover = ""; }
  function startJoin(): void {
    if (locked || !current || current.closed || current.excluded) return;
    joining = true; joinHover = ""; joinNote = ""; error = "";
    drawing = undefined; aligning = false;
  }
  const alignment = $derived.by(() => {
    if (!draft.review || !draft.lake) return undefined;
    try { return reviewAlignment(draft.review, draft.lake.outline); } catch { return undefined; }
  });
  // The chart image as a data URL for the review's <image>, redrawn when its pixels change.
  const source = $derived.by(() => {
    if (!draft.pixels) return "";
    const canvas = document.createElement("canvas");
    canvas.width = draft.pixels.width; canvas.height = draft.pixels.height;
    canvas.getContext("2d")?.putImageData(draft.pixels, 0, 0);
    return canvas.toDataURL();
  });

  const clone = (): ChartReview => JSON.parse(JSON.stringify(draft.review));
  function edit(action: (review: ChartReview) => void): void {
    if (!draft.review || locked) return;
    const next = clone();
    try { action(next); } catch (cause) { error = cause instanceof Error ? cause.message : "Edit failed."; return; }
    cancelJoin(); joinNote = "";
    history = [...history.slice(-39), JSON.stringify(draft.review)]; future = [];
    next.alignmentConfirmed = false;
    draft.review = next; draft.layersReviewedKey = ""; error = "";
  }
  function update(action: (contour: ReviewContour) => void): void { edit(r => { const c = r.contours.find(c => c.id === selected); if (c) action(c); }); }
  function undo(redo = false): void {
    const from = redo ? future : history;
    if (!from.length || locked) return;
    cancelJoin(); joinNote = "";
    const before = JSON.stringify(draft.review);
    draft.review = JSON.parse(from.at(-1)!); draft.layersReviewedKey = "";
    if (redo) { future = future.slice(0, -1); history = [...history, before]; }
    else { history = history.slice(0, -1); future = [...future, before]; }
  }
  function path(points: Point2[], closed: boolean): string { return points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + (closed ? " Z" : ""); }
  function position(event: MouseEvent): Point2 | undefined {
    const point = svg!.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svg!.getScreenCTM()!.inverse());
    if (local.x < 0 || local.y < 0 || local.x > draft.image!.width || local.y > draft.image!.height) return undefined;
    return [local.x, local.y];
  }
  function addPoint(point: Point2): void {
    cursor = point;
    if (locked) return;
    if (drawing) drawing = [...drawing, point];
    else if (aligning) {
      edit(r => r.controlPoints.push({ x: point[0], y: point[1], lon: Number.NaN, lat: Number.NaN }));
      aligning = false;
    }
  }
  function selectContour(event: MouseEvent | KeyboardEvent, id: string): void {
    if (drawing || aligning || previewing) return;
    event.stopPropagation();
    if (joining) {
      if (locked) return;
      const sourceId = selected;
      edit(r => {
        const a = r.contours.find(c => c.id === sourceId)!;
        const b = r.contours.find(c => c.id === id && !c.excluded)!;
        const joined = joinReviewContours(a, b);
        if (b.id === r.shorelineId) r.shorelineId = a.id;
        r.contours = r.contours.map(c => c.id === a.id ? joined : c.id === b.id ? { ...c, excluded: true, confirmed: false } : c);
      });
      if (!joining) { vertex = 0; joinNote = "Paths joined. Check the connection against the source, then confirm the path. Undo edit restores both paths."; }
      return;
    }
    joinNote = ""; section = "contours"; selected = id; vertex = 0;
    toolsBody?.scrollTo({ top: 0 });
  }
  async function saveDraft(): Promise<void> {
    const file = exportReviewDraft();
    if (!file) return;
    const { startBrowserDownload } = await import("$lib/studio/native-export");
    startBrowserDownload({ filename: "contour-review.json", blob: new Blob([JSON.stringify(file)], { type: "application/json" }), fileCount: 1 });
  }
  function finishDrawing(): void {
    if (!drawing || drawing.length < 3) return;
    const points = drawing;
    edit(r => {
      const c = r.contours.find(c => c.id === drawTarget);
      if (c) { c.points = points; c.closed = true; c.confirmed = false; }
      else { const id = `manual-${crypto.randomUUID()}`; r.contours.push({ id, points, closed: true, value: null, confirmed: false, excluded: false }); selected = id; }
    });
    drawing = undefined; drawTarget = "";
  }
  function key(event: KeyboardEvent): void {
    if (event.key === "Escape") { drawing = undefined; aligning = false; return; }
    if (event.key === "Enter") { event.preventDefault(); addPoint(cursor); return; }
    const steps: Record<string, Point2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = steps[event.key];
    if (delta) { event.preventDefault(); cursor = [Math.max(0, Math.min(draft.image!.width, cursor[0] + delta[0] * (event.shiftKey ? 10 : 1))), Math.max(0, Math.min(draft.image!.height, cursor[1] + delta[1] * (event.shiftKey ? 10 : 1)))]; }
  }
</script>

<svelte:window onkeydown={event => { if (event.key === "Escape" && joining) { event.preventDefault(); cancelJoin(); error = ""; } }} />

{#if draft.review && draft.image}
<div class="review-editor" class:review-previewing={previewing} aria-label="Review and correct contours">
  <section class="chart-editor review-chart" aria-label="Chart editor">
    <header class="review-chart-heading"><h3>{previewing ? "Reviewed source chart" : "5 · Review and correct contours"}</h3><p>{previewing ? "Compare the generated basin with the source." : "Select a path on the chart, then correct it in the tools panel."}</p></header>
  <div class="review-source">
    <SvgViewport widthMm={draft.image.width} heightMm={draft.image.height} topLeft padding={0} editable bind:svg label="chart contour" svgLabel="Source with reviewed contour overlay" controlsLabel="Chart review zoom controls" resetLabel="Reset chart review view" onactivate={event => { const point = position(event); if (point) addPoint(point); }} onkeydown={event => { if (drawing || aligning) key(event); }}>
      <image href={source} width={draft.image.width} height={draft.image.height} />
      {#each draft.review.contours as c (c.id)}
        {#if !c.excluded}
          <path d={path(c.points, c.closed)} fill="none" data-join-target={joining && c.id === joinHover ? (joinPreview?.error ? "invalid" : "valid") : undefined} stroke={joining && c.id === joinHover && c.id !== selected ? (joinPreview?.error ? "#dc2626" : "#0891b2") : c.id === selected ? "#a21caf" : c.id === draft.review.shorelineId || c.role === "island" ? "#0284c7" : c.confirmed ? "#15803d" : "#d97706"} stroke-width={c.id === selected || (joining && c.id === joinHover) ? 4 : 2} opacity={joining && c.id !== selected && c.closed ? 0.35 : 1} vector-effect="non-scaling-stroke" pointer-events="none" />
          <path d={path(c.points, c.closed)} fill="none" stroke="transparent" stroke-width="10" vector-effect="non-scaling-stroke" role="button" tabindex={previewing ? -1 : 0} aria-label={`${c.id}, ${c.value ?? "unassigned"}, ${c.confirmed ? "confirmed" : "needs review"}`} onpointerenter={() => { if (joining) { joinHover = c.id; error = ""; } }} onpointerleave={() => { if (joinHover === c.id) joinHover = ""; }} onfocus={() => { if (joining) { joinHover = c.id; error = ""; } }} onblur={() => { if (joinHover === c.id) joinHover = ""; }} onclick={event => selectContour(event, c.id)} onkeydown={event => { if (drawing || aligning) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectContour(event, c.id); } }} />
        {/if}
      {/each}
      {#if joinPreview?.connection}<path d={path(joinPreview.connection, false)} fill="none" stroke="#0891b2" stroke-dasharray="6 4" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none" aria-label="Proposed endpoint connection" />{/if}
      {#if alignment}<path d={path(alignment.outlinePixels, true)} fill="none" stroke="#db2777" stroke-dasharray="8 5" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />{/if}
      {#if drawing}<path d={path(drawing, false)} fill="none" stroke="#a21caf" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none" />{/if}
      {#each draft.review.controlPoints as point, index}
        <circle cx={point.x} cy={point.y} r="5" fill="#db2777" /><text x={point.x + 8} y={point.y} fill="#db2777" font-size="20">{index + 1}</text>
      {/each}
      {#if drawing || aligning}<path d={`M${cursor[0]-8},${cursor[1]}h16 M${cursor[0]},${cursor[1]-8}v16`} stroke="#1d4ed8" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />{/if}
    </SvgViewport>
  </div>
    <footer class="review-chart-legend">
      {#if joining}<p role="status">Pick the next open path to join to the purple path. Cyan previews the target and connection; faded paths are closed. Click or tap to join, or focus a path and press Enter. Escape cancels.</p>{/if}
      <p>Scroll or pinch to zoom · drag to pan · + / − to zoom · 0 to reset.</p><p>Blue: shoreline / islands · amber: needs review · green: confirmed · purple: selected · dashed pink: aligned map outline.</p></footer>
  </section>
  {#if previewing}
    <section class="review-preview" aria-label="Generated depth review">
      <header class="review-preview-heading"><h3>Review generated depths</h3><Button size="sm" onclick={() => { previewing = false; }}>Edit contours</Button></header>
      {@render previews()}
    </section>
  {:else}
    <section class="review-tools" aria-label="Contour editing tools">
      <header class="review-tools-heading"><h3>Contour editing tools</h3><p>Correct paths, align the source, then generate depths.</p></header>
  <div class="review-toolbar">
    <Button size="sm" disabled={locked} onclick={() => void saveDraft()}>Export review draft</Button>
    <Button size="sm" disabled={locked || !history.length} onclick={() => undo()}>Undo edit</Button>
    <Button size="sm" disabled={locked || !future.length} onclick={() => undo(true)}>Redo edit</Button>
    <Button size="sm" disabled={locked} onclick={() => { cancelJoin(); drawing = []; drawTarget = ""; aligning = false; section = "contours"; }}>Draw new contour</Button>
  </div>
  {#if drawing}
    <p role="status">Click vertices along the source line; finish to close it. Keyboard: arrows move the crosshair; Enter adds a vertex; Escape cancels.</p>
    <Button size="sm" disabled={drawing.length < 3 || locked} onclick={finishDrawing}>Finish closed path</Button>
    <Button size="sm" onclick={() => { drawing = drawing?.slice(0, -1); }}>Undo drawn vertex</Button>
    <Button size="sm" onclick={() => { drawing = undefined; }}>Cancel drawing</Button>
  {/if}
  {#if aligning}<p role="status">Click a known coordinate on the source, then enter its longitude and latitude below. Arrow keys and Enter also place a point.</p>{/if}
      <div class="review-sections" role="group" aria-label="Contour tool sections">
        <Button size="sm" variant={section === "contours" ? "primary" : "quiet"} aria-pressed={section === "contours"} onclick={() => { cancelJoin(); section = "contours"; }}>Contours</Button>
        <Button size="sm" variant={section === "alignment" ? "primary" : "quiet"} aria-pressed={section === "alignment"} onclick={() => { cancelJoin(); section = "alignment"; }}>Alignment</Button>
        <Button size="sm" variant={section === "checks" ? "primary" : "quiet"} aria-pressed={section === "checks"} onclick={() => { cancelJoin(); section = "checks"; }}>Checks ({issues.length})</Button>
      </div>
      {#if joining}
        <div class="review-join-status">
          <p role="status">{joinPreview?.error || error || "Select the next open path on the chart. The purple source stays selected."}</p>
          <Button size="sm" onclick={() => { cancelJoin(); error = ""; }}>Cancel joining</Button>
        </div>
      {:else if joinNote}<p class="review-join-status" role="status">{joinNote}</p>{/if}
      <div class="review-tools-body" bind:this={toolsBody}>
        {#if stale}<p role="alert">Chart settings changed. Prepare contours again; these edits belong to the previous settings.</p>{/if}
        {#if section === "contours"}
  <Field label="Contour">{#snippet children({ id })}<Select {id} boxed disabled={joining} label="Select review contour" value={selected} onchange={event => { selected = event.currentTarget.value; vertex = 0; }} placeholder="Choose a path" options={draft.review!.contours.map(c => ({value:c.id,label:`${c.id} · ${c.id === draft.review!.shorelineId ? "shoreline" : c.role === "island" ? "island" : c.value ?? "unassigned"} · ${c.excluded ? "excluded" : c.confirmed ? "confirmed" : "review"}`}))} />{/snippet}</Field>
  {#if current}
    <fieldset disabled={locked || joining}>
      <legend>Selected path</legend>
      <Field label="Path type">{#snippet children({ id })}<Select {id} boxed label="Path type" value={current.id === draft.review!.shorelineId ? "shoreline" : current.role ?? "contour"} onchange={event => edit(r => {
        const c = r.contours.find(c => c.id === selected)!;
        if (event.currentTarget.value === "shoreline") { r.shorelineId = c.id; c.role = "contour"; }
        else { if (r.shorelineId === c.id) r.shorelineId = ""; c.role = event.currentTarget.value as "contour" | "island"; }
        delete c.interiorValue; c.confirmed = false; c.excluded = false;
      })} options={[{value:"contour",label:"Depth contour"},{value:"shoreline",label:"Outer shoreline"},{value:"island",label:"Island boundary (land)"}]} />{/snippet}</Field>
      {#if current.id !== draft.review.shorelineId && current.role !== "island"}
      <Field label={`Printed value (${unitLabel(draft.units)})`}>{#snippet children({ id })}<Input {id} boxed aria-label="Contour printed value" type="number" step="any" value={current.value === null ? "" : String(current.value)} oninput={event => update(c => { c.value = event.currentTarget.value === "" ? null : Number(event.currentTarget.value); c.confirmed = false; })} />{/snippet}</Field>
      <Field label="Inside this contour">{#snippet children({ id })}<Select {id} boxed label="Contour interior" value={current.inside ?? "deeper"} onchange={event => update(c => { c.inside = event.currentTarget.value as "deeper" | "shallower"; delete c.interiorValue; c.confirmed = false; })} options={[{value:"deeper",label:"Deeper — basin"},{value:"shallower",label:"Shallower — underwater rise"}]} />{/snippet}</Field>
      <details><summary>Interior beyond the last contour</summary><p>By default, hold this contour's value. For an innermost contour, optionally enter a known or deliberately modelled basin bottom or rise summit. The chart does not establish its exact position.</p>
        <Field label={`Interior value (${unitLabel(draft.units)})`}>{#snippet children({ id })}<Input {id} boxed aria-label="Contour interior value" type="number" step="any" placeholder="Hold contour value" value={current.interiorValue === undefined ? "" : String(current.interiorValue)} oninput={event => update(c => { if (event.currentTarget.value === "") delete c.interiorValue; else c.interiorValue = Number(event.currentTarget.value); c.confirmed = false; })} />{/snippet}</Field>
      </details>
      {:else}<p>Water depth is zero along this boundary. {current.role === "island" ? "Its interior is land and is excluded from lake carving." : "This is the lake's outer water boundary."}</p>{/if}
      <Button size="sm" onclick={() => edit(r => { r.shorelineId = selected; const c = r.contours.find(c => c.id === selected)!; c.role = "contour"; delete c.interiorValue; c.excluded = false; c.confirmed = false; })}>Use as shoreline</Button>
      <Button size="sm" disabled={current.id !== draft.review.shorelineId && current.role !== "island" && current.value === null} onclick={() => update(c => { c.confirmed = true; c.excluded = false; })}>Confirm path and value</Button>
      <Button size="sm" onclick={() => update(c => { c.excluded = !c.excluded; c.confirmed = false; })}>{current.excluded ? "Restore path" : "Exclude stray path"}</Button>
      <Button size="sm" disabled={current.closed} onclick={() => update(c => { c.closed = true; c.confirmed = false; })}>Close path</Button>
      <Button size="sm" onclick={() => { drawTarget = selected; drawing = []; aligning = false; }}>Redraw selected path</Button>
      <Button size="sm" disabled={current.closed || current.excluded} onclick={startJoin}>Join paths</Button>
      {#if current.closed}<p>Joining connects open path fragments. This path is already closed.</p>{/if}
      <details><summary>Correct individual vertices</summary>
        <Field label="Vertex">{#snippet children({ id })}<Input {id} boxed type="number" min="1" max={String(current.points.length)} value={String(vertex + 1)} onchange={event => { vertex = Math.max(0, Math.min(current!.points.length - 1, Number(event.currentTarget.value) - 1)); }} />{/snippet}</Field>
        {#if current.points[vertex]}
          {#each [0, 1] as axis}<Field label={axis ? "Y" : "X"}>{#snippet children({ id })}<Input {id} boxed type="number" step="any" value={String(current.points[vertex]![axis])} onchange={event => update(c => { c.points[vertex]![axis] = Number(event.currentTarget.value); c.confirmed = false; })} />{/snippet}</Field>{/each}
          <Button size="sm" onclick={() => update(c => { const a = c.points[vertex]!, b = c.points[(vertex + 1) % c.points.length]!; c.points.splice(vertex + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); c.confirmed = false; })}>Insert midpoint after vertex</Button>
          <Button size="sm" disabled={current.points.length <= 3} onclick={() => { update(c => { c.points.splice(vertex, 1); c.confirmed = false; }); vertex = 0; }}>Remove vertex</Button>
        {/if}
      </details>
    </fieldset>
  {/if}
  <Button size="sm" disabled={locked} onclick={() => edit(r => { for (const c of r.contours) if (c.value === null && c.id !== r.shorelineId && c.role !== "island") c.excluded = true; })}>Exclude all unassigned paths</Button>
  <p>Only exclude paths after checking they are text, borders, or other non-contour marks. Missing depth contours can distort the basin.</p>
          <details><summary>Review and draft help</summary><p>Confirm every included path against the source. Define the outer shoreline, island boundaries, and each depth contour. Use shallower interiors for underwater rises. Crossings, touching boundaries, and paths inside island land must be repaired.</p><p>Export a review draft before closing or reloading. Keep the original chart file to restore these edits later.</p></details>
        {:else if section === "alignment"}
  <h3>6 · Align with the lake</h3>
  <p>Add at least four known WGS84 coordinates spread around the source chart. Use printed coordinate ticks or identifiable mapped locations. A low fit error alone does not establish accuracy.</p>
  <Button size="sm" disabled={locked || draft.review.controlPoints.length >= 64} onclick={() => { cancelJoin(); aligning = true; drawing = undefined; }}>Place alignment point</Button>
  {#each draft.review.controlPoints as point, index}
    <fieldset disabled={locked || joining}>
      <legend>Alignment point {index + 1} · pixel {point.x.toFixed(1)}, {point.y.toFixed(1)}</legend>
      {#each ["lon", "lat"] as coordinate}
        <Field label={coordinate === "lon" ? "Longitude" : "Latitude"}>{#snippet children({ id })}<Input {id} boxed aria-label={`${coordinate === "lon" ? "Longitude" : "Latitude"} ${index + 1}`} type="number" step="any" value={Number.isFinite(point[coordinate as "lon" | "lat"]) ? String(point[coordinate as "lon" | "lat"]) : ""} onchange={event => edit(r => { r.controlPoints[index]![coordinate as "lon" | "lat"] = event.currentTarget.value === "" ? Number.NaN : Number(event.currentTarget.value); })} />{/snippet}</Field>
      {/each}
      <Button size="sm" onclick={() => edit(r => { r.controlPoints.splice(index, 1); })}>Remove alignment point {index + 1}</Button>
    </fieldset>
  {/each}
  {#if alignment}<p>Alignment residual: {alignment.rmsM.toFixed(1)} m · shoreline overlap: {Math.round(alignment.iou * 100)}%. Check the dashed pink map outline against the blue source shoreline.</p>{/if}
  <Checkbox disabled={locked || !alignment} checked={draft.review.alignmentConfirmed} onCheckedChange={checked => { draft.review!.alignmentConfirmed = checked; draft.layersReviewedKey = ""; }} label="I checked the alignment and orientation against the source." />
        {:else}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if issues.length}<div role="status"><strong>Resolve before depth generation</strong><ul>{#each issues as issue}<li>{issue}</li>{/each}</ul></div>{/if}
  {#if pathIssues.length}<details><summary>Locate paths that need correction ({pathIssues.length})</summary><ul>{#each pathIssues as issue}<li>{issue.message} {#each [...new Set(issue.contourIds)] as id}<Button size="sm" onclick={() => { selected = id; vertex = 0; section = "contours"; toolsBody?.scrollTo({ top: 0 }); }}>{id}</Button>{/each}</li>{/each}</ul></details>{/if}
          {#if !issues.length}<p>Contours and alignment are ready. Generate depths, then compare the basin and layers with the source.</p>{/if}
        {/if}
      </div>
      <footer class="review-tools-footer">
        {#if error || session.error}<p role="alert">{error || session.error}</p>{/if}
        {#if issues.length}<Button size="sm" variant="quiet" class="review-issues-link" onclick={() => { cancelJoin(); section = "checks"; }}>{issues.length} {issues.length === 1 ? "issue" : "issues"} to resolve before generation</Button>{/if}
        <Button size="sm" variant="primary" disabled={locked || issues.length > 0} onclick={() => void generateReviewedDepths()}>{session.busy ? "Generating depths…" : "Generate reviewed depths"}</Button>
        {#if draft.result && resultIsCurrent()}<Button size="sm" onclick={() => { previewing = true; drawing = undefined; aligning = false; }}>View generated depths</Button>{/if}
      </footer>
    </section>
  {/if}
</div>
{/if}

<style>
  .review-editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 380px); gap: 1px; height: 100%; min-height: 0; min-width: 0; background: var(--loidolt-border); }
  .review-editor.review-previewing { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); }
  .review-chart { height: 100%; }
  .review-chart-heading, .review-tools-heading, .review-preview-heading { padding: 10px 12px; border-bottom: 1px solid var(--loidolt-border); }
  h3 { font-size: 13px; margin: 0; }
  p { font-size: 12px; line-height: 1.5; margin: 6px 0; }
  .review-source { flex: 1; min-height: 0; min-width: 0; background: white; --svg-canvas-width: 100%; --svg-canvas-height: 100%; }
  .review-chart-legend { flex: 0 0 auto; padding: 6px 12px; border-top: 1px solid var(--loidolt-border); }
  .review-chart-legend p { font-size: 11px; margin: 2px 0; }
  .review-tools, .review-preview { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: var(--loidolt-surface); }
  .review-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .review-preview :global(.chart-result) { flex: 1; }
  .review-join-status { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--loidolt-border-soft); }
  .review-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; }
  .review-sections { display: flex; padding: 0 12px 8px; gap: 6px; border-bottom: 1px solid var(--loidolt-border); }
  .review-sections :global(.ldt-button) { flex: 1; min-width: 0; }
  .review-tools-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px; }
  .review-tools-footer { flex: 0 0 auto; display: grid; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--loidolt-border); }
  .review-tools-footer :global(.review-issues-link) { justify-content: flex-start; text-align: left; }
  fieldset { display: flex; gap: 8px; flex-wrap: wrap; margin-block: 10px; padding: 10px; min-width: 0; }
  fieldset :global(.ldt-field) { flex-basis: 100%; min-width: 0; }
  path[role="button"] { cursor: pointer; pointer-events: stroke; }
  path:focus { stroke: #a21caf; stroke-width: 5; outline: none; }
  .review-tools :global(.ldt-button), .review-preview-heading :global(.ldt-button) { max-width: 100%; white-space: normal; }
  .review-tools :global(.ldt-input), .review-tools :global(.ldt-select) { min-width: 0; width: 100%; }
  .review-tools :global(.ldt-field), .review-tools :global(.ldt-choice) { min-width: 0; }
  .review-tools-body { overflow-wrap: anywhere; }
  fieldset { border: 1px solid var(--loidolt-border-soft); }
  legend { font-size: var(--loidolt-font-size-sm); color: var(--loidolt-text-muted); }
  li { font-size: 12px; margin-block: 5px; }
  @container (max-width: 820px) {
    .review-editor, .review-editor.review-previewing { grid-template-columns: minmax(0, 1fr); height: auto; }
    .review-chart { height: clamp(360px, 58dvh, 650px); }
    .review-tools { height: clamp(400px, 65dvh, 700px); }
    .review-preview { overflow: visible; }
  }
</style>
