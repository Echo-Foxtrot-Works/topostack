export const CLOUDFLARE_TIMEOUT_MS = 30_000;

/** Do not include provider response bodies in errors: some APIs return credentials. */
export function cloudflareClient(accountId = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN, request = fetch) {
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId) || !token) throw new Error("A Cloudflare account ID and API token are required.");
  return async (path, init = {}) => {
    // A caller's signal (e.g. a shorter deadline or cancellation) still applies alongside the default timeout.
    const timeout = AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS);
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    let payload;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      throw new Error(`Cloudflare API request failed (${response.status}; response was not JSON).`);
    }
    const codes = Array.isArray(payload?.errors) ? payload.errors.map((error) => error?.code).join(",") : "";
    if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare API request failed (${response.status}; codes: ${codes}).`);
    return payload.result;
  };
}
