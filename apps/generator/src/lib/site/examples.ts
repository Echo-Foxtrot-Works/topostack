import { EXAMPLES_HOME, SITE_ORIGIN, type SocialImage } from "./site.ts";
import type { PageSeo } from "./seo.ts";
import { KM_PER_DEGREE_LAT, kmPerDegreeLon } from "./geo.ts";

/**
 * Worked example projects. Each one is a real TopoStack project: the capture
 * script (scripts/dev/capture-examples.mjs) builds its settings with
 * `exampleProject`, generates terrain in the studio, and saves the render, the
 * sharing card, an importable project file and the measured results to
 * `static/examples/<slug>.json`. Pages read those measurements rather than
 * hand-typed numbers, so the copy always matches the picture.
 *
 * Crater Lake predates this registry and keeps its own route.
 */

export interface ExampleConfig {
  slug: string;
  place: string;
  region: string;
  /** Map center and the ground width the cut size spans. */
  center: { lat: number; lon: number };
  groundWidthKm: number;
  shape: "rectangle" | "circle";
  widthMm: number;
  heightMm: number;
  verticalExaggeration: number;
  waterDepthExaggeration?: number;
  /** One or two plain sentences on what makes the place a good piece. */
  summary: string;
  /** Why the settings are what they are. */
  notes: string[];
  keywords: string;
  /** Set while an example must not be published, with the reason. */
  draft?: string;
  published: string;
  updated: string;
}

/** The results a capture measured; written by the capture script. */
export interface ExampleCapture {
  capturedAt: string;
  layers: number;
  reliefM: number;
  heightMm: number;
  surveyed: boolean;
}

const MATERIAL_MM = 3.175;

export const ALL_EXAMPLES: readonly ExampleConfig[] = [
  {
    slug: "grand-canyon",
    place: "Grand Canyon",
    region: "Arizona, USA",
    center: { lat: 36.095, lon: -112.12 },
    groundWidthKm: 24,
    shape: "rectangle",
    widthMm: 406.4,
    heightMm: 270.933,
    verticalExaggeration: 1.5,
    summary: "The canyon around Grand Canyon Village drops from the South Rim to the Colorado River through stepped cliffs and buttes, which layered sheets show especially well.",
    notes: [
      "The canyon is already deep compared with its width, so a low vertical exaggeration keeps the buttes from turning into spikes.",
      "Framing the rim, Bright Angel Canyon and a stretch of the river gives the piece both edges of the canyon.",
    ],
    keywords: "Grand Canyon topographic map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
  {
    slug: "yosemite-valley",
    place: "Yosemite Valley",
    region: "California, USA",
    center: { lat: 37.735, lon: -119.585 },
    groundWidthKm: 16,
    shape: "rectangle",
    widthMm: 406.4,
    heightMm: 270.933,
    verticalExaggeration: 1.25,
    summary: "Half Dome, El Capitan and the valley floor sit within a few kilometers of each other, so a small area holds a lot of recognizable relief.",
    notes: [
      "Granite walls rise steeply from a flat valley, so the relief needs little exaggeration.",
      "The frame runs along the valley from El Capitan to Half Dome so both landmarks fit on one board.",
    ],
    keywords: "Yosemite topographic map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
  {
    slug: "mount-rainier",
    place: "Mount Rainier",
    region: "Washington, USA",
    center: { lat: 46.853, lon: -121.76 },
    groundWidthKm: 30,
    shape: "circle",
    widthMm: 300,
    heightMm: 300,
    verticalExaggeration: 2,
    summary: "A single volcano standing far above its surroundings makes a striking round piece, with ridges and glacier valleys radiating from the summit.",
    notes: [
      "A circle keeps the summit at the center and the ridges evenly spaced around it.",
      "At this scale a 2× exaggeration lifts the summit cone clearly above the surrounding ridges.",
    ],
    keywords: "Mount Rainier topographic map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
  {
    slug: "mount-fuji",
    place: "Mount Fuji",
    region: "Shizuoka and Yamanashi, Japan",
    center: { lat: 35.3606, lon: 138.7274 },
    groundWidthKm: 30,
    shape: "circle",
    widthMm: 300,
    heightMm: 300,
    verticalExaggeration: 2.5,
    summary: "Fuji’s near-symmetrical cone turns into evenly nested rings when cut in layers, one of the cleanest shapes a layered map can show.",
    notes: [
      "Evenly spaced contours on a symmetrical cone make each layer a slightly smaller ring, which reads clearly from across a room.",
      "Fuji’s lower slopes are gentle, so a 2.5× exaggeration gives the cone a clear profile. A circle centered on the crater matches its shape.",
    ],
    keywords: "Mount Fuji topographic map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
  {
    slug: "matterhorn",
    place: "Matterhorn",
    region: "Valais, Switzerland and Aosta Valley, Italy",
    center: { lat: 45.9763, lon: 7.6586 },
    groundWidthKm: 14,
    shape: "rectangle",
    widthMm: 300,
    heightMm: 300,
    verticalExaggeration: 1.5,
    summary: "The Matterhorn’s steep pyramid and the glaciers around it give a compact, dramatic relief from a small area.",
    notes: [
      "Alpine relief is already steep, so exaggeration stays modest to keep the summit from turning needle-thin.",
      "A square frame keeps the peak central with room for the surrounding ridges.",
    ],
    keywords: "Matterhorn topographic map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
  {
    slug: "lake-tahoe",
    place: "Lake Tahoe",
    region: "California and Nevada, USA",
    center: { lat: 39.095, lon: -120.035 },
    groundWidthKm: 30,
    shape: "rectangle",
    widthMm: 270.933,
    heightMm: 406.4,
    verticalExaggeration: 3,
    waterDepthExaggeration: 1,
    summary: "Lake Tahoe is one of the deepest lakes in North America, and the USGS multibeam survey of its floor gives a lake map real depth instead of a flat hole.",
    notes: [
      "A portrait frame fits the lake’s north–south length and the mountains on both shores.",
      "The surveyed lake floor is deep compared with the land relief, so depth exaggeration stays at 1× and the studio adds the depth sheets it needs.",
    ],
    keywords: "Lake Tahoe depth map",
    published: "2026-09-21",
    updated: "2026-09-25",
  },
];

/** Published examples; drafts are captured on request but get no page. */
export const EXAMPLES: readonly ExampleConfig[] = ALL_EXAMPLES.filter((example) => !example.draft);

export const examplePath = (slug: string): string => `${EXAMPLES_HOME}/${slug}`;

export function exampleImage(example: ExampleConfig): SocialImage {
  return { url: `/images/examples/${example.slug}-card.jpg`, width: 1200, height: 630, alt: `${example.place} layered topographic map generated in TopoStack.` };
}

/** Ground bounds for the cut size: the width spans `groundWidthKm`, the height follows the cut's aspect ratio. */
export function exampleBounds(example: ExampleConfig): { west: number; south: number; east: number; north: number } {
  const halfLon = example.groundWidthKm / kmPerDegreeLon(example.center.lat) / 2;
  const halfLat = (example.groundWidthKm * example.heightMm / example.widthMm) / KM_PER_DEGREE_LAT / 2;
  return { west: example.center.lon - halfLon, south: example.center.lat - halfLat, east: example.center.lon + halfLon, north: example.center.lat + halfLat };
}

/**
 * A complete project for the example, built on a template project so every
 * other setting matches the Crater Lake example.
 */
export function exampleProject<T extends Record<string, unknown>>(template: T, example: ExampleConfig): T {
  return {
    ...template,
    id: `topostack-example-${example.slug}`,
    name: `${example.place} · TopoStack example`,
    location: { lat: example.center.lat, lon: example.center.lon, label: `${example.place}, ${example.region}`, zoom: example.groundWidthKm > 35 ? 10 : 11, bounds: exampleBounds(example) },
    cropShape: example.shape,
    outputMode: "stack",
    widthMm: example.widthMm,
    heightMm: example.heightMm,
    materialThicknessMm: MATERIAL_MM,
    verticalExaggeration: example.verticalExaggeration,
    showWaterDepth: true,
    waterDepthExaggeration: example.waterDepthExaggeration ?? 1,
    fitLakeDepth: false,
    markers: [],
    customLines: [],
    explodedPreview: 0,
  };
}

export function exampleMeta(example: ExampleConfig): { title: string; description: string } {
  return {
    title: `${example.keywords.replace(/\b\w/g, (letter) => letter.toUpperCase())}: A Laser-Cut Project | TopoStack`,
    description: `Make a layered ${example.place} map from real elevation data. See the finished render and the settings used, then open the project in TopoStack.`,
  };
}

export function examplePageSeo(example: ExampleConfig): PageSeo {
  const path = examplePath(example.slug);
  const { title, description } = exampleMeta(example);
  return {
    title,
    description,
    canonical: SITE_ORIGIN + path,
    registered: true,
    image: exampleImage(example),
    article: { headline: title.replace(/\s*\|\s*TopoStack$/, ""), published: example.published, updated: example.updated },
    breadcrumbs: [
      { name: "TopoStack", item: SITE_ORIGIN + "/" },
      { name: "Examples", item: SITE_ORIGIN + EXAMPLES_HOME },
      { name: example.place, item: SITE_ORIGIN + path },
    ],
  };
}
