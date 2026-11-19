// The English catalog, the source every other locale translates. One JSON
// file per area keeps unrelated work apart; a key is `<area>.<name>`, e.g.
// `water.acrylicInserts`. Add an area here and in AREAS (i18n.svelte.ts).
import app from "./app.json";
import aviation from "./aviation.json";
import customdata from "./customdata.json";
import domain from "./domain.json";
import features from "./features.json";
import labels from "./labels.json";
import place from "./place.json";
import preview from "./preview.json";
import status from "./status.json";
import terrain from "./terrain.json";
import tips from "./tips.json";
import warnings from "./warnings.json";
import water from "./water.json";
import workbench from "./workbench.json";

type Area<Prefix extends string, Messages> = { [Key in keyof Messages & string as `${Prefix}.${Key}`]: string };

function area<Prefix extends string, Messages extends Record<string, string>>(prefix: Prefix, messages: Messages): Area<Prefix, Messages> {
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [`${prefix}.${key}`, value])) as Area<Prefix, Messages>;
}

export const en = {
  ...area("app", app),
  ...area("aviation", aviation),
  ...area("customdata", customdata),
  ...area("domain", domain),
  ...area("features", features),
  ...area("labels", labels),
  ...area("place", place),
  ...area("preview", preview),
  ...area("status", status),
  ...area("terrain", terrain),
  ...area("tips", tips),
  ...area("warnings", warnings),
  ...area("water", water),
  ...area("workbench", workbench),
};

export type MessageKey = keyof typeof en;
