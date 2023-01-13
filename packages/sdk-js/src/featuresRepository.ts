// feature-repo.ts
import { FeatureDefinition } from ".";

export type ApiHost = string;
export type ClientKey = string;
export type RepositoryKey = `${ApiHost}||${ClientKey}`;

export type FeatureApiResponse = {
  features: Record<string, FeatureDefinition>;
  encryptedFeatures?: string;
};

type CacheEntry = {
  data: FeatureApiResponse;
  staleAt: Date;
};

const cacheTTL = 1000 * 60; // 1 minute

const cache: Map<RepositoryKey, CacheEntry> = new Map();
loadPersistentCache();

// TODO: populate initial cache from localStorage (if available)

// Fetch with debouncing
const activeFetches: Map<
  RepositoryKey,
  Promise<FeatureApiResponse>
> = new Map();
async function fetchFeatures(
  key: RepositoryKey
): Promise<FeatureApiResponse | null> {
  let promise = activeFetches.get(key);
  if (!promise) {
    const [apiHost, clientKey] = key.split("||");
    const url = `${apiHost}/api/features/${clientKey}`;
    // TODO: allow configuring which 'fetch' implementation is used
    promise = globalThis
      // TODO: timeout using AbortController
      .fetch(url)
      // TODO: auto-retry if status code indicates a temporary error
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return Promise.resolve(null);
      })
      .finally(() => {
        activeFetches.delete(key);
      });
    activeFetches.set(key, promise);
  }
  return await promise;
}

export async function loadFeatures(
  apiHost: string,
  clientKey: string
): Promise<FeatureApiResponse | null> {
  const key: RepositoryKey = `${apiHost}||${clientKey}`;
  let entry = cache.get(key);
  if (!entry) {
    const data = await fetchFeatures(key);
    if (!data) return null;
    entry = {
      data,
      staleAt: new Date(Date.now() + cacheTTL),
    };
    cache.set(key, entry);
    savePersistentCache();
  }

  // Refresh in the background if stale
  if (entry.staleAt < new Date()) {
    fetchFeatures(key).catch((e) => {
      console.error(e);
    });
  }

  return entry.data;
}

function loadPersistentCache() {
  if (typeof globalThis?.localStorage === "object") {
    const lsCacheEntry = globalThis.localStorage.getItem(
      "growthbook:cache:features"
    );
    if (lsCacheEntry) {
      try {
        const cacheObj = new Map(JSON.parse(lsCacheEntry));
        // eslint-disable-next-line
        cacheObj.forEach((value: any, key: any) => {
          value.staleAt = new Date(value.staleAt);
          if (value.staleAt >= new Date()) {
            cache.set(key as RepositoryKey, value as CacheEntry);
          } else {
            cache.delete(key as RepositoryKey);
          }
        });
      } catch (e) {
        console.error(e);
      }
    }
  }
}

function savePersistentCache() {
  if (typeof globalThis?.localStorage === "object") {
    const cacheObj = Array.from(cache.entries());
    globalThis.localStorage.setItem(
      "growthbook:cache:features",
      JSON.stringify(cacheObj)
    );
  }
}
