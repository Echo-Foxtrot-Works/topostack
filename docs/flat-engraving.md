# Flat engraving

Flat engraving is a first-class output type alongside layered relief. It reuses
the selected map area and real elevation/vector sources, but it has a separate
geometry and export contract so stack-only fabrication concepts never leak into
the workflow.

## Workflow

1. Choose **Flat engraving** in Output.
2. Select a location and the physical artwork size/crop.
3. Set contour density (4–40 lines) and the index-contour cadence, or turn
   **Contour lines** off for a map of roads, water and labels only.
4. Add or remove roads, trails, transportation labels, lakes/rivers,
   state/province boundaries, latitude/longitude grid lines, elevation
   labels, compass, scale bar, and the engraved border.
   Water areas can optionally use Lines, Ripples, or Dots while None preserves
   outline-only engraving.
5. Choose a Fine, Balanced, or Bold linework preset, then optionally customize
   the physical widths and trail pattern.
6. Generate real terrain, inspect the exact flattened preview, and export.

Water depth, layer thickness, vertical exaggeration, assembly guides, material
nesting, glue margin, kerf, and the machine work area are intentionally
stack-only controls. A flat engraving is never split into work-area tiles: it
has nothing to cut and always exports as one SVG.

## Geometry

The elevation range is divided into the requested number of evenly spaced
contour thresholds. Filled threshold polygons are retained in the shared
geometry IR, then their rings are flattened for preview/export. Segments that
coincide with the crop boundary are removed so contours terminate at the edge
instead of tracing the frame. Transportation and water paths are combined from
their terrain bands into the same flat coordinate system. The coordinate grid
is generated directly from the selected bounds using readable 1/2/5-degree
intervals and Web Mercator latitude placement, matching the map geometry
without downloading another vector layer.

## SVG contract

The primary file is named `<project>-engraving.svg` and is 1:1 at the selected
physical size. It contains one blue (`#2366FF`) `ENGRAVE` operation group and no `CUT`
or `SCORE` groups. Named subgroups separate minor contours, index contours,
map details, the optional water-fill linework, and the optional border. State/province boundaries have their own
dashed group so they remain distinguishable from transportation and contour
lines. Latitude/longitude lines have a dedicated dotted group. Layered score features such as water
outlines are converted to engraving paths.
Water fills are emitted as explicit clipped vector paths rather than SVG pattern
or clipping elements, keeping the file predictable in laser software and
preserving islands as unfilled material.

## Linework

Linework settings are shared with layered projects and are stored as physical
millimeter widths. Flat projects expose independent minor contour, index
contour, major-road, local-road, trail, water, boundary, coordinate-grid,
annotation, and border widths.
Roads default to continuous centerlines with round joins. Major roads may use
a two-line outline instead, with configurable spacing and round or square endpoints.
Trails may be solid, dashed, or dotted. The same hierarchy appears in the flat
preview, layered 2D preview, layered engraving companions, and 3D surface
markings where the browser's WebGL line implementation supports it.

These values describe SVG strokes, not guaranteed burn widths. Laser focus,
power, speed, material, and whether the receiving application treats strokes
as centerlines or filled shapes still affect the physical result.

The download package also includes project JSON, a fabrication README, and
source attribution. As with layered projects, export is blocked for synthetic
terrain, stale settings, or unavailable requested vector data.
