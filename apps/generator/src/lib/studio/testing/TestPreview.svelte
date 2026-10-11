<script lang="ts">
  let fits = $state(0);
  export function fitView(): void { fits += 1; }
</script>

<div class="three-stage" data-testid="three-preview" data-fit-count={fits}>3D preview</div>
