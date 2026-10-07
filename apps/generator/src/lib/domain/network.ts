export const NETWORK_TIMEOUT_MS = 20_000;

/** The caller's signal, if any, combined with the standard network deadline. */
export function networkSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
