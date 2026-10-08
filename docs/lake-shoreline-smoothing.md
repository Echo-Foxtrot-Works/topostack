# Lake shoreline smoothing

With smoothing enabled, generation filters narrow shoreline reversals and rounds
lake corners using quadratic arcs. The local shoreline edge lengths determine
the trim, capped at a fixed 0.8 mm. This helps sparse vector outlines
independently of the terrain grid resolution, and the cap does not follow the
minimum feature size: that setting removes slivers but never coarsens a shore.

Near reversals are removed only when their width is below 18% of the minimum
feature size and their tip lies within twice that size (at most 2 mm) of the
replacement edge. Other bays and peninsulas remain. Duplicate points are removed
before rounding. Polygon normalization rejects changes that split a lake, lose
an island, introduce crossings, or change any ring's area by more than 5%.

The pass runs on a copy of source data at geometry generation, sharing the result
between lake masks, water fills, and matching shoreline score paths. Repeated
previews do not accumulate smoothing; disabling smoothing uses the source shape.
Oceans and open river paths are unaffected. This improves presentation of coarse
outlines; it does not recover missing geographic detail.

The regression fixture at 60.2657, 5.3344 is from the production OSM archive
(z12/2108/1183, fetched 2026-09-16; OpenStreetMap contributors, ODbL). Its 17 distinct
vertices include a narrow reversal that corner rounding alone cannot remove.

Lake terrain uses the same vector shore when smoothing is enabled. Complete
modeled basins measure distance to shoreline segments in ground meters rather
than to dry raster-cell centers, and seed the terrain-informed depth solve at
those distances. This removes raster terraces from the shallow cut contours,
not just from the blue shoreline overlay. Maximum/mean depth constraints and
survey samples keep their existing precedence. Clipped and edge-touching lakes
retain the raster fallback to avoid treating crop boundaries as shores.

For incomplete surveys without a modeled-depth fallback, the uncovered rim is
estimated from nearby supplied depths and tapered to zero at the vector shore.
The search covers at most three sampled survey pixels (capped at 24 terrain
samples per axis), uses distance-weighted observations, and rejects paths across
dry banks or islands. Interior or remote gaps remain unknown. Supplied samples
are never rewritten, and coverage stays `mixed`. The loader carries the survey
raster's ground spacing so zooming into a coarse survey does not reduce the
search to the much finer terrain pixels.

A second regression fixture retains the actual NVE survey 144518 coverage mask
at the reported location. The old zero-depth fallback produced rectangular
ledges along that mask, even with contour smoothing enabled. This fixture tests
the transition itself, preservation of supplied samples, and mixed provenance.
