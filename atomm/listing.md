# Atomm listing

- **Immutable generator slug:** `topostack`
- **Card title:** TopoStack
- **Short description:** Turn real places into layered laser-cut terrain reliefs and flat topographic engravings.
- **Craft:** Laser, Cutting, Engraving, Relief. If only one selection is allowed, choose Laser.

## Detailed description

Turn a place you love into something you can make. TopoStack transforms real elevation and map data into layered terrain reliefs and flat topographic engravings. The whole studio is available in all 18 Atomm languages.

Choose a location, frame your map, and set its physical size. Create a layered relief with adjustable material thickness and vertical exaggeration, or a flat engraving with customizable contour lines or none at all. Add roads, trails, water details, labels, a compass, a scale bar, or your own markers and paths.

Paint templates and engraved boundaries show national parks, forests and other public lands in the US and Canada. Cut lakes from acrylic as fitted inserts. For US places, add airspace, airports and runways from FAA charts, engraved on the map or built in acrylic above the terrain.

Include lake-floor relief using surveyed bathymetry where available, with terrain or modeled depths filling gaps. Explore your design in 2D or as an assembled or separated 3D stack.

For layered projects, set your material width and height and let automatic nesting arrange the pieces. Watch the layout improve, or keep the current layout to finish early. The Export view shows every nested sheet beside the list of files it will produce and explains the processing colors.

Open in Studio sends one editable SVG of the entire layout, with each piece in its own named group, so its outline, engraving and score lines move together. Download provides the complete project bundle, including artwork, project settings and source credits, plus an assembly guide for layered reliefs. Flat designs export as SVG artwork at your chosen physical size.

Generate fresh terrain before exporting, then review the artwork, material and machine settings before fabrication. The opening design is a bundled preview. Current media shows freshly generated terrain for Crater Lake and five other places, including real survey data where available. Images are software renders and screenshots, not photographs of physical builds or machine runs.

## Upload media

Use `assets/topostack-cover-v11.png` as the cover. It is a still image made for the 272 × 204 grid card: Crater Lake fills the frame on its own engraving artwork, with no text, since Atomm prints the title below the card. Upload no cover video. A video card shows only its first frame in the grid.

All ten PNGs are 3200 × 2400. Models are TopoStack's own 3D renders of live terrain, and interface images are screenshots of the embedded studio at twice the display resolution. Each card's background is the place's flat-engraving artwork, shown as faint lines. Warning notifications are dismissed before the screenshots; source limitations are explained here and in the provenance.

| Order | File | Caption / alt text |
| --- | --- | --- |
| Cover | `assets/topostack-cover-v11.png` | Software render of a layered Crater Lake relief on its own contour lines. |
| 1 | `assets/topostack-gallery-01-places-v11.png` | Any place on Earth: Crater Lake, Grand Canyon, Mount Rainier, Grand Teton, Mount Fuji and the Matterhorn as layered reliefs (software renders). |
| 2 | `assets/topostack-gallery-02-layers-v11.png` | The Crater Lake stack separated into its layers (software render). |
| 3 | `assets/topostack-gallery-03-relief-engraving-v11.png` | The same place as a layered relief and as flat engraving artwork. |
| 4 | `assets/topostack-gallery-04-acrylic-v11.png` | Crater Lake with its water cut as an acrylic insert (software render). |
| 5 | `assets/topostack-gallery-05-public-lands-v11.png` | Public-land paint templates around Grand Teton (software render). |
| 6 | `assets/topostack-gallery-06-airspace-v11.png` | FAA airspace over Colorado Springs built in acrylic tiers (software render; not for navigation). |
| 7 | `assets/topostack-gallery-07-three-steps-v11.png` | Pick a place, set the size, open in xTool Studio (screenshots). |
| 8 | `assets/topostack-gallery-08-ready-to-cut-v11.png` | The Export view: nested sheets, red cuts and blue scores (screenshot). |
| 9 | `assets/topostack-gallery-09-make-it-yours-v11.png` | Labels, compass and scale bar controls on a flat engraving (screenshot). |

`media-projects-v11.json` holds every project rendered, keyed by card. Crater Lake is the reviewed media project used since v6: 406.4 × 270.933 mm, 3.175 mm material, 4× terrain exaggeration and 1.75× depth exaggeration. The other places and the three feature projects are built through the agent request contract (`expandProjectRequest`) at the same physical size, by `scripts/dev/atomm-listing-places.mjs`. Survey coverage is incomplete, and terrain or modeled depths fill the gaps.

`media-provenance.json` records the capture source commit, development base, source attribution and file hashes. Capture uses the embedded UI with an SDK mount/export stand-in, so these images do not claim a native Studio import. Real platform validation is done separately through Atomm Local Debug. See `review-readiness.md` for this revision's checks and the platform validation still to do.

The upload bundle contains 10 media files. The provenance of earlier captures is kept as `media-provenance-v5.json`, `-v7.json`, `-v9.json` and `-v10.json`. The v9 images and videos and the v10 cards stay in the repository because `docs/launch/media.md` and the README animation use them for launch posts, but none of them is part of this upload set.

Credits: USGS Crater Lake multibeam bathymetry (public domain); Mapzen Terrain Tiles and contributing elevation sources; HydroLAKES / GLOBathy; USGS Protected Areas Database of the United States (PAD-US) 4.1; FAA Aeronautical Information Services, NASR (airspace shown is not for navigation); map data © OpenStreetMap contributors, via Protomaps. Full attribution is retained in the provenance and project export.

## Craft selection notes

Select Laser, Cutting, Engraving, and Relief wherever multiple choices are supported. Do not select the printing categories. The 3D preview represents stacked sheet construction; TopoStack supplies SVG fabrication files, so 3D is not selected as a printing craft.

## Review notes

The Atomm package opens the terrain workbench directly at its root. The standalone website keeps its homepage. For local editor preview, point Atomm's `local` URL at `/studio`. The embedded workbench follows `layout-3-generate.skeleton.html`: a 320px generation rail, canvas, and 320px parameter rail with a pinned platform export button.

TopoStack uses the Atomm platform export button and registers one export lifecycle hook. Download returns a multi-file fabrication package; Open in Studio returns a single master SVG. All machine-facing SVGs use millimeters at physical size and follow the platform's SVG grouping spec (v1.7.0): one root-level group per cut piece, named for Studio's object list, with one container per operation inside it. Cuts use `#FE0002`; score lines, engraving lines, and engraving fills use `#2366FF`. SCORE and ENGRAVE share Atomm’s blue processing group. White marker knockouts remain an additional color group to review in Studio.

The generator requests elevation, OSM-derived vector data, and proxied Geoapify place-search results from the configured TopoStack Cloudflare Worker. Search queries are hashed for a 24-hour response cache and are also processed under Geoapify's privacy terms. The interactive reference map loads OpenFreeMap tiles. No Atomm user profile or token is read or stored. Projects are saved only in the browser's IndexedDB unless the user exports `project.json`.

The UI reads the platform locale once, before the first render, and is translated into all 18 platform languages; there is no in-app language switcher. Downloaded files (README, assembly guide, SVG titles) stay in English. Platform toasts are used for generation feedback; no login flow is needed.
