/**
 * DV360 API client — Display & Video 360 API v4 (entities + Floodlight) and
 * Bid Manager API v2 (performance reports).
 *
 * Auth: standard Google OAuth refresh-token grant. The user supplies an OAuth
 * client (id + secret) and a refresh token minted via OAuth Playground with
 * scopes:
 *   https://www.googleapis.com/auth/display-video
 *   https://www.googleapis.com/auth/doubleclickbidmanager
 * No developer token is needed (unlike the Google Ads API).
 *
 * Reporting is ASYNCHRONOUS (unlike Meta): create query → run → poll →
 * download CSV from a public GCS URL → parse. runBidManagerReport() wraps that
 * with a poll budget and a {queryId, reportId} resume protocol so serverless
 * routes can return 202-pending and let the client retry.
 */

const DV360_BASE = "https://displayvideo.googleapis.com/v4";
const BM_BASE = "https://doubleclickbidmanager.googleapis.com/v2";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * fetch with a hard wall-clock cap. Google's Bid Manager poll/download endpoints
 * occasionally stall for minutes on a single connection; without this an
 * individual fetch could block the poll loop far past its deadline (the loop
 * only checks the deadline between polls). Aborts and throws on timeout.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface DV360Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  advertiserId: string;
  partnerId?: string;
}

// ─── Entity shapes (subset of the v4 resources we consume) ───────────────────

export interface DV360Campaign {
  campaignId: string;
  displayName: string;
  entityStatus: string;              // ENTITY_STATUS_ACTIVE | _PAUSED | _ARCHIVED …
  updateTime?: string;
  campaignGoal?: { campaignGoalType?: string };
  campaignFlight?: { plannedDates?: { startDate?: RawDate; endDate?: RawDate } };
}

export interface DV360InsertionOrder {
  insertionOrderId: string;
  campaignId: string;
  displayName: string;
  entityStatus: string;
  pacing?: { pacingPeriod?: string; pacingType?: string };
  budget?: { budgetSegments?: Array<{ budgetAmountMicros?: string }>; budgetUnit?: string };
}

export interface DV360LineItem {
  lineItemId: string;
  insertionOrderId: string;
  campaignId: string;
  displayName: string;
  entityStatus: string;
  lineItemType?: string;             // LINE_ITEM_TYPE_DISPLAY_DEFAULT | _VIDEO_DEFAULT | _YOUTUBE_AND_PARTNERS_* …
  updateTime?: string;               // ISO timestamp of last update — used as "days since edit" proxy
  flight?: {
    dateRange?: {
      startDate?: { year: number; month: number; day: number };
      endDate?: { year: number; month: number; day: number };
    };
  };
  bidStrategy?: {
    fixedBid?: { bidAmountMicros?: string };
    maximizeSpendAutoBid?: {
      maxAverageCpmBidAmountMicros?: string;
      performanceGoalType?: string;
    };
    performanceGoalAutoBid?: {
      performanceGoalAmountMicros?: string;
      performanceGoalType?: string;
    };
  };
}

export interface DV360AdGroup {
  adGroupId: string;
  lineItemId: string;
  displayName: string;
  entityStatus: string;
  adGroupFormat?: string;
}

export interface DV360AdGroupAd {
  name: string;           // resource name: advertisers/{id}/adGroupAds/{id}
  adGroupAdId: string;
  adGroupId: string;
  displayName: string;
  entityStatus: string;
}

export interface DV360FloodlightActivity {
  floodlightActivityId: string;
  displayName: string;
  servingStatus?: string;            // FLOODLIGHT_ACTIVITY_SERVING_STATUS_ENABLED | _DISABLED
  floodlightGroupId?: string;
  advertiserIds?: string[];
  remarketingEnabled?: boolean;
  sslRequired?: boolean;
}

/** One Floodlight activity, merged from every source that could contribute. */
export interface ResolvedFloodlightActivity {
  id: string;
  name: string;
  hasRealName: boolean;              // false when name is a synthetic "Activity {id}" fallback
  nameSource: "cm360" | "dv360_group" | "bid_manager" | "none";
  type: string;                      // STANDARD | REMARKETING
  clickLookbackDays: number;
  viewLookbackDays: number;
  servingStatus: string;             // ENABLED | DISABLED
  sslRequired: boolean;
  lineItemCount: number;
  activeLineItemCount: number;
}

/** Result of resolveFloodlight() — the unified, multi-path Floodlight picture. */
export interface FloodlightResolution {
  configType: "cm360_hybrid" | "third_party" | "unknown";
  detectionPath: string;             // which source first produced activities
  group: { id: string; name: string } | null;
  cm360: { networkId?: string; floodlightConfigId?: string; accessible: boolean };
  activities: ResolvedFloodlightActivity[];
  notes: string[];                   // honest limitations (no synthetic data)
}

export interface DV360Audience {
  firstAndThirdPartyAudienceId: string;
  displayName: string;
  audienceType: string;       // FIRST_AND_THIRD_PARTY_AUDIENCE_TYPE_FIRST_PARTY | _THIRD_PARTY
  audienceSource: string;     // AUDIENCE_SOURCE_UNSPECIFIED | _CUSTOMER_MATCH_CONTACT_INFO | _ACTIVITY_BASED | etc.
  description?: string;
  membershipDurationDays?: string;
  activeDisplayAudienceSize?: string;  // enum range: e.g. "ONE_HUNDRED_THOUSAND_TO_ONE_MILLION"
  displayDesktopAudienceSize?: string;
  displayMobileWebAudienceSize?: string;
  youtubeAudienceSize?: string;
  gmailAudienceSize?: string;
}

interface RawDate { year?: number; month?: number; day?: number }

/**
 * Run `fn` over `items` with at most `limit` promises in flight at once.
 * Preserves input order in the result. Keeps parallel fan-out fast while
 * staying under DV360's per-endpoint rate limits.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Bid Manager report shapes ────────────────────────────────────────────────

export interface BMReportRequest {
  /** BM filter dimensions, e.g. ["FILTER_MEDIA_PLAN", "FILTER_INSERTION_ORDER"] */
  dimensions: string[];
  /** BM metrics, e.g. ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER"] */
  metrics: string[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  /** Extra filters beyond advertiser, e.g. [{type:"FILTER_MEDIA_PLAN", value:"123"}] */
  filters?: Array<{ type: string; value: string }>;
  /**
   * BM params.type — defaults to "STANDARD".
   * Use "YOUTUBE_AUDIENCE" for age/gender demographic breakdowns (FILTER_AGE /
   * FILTER_GENDER are only valid in YouTube-type reports).
   */
  reportType?: string;
}

export interface BMPending {
  status: "pending";
  queryId: string;
  reportId: string;
}

export interface BMDone {
  status: "done";
  /** Parsed CSV rows: header-keyed records, numbers parsed where possible. */
  rows: Array<Record<string, string | number>>;
}

export type BMResult = BMPending | BMDone;

// Module-level access-token cache keyed by refresh token — survives across
// requests within a warm serverless instance. Expiry-aware with 60s headroom.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class DV360ApiClient {
  constructor(private creds: DV360Credentials) {}

  // ─── OAuth ──────────────────────────────────────────────────────────────────

  async getAccessToken(): Promise<string> {
    const key = this.creds.refreshToken;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const r = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const body = await r.json();
    if (!r.ok || !body.access_token) {
      throw new Error(
        `DV360 token exchange failed: ${body.error_description || body.error || `HTTP ${r.status}`}`
      );
    }
    const token = body.access_token as string;
    tokenCache.set(key, { token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return token;
  }

  private async authedGet<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    const r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 20_000);
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`DV360 GET ${url.replace(DV360_BASE, "").replace(BM_BASE, "").split("?")[0]} failed (HTTP ${r.status}): ${text.slice(0, 300)}`);
    }
    return (await r.json()) as T;
  }

  /**
   * Rename a DV360 entity via v4 PATCH (write — needs the display-video scope,
   * which the OAuth consent grants). `kind` selects the resource collection.
   * Returns {success} — throws are caught by the caller and surfaced.
   */
  async renameEntity(
    kind: "campaign" | "insertionOrder" | "lineItem",
    entityId: string,
    newName: string
  ): Promise<{ success: boolean; error?: string }> {
    const collection =
      kind === "campaign" ? "campaigns" : kind === "insertionOrder" ? "insertionOrders" : "lineItems";
    const token = await this.getAccessToken();
    const url =
      `${DV360_BASE}/advertisers/${this.creds.advertiserId}/${collection}/${entityId}` +
      `?updateMask=displayName`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: newName }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { success: false, error: `DV360 rename failed (HTTP ${r.status}): ${text.slice(0, 300)}` };
    }
    return { success: true };
  }

  /** Paginate a DV360 v4 list endpoint, concatenating `field` across pages. */
  private async listAll<T>(path: string, field: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ pageSize: "200", ...params });
      if (pageToken) qs.set("pageToken", pageToken);
      const data = await this.authedGet<Record<string, unknown>>(`${DV360_BASE}/${path}?${qs.toString()}`);
      const items = (data[field] as T[] | undefined) ?? [];
      out.push(...items);
      pageToken = (data.nextPageToken as string | undefined) ?? "";
      if (!pageToken) break;
    }
    return out;
  }

  // ─── Entities ───────────────────────────────────────────────────────────────

  async getAdvertiser(): Promise<{ advertiserId: string; displayName: string; generalConfig?: { currencyCode?: string } }> {
    return this.authedGet(`${DV360_BASE}/advertisers/${this.creds.advertiserId}`);
  }

  async listCampaigns(): Promise<DV360Campaign[]> {
    return this.listAll<DV360Campaign>(
      `advertisers/${this.creds.advertiserId}/campaigns`,
      "campaigns",
      { filter: 'entityStatus="ENTITY_STATUS_ACTIVE" OR entityStatus="ENTITY_STATUS_PAUSED"' }
    );
  }

  async listInsertionOrders(): Promise<DV360InsertionOrder[]> {
    return this.listAll<DV360InsertionOrder>(
      `advertisers/${this.creds.advertiserId}/insertionOrders`,
      "insertionOrders"
    );
  }

  async listLineItems(): Promise<DV360LineItem[]> {
    return this.listAll<DV360LineItem>(
      `advertisers/${this.creds.advertiserId}/lineItems`,
      "lineItems"
    );
  }

  /**
   * Discover Floodlight activities from line items' conversionCounting config.
   * This is the ONLY way to find Floodlight for third-party-ad-server
   * advertisers (thirdPartyOnlyConfig) — they have no floodlight group in
   * adServerConfig, and the DV360 API has no floodlightGroups.list method.
   */
  async getFloodlightUsageFromLineItems(): Promise<Array<{
    activityId: string;
    postClickLookbackWindowDays?: number;
    postViewLookbackWindowDays?: number;
    lineItemIds: string[];
    activeLineItemCount: number;
  }>> {
    const lis = await this.listAll<{
      lineItemId: string;
      entityStatus: string;
      conversionCounting?: {
        floodlightActivityConfigs?: Array<{
          floodlightActivityId?: string;
          postClickLookbackWindowDays?: number;
          postViewLookbackWindowDays?: number;
        }>;
      };
    }>(`advertisers/${this.creds.advertiserId}/lineItems`, "lineItems");

    const byActivity = new Map<string, {
      activityId: string;
      postClickLookbackWindowDays?: number;
      postViewLookbackWindowDays?: number;
      lineItemIds: string[];
      activeLineItemCount: number;
    }>();

    for (const li of lis) {
      for (const cfg of li.conversionCounting?.floodlightActivityConfigs ?? []) {
        const id = cfg.floodlightActivityId;
        if (!id) continue;
        let entry = byActivity.get(String(id));
        if (!entry) {
          entry = {
            activityId: String(id),
            postClickLookbackWindowDays: cfg.postClickLookbackWindowDays,
            postViewLookbackWindowDays: cfg.postViewLookbackWindowDays,
            lineItemIds: [],
            activeLineItemCount: 0,
          };
          byActivity.set(String(id), entry);
        }
        entry.lineItemIds.push(li.lineItemId);
        if (li.entityStatus === "ENTITY_STATUS_ACTIVE") entry.activeLineItemCount++;
      }
    }

    console.log(
      `[Floodlight] Line-item scan: ${lis.length} LIs, ${byActivity.size} distinct Floodlight activities`,
      JSON.stringify([...byActivity.keys()])
    );
    return [...byActivity.values()];
  }

  /**
   * Fetch a single Floodlight activity by ID (third-party advertisers only).
   * Endpoint: GET advertisers/{advertiserId}/floodlightActivities/{activityId}
   */
  async getFloodlightActivity(activityId: string): Promise<{ displayName?: string; servingStatus?: string; sslRequired?: boolean; remarketingEnabled?: boolean } | null> {
    try {
      const data = await this.authedGet<{ displayName?: string; servingStatus?: string; sslRequired?: boolean; remarketingEnabled?: boolean }>(
        `${DV360_BASE}/advertisers/${this.creds.advertiserId}/floodlightActivities/${activityId}`
      );
      console.log(`[Floodlight] Activity ${activityId}:`, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn(`[Floodlight] Activity ${activityId} fetch failed:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * List all Floodlight activities for this advertiser directly.
   * Works for third-party-ad-server advertisers (no floodlight group needed).
   */
  async listAdvertiserFloodlightActivities(): Promise<Array<{ floodlightActivityId: string; displayName: string; servingStatus?: string; sslRequired?: boolean; remarketingEnabled?: boolean }>> {
    try {
      const data = await this.authedGet<{ floodlightActivities?: Array<{ floodlightActivityId: string; displayName: string; servingStatus?: string; sslRequired?: boolean; remarketingEnabled?: boolean }> }>(
        `${DV360_BASE}/advertisers/${this.creds.advertiserId}/floodlightActivities`
      );
      console.log(`[Floodlight] listAdvertiserFloodlightActivities:`, JSON.stringify(data.floodlightActivities?.map(a => ({ id: a.floodlightActivityId, name: a.displayName }))));
      return data.floodlightActivities ?? [];
    } catch (e) {
      console.warn(`[Floodlight] listAdvertiserFloodlightActivities failed:`, e instanceof Error ? e.message : e);
      return [];
    }
  }

  async listAdGroups(): Promise<DV360AdGroup[]> {
    return this.listAll<DV360AdGroup>(
      `advertisers/${this.creds.advertiserId}/adGroups`,
      "adGroups"
    );
  }

  /** Creative entities (id → displayName/type) for resolving BM creative IDs. */
  async listCreatives(): Promise<Array<{ creativeId: string; displayName: string; creativeType?: string }>> {
    try {
      return await this.listAll<{ creativeId: string; displayName: string; creativeType?: string }>(
        `advertisers/${this.creds.advertiserId}/creatives`,
        "creatives"
      );
    } catch (e) {
      console.warn("[Creatives] listCreatives failed:", e instanceof Error ? e.message : e);
      return [];
    }
  }

  /**
   * Fetch a specific set of creatives by their IDs — much faster than listing
   * all creatives because the filter hits only what the BM report delivered.
   * Batches in groups of 20 to stay within URL length limits.
   */
  async getCreativesByIds(ids: string[]): Promise<Array<{ creativeId: string; displayName: string; creativeType?: string }>> {
    if (ids.length === 0) return [];
    const BATCH = 20;
    const results: Array<{ creativeId: string; displayName: string; creativeType?: string }> = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      // DV360 AIP-160: numeric fields use unquoted values (creativeId=123 not "123")
      const filter = chunk.map((id) => `creativeId=${id}`).join(" OR ");
      try {
        const batch = await this.listAll<{ creativeId: string; displayName: string; creativeType?: string }>(
          `advertisers/${this.creds.advertiserId}/creatives`,
          "creatives",
          { filter }
        );
        results.push(...batch);
      } catch (e) {
        console.warn(`[Creatives] getCreativesByIds chunk ${i}–${i + BATCH} failed:`, e instanceof Error ? e.message : e);
      }
    }
    return results;
  }

  async listAdGroupAds(): Promise<DV360AdGroupAd[]> {
    return this.listAll<DV360AdGroupAd>(
      `advertisers/${this.creds.advertiserId}/adGroupAds`,
      "adGroupAds"
    );
  }

  /**
   * Creatives that actually delivered on each line item — via a Bid Manager
   * report grouped by FILTER_LINE_ITEM × FILTER_CREATIVE_ID. DV360's entity API
   * doesn't cleanly expose creative→line-item assignments, so this reports real
   * delivery (names + impressions/clicks/spend) instead. Returns a map keyed by
   * line-item ID. Best-effort: returns an empty map on failure/timeout.
   */
  async getCreativesByLineItem(startDate: string, endDate: string, timeoutMs = 40_000): Promise<Map<string, Array<{ id: string; name: string; impressions: number; clicks: number; spend: number }>>> {
    const byLi = new Map<string, Array<{ id: string; name: string; impressions: number; clicks: number; spend: number }>>();
    try {
      const result = await this.runBidManagerReport(
        {
          dimensions: ["FILTER_LINE_ITEM", "FILTER_CREATIVE_ID", "FILTER_ADVERTISER_CURRENCY"],
          metrics: ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER"],
          startDate, endDate,
        },
        timeoutMs
      );
      if (result.status !== "done") return byLi;
      const rows = result.rows;
      if (rows.length > 0) console.log("[Creatives] BM CSV columns:", Object.keys(rows[0]).join(", "));
      for (const row of rows) {
        const keys = Object.keys(row);
        const liIdKey = keys.find((k) => /line item id/i.test(k));
        const crIdKey = keys.find((k) => /creative id/i.test(k));
        const crNameKey = keys.find((k) => /^creative$/i.test(k)) || keys.find((k) => /creative/i.test(k) && !/id/i.test(k));
        const imprKey = keys.find((k) => /^impressions$/i.test(k));
        const clickKey = keys.find((k) => /^clicks$/i.test(k));
        const spendKey = keys.find((k) => /revenue \(adv/i.test(k));
        if (!liIdKey || !crIdKey) continue;
        const liId = String(row[liIdKey]);
        const crId = String(row[crIdKey]);
        if (!crId || crId === "0") continue;
        const num = (k?: string) => (k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0);
        const entry = {
          id: crId,
          name: crNameKey && row[crNameKey] ? String(row[crNameKey]) : `Creative ${crId}`,
          impressions: num(imprKey), clicks: num(clickKey), spend: num(spendKey),
        };
        const arr = byLi.get(liId) ?? [];
        arr.push(entry);
        byLi.set(liId, arr);
      }
      console.log(`[Creatives] ${[...byLi.values()].reduce((s, a) => s + a.length, 0)} creatives across ${byLi.size} line items`);
    } catch (e) {
      console.warn("[Creatives] fetch failed:", e instanceof Error ? e.message : e);
    }
    return byLi;
  }

  async listAudiences(): Promise<DV360Audience[]> {
    const token = await this.getAccessToken();
    const advId = this.creds.advertiserId;

    // Path 1: try the direct firstAndThirdPartyAudiences endpoint (v4 → v2)
    const versions = ["v4", "v3", "v2", "v1"];
    for (const ver of versions) {
      try {
        const url = `https://displayvideo.googleapis.com/${ver}/firstAndThirdPartyAudiences?advertiserId=${advId}&pageSize=1`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          // This version works — paginate fully
          const out: DV360Audience[] = [];
          let pageToken = "";
          const base = `https://displayvideo.googleapis.com/${ver}/firstAndThirdPartyAudiences`;
          for (let page = 0; page < 20; page++) {
            const qs = new URLSearchParams({ advertiserId: advId, pageSize: "200" });
            if (pageToken) qs.set("pageToken", pageToken);
            const data = await this.authedGet<{
              firstAndThirdPartyAudiences?: DV360Audience[];
              nextPageToken?: string;
            }>(`${base}?${qs.toString()}`);
            out.push(...(data.firstAndThirdPartyAudiences ?? []));
            pageToken = data.nextPageToken ?? "";
            if (!pageToken) break;
          }
          return out;
        }
      } catch { /* try next version */ }
    }

    // Path 2: fallback — extract audiences from line item targeting assignments.
    // The per-line-item targeting calls run in PARALLEL (previously sequential,
    // which meant 20 round-trips back-to-back = 25–60s). A concurrency cap keeps
    // us under DV360 rate limits while cutting wall-clock to ~1 round-trip.
    console.log("DV360 audience list: direct endpoint unavailable, falling back to line item targeting");
    const lineItems = await this.listLineItems();
    const seen = new Map<string, DV360Audience>();

    const batch = lineItems.slice(0, 20); // cap to avoid rate limits
    const perLiTargets = await mapWithConcurrency(batch, 8, async (li) => {
      try {
        return { li, targets: await this.listLineItemAudienceTargeting(li.lineItemId) };
      } catch {
        return { li, targets: [] as Array<{ assignedTargetingOptionId: string; audienceGroupDetails?: unknown }> };
      }
    });

    for (const { li, targets } of perLiTargets) {
      for (const t of targets) {
        const details = t.audienceGroupDetails as Record<string, unknown> | undefined;
        if (!details) continue;
        const groups = [
          ...((details.includedFirstAndThirdPartyAudienceGroups as Array<{ settings?: Array<{ firstAndThirdPartyAudienceId?: string }> }>) ?? []),
          ...((details.excludedFirstAndThirdPartyAudienceGroups as Array<{ settings?: Array<{ firstAndThirdPartyAudienceId?: string }> }>) ?? []),
        ];
        for (const g of groups) {
          for (const s of (g.settings ?? [])) {
            const id = s.firstAndThirdPartyAudienceId;
            if (id && !seen.has(id)) {
              seen.set(id, {
                firstAndThirdPartyAudienceId: id,
                displayName: `Audience ${id}`,
                audienceType: "FIRST_AND_THIRD_PARTY_AUDIENCE_TYPE_UNSPECIFIED",
                audienceSource: "AUDIENCE_SOURCE_UNSPECIFIED",
                membershipDurationDays: "",
                description: `Used in line item: ${li.displayName}`,
                activeDisplayAudienceSize: "",
              });
            }
          }
        }
      }
    }

    return [...seen.values()];
  }

  async listLineItemAudienceTargeting(lineItemId: string): Promise<Array<{ assignedTargetingOptionId: string; audienceGroupDetails?: unknown }>> {
    try {
      const data = await this.authedGet<{ assignedTargetingOptions?: Array<{ assignedTargetingOptionId: string; audienceGroupDetails?: unknown }> }>(
        `${DV360_BASE}/advertisers/${this.creds.advertiserId}/lineItems/${lineItemId}/targetingTypes/TARGETING_TYPE_AUDIENCE_GROUP/assignedTargetingOptions`
      );
      return data.assignedTargetingOptions ?? [];
    } catch {
      return [];
    }
  }

  /** Targeting dimensions worth surfacing for an audience/targeting audit. */
  private static readonly TARGETING_TYPES = [
    "TARGETING_TYPE_GEO_REGION",
    "TARGETING_TYPE_AGE_RANGE",
    "TARGETING_TYPE_GENDER",
    "TARGETING_TYPE_PARENTAL_STATUS",
    "TARGETING_TYPE_HOUSEHOLD_INCOME",
    "TARGETING_TYPE_DEVICE_TYPE",
    "TARGETING_TYPE_BROWSER",
    "TARGETING_TYPE_AUDIENCE_GROUP",
    "TARGETING_TYPE_LANGUAGE",
  ];

  private async listAssignedTargeting(
    parent: "lineItems" | "insertionOrders",
    parentId: string
  ): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    const fetches = DV360ApiClient.TARGETING_TYPES.map(async (t) => {
      try {
        const data = await this.authedGet<{ assignedTargetingOptions?: unknown[] }>(
          `${DV360_BASE}/advertisers/${this.creds.advertiserId}/${parent}/${parentId}/targetingTypes/${t}/assignedTargetingOptions`
        );
        if (data.assignedTargetingOptions?.length) {
          result[t] = data.assignedTargetingOptions;
        }
      } catch { /* skip */ }
    });
    await Promise.all(fetches);
    return result;
  }

  async listLineItemAllTargeting(lineItemId: string): Promise<Record<string, unknown[]>> {
    return this.listAssignedTargeting("lineItems", lineItemId);
  }

  /**
   * Insertion-order-level targeting. In DV360 demographics/geo are often set on
   * the IO and inherited by its line items — the line-item endpoint does NOT
   * return inherited targeting, so we fetch the IO's own assignments too.
   */
  async listInsertionOrderAllTargeting(insertionOrderId: string): Promise<Record<string, unknown[]>> {
    return this.listAssignedTargeting("insertionOrders", insertionOrderId);
  }

  /**
   * Floodlight activities for a floodlight group (read-only in v4).
   * Requires partnerId context. Group id comes from the advertiser's
   * dataAccessConfig or is passed explicitly.
   */
  async listFloodlightActivities(floodlightGroupId: string, partnerId: string): Promise<DV360FloodlightActivity[]> {
    const qs = new URLSearchParams({ partnerId });
    const data = await this.authedGet<{ floodlightActivities?: DV360FloodlightActivity[] }>(
      `${DV360_BASE}/floodlightGroups/${floodlightGroupId}/floodlightActivities?${qs.toString()}`
    );
    return data.floodlightActivities ?? [];
  }

  /** Full advertiser config — useful for diagnosing Floodlight/ad-server setup. */
  async getAdvertiserConfig(): Promise<Record<string, unknown>> {
    return this.authedGet<Record<string, unknown>>(
      `${DV360_BASE}/advertisers/${this.creds.advertiserId}`
    );
  }

  /**
   * Returns the Floodlight group id for this advertiser.
   *
   * Tries three paths:
   * 1. CM360-hybrid config  (adServerConfig.cmHybridConfig.cmFloodlightConfigId)
   * 2. Third-party ad server Floodlight  (adServerConfig.thirdPartyOnlyConfig.floodlightGroupId — v4 field)
   * 3. DV360-native Floodlight — list floodlightGroups filtered by partnerId
   */
  async getFloodlightGroupId(): Promise<string | null> {
    try {
      // Fetch full advertiser object — log the entire response so we can
      // diagnose what fields exist for advertisers where detection fails.
      const adv = await this.authedGet<Record<string, unknown>>(
        `${DV360_BASE}/advertisers/${this.creds.advertiserId}`
      );

      console.log("[Floodlight] FULL advertiser response keys:", Object.keys(adv));
      console.log("[Floodlight] adServerConfig:", JSON.stringify(adv.adServerConfig));
      console.log("[Floodlight] generalConfig:", JSON.stringify(adv.generalConfig));
      if (adv.partnerId) console.log("[Floodlight] partnerId:", adv.partnerId);

      const asc = adv.adServerConfig as Record<string, unknown> | undefined;

      // Path 1 — CM360 hybrid: cmFloodlightConfigId
      const cmHybrid = asc?.cmHybridConfig as Record<string, unknown> | undefined;
      const cmFloodId = cmHybrid?.cmFloodlightConfigId;
      if (cmFloodId && String(cmFloodId).length > 0) {
        console.log("[Floodlight] Found via CM360 hybrid cmFloodlightConfigId:", cmFloodId);
        return String(cmFloodId);
      }

      // Path 1b — CM360 hybrid: cmAccountId (sometimes used as the Floodlight config ID)
      const cmAccountId = cmHybrid?.cmAccountId;
      if (cmAccountId && String(cmAccountId).length > 0) {
        console.log("[Floodlight] Found via CM360 hybrid cmAccountId:", cmAccountId);
        return String(cmAccountId);
      }

      // Path 2 — Third-party ad server with Floodlight
      const tpConfig = asc?.thirdPartyOnlyConfig as Record<string, unknown> | undefined;
      const tpId = tpConfig?.floodlightGroupId;
      if (tpId && String(tpId).length > 0) {
        console.log("[Floodlight] Found via thirdPartyOnlyConfig:", tpId);
        return String(tpId);
      }

      // Path 2b — Check top-level adServerConfig for any floodlight-related field
      if (asc) {
        for (const key of Object.keys(asc)) {
          const val = asc[key];
          if (typeof val === "object" && val !== null) {
            const sub = val as Record<string, unknown>;
            for (const sk of Object.keys(sub)) {
              if (sk.toLowerCase().includes("floodlight") && sub[sk]) {
                console.log(`[Floodlight] Found via adServerConfig.${key}.${sk}:`, sub[sk]);
                return String(sub[sk]);
              }
            }
          }
        }
      }

      // Path 3 — floodlightGroups list by partnerId (try v2, v3, v4 URL forms)
      const realPartnerId = (adv.partnerId || this.creds.partnerId) as string | undefined;
      if (realPartnerId) {
        const fgUrls = [
          `https://displayvideo.googleapis.com/v2/floodlightGroups?partnerId=${realPartnerId}`,
          `https://displayvideo.googleapis.com/v3/floodlightGroups?partnerId=${realPartnerId}`,
          `${DV360_BASE}/floodlightGroups?partnerId=${realPartnerId}`,
        ];
        for (const fgUrl of fgUrls) {
          try {
            const token = await this.getAccessToken();
            const r = await fetch(fgUrl, { headers: { Authorization: `Bearer ${token}` } });
            console.log(`[Floodlight] floodlightGroups (${fgUrl}): status=${r.status}`);
            if (r.ok) {
              const data = await r.json() as { floodlightGroups?: Array<{ floodlightGroupId?: string; displayName?: string }> };
              console.log(`[Floodlight] floodlightGroups response:`, JSON.stringify(data));
              const first = data.floodlightGroups?.[0]?.floodlightGroupId;
              if (first && String(first).length > 0) {
                console.log("[Floodlight] Found via floodlightGroups list:", first);
                return String(first);
              }
            }
          } catch (e) {
            console.warn(`[Floodlight] floodlightGroups list failed (${fgUrl}):`, e instanceof Error ? e.message : e);
          }
        }
      }

      // Path 3b — CM360 API (try v3.5 and v4): list floodlight configs
      try {
        const token = await this.getAccessToken();
        const apiVersions = ["v3.5", "v4"];
        for (const ver of apiVersions) {
          const cm360Url = `https://dfareporting.googleapis.com/dfareporting/${ver}/userprofiles`;
          const profileRes = await fetch(cm360Url, { headers: { Authorization: `Bearer ${token}` } });
          console.log(`[Floodlight] CM360 ${ver} userprofiles status:`, profileRes.status);
          if (profileRes.ok) {
            const profiles = await profileRes.json() as { items?: Array<{ profileId: string; accountId?: string }> };
            console.log(`[Floodlight] CM360 ${ver} profiles:`, JSON.stringify(profiles.items?.map(p => ({ profileId: p.profileId, accountId: p.accountId }))));
            if (profiles.items) {
              for (const profile of profiles.items) {
                try {
                  const flUrl = `https://dfareporting.googleapis.com/dfareporting/${ver}/userprofiles/${profile.profileId}/floodlightConfigurations`;
                  const flRes = await fetch(flUrl, { headers: { Authorization: `Bearer ${token}` } });
                  if (flRes.ok) {
                    const flData = await flRes.json() as { floodlightConfigurations?: Array<{ id: string; advertiserId?: string }> };
                    console.log(`[Floodlight] CM360 ${ver} profile ${profile.profileId} floodlightConfigs:`, JSON.stringify(flData.floodlightConfigurations?.map(f => ({ id: f.id, advertiserId: f.advertiserId }))));
                    const first = flData.floodlightConfigurations?.[0]?.id;
                    if (first) {
                      console.log("[Floodlight] Found via CM360 API:", first);
                      return String(first);
                    }
                  }
                } catch {
                  // try next profile
                }
              }
            }
            break; // found a working version, no need to try next
          }
        }
      } catch (e) {
        console.warn("[Floodlight] CM360 API check failed:", e instanceof Error ? e.message : e);
      }

      // Path 4 — check generalConfig or any top-level floodlight field
      for (const key of Object.keys(adv)) {
        if (key.toLowerCase().includes("floodlight") && adv[key]) {
          console.log(`[Floodlight] Found via advertiser.${key}:`, adv[key]);
          return String(adv[key]);
        }
      }
    } catch (e) {
      console.warn("[Floodlight] advertiser fetch failed:", e instanceof Error ? e.message : e);
    }

    console.log("[Floodlight] No Floodlight configuration found for advertiser", this.creds.advertiserId);
    return null;
  }

  /**
   * Unified Floodlight resolver — handles ALL three ways a DV360 advertiser's
   * Floodlight can be wired, cascading through every source and MERGING what
   * each can contribute so there is always data whenever the advertiser uses
   * Floodlight at all:
   *
   *   1. CM360 hybrid   (adServerConfig.cmHybridConfig)  → DV360 floodlightGroups
   *      + CM360 API give group + activity names.
   *   2. DV360-native   (a discoverable floodlightGroupId) → floodlightGroups.get
   *      + activities list give names.
   *   3. Third-party    (adServerConfig.thirdPartyOnlyConfig) → line-item
   *      conversionCounting gives activity IDs + lookback windows; CM360 API
   *      supplies names IF the connected account can reach CM360.
   *
   * Merge key is the activity ID. Names come from the richest available source
   * (CM360 > DV360 group). Lookback + line-item usage always come from the
   * line-item scan. Daily conversions are layered on later by the route via
   * Bid Manager. Nothing is fabricated — `notes` states what could not be read.
   */
  async resolveFloodlight(): Promise<FloodlightResolution> {
    const notes: string[] = [];
    const byId = new Map<string, ResolvedFloodlightActivity>();
    let configType: FloodlightResolution["configType"] = "unknown";
    let detectionPath = "";
    let group: FloodlightResolution["group"] = null;
    let cmFloodlightConfigId: string | undefined;
    let cmNetworkId: string | undefined;

    const ensure = (id: string): ResolvedFloodlightActivity => {
      let a = byId.get(id);
      if (!a) {
        a = {
          id, name: `Floodlight Activity ${id}`, hasRealName: false, nameSource: "none",
          type: "STANDARD", clickLookbackDays: 0, viewLookbackDays: 0,
          servingStatus: "DISABLED", sslRequired: false, lineItemCount: 0, activeLineItemCount: 0,
        };
        byId.set(id, a);
      }
      return a;
    };
    const applyName = (id: string, name: string, source: ResolvedFloodlightActivity["nameSource"]) => {
      const a = ensure(id);
      if (name && !/^Floodlight Activity /.test(name)) { a.name = name; a.hasRealName = true; a.nameSource = source; }
    };

    // ── 1. Advertiser config → config type + CM360 references ────────────────
    let adv: Record<string, unknown> = {};
    try {
      adv = await this.getAdvertiserConfig();
    } catch (e) {
      notes.push("Could not read advertiser config from DV360 API.");
      console.warn("[Floodlight resolve] advertiser fetch failed:", e instanceof Error ? e.message : e);
    }
    const asc = adv.adServerConfig as Record<string, unknown> | undefined;
    const cmHybrid = asc?.cmHybridConfig as Record<string, unknown> | undefined;
    const tpConfig = asc?.thirdPartyOnlyConfig as Record<string, unknown> | undefined;
    if (cmHybrid) {
      configType = "cm360_hybrid";
      if (cmHybrid.cmFloodlightConfigId) cmFloodlightConfigId = String(cmHybrid.cmFloodlightConfigId);
      if (cmHybrid.cmAccountId) cmNetworkId = String(cmHybrid.cmAccountId);
    } else if (tpConfig) {
      configType = "third_party";
    }
    const realPartnerId = (adv.partnerId || this.creds.partnerId) as string | undefined;

    // ── 2. DV360 floodlight group path (hybrid or native) ────────────────────
    // In DV360 the group ID equals the CM360 Floodlight config ID for hybrids.
    const groupId = cmFloodlightConfigId || (await this.getFloodlightGroupId()) || undefined;
    if (groupId) {
      const partnerCtx = realPartnerId || this.creds.advertiserId;
      try {
        const acts = await this.listFloodlightActivities(groupId, partnerCtx);
        if (acts.length > 0) {
          group = { id: groupId, name: `Floodlight Group ${groupId}` };
          detectionPath = configType === "cm360_hybrid" ? "cm360_hybrid_group" : "dv360_floodlight_group";
          for (const a of acts) {
            const entry = ensure(a.floodlightActivityId);
            applyName(a.floodlightActivityId, a.displayName, "dv360_group");
            entry.type = a.remarketingEnabled ? "REMARKETING" : "STANDARD";
            entry.sslRequired = !!a.sslRequired;
            entry.servingStatus = a.servingStatus?.includes("ENABLED") ? "ENABLED" : "DISABLED";
          }
        }
      } catch (e) {
        console.warn("[Floodlight resolve] group activities failed:", e instanceof Error ? e.message : e);
      }
    }

    // ── 3. Line-item scan — ALWAYS (IDs + lookback + usage) ──────────────────
    try {
      const usage = await this.getFloodlightUsageFromLineItems();
      for (const u of usage) {
        const entry = ensure(u.activityId);
        entry.clickLookbackDays = u.postClickLookbackWindowDays ?? entry.clickLookbackDays;
        entry.viewLookbackDays = u.postViewLookbackWindowDays ?? entry.viewLookbackDays;
        entry.lineItemCount = u.lineItemIds.length;
        entry.activeLineItemCount = u.activeLineItemCount;
        // If the group path didn't set a serving status, infer from active LIs.
        if (entry.servingStatus === "DISABLED" && u.activeLineItemCount > 0 && entry.nameSource === "none") {
          entry.servingStatus = "ENABLED";
        }
      }
      if (usage.length > 0 && !detectionPath) detectionPath = "line_item_scan";
    } catch (e) {
      console.warn("[Floodlight resolve] line-item scan failed:", e instanceof Error ? e.message : e);
    }

    // ── 4. CM360 API — enrich with real activity names when reachable ────────
    const needNames = [...byId.values()].some((a) => !a.hasRealName);
    if (needNames && byId.size > 0) {
      const cm = await this.fetchCm360FloodlightActivities(cmFloodlightConfigId);
      if (cm.accessible) {
        let enriched = 0;
        for (const [id, meta] of cm.activities) {
          if (byId.has(id) || configType === "cm360_hybrid") {
            const entry = ensure(id);
            applyName(id, meta.name, "cm360");
            if (meta.sslRequired !== undefined) entry.sslRequired = meta.sslRequired;
            if (meta.clickLookbackDays) entry.clickLookbackDays = meta.clickLookbackDays;
            if (meta.viewLookbackDays) entry.viewLookbackDays = meta.viewLookbackDays;
            enriched++;
          }
        }
        if (enriched > 0) {
          notes.push(`Activity names fetched from Campaign Manager 360 API (${enriched}).`);
          if (cm.networkId) cmNetworkId = cm.networkId;
          if (cm.floodlightConfigId) cmFloodlightConfigId = cm.floodlightConfigId;
        }
      } else if (cm.error) {
        notes.push(
          "Activity names & post-click/post-view split live in Campaign Manager 360 and can't be fetched — " +
          `the connected Google account can't reach the CM360 API (${cm.error}). ` +
          "Grant CM360 access (dfatrafficking scope + a CM360 user profile) to enrich these."
        );
      }
    }

    if (byId.size === 0) {
      notes.push(
        "No Floodlight activities found. The advertiser uses a third-party ad server config and no line item has " +
        "Floodlight conversion tracking assigned. Link CM360 or assign Floodlight activities to line items in DV360."
      );
    }

    return {
      configType,
      detectionPath: detectionPath || "none",
      group,
      cm360: { networkId: cmNetworkId, floodlightConfigId: cmFloodlightConfigId, accessible: notes.some((n) => n.startsWith("Activity names fetched from Campaign Manager 360")) },
      activities: [...byId.values()],
      notes,
    };
  }

  /**
   * Fetch Floodlight activity names from the Campaign Manager 360 (dfareporting)
   * API. Works only when the connected Google account has a CM360 user profile
   * and the dfatrafficking scope. Returns accessible:false (with an error
   * string) when CM360 can't be reached — the caller then notes the limitation
   * rather than fabricating names.
   */
  async fetchCm360FloodlightActivities(
    floodlightConfigId?: string
  ): Promise<{
    accessible: boolean;
    activities: Map<string, { name: string; sslRequired?: boolean; clickLookbackDays?: number; viewLookbackDays?: number }>;
    networkId?: string;
    floodlightConfigId?: string;
    error?: string;
  }> {
    const activities = new Map<string, { name: string; sslRequired?: boolean; clickLookbackDays?: number; viewLookbackDays?: number }>();
    let lastError = "userprofiles not reachable";
    try {
      const token = await this.getAccessToken();
      for (const ver of ["v4", "v3.5"]) {
        const base = `https://dfareporting.googleapis.com/dfareporting/${ver}`;
        const pr = await fetch(`${base}/userprofiles`, { headers: { Authorization: `Bearer ${token}` } });
        if (!pr.ok) {
          lastError = `userprofiles HTTP ${pr.status}`;
          continue;
        }
        const profiles = ((await pr.json()) as { items?: Array<{ profileId: string; accountId?: string }> }).items ?? [];
        let networkId: string | undefined;
        for (const p of profiles) {
          networkId = networkId || p.accountId;
          const qs = floodlightConfigId ? `?floodlightConfigurationId=${floodlightConfigId}` : "";
          try {
            const ar = await fetch(`${base}/userprofiles/${p.profileId}/floodlightActivities${qs}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!ar.ok) { lastError = `floodlightActivities HTTP ${ar.status}`; continue; }
            const acts = ((await ar.json()) as {
              floodlightActivities?: Array<{ id: string; name: string; floodlightConfigurationId?: string; sslRequired?: boolean }>;
            }).floodlightActivities ?? [];
            for (const a of acts) {
              activities.set(String(a.id), { name: a.name, sslRequired: a.sslRequired });
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        if (activities.size > 0) {
          console.log(`[Floodlight resolve] CM360 ${ver}: ${activities.size} activity names fetched`);
          return { accessible: true, activities, networkId, floodlightConfigId };
        }
      }
      return { accessible: false, activities, error: lastError };
    } catch (e) {
      return { accessible: false, activities, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ─── Bid Manager reporting (async CSV flow) ─────────────────────────────────

  private async bmPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const r = await fetchWithTimeout(`${BM_BASE}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, 30_000);
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Bid Manager ${path} failed (HTTP ${r.status}): ${text.slice(0, 300)}`);
    }
    return (await r.json()) as T;
  }

  /** Create + run a ONE_TIME query. Returns ids for polling. */
  async createAndRunQuery(req: BMReportRequest): Promise<{ queryId: string; reportId: string }> {
    const query = await this.bmPost<{ queryId: string }>("queries", {
      metadata: {
        title: `auditor-${Date.now()}`,
        dataRange: {
          range: "CUSTOM_DATES",
          customStartDate: isoToRawDate(req.startDate),
          customEndDate: isoToRawDate(req.endDate),
        },
        format: "CSV",
      },
      params: {
        type: req.reportType ?? "STANDARD",
        groupBys: req.dimensions,
        filters: [
          { type: "FILTER_ADVERTISER", value: this.creds.advertiserId },
          ...(req.filters ?? []),
        ],
        metrics: req.metrics,
      },
      schedule: { frequency: "ONE_TIME" },
    });
    const run = await this.bmPost<{ key?: { queryId: string; reportId: string }; metadata?: unknown }>(
      `queries/${query.queryId}:run?synchronous=false`,
      {}
    );
    const reportId = run.key?.reportId ?? "";
    return { queryId: query.queryId, reportId };
  }

  /** Poll a report once. Returns the GCS path when DONE, null while running. */
  async getReportPath(queryId: string, reportId: string): Promise<string | null> {
    const token = await this.getAccessToken();
    const r = await fetchWithTimeout(`${BM_BASE}/queries/${queryId}/reports/${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, 30_000);
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Bid Manager report poll failed (HTTP ${r.status}): ${text.slice(0, 300)}`);
    }
    const data = (await r.json()) as {
      metadata?: { status?: { state?: string }; googleCloudStoragePath?: string };
    };
    const state = data.metadata?.status?.state;
    if (state === "DONE") return data.metadata?.googleCloudStoragePath ?? null;
    if (state === "FAILED") throw new Error("Bid Manager report FAILED");
    return null;
  }

  /** Download + parse the report CSV from its (unauthenticated) GCS URL. */
  async downloadReport(gcsPath: string): Promise<Array<Record<string, string | number>>> {
    const r = await fetchWithTimeout(gcsPath, {}, 30_000);
    if (!r.ok) throw new Error(`Report download failed (HTTP ${r.status})`);
    const text = await r.text();
    return parseBmCsv(text);
  }

  /**
   * Full flow with a poll budget. If the report isn't done within
   * `timeoutMs`, returns {status:"pending", queryId, reportId} so the route
   * can 202 and the client can resume with resumeReport().
   */
  async runBidManagerReport(req: BMReportRequest, timeoutMs = 45_000): Promise<BMResult> {
    const { queryId, reportId } = await this.createAndRunQuery(req);
    return this.pollToResult(queryId, reportId, timeoutMs);
  }

  /** Resume a previously started report (cheap — poll + download only). */
  async resumeReport(queryId: string, reportId: string, timeoutMs = 45_000): Promise<BMResult> {
    return this.pollToResult(queryId, reportId, timeoutMs);
  }

  private async pollToResult(queryId: string, reportId: string, timeoutMs: number): Promise<BMResult> {
    const deadline = Date.now() + timeoutMs;
    // First poll immediately, then every 2s.
    for (;;) {
      try {
        const path = await this.getReportPath(queryId, reportId);
        if (path) {
          const rows = await this.downloadReport(path);
          return { status: "done", rows };
        }
      } catch (e) {
        // A timed-out/aborted poll (fetchWithTimeout) or transient network blip
        // shouldn't fail the whole request — the report is still generating, so
        // fall through to the deadline check and let the client resume. Real API
        // failures (a FAILED report) rethrow.
        if (e instanceof Error && /report FAILED/i.test(e.message)) throw e;
      }
      if (Date.now() + 2_000 > deadline) return { status: "pending", queryId, reportId };
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToRawDate(iso: string): RawDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** DV360 RawDate ({year,month,day}) → ISO "yyyy-mm-dd", or undefined if incomplete. */
export function rawDateToIso(d?: RawDate): string | undefined {
  if (!d?.year || !d.month || !d.day) return undefined;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * Parse a Bid Manager CSV payload. Layout: header row, data rows, then a blank
 * line followed by summary/footer rows ("Report Time:", totals) — we stop at
 * the first blank line. Numeric cells are parsed to numbers.
 */
export function parseBmCsv(text: string): Array<Record<string, string | number>> {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const rows: Array<Record<string, string | number>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break; // blank line = start of summary footer
    const cells = splitCsvLine(line);
    if (cells.length !== header.length) continue;
    const row: Record<string, string | number> = {};
    header.forEach((h, idx) => {
      const v = cells[idx];
      const n = Number(v.replace(/,/g, ""));
      row[h] = v !== "" && Number.isFinite(n) && /^[\d.,-]+$/.test(v) ? n : v;
    });
    // Skip the grand-total row BM sometimes emits with an empty first dimension.
    if (String(row[header[0]] ?? "") === "") continue;
    rows.push(row);
  }
  return rows;
}

/** Minimal CSV line splitter with double-quote support. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
