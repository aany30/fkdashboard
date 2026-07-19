/**
 * Tiny in-memory TTL cache for Bid Manager report payloads (and their
 * queryIds). Serverless-friendly: best-effort within a warm instance; cold
 * starts simply refetch. Keyed by a serialized (advertiser, range, dims,
 * filters) tuple built by the caller.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 100;

export class TTLCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU bump
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Parsed report rows, ~15 min TTL. */
export const reportCache = new TTLCache<Array<Record<string, string | number>>>(15 * 60 * 1000);

/** In-flight query ids so a resumed/duplicate request can skip queries.create. */
export const queryIdCache = new TTLCache<{ queryId: string; reportId: string }>(10 * 60 * 1000);

/** DV360 entity hierarchy (campaigns/IOs/LIs/ad-groups), 10 min TTL.
 *  Keyed by advertiserId so the 6 parallel entity API calls are only made
 *  once per warm server instance per account — subsequent requests within the
 *  window skip the ~3-8s entity round-trip entirely.
 *  NOTE: creatives are cached separately in creativeEntityCache so a timeout
 *  on the first fetch does not poison the main entity cache. */
export const entityCache = new TTLCache<{
  advertiser: unknown;
  campaigns: unknown[];
  insertionOrders: unknown[];
  lineItems: unknown[];
  adGroups: unknown[];
  adGroupAds: unknown[];
}>(10 * 60 * 1000);

/** DV360 creative entities (creativeId → displayName/type), 20 min TTL.
 *  Stored separately from entityCache: if listCreatives() times out on the
 *  first call, the main entity cache is unaffected and creatives will be
 *  retried on subsequent requests until a successful fetch is stored here. */
export const creativeEntityCache = new TTLCache<Array<{
  creativeId: string;
  displayName: string;
  creativeType?: string;
}>>(20 * 60 * 1000);

/** DV360 audience-list route payload (audiences + optional targeting), 10 min
 *  TTL. Keyed by advertiserId. The fallback path scans line-item targeting and
 *  can take tens of seconds on a cold call — cache makes repeat loads instant. */
export const audienceCache = new TTLCache<unknown>(10 * 60 * 1000);

export function reportCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(parts, Object.keys(parts).sort());
}
