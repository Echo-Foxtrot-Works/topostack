# Atomm listing

- **Immutable generator slug:** `topostack`
- **Card title:** TopoStack
- **Short description:** Turn real terrain into layered laser-cut reliefs and flat topographic engravings.
- **Craft:** Laser, Cutting, Engraving, Relief. If only one selection is allowed, choose Laser.

## Detailed description

Turn a place you love into something you can make. TopoStack transforms real elevation and map data into layered terrain reliefs and flat topographic engravings.

Choose a location, frame your map, and set its physical size. Create a layered relief with adjustable material thickness and vertical exaggeration, or a flat engraving with customizable contour lines. Add roads, trails, water details, labels, a compass, a scale bar, or your own markers and paths.

Include lake-floor relief using surveyed bathymetry where available, with terrain or modeled depths filling gaps. Explore your design in 2D or as an assembled or separated 3D stack.

For layered projects, set your material width and height and let automatic nesting arrange the pieces. Watch the layout improve, or keep the current layout to finish early. Export previews show the actual artwork and explain the processing colors.

Open in Studio sends one editable SVG containing the entire layout. Download provides the complete project bundle, including artwork, project settings and source credits, plus an assembly guide for layered reliefs. Flat designs export as SVG artwork at your chosen physical size.

Generate fresh terrain before exporting, then review the artwork, material and machine settings before fabrication. The opening design is a bundled preview. Current media shows freshly generated Crater Lake terrain prepared for the 0.7.1 review, including real survey data where available. Images and videos are software previews, not physical builds or machine runs.

## Upload media

Use `assets/topostack-cover-loop-v8.mp4` as the silent cover video and `assets/topostack-cover-v8.png` as its still fallback. The movie renders every frame from the actual 3D scene as the camera orbits and the stack separates and reassembles. Use `assets/topostack-showcase-v8.mp4` for a feature tour with native 3D motion, gently moving interface scenes and short fades. Videos are H.264, 60 fps, with fast-start playback and no audio.

All seventeen PNGs are 3200 × 2400; both videos are 1920 × 1440. The sixteen gallery cards use app screenshots captured at twice the display resolution or native 3D renders, with captions outside the app imagery. Warning notifications are dismissed for the promotional captures; source limitations remain explained here and in the provenance.

| Order | File | Caption / alt text |
| --- | --- | --- |
| 1 | `assets/topostack-gallery-01-workbench-v8.png` | Crater Lake in the current Atomm workbench. |
| 2 | `assets/topostack-gallery-02-layers-v8.png` | Separate the actual terrain stack to inspect the layers. |
| 3 | `assets/topostack-gallery-03-cut-layer-v8.png` | Inspect a cut layer before fabrication. |
| 4 | `assets/topostack-gallery-04-flat-v8.png` | Flat surface contour artwork. |
| 5 | `assets/topostack-gallery-05-depth-v8.png` | Lake-floor relief and water depth controls. |
| 6 | `assets/topostack-gallery-06-nesting-v8.png` | Live sheet layouts while automatic nesting solves. |
| 7 | `assets/topostack-gallery-07-export-v8.png` | Actual export artwork and clear Studio/download contents. |
| 8 | `assets/topostack-gallery-08-material-v8.png` | Layout updated for 700 × 500 mm material, with aligned controls. |
| 9 | `assets/topostack-gallery-09-location-v8.png` | Place search, surveyed lakes and coordinate entry. |
| 10 | `assets/topostack-gallery-10-size-v8.png` | Crop shape, physical size and units. |
| 11 | `assets/topostack-gallery-11-terrain-v8.png` | Material thickness and vertical exaggeration. |
| 12 | `assets/topostack-gallery-12-annotations-v8.png` | Map details, compass and scale controls. |
| 13 | `assets/topostack-gallery-13-linework-v8.png` | Linework presets and customization. |
| 14 | `assets/topostack-gallery-14-fabrication-v8.png` | Fabrication and work-area settings. |
| 15 | `assets/topostack-gallery-15-markers-v8.png` | Imported geographic marker and symbol controls. |
| 16 | `assets/topostack-gallery-16-paths-v8.png` | Imported illustrative path and point controls. |

Import `media-project-v8.json` to reproduce the starting project: Crater Lake, 406.4 × 270.933 mm, 3.175 mm material, 4× terrain exaggeration, 1.75× depth exaggeration, and 600 × 400 mm sheets. `media-export-v8.json` records the final export after changing sheets to 700 × 500 mm and importing the illustrative marker/path from `media-annotations-v8.json`. Survey coverage is incomplete; terrain or modeled depths fill gaps. Flat artwork shows surface contours, not submerged 3D relief.

`media-provenance.json` records the capture source commit, development base, source attribution and file hashes. Capture uses the actual embedded UI with an SDK mount/export stand-in; these images do not claim a native Studio import. Real platform validation is performed separately through Atomm Local Debug. The provenance records the source commit and a SHA-256 of the application/capture source diff. The release receipt records whether the packaged working tree is dirty. See `review-readiness.md` for this revision’s checks and remaining platform validation.

The current upload bundle contains 19 media files. Historical captures and `media-provenance-v5.json` remain in the repository for reference; they are excluded from this refreshed upload set.

Credits: USGS Crater Lake multibeam bathymetry (public domain); Mapzen Terrain Tiles and contributing elevation sources; HydroLAKES / GLOBathy; map data © OpenStreetMap contributors, via Protomaps. Full attribution is retained in the provenance and project export.

## Craft selection notes

Select Laser, Cutting, Engraving, and Relief wherever multiple choices are supported. Do not select the printing categories. The 3D preview represents stacked sheet construction; TopoStack supplies SVG fabrication files, so 3D is not selected as a printing craft.

## Review notes

The Atomm package opens the terrain workbench directly at its root. The standalone website keeps its homepage. For local editor preview, point Atomm's `local` URL at `/studio`. The embedded workbench follows `layout-3-generate.skeleton.html`: a 320px generation rail, canvas, and 320px parameter rail with a pinned platform export button.

TopoStack uses the Atomm platform export button and registers one export lifecycle hook. Download returns a multi-file fabrication package; Open in Studio returns a single master SVG. All machine-facing SVGs use millimeters at physical size and keep cut, score, and engraving operations in named groups. Cuts use `#FE0002`; score lines, engraving lines, and engraving fills use `#2366FF`. SCORE and ENGRAVE share Atomm’s blue processing group. White marker knockouts remain an additional color group to review in Studio.

The generator requests elevation, OSM-derived vector data, and proxied Geoapify place-search results from the configured TopoStack Cloudflare Worker. Search queries are hashed for a 24-hour response cache and are also processed under Geoapify's privacy terms. The interactive reference map loads OpenFreeMap tiles. No Atomm user profile or token is read or stored. Projects are saved only in the browser's IndexedDB unless the user exports `project.json`.

The UI reads the platform locale once and falls back to English for languages without a translation. Platform toasts are used for generation feedback; no login flow is needed.
