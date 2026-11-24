import { sourceAvailableIn, type SurveySource } from "@topostack/data-contracts/source-catalog";

/**
 * The deployment whose registered data this build may load. Development
 * servers and the dev site load sources still waiting on a licence approval;
 * production and Atomm builds never see them, and the production Worker would
 * refuse their archives anyway.
 */
export const DATA_ENVIRONMENT: "development" | "production" =
  import.meta.env.DEV || import.meta.env.VITE_SITE_ENV === "development" ? "development" : "production";

/** The registered sources this build may load. */
export function servedSources<T extends Pick<SurveySource, "availability">>(sources: readonly T[], environment: string = DATA_ENVIRONMENT): T[] {
  return sources.filter((source) => sourceAvailableIn(source, environment));
}
