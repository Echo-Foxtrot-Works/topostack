import { registerAirspaceStage } from "@topostack/core";

let loading: Promise<void> | undefined;

/**
 * Load the airspace stage into this JavaScript realm and register it, once.
 * Only projects that build airspace in acrylic pay for it; a failed chunk load
 * is forgotten so the next generation tries again.
 */
export function ensureAirspaceStage(): Promise<void> {
  loading ??= import("@topostack/core/airspace")
    .then(({ buildAirspaceStack }) => registerAirspaceStage(buildAirspaceStack))
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
