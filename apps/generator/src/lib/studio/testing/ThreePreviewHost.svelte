<script lang="ts">
  // Test harness. `mount` props are not reactive, so the 3D preview's rebuild
  // path (which reacts to a fresh worker result) can only be exercised through
  // a component that owns the geometry as state and exposes a setter.
  import { untrack } from "svelte";
  import type { GeometryIRV1 } from "@topostack/core";
  import ThreePreview from "$lib/studio/ThreePreview.svelte";

  let { initial }: { initial: GeometryIRV1 } = $props();
  let geometry = $state.raw(untrack(() => initial));
  export const setGeometry = (next: GeometryIRV1): void => { geometry = next; };
</script>

<ThreePreview {geometry} exploded={0} />
