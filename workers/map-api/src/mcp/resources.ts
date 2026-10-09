import { PROJECT_REQUEST_LIMITS, PROJECT_REQUEST_SCHEMA } from "@topostack/core/project";
import { buildManifest } from "../manifest";
import { aviationSources, bathymetryArchives, terrainArchives } from "../routes/archive";
import { PREVIEW_URI, previewListing, readPreview } from "./app-resource";
import { RPC_ERRORS, RpcError } from "./protocol";

/**
 * Read-only reference an agent can pull into context: how to choose a model,
 * where the data comes from, and the request schema.
 */
interface ResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  read: (context: { siteOrigin: string; datasetVersion: string }) => string;
}

/** The material and sizing guide, also the body of the published agent skill (routes/discovery.ts). */
export const makingAModelGuide = (siteOrigin: string) => `# Making a TopoStack model

TopoStack turns real terrain into laser-cutter files. Files are generated and exported in the TopoStack studio in the browser; these tools plan a model and hand it over as a studio link.

## Layered or flat

- **layered** (default): a stack of cut sheets that rebuilds the terrain in 3D. Each sheet covers one band of elevation; lakes can be carved below the shoreline. Good for plywood, MDF, acrylic, cardboard.
- **flat**: one sheet engraved with contour lines, roads, water and labels. Nothing is stacked; set how many contours with \`contourCount\` (${PROJECT_REQUEST_LIMITS.contourCount.min}–${PROJECT_REQUEST_LIMITS.contourCount.max}).

## What decides the number of sheets

The layer count is never set directly. The model's width over the ground width fixes the horizontal scale; the terrain's relief at that scale, times \`verticalExaggeration\`, gives the stack height; and \`materialThicknessMm\` divides it into whole sheets (at least two).

- Thicker material: fewer, coarser sheets.
- More exaggeration or a wider model: taller stack, more sheets.
- A smaller area on the same model size: larger scale, taller relief, more sheets.

Typical materials: 3 mm plywood or MDF, 1.5–3 mm acrylic, 2 mm chipboard. Many hobby lasers cut 3 mm comfortably. Big mountains at small scales can need 40+ sheets; if a plan says so, suggest thicker material, less exaggeration, or a smaller model.

## Size and the laser bed

\`widthMm\` × \`heightMm\` is the finished model (default 300 × 200 mm). If it is larger than the laser's bed, set \`laser.workAreaWidthMm\` and \`laser.workAreaHeightMm\`: each sheet is split into pieces with alignment tabs. \`laser.kerfMm\` (default 0.15) compensates for the beam width.

## Choosing the area

- \`{ center: { lat, lon }, widthKm }\`: a place and how much ground to show across. A single mountain is often 10–30 km; a lake 5–40 km; a city 15–30 km.
- \`{ bounds: { west, south, east, north } }\`: keep a whole box in view; it is widened to the model's proportions.

Coverage is Web Mercator (±85° latitude). A box crossing the antimeridian has west greater than east, as in GeoJSON. Terrain is land elevation; the sea is cut flat, and lakes use surveyed depths where they exist (see check_coverage).

## Details

Water, water depth, roads, trails, elevation labels, a north arrow and a scale bar are on by default; road labels, boundaries and a coordinate grid are off. In the United States, \`aviation\` adds FAA detail like a VFR sectional's: \`airspace\` (Class B, C and D), \`specialUse\`, \`runways\`, \`airports\`, \`navaids\`, \`obstacles\` and \`labels\` (identifiers and airspace altitudes), all off unless set. It is decorative and never for navigation; check_coverage says whether an area has it. A \`title\` of up to three lines is engraved on the model; \`markers\` add up to ${PROJECT_REQUEST_LIMITS.markers} engraved points of interest.

\`airspaceStack\` builds the Class B, C and special use airspace (and optionally Class D lids) over a layered US model in acrylic, at true height on the model's own vertical scale, held on rods the maker cuts to length; like the aviation detail, it is decorative and never for navigation. Choose \`form\`: \`plates\` (clear plates where airspace starts or ends), \`tiers\` (the tinted wedding cake) or \`volumes\` (solid, and acrylic-hungry). A whole Class B needs a 100–160 km area and about 10× \`verticalExaggeration\` before its shelves separate; plan_model estimates the height, and \`ceilingCapFt\` keeps it practical. \`false\` turns it off.

## Handing over

Share the studio link. Opening it generates the model; the user checks the 3D preview, then chooses Export for per-sheet SVG files, a master layout, an assembly guide, and ATTRIBUTION.txt. Output is decorative, not survey-grade.

## Credit

Terrain comes from Mapzen Terrain Tiles and their sources, map data from OpenStreetMap contributors (ODbL), and lakes from HydroLAKES (CC BY 4.0) and GLOBathy (CC0). Keep the attribution each tool returns with anything you show. Full notice: ${new URL("/attribution", siteOrigin).toString()}
`;

export const RESOURCES: ResourceDefinition[] = [
  {
    uri: "topostack://guide/making-a-model",
    name: "making-a-model",
    title: "Making a TopoStack model",
    description: "Layered vs flat output, what sets the number of sheets, materials, laser bed size, choosing an area, and handing over to the studio.",
    mimeType: "text/markdown",
    read: ({ siteOrigin }) => makingAModelGuide(siteOrigin),
  },
  {
    uri: "topostack://data/sources",
    name: "data-sources",
    title: "TopoStack data sources and licenses",
    description: "Every terrain, lake and map source TopoStack draws from, with its license and coverage.",
    mimeType: "application/json",
    read: ({ datasetVersion }) => JSON.stringify(buildManifest(datasetVersion, terrainArchives, bathymetryArchives, aviationSources), null, 2),
  },
  {
    uri: "topostack://schema/project-request-v1",
    name: "project-request-v1",
    title: "Project request schema (v1)",
    description: "JSON Schema for the model request plan_model and create_studio_link accept.",
    mimeType: "application/schema+json",
    read: () => JSON.stringify(PROJECT_REQUEST_SCHEMA, null, 2),
  },
];

export interface ResourceContext { siteOrigin: string; apiOrigin: string; datasetVersion: string; assets?: Fetcher }

export function resourceListings(context: Pick<ResourceContext, "apiOrigin">) {
  return [...RESOURCES.map(({ read: _read, ...resource }) => resource), previewListing(context.apiOrigin)];
}

export async function readResource(uri: string, context: ResourceContext) {
  if (uri === PREVIEW_URI) return readPreview(context.assets, context.apiOrigin);
  const resource = RESOURCES.find((entry) => entry.uri === uri);
  if (!resource) throw new RpcError(RPC_ERRORS.resourceNotFound, "Resource not found.", { uri });
  return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.read(context) }] };
}
