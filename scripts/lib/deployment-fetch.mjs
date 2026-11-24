async function retryVerification(action, { verificationTimeoutMs = 180_000, retryDelayMs = 3_000 } = {}) {
  let lastError;
  const deadline = Date.now() + verificationTimeoutMs;
  let attempt = 0;
  do {
    attempt += 1;
    try {
      return await action();
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (Date.now() + retryDelayMs >= deadline) break;
      console.warn(`Deployment verification attempt ${attempt} failed: ${error.message}; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

export function fetchWithRetry(base, path, init, options = {}) {
  const { allowRolloutStatuses = false, readResponse = (response) => response } = options;
  return retryVerification(async () => {
    const response = await fetch(new URL(path, base), {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = new Error(`${init?.method ?? "GET"} ${path} returned HTTP ${response.status}`);
      // During rollout, an edge can still serve the previous origin policy
      // or route table. Ordinary monitoring must still fail these immediately.
      error.retryable = response.status >= 500 || response.status === 429
        || (allowRolloutStatuses && [403, 404].includes(response.status));
      await response.body?.cancel();
      throw error;
    }
    return await readResponse(response);
  }, options);
}

/** A previous edge deployment can be healthy during propagation. Retry its 200 as well. */
export function revisionJson(base, path, commit, options) {
  const url = new URL(path, base);
  if (commit) url.searchParams.set("revision", commit);
  return fetchWithRetry(base, url.pathname + url.search, { cache: "no-store", headers: { accept: "application/json" } }, {
    ...options,
    readResponse: async (response) => {
      const value = await response.json();
      const actual = path === "/version.json" ? value.commit : value.deployment?.commit;
      if (commit && (actual !== commit || (path !== "/version.json" && !value.deployment?.id))) {
        throw new Error(`${path} served revision ${actual ?? "unknown"}, expected ${commit} and its deployment identity`);
      }
      return value;
    },
  });
}

export function releaseEvidence(base, commit, environment, options = {}) {
  // On a rollout mismatch re-read the entire group, including the active archive heads.
  return retryVerification(() => collectEvidence(base, commit, environment, { ...options, verificationTimeoutMs: 0 }), options);
}

async function collectEvidence(base, commit, environment, options) {
  const [frontend, readiness, manifest] = await Promise.all(
    ["/version.json", "/ready", "/v1/manifest"].map((path) => revisionJson(base, path, commit, options)),
  );
  if (frontend.environment !== environment || readiness.environment !== environment || readiness.status !== "ready"
    || !manifest.datasetVersion || !frontend.version || !manifest.deployment?.id || readiness.deployment?.id !== manifest.deployment.id) {
    throw new Error("Frontend, readiness and manifest do not identify one ready deployment");
  }
  await Promise.all([["vectorData", "/v1/osm.pmtiles"], ["lakeData", "/v1/lakes.pmtiles"]].map(async ([key, path]) => {
    const head = readiness.dependencies?.[key];
    if (head?.status !== "available" || !head.etag || !Number.isSafeInteger(head.bytes) || head.bytes < 1) {
      throw new Error(`Readiness did not identify the active ${key} archive`);
    }
    await fetchWithRetry(base, path, { headers: { range: "bytes=0-0" }, cache: "no-store" }, {
      ...options,
      readResponse: async (response) => {
        await response.body?.cancel();
        if (response.status !== 206 || response.headers.get("etag") !== head.etag
          || response.headers.get("x-topostack-dataset") !== manifest.datasetVersion
          || response.headers.get("content-range") !== `bytes 0-0/${head.bytes}`) {
          throw new Error(`${path} range identity differs from readiness`);
        }
      },
    });
  }));
  if (!options.deploymentBase) return { frontend, readiness, manifest };
  const deploymentHealth = await revisionJson(options.deploymentBase, "/health", commit, options);
  const publicHealth = new URL(options.deploymentBase).origin === new URL(base).origin ? deploymentHealth : await revisionJson(base, "/health", commit, options);
  if ([deploymentHealth, publicHealth].some(health => health.deployment.id !== manifest.deployment.id)) {
    throw new Error("Public and deployment origins serve different Worker versions");
  }
  return { frontend, readiness, manifest, publicHealth, deploymentHealth };
}
