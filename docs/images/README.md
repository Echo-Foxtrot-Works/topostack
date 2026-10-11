# Website and README visuals

The [airspace website visuals](airspace-example/README.md) include the conceptual homepage SVG, a real Denver FAA preview and its importable capture project.

The [Walden Pond announcement example](walden-example/README.md) includes reviewed chart screenshots, a generated terrain preview, source credits, and an importable project.

- `workflows.svg` reuses the homepage's layered-relief and flat-engraving diagrams, with styles embedded for GitHub.
- `studio-crater-lake.png` is a direct 1280 × 900 studio screenshot of freshly generated Crater Lake terrain using USGS lake-floor survey data. The script copies it to `apps/generator/static/images/studio-crater-lake.png` for the homepage and example page.
- `apps/generator/static/images/social-crater-lake.png` is a 1200 × 630 sharing card composed around an unaltered screenshot of the same app-rendered model. Open Graph and Twitter metadata use this card.
- `topostack-stack.webp` is the README's animated preview: `atomm/assets/topostack-cover-loop-v8.mp4` (the studio's native 3D render of the Crater Lake stack, see `atomm/media-provenance.json`) cropped to the model, scaled to 800 px and re-encoded at 12 fps by `node scripts/dev/make-readme-media.mjs`. Rerun it after the cover loop is recaptured.
- `media-provenance.json` records capture time, project settings, and successful survey request URLs.
- `apps/generator/static/images/cards/*.jpg` are the guide, hub and lake-region sharing cards. `scripts/dev/capture-social-cards.mjs` composes them from the captures listed here, the example renders and the Atomm Tips pictures (cropped, not retouched), and draws the region cards' dot maps from the lake directory. No new imagery is generated; see [seo-operations.md](../seo-operations.md).

Survey coverage is incomplete: existing terrain or modeled depths fill gaps. The pictured depth scale is exaggerated. The bundled startup preview still uses modeled depths; it is not the source of these screenshots. The Atomm gallery already has survey-backed media and its own record in `atomm/media-provenance.json`.

Start the normal frontend using the deployed data API:

```sh
VITE_MAP_API_URL=https://topostack.app npm run dev:web
```

Then run from the repository root:

```sh
node scripts/dev/capture-readme-assets.mjs
```

Set `TOPOSTACK_APP_URL` if the frontend uses a different origin. The script requires installed Playwright Chromium (`npx playwright install chromium` if needed). It restores the settings in `atomm/media-project-v3.json`, generates fresh terrain, and requires both a successful USGS survey response and the app's surveyed-data notice before saving screenshots. Public API responses are relayed through Playwright without localhost Origin/Referer headers; their data is unchanged. Use a normal frontend, not an end-to-end test build, and avoid editing app files during capture because hot reload can reset the terrain.

The captured project is 406.4 × 270.933 mm with 3.175 mm material, requested 4× terrain exaggeration, 1.75× water-depth exaggeration, and Fit lake depth enabled. Layer limits can reduce the applied terrain scale. Attribution and coverage warnings remain visible in the studio screenshot.

Regenerate after changes to the UI, theme, survey data, or `TerrainIllustration.svelte`; visually inspect both PNGs before committing. No AI-generated terrain is used.

## Atomm Tips pictures

`apps/generator/src/lib/atomm/tips/*.webp` are the pictures in the Atomm embed's Tips walkthrough, one per step. Each is an unaltered crop of what the studio draws inside the embed (light canvas, rails and overlays hidden) for the bundled Crater Lake project after real terrain has loaded: the map selection, the exploded and assembled 3D stack, a cut layer, the Export view and a close-up of its cut and score lines. Captures are 960 × 534 for the platform's 480 × 267 media band. Regenerate after changes to the embed, the Export view or the 3D preview, against a frontend with a working map API:

```sh
node scripts/dev/capture-atomm-tips.mjs
```

It needs cwebp on PATH and honours `TOPOSTACK_APP_URL` like the other capture scripts. Look at every picture before committing.

## Atomm listing refresh

Run `TOPOSTACK_APP_URL=http://127.0.0.1:5284 node scripts/dev/capture-atomm-listing.mjs` against a normal frontend with the deployed data API. Requires Playwright Chromium and ffmpeg (`FFMPEG_PATH` can select its executable). On macOS, set `TOPOSTACK_CAPTURE_GPU=1` to use installed Google Chrome with Metal acceleration; software rendering remains the default fallback. The script captures the current embedded UI, captures 3200 × 2400 gallery cards and renders 360 distinct native 3D frames for a 60 fps orbit/explode loop. A capture-only response hook exposes the existing renderer without modifying shipped code. Native model stills render at their presentation resolution, avoiding enlarged crops. Warnings are dismissed before promotional screenshots. The feature tour combines the native loop with moving gallery scenes and short fades. It records project settings, source attribution, hashes and successful survey requests in `atomm/media-provenance.json`. Historical assets and their v5 provenance remain on disk. Run Tips capture first and avoid source edits during capture, because hot reload resets the studio. Tips hashes and capture details are recorded beside the WebP assets in `media-provenance.json`.
