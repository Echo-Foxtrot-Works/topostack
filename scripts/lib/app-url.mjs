/**
 * The studio a browser script drives: TOPOSTACK_APP_URL, else the script's own
 * older variable (still honoured), else the dev server `npm run dev` starts.
 * A trailing slash is dropped so callers can append paths.
 * @param {...string} legacy older per-script variable names
 */
export function appUrl(...legacy) {
  for (const name of ["TOPOSTACK_APP_URL", ...legacy]) {
    const value = process.env[name];
    if (value) return value.replace(/\/+$/, "");
  }
  return `http://localhost:${process.env.TOPOSTACK_WEB_PORT || 5273}`;
}
