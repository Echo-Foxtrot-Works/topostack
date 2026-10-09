import type { ProjectConfigV1 } from "@topostack/core/project";
import type { AreaCoverage } from "./coverage";

export interface AttributionEntry { name: string; license: string; url?: string }

/**
 * Credit for the data behind an agent response. Anything shown or passed on
 * from these responses must keep it; the full notice list is on the site's
 * attribution page.
 */
export interface Attribution {
  text: string;
  sources: AttributionEntry[];
  fullNotice: string;
}

const BASE: AttributionEntry[] = [
  { name: "Mapzen Terrain Tiles", license: "Composite terrain dataset; see the full notice for its sources", url: "https://registry.opendata.aws/terrain-tiles/" },
  { name: "OpenStreetMap contributors", license: "ODbL", url: "https://www.openstreetmap.org/copyright" },
  { name: "HydroLAKES v1.0", license: "CC BY 4.0 — Messager et al. (2016)", url: "https://www.hydrosheds.org/products/hydrolakes" },
  { name: "GLOBathy", license: "CC0 1.0 — Khazaei et al. (2022)", url: "https://doi.org/10.1038/s41597-022-01132-9" },
];

const GEOCODER: AttributionEntry = { name: "Geoapify place search", license: "© OpenStreetMap contributors (ODbL)", url: "https://www.geoapify.com/" };

/** True when a project draws any FAA aviation detail (identifiers alone draw nothing) or builds airspace in acrylic over a layered model. */
export function projectDrawsAviation(project: Pick<ProjectConfigV1, "aviation" | "airspaceStack" | "outputMode">): boolean {
  if (project.airspaceStack && project.outputMode === "stack") return true;
  return Object.entries(project.aviation ?? {}).some(([key, enabled]) => key !== "labels" && enabled === true);
}

export function attributionFor(origin: string, coverage?: AreaCoverage, options: { geocoder?: boolean; aviation?: boolean } = {}): Attribution {
  const aviation = options.aviation && coverage?.aviation;
  const regional: AttributionEntry[] = [
    ...(coverage?.terrain.highResolution ?? []).map(({ name, license }) => ({ name, license })),
    ...(coverage?.lakeSurveys ?? []).map(({ name, license }) => ({ name, license })),
    ...(aviation ? [{ name: `${aviation.name}, NASR cycle ${aviation.nasrCycle}`, license: aviation.license }] : []),
  ];
  const sources = [...BASE, ...regional, ...(options.geocoder ? [GEOCODER] : [])];
  return {
    text: `Terrain: Mapzen Terrain Tiles and its sources · Map data © OpenStreetMap contributors (ODbL) · Lakes: HydroLAKES (CC BY 4.0), GLOBathy (CC0)${regional.length ? ` · ${regional.map(({ name }) => name).join(", ")}` : ""}${options.geocoder ? " · Search by Geoapify" : ""}`,
    sources,
    fullNotice: new URL("/attribution", origin).toString(),
  };
}
