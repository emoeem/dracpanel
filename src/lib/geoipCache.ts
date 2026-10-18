import {
  GeoIpUnavailableError,
  PanelAuthError,
  getGeoIp,
  type GeoIpInfo,
} from "../api/panel";

const GEOIP_CACHE_LIMIT = 500;

const cache = new Map<string, GeoIpInfo | null>();
const pending = new Map<string, Promise<GeoIpInfo | null>>();
let unavailable = false;

export function isGeoIpUnavailable(): boolean {
  return unavailable;
}

export function clearGeoIpCache(): void {
  cache.clear();
  pending.clear();
  unavailable = false;
}

function remember(ip: string, info: GeoIpInfo | null): void {
  cache.set(ip, info);
  if (cache.size > GEOIP_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

/**
 * Shared GeoIP lookup with a bounded LRU and per-IP in-flight deduplication.
 * Private/unresolvable addresses are cached as null; a 503 disables further
 * lookups for this page session so a missing database does not cause a retry
 * storm for every new connection.
 */
export function lookupGeoIp(ip: string): Promise<GeoIpInfo | null> {
  if (unavailable) {
    return Promise.resolve(null);
  }
  if (cache.has(ip)) {
    const value = cache.get(ip) ?? null;
    cache.delete(ip);
    cache.set(ip, value);
    return Promise.resolve(value);
  }
  const inFlight = pending.get(ip);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const task = getGeoIp(ip)
    .then((info) => {
      remember(ip, info);
      return info;
    })
    .catch((error: unknown) => {
      if (error instanceof GeoIpUnavailableError) {
        unavailable = true;
      } else if (!(error instanceof PanelAuthError)) {
        // A failed lookup should not be retried for every stream snapshot.
        remember(ip, null);
      }
      throw error;
    })
    .finally(() => {
      pending.delete(ip);
    });
  pending.set(ip, task);
  return task;
}
