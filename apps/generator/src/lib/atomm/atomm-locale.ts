// TopoStack currently ships English copy. Read the host locale once, while
// keeping the document language truthful when a translation is unavailable.
export async function readAtommLocale(sdk: { app: Pick<AtommSdk["app"], "getLocale"> }): Promise<string> {
  try {
    const locale = (await sdk.app.getLocale()).toLowerCase().split("-")[0] ?? "";
    return ["en"].includes(locale) ? locale : "en";
  } catch {
    return "en";
  }
}
