<script lang="ts">
  import { FileUp, MapPin, Route, Shapes, Waves } from "@lucide/svelte";
  import { Tabs, type TabItem } from "@loidolt/theme-svelte";
  import { nav, openCustomDataSection, sectionsFor, type CustomDataSectionId } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { railOrientation } from "$lib/studio/rail-orientation.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import ChartTools from "$lib/studio/customdata/ChartTools.svelte";
  import GraphicTools from "$lib/studio/customdata/GraphicTools.svelte";
  import ImportTools from "$lib/studio/customdata/ImportTools.svelte";
  import MarkerTools from "$lib/studio/customdata/MarkerTools.svelte";
  import PathTools from "$lib/studio/customdata/PathTools.svelte";

  /**
   * The sidebar while the custom data view is open: a rail with one tab per
   * kind of data the maker brings, laid out like the settings rail. The tab
   * chooses the workspace the viewport shows, and its panel holds that kind's
   * tools. Every panel stays mounted, so work in progress survives a switch.
   */

  const studio = getStudio();
  const orientation = railOrientation();
  const sections = $derived(sectionsFor(studio.project.outputMode));
  // A section the project cannot use is never left open.
  $effect(() => {
    if (!sections.some((section) => section.id === nav.section)) openCustomDataSection(sections[0]!.id);
  });

  const summaries = $derived<Record<CustomDataSectionId, string>>({
    charts: chartSummary(),
    markers: studio.project.markers.length ? `${studio.project.markers.length} placed` : "None yet",
    paths: pathSummary(),
    graphics: graphicSummary(),
    import: "GPX, KML or GeoJSON",
  });

  function chartSummary(): string {
    const inUse = Object.keys(studio.project.userDepthCharts ?? {}).length;
    return inUse ? `${inUse} carving ${inUse === 1 ? "a lake" : "lakes"}` : "Trace a printed chart";
  }

  function graphicSummary(): string {
    const placed = studio.project.placedGraphics?.length ?? 0;
    const uploaded = studio.project.customGraphics?.length ?? 0;
    if (placed) return `${placed} on the piece`;
    return uploaded ? `${uploaded} uploaded` : "Logos and artwork";
  }

  function pathSummary(): string {
    const trails = studio.project.customLines.filter((line) => line.kind === "trail").length;
    const boundaries = studio.project.customLines.length - trails;
    const parts = [trails ? `${trails} trail${trails === 1 ? "" : "s"}` : "", boundaries ? `${boundaries} boundar${boundaries === 1 ? "y" : "ies"}` : ""].filter(Boolean);
    return parts.length ? parts.join(" · ") : "None yet";
  }
</script>

{#snippet charts()}<Waves strokeWidth={1.8} />{/snippet}
{#snippet markers()}<MapPin strokeWidth={1.8} />{/snippet}
{#snippet paths()}<Route strokeWidth={1.8} />{/snippet}
{#snippet graphics()}<Shapes strokeWidth={1.8} />{/snippet}
{#snippet importing()}<FileUp strokeWidth={1.8} />{/snippet}

<Tabs
  class="settings-rail custom-data-rail"
  variant="rail"
  orientation={orientation.current}
  label="Custom data"
  value={nav.section}
  onValueChange={(section) => openCustomDataSection(section)}
  tabs={sections.map((section): TabItem<CustomDataSectionId> => ({ value: section.id, label: section.tab, icon: { charts, markers, paths, graphics, import: importing }[section.id], description: summaries[section.id] }))}
>
  {#snippet children({ value })}
    {@const section = sections.find((item) => item.id === value)!}
    <div id={`custom-data-${value}`} class="studio-panel custom-data-section" data-section={value}>
      <header class="studio-panel-header">
        <h2>{section.label}</h2>
        <small>{summaries[value]}</small>
      </header>
      <div class="section-content">
        {#if value === "charts"}
          <ChartTools />
        {:else if value === "markers"}
          <MarkerTools />
        {:else if value === "paths"}
          <PathTools />
        {:else if value === "graphics"}
          <GraphicTools />
        {:else}
          <ImportTools />
        {/if}
      </div>
    </div>
  {/snippet}
</Tabs>
