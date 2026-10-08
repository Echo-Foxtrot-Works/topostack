# TopoStack

[![CI](https://github.com/Echo-Foxtrot-Works/topostack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Echo-Foxtrot-Works/topostack/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Echo-Foxtrot-Works/topostack?filter=v*&label=release)](https://topostack.app/changelog?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Open the studio](https://img.shields.io/badge/open-topostack.app-2366FF)](https://topostack.app/studio?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github)

Turn a place you love into something you can make. TopoStack is a free, browser-based terrain studio for creating layered, laser-cut reliefs and flat topographic engravings from real elevation and map data. No account, no install: pick a place, set your material, and download cut-ready SVGs.

[Visit the website](https://topostack.app?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) · [Open the studio](https://topostack.app/studio?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) · [Browse examples](https://topostack.app/examples?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) · [Find a lake with depth data](https://topostack.app/lakes?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) · [Report a bug or share an idea](https://github.com/Echo-Foxtrot-Works/topostack/issues)

![A TopoStack layered relief of Crater Lake turning in the studio's 3D preview, showing the stacked sheets and the surveyed lake floor](docs/images/topostack-stack.webp)

*Software preview from the studio's 3D view, not a photo of a finished piece.*

![Two TopoStack workflows: stacked contour sheets for layered relief, and contour lines on one surface for flat engraving](docs/images/workflows.svg)

## What you can make

| Workflow | Controls | Output |
| --- | --- | --- |
| **Layered relief** | Physical size, material thickness, vertical exaggeration, map details, and fabrication settings, including an optional machine work area | Master SVG, cut panels (one per work-area tile when split), matching engraving panels, optional paint templates, and an assembly guide |
| **Flat engraving** | Physical size, contour density, index contours, linework, map details, and border | One SVG at physical size, containing engraving paths only |

Both workflows support rectangular and circular crops; roads, trails, transportation labels, water outlines and fill patterns; state/province boundaries; latitude/longitude grids; elevation labels; a compass; and a scale bar. Add custom coordinate-based markers, trails, and boundaries to make a map your own.

Layered projects also support surveyed and modeled lake depth, alignment guides, and material reuse. Models larger than your laser bed can be split along a staggered seam grid into pieces that fit it; covered seams are cut as interlocking puzzle tabs, and each piece engraves an assembly id such as `L03-B2` where the next layer hides it. Sheet count is calculated from terrain relief, map scale, vertical exaggeration, and material thickness. Preview a project on the map, as 2D cut layers, as an engraving, or as a stacked/exploded 3D model, depending on the output type.

### Inside the studio

![TopoStack studio showing freshly generated Crater Lake terrain with USGS surveyed lake-floor relief](docs/images/studio-crater-lake.png)

Crater Lake with USGS surveyed lake-floor data where available; existing terrain or modeled depths fill gaps. Depth is exaggerated for display.

*The bundled Crater Lake preview in the studio's 3D stack view. Generate fresh terrain before exporting fabrication files.*

### Get started

1. Open the [studio](https://topostack.app/studio?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) and explore the bundled Crater Lake preview.
2. Choose a place, frame the map area, and select **Layered** or **Flat** output.
3. Set the physical dimensions and details, then **Generate terrain** and inspect the result.
4. Open **Export** to download the complete project, individual artwork, or project settings.

The initial preview uses a bundled snapshot of real terrain and map data. Generate fresh terrain before fabrication export. SVGs use physical millimeter coordinates; layered artwork separates red cuts (`#FE0002`) and blue score/engraving paths (`#2366FF`), with named operation groups. Exports include project metadata and source attribution. Review the artwork and machine settings in your laser software before making a piece.

Project settings are saved in your browser's IndexedDB. Export a project-settings JSON backup to keep a copy or move to another device; import it using the studio's import control. Restored or imported projects need fresh terrain generation before fabrication export. Settings backups are available even when fabrication export is blocked.

The homepage lives at `/`, the editor at `/studio`, and the former `/about` URL redirects to `/`. TopoStack also supports the Atomm export lifecycle and **Open in Studio** integration.

### Examples and guides

Worked projects with renders, measured results and a project file you can import: [Grand Canyon](https://topostack.app/examples/grand-canyon?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [Yosemite Valley](https://topostack.app/examples/yosemite-valley?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [Mount Rainier](https://topostack.app/examples/mount-rainier?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [Mount Fuji](https://topostack.app/examples/mount-fuji?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [Matterhorn](https://topostack.app/examples/matterhorn?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [Lake Tahoe](https://topostack.app/examples/lake-tahoe?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) and [Crater Lake](https://topostack.app/examples/crater-lake?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github).

Step-by-step guides cover [making a layered laser-cut map](https://topostack.app/guides/laser-cut-topographic-map?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [flat engraving](https://topostack.app/guides/topographic-map-engraving?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [splitting maps larger than your laser bed](https://topostack.app/guides/split-large-maps?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github), [painting water](https://topostack.app/guides/water-paint-templates?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) and [tracing a lake depth chart](https://topostack.app/guides/trace-a-depth-chart?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github). The [lake directory](https://topostack.app/lakes?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) lists more than 8,000 lakes with surveyed or charted depths.

For a first project, choose a small layered relief, flat engraving or surveyed lake starter on the homepage. The studio offers a checklist to your first export; the [LightBurn workflow](https://topostack.app/guides/lightburn?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=github) covers import, dimensions, operations and kerf. Export also offers a labelled software-preview PNG and a design link for sharing.

## Built in the open, with AI

TopoStack is a solo developer's spare-time project under [Echo Foxtrot Works](https://github.com/Echo-Foxtrot-Works), unashamedly built with help from AI. That collaboration helps turn ideas into working software and make the most of the time available.

Explore the code, ask questions, suggest improvements, or contribute through [GitHub](https://github.com/Echo-Foxtrot-Works/topostack). For bugs, include the output type, selected location, reproduction steps, and browser details; a project-settings JSON file can help reproduce geometry problems. For code changes, explain the behavior you changed and how you verified it. Pull requests normally target `dev`; releases are promoted to `main`.

[Donations](https://www.paypal.com/donate/?hosted_button_id=QXCUQVC3XAEZA) help support development and are always optional. Every export is available without donating.

## Feedback

Use **Feedback** in the studio or page footer to report bugs, request features, or flag low-quality terrain and lake data. Optionally include reviewable location and source diagnostics. Reports open as prefilled GitHub issues; a GitHub account and submission on GitHub are required. See the [feedback workflow and triage guide](docs/feedback.md).

## Contributing

Bug reports, data-quality reports and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); [docs/development.md](docs/development.md) covers running the studio and map API locally, validation, releases, the Atomm package and data provisioning. The [documentation index](docs/README.md) lists every design reference and runbook, starting with the [architecture](docs/architecture.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

TopoStack software is available under the [MIT License](LICENSE). Dependency and map-data licenses remain separate; retain the source attribution included with exports.

Sheet nesting uses [sparrow](https://github.com/JeroenGar/sparrow) (MIT, © 2025 Jeroen Gardeyn, KU Leuven) and [jagua-rs](https://github.com/JeroenGar/jagua-rs) (MPL-2.0), unmodified and compiled to WebAssembly. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [docs/nesting.md](docs/nesting.md) for licences and citations.
