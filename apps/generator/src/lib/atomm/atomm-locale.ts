import { currentLocale, setLocale } from "$lib/i18n/i18n.svelte";

/**
 * Read the platform's language once and load its copy before the workbench
 * renders (Atomm reloads the page when the language changes, so there is
 * nothing to subscribe to). Resolves to the BCP 47 tag for `<html lang>`:
 * English only when the host cannot answer, which Atomm allows only outside
 * the platform.
 */
export async function readAtommLocale(sdk: { app: Pick<AtommSdk["app"], "getLocale"> }): Promise<string> {
  let code: string | undefined;
  try {
    code = await sdk.app.getLocale();
  } catch {
    code = undefined;
  }
  await setLocale(code);
  return currentLocale();
}
