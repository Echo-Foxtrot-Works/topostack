# Media

Which existing pictures and videos to use where, with captions that say what they are. **Everything here is a screenshot or render from the TopoStack software.** None shows a physical piece, and no caption, post or crop may suggest otherwise. When real builds exist, they should lead and these should support them (see the [shot list](#shot-list-for-real-builds)).

Provenance for each set is recorded next to it: [atomm/media-provenance.json](../../atomm/media-provenance.json) (v6 Atomm set), [docs/images/README.md](../images/README.md), [docs/images/splitting-paint-templates/README.md](../images/splitting-paint-templates/README.md), [docs/images/walden-example/README.md](../images/walden-example/README.md) and [apps/generator/static/images/guides/chart-images.md](../../apps/generator/static/images/guides/chart-images.md).

## Do not use

| File | Why |
| --- | --- |
| `atomm/assets/topostack-cover-workshop-4x3.png` | AI image edit (see `atomm/cover-prompt*.txt`) that places a render on a photoreal workshop table. It looks like a photo of a built piece. |
| `atomm/assets/topostack-cover-workshop-v2-4x3.png` | Same as above. |
| `atomm/assets/topostack-cover.png` | Photoreal stacked wooden discs on a dark background. It is not a studio capture, no provenance file covers it, and it reads as a photograph. |
| Older gallery cards: `atomm/assets/topostack-gallery-01-3d.png`, `-01-hero`, `-02-places`, `-03-exploded`, `-03-flat-engraving`, `-04-layered-flat`, `-05-personalize`, `-06-lake-depth`, `-07-export`, `-08-custom-marker`, `-08-workbench`, `-09-shapes` | Superseded studio captures. The ones checked carry the legacy `topostack.echofoxtrot.works` domain and older UI. Use the `-v6` set instead. |
| `atomm/assets/topostack-cover-4x3.png`, `topostack-cover-motion-4x3.png` | Older software-preview covers, superseded by `topostack-cover-v6.png`. |
| `atomm/assets/topostack-cover-loop-v3.mp4`, `topostack-product-showcase-v3.mp4`, `topostack-exploded-stack-v2.mp4` | Native renders, but older captures; superseded by the v6 videos. |

## Recommended assets

| Asset | Size | Honest caption / alt text | Best for |
| --- | --- | --- | --- |
| `atomm/assets/topostack-cover-loop-v6.mp4` | 1920 × 1440, 6 s, silent, 16 MB | "Software render: a layered Crater Lake model in the TopoStack studio, separating into its layers. Survey depth where available; exaggerated for display." | X, Bluesky, Mastodon, Reddit video posts, Product Hunt video slot |
| `atomm/assets/topostack-showcase-v6.mp4` | 1920 × 1440, 44 s, silent, 52 MB | "A tour of the TopoStack studio: 3D preview, cut layers, flat engraving, lake depth, nesting and export. Screen captures and renders; no physical builds shown." | Product Hunt, creator pitches (as a link), the xTool community |
| `atomm/assets/topostack-cover-v6.png` | 3200 × 2400 | "Software preview: Crater Lake as a layered relief in TopoStack." | Product Hunt thumbnail source, Facebook groups |
| `atomm/assets/topostack-gallery-01-workbench-v6.png` | 3200 × 2400 | "Crater Lake in the TopoStack workbench (screenshot)." | r/xToolOfficial, Atomm-related posts |
| `atomm/assets/topostack-gallery-02-layers-v6.png` | 3200 × 2400 | "Separating the rendered terrain stack to inspect each layer (screenshot)." | r/lasercutting, Facebook groups |
| `atomm/assets/topostack-gallery-03-cut-layer-v6.png` | 3200 × 2400 | "One cut layer before export: red cuts, blue score lines (screenshot)." | LightBurn forum, r/Lightburn |
| `atomm/assets/topostack-gallery-04-flat-v6.png` | 3200 × 2400 | "Flat contour engraving artwork generated for Crater Lake (screenshot)." | r/cartography |
| `atomm/assets/topostack-gallery-05-depth-v6.png` | 3200 × 2400 | "Lake-floor relief and water-depth controls (screenshot). USGS survey where available; gaps filled." | r/gis |
| `atomm/assets/topostack-gallery-06-nesting-v6.png` | 3200 × 2400 | "Sheet layouts updating while automatic nesting runs (screenshot)." | r/xToolOfficial, Show HN (as a link) |
| `atomm/assets/topostack-gallery-07-export-v6.png` | 3200 × 2400 | "Export view showing the actual artwork and what the download contains (screenshot)." | LightBurn forum |
| `atomm/assets/topostack-gallery-08-material-v6.png` | 3200 × 2400 | "Layout recomputed for 700 × 500 mm material (screenshot)." | r/xToolOfficial, r/glowforge |
| `apps/generator/static/images/social-crater-lake.png` | 1200 × 630 | "TopoStack studio render of Crater Lake with surveyed lake floor." | Link-preview image, X/Bluesky/Mastodon still |
| `apps/generator/static/images/studio-crater-lake.png` (also `docs/images/studio-crater-lake.png`) | 1280 × 900 | "The TopoStack studio with freshly generated Crater Lake terrain and USGS survey data (screenshot). Depth exaggerated for display." | Show HN (as a link), r/gis |
| `docs/images/splitting-paint-templates/01-split-relief.png` … `04-lower-layer-paint-template.png` | 3200 × 2200 | Use the captions in [that folder's README](../images/splitting-paint-templates/README.md). Add "screenshot" to each. | r/glowforge, Glowforge forum, small-bed threads |
| `apps/generator/static/images/guides/split-relief.webp`, `split-cut-layer.webp`, `paint-template-on.webp`, `paint-template-lower-layer.webp` | 1600 × 1100 | The same screenshots at web size. The alt text for `split-relief` and `paint-template-on` is in `apps/generator/src/lib/site/seo.ts`. | Forums with upload limits |
| `apps/generator/static/images/examples/<slug>-card.jpg` (Grand Canyon, Yosemite Valley, Mount Rainier, Mount Fuji, Matterhorn, Lake Tahoe) | 1200 × 630 | "[Place] layered topographic map generated in TopoStack (software render)." | Creator pitches, threads about a specific place |
| `apps/generator/static/images/examples/<slug>.webp` and `-800.webp` | capture size / 800 px | Same caption. | Reddit galleries; Lake Tahoe for lake-map threads |
| `docs/images/walden-example/walden-reviewed-workspace.png` | 1600 × 1100 | "Walden Pond lake floor generated in TopoStack from a manually reviewed USGS depth chart (screenshot). Chart: U.S. Geological Survey. Workflow demonstration, not a survey-accuracy claim." | r/gis (chart tracing) |
| `docs/images/chart-release/king-reviewed-workspace.png` (also `apps/generator/static/images/guides/chart-reviewed-workspace.png`) | 1600 × 1100 | "Reviewing traced contours from a public-domain USGS chart before generating a lake floor (screenshot). Incomplete-coverage warning retained." | r/gis, creator pitches about depth charts |
| `docs/images/workflows.svg` | vector | "The two TopoStack workflows: stacked contour sheets for layered relief, contour lines on one surface for flat engraving (diagram)." | GitHub, Show HN (as a link) |

Rules for captions:

- Include "render" or "screenshot" in every caption, even on platforms without alt text.
- Keep the source credits the provenance files require. Crater Lake survey: USGS (public domain). Map data © OpenStreetMap contributors via Protomaps. Walden and King City charts: U.S. Geological Survey.
- Don't crop out coverage warnings or attribution in screenshots that show them. The splitting and chart sets retain them deliberately.
- Don't use `docs/images/real-depth-charts/*`. Its README says these images show unresolved tracing-quality warnings and are not approved results.

## Channel picks

| Channel | Lead with | Also |
| --- | --- | --- |
| r/lasercutting, Facebook groups | `topostack-gallery-02-layers-v6.png` | `topostack-cover-loop-v6.mp4` |
| r/xToolOfficial / xTool community | `topostack-gallery-06-nesting-v6.png` | `topostack-gallery-01-workbench-v6.png` |
| r/glowforge, Glowforge forum | `splitting-paint-templates/02-split-cut-layer.png` | `03-water-paint-template.png` |
| LightBurn forum | `topostack-gallery-03-cut-layer-v6.png` | `topostack-gallery-07-export-v6.png` |
| r/gis | `topostack-gallery-05-depth-v6.png` | `walden-reviewed-workspace.png`, `lake-tahoe.webp` |
| r/cartography | `topostack-gallery-04-flat-v6.png` | `workflows.svg` |
| Show HN | none (HN has no images); the link preview uses `social-crater-lake.png` | |
| Product Hunt | see below | |
| X / Bluesky / Mastodon | `topostack-cover-loop-v6.mp4` | `social-crater-lake.png` |

## Product Hunt gallery

Product Hunt recommends 1270 × 760 gallery images and needs at least two. The v6 cards are 4:3, so pad them rather than crop, to keep their captions. For example:

```sh
ffmpeg -i atomm/assets/topostack-gallery-02-layers-v6.png \
  -vf "scale=-1:760,pad=1270:760:(ow-iw)/2:0:color=0xe9ebee" ph-02-layers.png
```

Check the padding colour against the card background, and keep the output out of the repository unless it is being kept as a maintained asset. Suggested order: cover loop (video), layers, cut layer, flat engraving, depth, nesting, export. If real build photos exist by launch day, put one first.

## Shot list for real builds

When the maintainer (or a creator, with written permission) builds a piece, these shots replace the renders as lead images. Record, for each build, the project JSON, material and thickness, machine, laser software and version, power/speed/passes, kerf setting, and anything changed by hand after export. Keep the photos with a provenance note, like the other image folders, for example under `docs/images/builds/<place>/`.

1. **Hero:** three-quarter angle in soft daylight on a plain surface, with the whole piece in frame. The most important shot.
2. **Top-down:** square to the piece, for comparing with the studio's 2D preview.
3. **Edge profile:** low angle showing the layer count and material edge.
4. **Side by side:** the physical piece next to the studio render on a screen, from the same angle. This shows readers what the renders correspond to.
5. **Scale:** in hand or next to a ruler.
6. **Seams:** close-up of puzzle-tab seams and an engraved assembly id (`L03-B2`), if split.
7. **Paint stencil:** the paper stencil on a layer, then the painted water.
8. **Cut sheets:** the nested sheet on the bed or just out of the machine, with its parts still in place.
9. **Glue-up:** mid-assembly, with the assembly guide visible.
10. **Lake piece:** a surveyed lake floor (Crater Lake, Tahoe, or a Minnesota or Ontario lake), showing depth steps.
11. **Flat engraving:** one engraved piece, including a close-up of the contour lines.
12. **Short video:** 10–20 s of the machine cutting one layer (quiet or muted), and a time-lapse of assembly.
13. **Import screenshot:** the exported SVG open in the laser software used, with its layers or operations visible. This doubles as compatibility evidence for the guides.

Once real photos exist, update the render disclosure in [posts.md](posts.md) to say which images are photos and which are renders. Don't remove the distinction.
