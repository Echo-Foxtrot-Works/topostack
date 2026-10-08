<script lang="ts">
  import type { GeometryIRV1, ProjectConfigV1 } from "@topostack/core";
  import StackTopView from "$lib/studio/placement/StackTopView.svelte";
  import EngravingPreview from "$lib/studio/EngravingPreview.svelte";
  let { geometry, project }: { geometry: GeometryIRV1; project: ProjectConfigV1 } = $props();
</script>

{#if project.outputMode === "stack"}
  <StackTopView {geometry} outputMode="stack" cropShape={project.cropShape} marginMm={5} hiddenPrefixes={[]} />
{:else}
  <EngravingPreview {geometry} {project} cropShape={project.cropShape} />
{/if}
