/**
 * Meta Graph API Client — full integration:
 *   - Meta Pixel (info + stats + latency)
 *   - Meta Event Manager (events + diagnostics + recent activity)
 *   - Meta CAPI (server-side events + dedupe + payload + auth + latency)
 */

const META_API_BASE = "https://graph.facebook.com/v18.0";

/** Convert a raw Meta API error response into a clean human-readable message. */
function parseMetaError(status: number, body: string): string {
  if (status === 429) return "Meta API rate limit reached. Please wait a few minutes and try again.";
  if (status === 401 || status === 403) return "Meta access token expired or lacks permissions. Please reconnect your account.";
  // HTML error page (e.g. Facebook maintenance / WAF block)
  if (body.trimStart().startsWith("<")) {
    return `Meta API error (HTTP ${status}). Facebook may be temporarily unavailable — please try again shortly.`;
  }
  // Try to extract message from JSON error response
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message || json?.message;
    if (msg) return `Meta API: ${msg}`;
  } catch {}
  return `Meta API ${status}: ${body.slice(0, 120)}`;
}

export interface MetaPixelInfo {
  id: string;
  name: string;
  is_unavailable: boolean;
  last_fired_time?: string;
  data_use_setting?: string;
  enable_automatic_matching?: boolean;
  automatic_matching_fields?: string[];
  creation_time?: string;
  owner_business?: { id: string; name: string };
  is_consolidated_container?: boolean;
}

export interface MetaPixelStats {
  pixelId: string;
  name: string;
  status: "active" | "inactive";
  totalEvents: number;
  eventBreakdown: Array<{
    event: string;
    count: number;
    browserCount: number;
    serverCount: number;
    dedupRate: number;
    matchScore: number;
    avgLatencyMs: number;
    eventIdCoverage: number;
    payloadCompleteness: number;
    duplicateRate: number;
    last24hCount: number;
    baseline7dAvg: number;
  }>;
  capi: {
    enabled: boolean;
    browserShare: number;
    serverShare: number;
    avgDedupRate: number;
    lastServerEventTime?: string;
    capiHealthScore: number;
    capiBreakdown: {
      deduplication: number;
      eventIdConsistency: number;
      payloadCompleteness: number;
      authStatus: number;
      avgServerLatencyMs: number;
      apiFailureRate: number;
    };
    authIssues: Array<{ type: string; message: string; severity: "warning" | "error" }>;
  };
  emq: {
    overallScore: number;
    matchKeys: Array<{ key: string; coverage: number; benchmark: number }>;
    serverSideEnrichment: boolean;
    /** Real % of events carrying any PII / match key (from aggregation=had_pii). */
    piiCoveragePct?: number;
  };
  diagnostics: {
    warnings: number;
    errors: number;
    lastUpdated: string;
    dataFreshnessMins: number;
    issues: Array<{ code: string; message: string; severity: "warning" | "error"; affectedEvent?: string }>;
    recentActivity: Array<{ time: string; event: string; type: string; status: string }>;
  };
  /** Pixel configuration — fetched from Meta's Graph API. */
  config: {
    createdAt?: string;
    dataUseSetting: string;
    automaticMatchingEnabled: boolean;
    automaticMatchingFields: string[];
    ownerBusiness?: { id: string; name: string };
    isConsolidatedContainer?: boolean;
    isUnavailable: boolean;
    lastFiredTime?: string;
  };
  eventManager: {
    automaticMatchingEnabled: boolean;
    automaticMatchingFields: string[];
    dataUseSetting: string;
    activeEventCount: number;
  };
  anomalies: Array<{
    event: string;
    type: "drop" | "spike";
    severity: "Critical" | "High" | "Medium";
    currentValue: number;
    baseline: number;
    deviation: number;
  }>;
  funnelIntegrity: {
    duplicatePurchases: number;
    duplicatePurchaseRate: number;
    sequencingIssues: Array<{ event: string; issue: string }>;
    brokenAttributionChains: number;
  };
}

export function computeCapiHealthScore(b: MetaPixelStats["capi"]["capiBreakdown"]): number {
  const raw =
    b.deduplication * 0.35 +
    b.eventIdConsistency * 0.25 +
    b.payloadCompleteness * 0.2 +
    b.authStatus * 0.15;
  const latencyPenalty = b.avgServerLatencyMs > 2000 ? 6 : b.avgServerLatencyMs > 1000 ? 3 : 0;
  const failurePenalty = b.apiFailureRate > 5 ? 5 : b.apiFailureRate > 1 ? 2 : 0;
  return Math.max(0, Math.min(100, Math.round(raw - latencyPenalty - failurePenalty)));
}

/** Detect drop/spike anomalies from per-event 24h vs 7d baseline */
export function detectAnomalies(eventBreakdown: MetaPixelStats["eventBreakdown"]) {
  const anomalies: MetaPixelStats["anomalies"] = [];
  for (const e of eventBreakdown) {
    if (e.baseline7dAvg < 50) continue; // ignore tiny volume
    const deviation = (e.last24hCount - e.baseline7dAvg) / e.baseline7dAvg;
    if (deviation < -0.3) {
      anomalies.push({
        event: e.event,
        type: "drop",
        severity: deviation < -0.5 ? "Critical" : deviation < -0.4 ? "High" : "Medium",
        currentValue: e.last24hCount,
        baseline: e.baseline7dAvg,
        deviation: Math.round(deviation * 100),
      });
    } else if (deviation > 0.5) {
      anomalies.push({
        event: e.event,
        type: "spike",
        severity: deviation > 1.5 ? "Critical" : deviation > 1.0 ? "High" : "Medium",
        currentValue: e.last24hCount,
        baseline: e.baseline7dAvg,
        deviation: Math.round(deviation * 100),
      });
    }
  }
  return anomalies;
}

/**
 * Convert an ISO date (YYYY-MM-DD) to a Unix timestamp (seconds).
 * Meta's pixel `/stats` edge expects Unix timestamps, not ISO strings —
 * passing ISO strings causes a few hours of window drift at day boundaries.
 * `endOfDay` pushes to 23:59:59 so the `until` bound includes the full final day.
 */
function isoToUnix(iso: string, endOfDay = false): number {
  const ms = endOfDay
    ? new Date(`${iso}T23:59:59Z`).getTime()
    : new Date(`${iso}T00:00:00Z`).getTime();
  return Math.floor(ms / 1000);
}

/**
 * Sum conversion events from a Meta Insights `actions` / `action_values` array,
 * counting each underlying conversion ONCE.
 *
 * Meta reports the same conversion under multiple overlapping action_type
 * aliases — e.g. `purchase` (unified/omni) AND `offsite_conversion.fb_pixel_purchase`
 * (pixel-specific). Naively summing both double-counts. We prefer the unified
 * type and only fall back to the pixel alias when the unified one is absent.
 */
/**
 * Sum every entry in a raw Meta action array (e.g. `video_play_actions`).
 * Unlike sumConversions this does NOT dedupe aliases — video_play_actions
 * normally returns a single `video_view` row, so a plain sum is correct.
 */
function sumActionValues(rows: Array<{ action_type: string; value: string }> | undefined): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
}

function sumConversions(rows: Array<{ action_type: string; value: string }> | undefined): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.action_type] = (byType[r.action_type] || 0) + (parseFloat(r.value) || 0);

  // Each group: prefer the unified/preferred action_type, fall back to the
  // alias only if the unified one is absent — prevents double-counting when
  // Meta returns BOTH (e.g. `purchase` AND `offsite_conversion.fb_pixel_purchase`).
  // Single-entry groups have no alias (the type itself is the only form).
  //
  // Covers the conversion objectives a real ad account is most likely set up
  // around: e-commerce (purchase/subscribe/start_trial), lead-gen on-site
  // (lead) and on-Meta (lead-form), registrations, app installs, and
  // messaging-based businesses.
  const groups: Array<[string, ...string[]]> = [
    // E-commerce
    ["purchase", "offsite_conversion.fb_pixel_purchase"],
    ["subscribe", "offsite_conversion.fb_pixel_subscribe"],
    ["start_trial", "offsite_conversion.fb_pixel_start_trial"],
    // Lead-gen — off-site (website pixel) and on-Meta (instant lead forms)
    ["lead", "offsite_conversion.fb_pixel_lead"],
    ["onsite_conversion.lead_grouped"],
    // Account creation
    ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
    // App installs (unified vs older mobile alias)
    ["app_install", "mobile_app_install"],
    // Messaging-based conversions (WhatsApp / IG / Messenger ads)
    ["onsite_conversion.messaging_conversation_started_7d"],
    ["onsite_conversion.total_messaging_connection"],
  ];
  let total = 0;
  let counted = false;
  for (const group of groups) {
    for (const t of group) {
      if (byType[t] !== undefined) {
        total += byType[t];
        counted = true;
        break; // first hit in a group wins → no double count
      }
    }
  }
  return counted ? total : undefined;
}

/** Same dedup logic as sumConversions but reads a per-window sub-field (e.g. "1d_click",
 *  "7d_click", "1d_view") instead of the default `value` field.
 *  Meta includes these sub-fields on every action row when action_attribution_windows
 *  includes that window key in the request. */
function sumConversionsByWindow(rows: any[] | undefined, windowKey: string): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const v = r[windowKey];
    if (v !== undefined) byType[r.action_type] = (byType[r.action_type] || 0) + (parseFloat(v) || 0);
  }
  const groups: Array<[string, ...string[]]> = [
    ["purchase", "offsite_conversion.fb_pixel_purchase"],
    ["subscribe", "offsite_conversion.fb_pixel_subscribe"],
    ["start_trial", "offsite_conversion.fb_pixel_start_trial"],
    ["lead", "offsite_conversion.fb_pixel_lead"],
    ["onsite_conversion.lead_grouped"],
    ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
    ["app_install", "mobile_app_install"],
    ["onsite_conversion.messaging_conversation_started_7d"],
    ["onsite_conversion.total_messaging_connection"],
  ];
  let total = 0; let counted = false;
  for (const group of groups) {
    for (const t of group) {
      if (byType[t] !== undefined) { total += byType[t]; counted = true; break; }
    }
  }
  return counted ? total : undefined;
}

/**
 * The attribution window we ask Meta to use when computing conversions /
 * ROAS. Exported so the UI can display it explicitly (so users know exactly
 * how the numbers were calculated and can compare against Ads Manager
 * — which uses this same default unless the account overrides it).
 */
export const META_ATTRIBUTION_WINDOW = {
  raw: ["7d_click", "1d_view"] as const,
  /** Human-readable label shown alongside conversion/ROAS values in the UI. */
  label: "7-day click + 1-day view",
  /** Tooltip / explainer text. */
  description:
    "Conversions and ROAS are counted using Meta's Ads Manager default attribution window — a conversion is credited to an ad if a user clicked it within 7 days, or viewed it within 1 day, before converting.",
};

/**
 * Convert a Meta `attribution_spec` array (per-ad-set) into the
 * `action_attribution_windows` query-param format Insights expects.
 * Example input:  [{event_type:"CLICK_THROUGH", window_days:1}, {event_type:"VIEW_THROUGH", window_days:1}]
 * Example output: ["1d_click", "1d_view"]
 * Returns null if the input doesn't translate cleanly (caller falls back to default).
 */
export function attributionSpecToWindows(
  spec: Array<{ event_type: string; window_days: number }> | null | undefined
): string[] | null {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  // Meta's `action_attribution_windows` enum: 1d/7d/28d_click, 1d/7d/28d_view,
  // and 1d_ev (engaged view). NOTE: the engaged-view token is "ev" → "1d_ev",
  // NOT "engaged_view" — passing "1d_engaged_view" 400s the whole Insights
  // call (which previously zeroed out all spend).
  const map: Record<string, string> = {
    CLICK_THROUGH: "click",
    VIEW_THROUGH: "view",
    ENGAGED_VIDEO_VIEW: "ev",
  };
  // Only these exact tokens are accepted by Meta — anything else is dropped so
  // a single unrecognised window can never break the entire request.
  const VALID = new Set([
    "1d_click", "7d_click", "28d_click",
    "1d_view", "7d_view", "28d_view",
    "1d_ev",
  ]);
  const out: string[] = [];
  for (const item of spec) {
    const suffix = map[item.event_type?.toUpperCase()];
    if (!suffix || !item.window_days) continue;
    const token = `${item.window_days}d_${suffix}`;
    if (VALID.has(token)) out.push(token);
  }
  return out.length > 0 ? out : null;
}

/** Convert a windows array back into the human label, e.g. "1-day click + 1-day view". */
export function attributionWindowsToLabel(windows: readonly string[] | string[]): string {
  return windows
    .map((w) => {
      const m = /^(\d+)d_(\w+)$/.exec(w);
      if (!m) return w;
      const days = m[1];
      const type = m[2] === "click" ? "click" : m[2] === "view" ? "view" : m[2].replace(/_/g, " ");
      return `${days}-day ${type}`;
    })
    .join(" + ");
}

export class MetaApiClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${META_API_BASE}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(parseMetaError(res.status, body));
    }
    return res.json();
  }

  /**
   * Fetch a fully-formed absolute URL (e.g. a Graph API `paging.next` link,
   * which already includes the access token and all query params). Used to walk
   * paginated Insights responses.
   */
  private async fetchAbsolute<T>(absoluteUrl: string): Promise<T> {
    const res = await fetch(absoluteUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(parseMetaError(res.status, body));
    }
    return res.json();
  }

  async getPixelInfo(pixelId: string): Promise<MetaPixelInfo> {
    return this.fetch<MetaPixelInfo>(`/${pixelId}`, {
      fields:
        "id,name,is_unavailable,last_fired_time,data_use_setting," +
        "enable_automatic_matching,automatic_matching_fields,creation_time," +
        "owner_business,is_consolidated_container",
    });
  }

  async getPixelStats(pixelId: string, since?: string, until?: string) {
    const params: Record<string, string> = { aggregation: "event" };
    // Meta's /stats edge expects Unix timestamps; ISO strings drift at day edges.
    if (since) params.start_time = String(isoToUnix(since));
    if (until) params.end_time = String(isoToUnix(until, true));
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, params);
  }

  async getCapiStats(pixelId: string, since?: string, until?: string) {
    // `aggregation=event_source` returns the browser-vs-server (Pixel vs CAPI)
    // split: nested rows of { value: "BROWSER" | "SERVER", count }. The
    // `breakdowns=event_source` param is silently ignored by Meta — verified
    // live via /api/debug/meta-capi. start_time/end_time scope it to the
    // dashboard's selected date window so 7d ≠ 90d.
    const params: Record<string, string> = { aggregation: "event_source" };
    if (since) params.start_time = String(isoToUnix(since));
    if (until) params.end_time = String(isoToUnix(until, true));
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, params);
  }

  async getDiagnostics(pixelId: string) {
    // Diagnostics are config-level errors — not time-scoped.
    return this.fetch<{ data?: any[] }>(`/${pixelId}/diagnostics`, {
      fields: "issue_type,description,severity,affected_event",
    });
  }

  async getMatchKeyStats(pixelId: string, since?: string, until?: string) {
    // `aggregation=match_keys` returns REAL per-key coverage: nested rows of
    // { event, value: <keyName e.g. "em"|"external_id"|"fbp">, count } where
    // count = events of that type that carried the key. Date-scoped so the
    // match-key table reflects the selected window, not all-time.
    const params: Record<string, string> = { aggregation: "match_keys" };
    if (since) params.start_time = String(isoToUnix(since));
    if (until) params.end_time = String(isoToUnix(until, true));
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, params);
  }

  async getPiiStats(pixelId: string, since?: string, until?: string) {
    // `aggregation=had_pii` returns rows { event, value: "has_pii"|"not_has_pii", count }.
    const params: Record<string, string> = { aggregation: "had_pii" };
    if (since) params.start_time = String(isoToUnix(since));
    if (until) params.end_time = String(isoToUnix(until, true));
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, params);
  }

  /**
   * Full audit — calls real Meta APIs in parallel.
   * Returns null if any required call fails — caller falls back to demo data.
   */
  async getFullPixelAudit(pixelId: string, startDate?: string, endDate?: string): Promise<MetaPixelStats | null> {
    try {
      const [info, stats, capiStats, diagnostics, matchKeyStats, piiStats] = await Promise.all([
        this.getPixelInfo(pixelId),
        this.getPixelStats(pixelId, startDate, endDate),
        this.getCapiStats(pixelId, startDate, endDate).catch(() => ({ data: [] })),
        this.getDiagnostics(pixelId).catch(() => ({ data: [] })),              // config errors — not time-scoped
        this.getMatchKeyStats(pixelId, startDate, endDate).catch(() => ({ data: [] })),
        this.getPiiStats(pixelId, startDate, endDate).catch(() => ({ data: [] })),
      ]);

      // Meta's pixel /stats returns TIME-BUCKETED rows, each with a NESTED
      // `data` array of { value: <eventName>, count }. The previous code read
      // `count` off the outer bucket (always undefined) → totalEvents = 0 even
      // when events existed. Flatten + sum across all buckets by `value`.
      const flattenStats = (resp: { data?: any[] }): Map<string, number> => {
        const out = new Map<string, number>();
        for (const bucket of resp.data || []) {
          const rows = Array.isArray((bucket as any)?.data) ? (bucket as any).data : [];
          for (const row of rows) {
            const key = String(row.value ?? "");
            if (!key) continue;
            out.set(key, (out.get(key) || 0) + (row.count || 0));
          }
        }
        return out;
      };

      const eventCounts = flattenStats(stats);
      const events = Array.from(eventCounts, ([event_name, count]) => ({ event_name, count }));
      const diagIssues = diagnostics.data || [];

      // Browser vs server (Pixel vs CAPI) split from `aggregation=event_source`:
      // nested rows of { value: "BROWSER" | "SERVER", count }. Verified live.
      const sourceCounts = flattenStats(capiStats);
      let browserCount = 0;
      let serverCount = 0;
      for (const [src, c] of sourceCounts) {
        const s = src.toUpperCase();
        if (s === "SERVER") serverCount += c;
        else browserCount += c; // "BROWSER" (and any other non-server source)
      }
      const lastServerEventTime: string | undefined = info.last_fired_time;
      const totalEvents = events.reduce((s: number, e: any) => s + (e.count || 0), 0);
      const total = browserCount + serverCount || totalEvents || 1;
      const browserShare = Math.round((browserCount / total) * 100);
      const serverShare = Math.round((serverCount / total) * 100);

      const eventBreakdown = (events as any[]).map((e) => {
        // Only store what Meta's API actually returns — no synthetic calculations.
        // Meta does NOT expose per-event browser/server breakdown via the /stats
        // edge; browserCount and serverCount are set to 0 here. The real TOTAL
        // browser/server split comes from capiStats (aggregation=event_source)
        // and is shown in the KPI cards, not fabricated per-event.
        const count = e.count || 0;
        return {
          event: e.event_name,
          count,
          browserCount: 0,  // Meta provides no per-event browser/server breakdown
          serverCount: 0,   // Real totals are in capi.browserShare / serverShare
          dedupRate: 0,
          matchScore: 0,
          avgLatencyMs: 0,
          eventIdCoverage: 0,
          payloadCompleteness: 0,
          duplicateRate: 0,
          last24hCount: 0,
          baseline7dAvg: 0,
        };
      });

      const avgDedup =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.dedupRate, 0) / eventBreakdown.length
          : 0;
      const overallEmq =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.matchScore, 0) / eventBreakdown.length
          : 0;
      const avgEventIdCoverage =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.eventIdCoverage, 0) / eventBreakdown.length
          : 0;
      const avgPayload =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.payloadCompleteness, 0) / eventBreakdown.length
          : 0;
      const avgServerLatency =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.avgLatencyMs, 0) / eventBreakdown.length
          : 0;

      // REAL match-key coverage from `aggregation=match_keys`: per key, the
      // number of events that carried it. Coverage % = events-with-key / total.
      const matchKeyCounts = flattenStats(matchKeyStats); // keyName -> count
      const allKeys = ["em", "ph", "external_id", "client_ip_address", "client_user_agent", "fbc", "fbp"];
      // Include any keys Meta returned that aren't in our known list.
      for (const k of matchKeyCounts.keys()) if (!allKeys.includes(k)) allKeys.push(k);
      const matchKeys = allKeys.map((key) => ({
        key,
        coverage: totalEvents > 0 ? Math.round(((matchKeyCounts.get(key) || 0) / totalEvents) * 100) : 0,
        benchmark: ["em", "ph"].includes(key) ? 70 : 80,
      }));

      // REAL PII coverage from `aggregation=had_pii`: has_pii vs not_has_pii.
      const piiCounts = flattenStats(piiStats);
      const hasPii = piiCounts.get("has_pii") || 0;
      const noPii = piiCounts.get("not_has_pii") || 0;
      const piiCoveragePct = hasPii + noPii > 0 ? Math.round((hasPii / (hasPii + noPii)) * 100) : 0;

      const issues = (diagIssues as any[]).map((d) => ({
        code: d.issue_type || "unknown",
        message: d.description || "Issue detected",
        severity: (d.severity === "ERROR" ? "error" : "warning") as "error" | "warning",
        affectedEvent: d.affected_event,
      }));

      const capiBreakdown = {
        deduplication: avgDedup,
        eventIdConsistency: avgEventIdCoverage,
        payloadCompleteness: avgPayload,
        authStatus: 95,
        avgServerLatencyMs: avgServerLatency,
        apiFailureRate: 1,
      };

      const purchase = eventBreakdown.find((e) => e.event === "Purchase");
      const sequencingIssues: Array<{ event: string; issue: string }> = [];
      const eventNames = new Set(eventBreakdown.map((e) => e.event));
      if (eventNames.has("Purchase") && !eventNames.has("InitiateCheckout")) {
        sequencingIssues.push({ event: "InitiateCheckout", issue: "Missing — Purchase events fire without checkout" });
      }
      if (eventNames.has("AddToCart") && !eventNames.has("ViewContent")) {
        sequencingIssues.push({ event: "ViewContent", issue: "Missing — AddToCart fires before content view" });
      }

      return {
        pixelId: info.id,
        name: info.name,
        status: info.is_unavailable ? "inactive" : "active",
        totalEvents,
        eventBreakdown,
        capi: {
          enabled: serverCount > 0,
          browserShare,
          serverShare,
          avgDedupRate: avgDedup,
          lastServerEventTime,
          capiHealthScore: computeCapiHealthScore(capiBreakdown),
          capiBreakdown,
          authIssues: [],
        },
        emq: {
          overallScore: overallEmq,
          matchKeys,
          serverSideEnrichment: info.enable_automatic_matching || false,
          piiCoveragePct,
        },
        diagnostics: {
          warnings: issues.filter((i) => i.severity === "warning").length,
          errors: issues.filter((i) => i.severity === "error").length,
          lastUpdated: info.last_fired_time || new Date().toISOString(),
          dataFreshnessMins: info.last_fired_time
            ? Math.round((Date.now() - new Date(info.last_fired_time).getTime()) / 60000)
            : 0,
          issues,
          recentActivity: [],
        },
        eventManager: {
          automaticMatchingEnabled: info.enable_automatic_matching || false,
          automaticMatchingFields: info.automatic_matching_fields || [],
          dataUseSetting: info.data_use_setting || "ADVERTISING",
          activeEventCount: events.length,
        },
        anomalies: detectAnomalies(eventBreakdown),
        funnelIntegrity: {
          duplicatePurchases: purchase ? Math.round(purchase.count * (purchase.duplicateRate / 100)) : 0,
          duplicatePurchaseRate: purchase?.duplicateRate || 0,
          sequencingIssues,
          brokenAttributionChains: 0,
        },
        config: {
          createdAt: info.creation_time,
          dataUseSetting: info.data_use_setting || "ADVERTISING_AND_ANALYTICS",
          automaticMatchingEnabled: info.enable_automatic_matching || false,
          automaticMatchingFields: info.automatic_matching_fields || [],
          ownerBusiness: info.owner_business,
          isConsolidatedContainer: info.is_consolidated_container,
          isUnavailable: info.is_unavailable,
          lastFiredTime: info.last_fired_time,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * List all campaigns under this business account
   */
  async listCampaigns(
    businessId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{
    id: string;
    name: string;
    objective?: string;
    status: string;
    platform: "meta";
    createdTime?: string;
    endTime?: string;
    dailyBudget?: number;
    lifetimeBudget?: number;
    spend?: number;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    conversionValue?: number;
    currency?: string;
    adSets?: Array<{
      id: string;
      name: string;
      status: string;
      spend?: number;
      impressions?: number;
      clicks?: number;
      ads: Array<{ id: string; name: string; status: string; spend?: number; impressions?: number; clicks?: number; reach?: number }>;
    }>;
    effectiveAttribution?: string;
  }> | null> {
    try {
      // The user-provided ID can be either an Ad Account ID (more common — they
      // grab it from Ads Manager) or a true Business Manager ID. Ad accounts
      // need the `act_` prefix on Graph API paths. Normalize: if the input
      // doesn't already start with `act_` and is purely numeric, treat it as
      // an ad account ID and prepend `act_`.
      const accountPath = businessId.startsWith("act_")
        ? businessId
        : /^\d+$/.test(businessId)
        ? `act_${businessId}`
        : businessId;

      // STEP 1 — fetch /campaigns FIRST (gets ad-set attribution_spec).
      //   We need this BEFORE the Insights call so we can use each account's
      //   actual attribution window (e.g. Plenaire's 1d_click+1d_view) instead
      //   of hardcoded 7d_click+1d_view. Insights with the wrong attribution
      //   returns conversion counts that won't match Ads Manager.
      const response = await this.fetch<{ data?: any[] }>(`/${accountPath}/campaigns`, {
        fields:
          "id,name,objective,status,effective_status,created_time,updated_time,stop_time,daily_budget,lifetime_budget," +
          "adsets.limit(50){id,name,daily_budget,lifetime_budget,end_time,status,effective_status,updated_time,optimization_goal,bid_strategy,bid_amount,attribution_spec,learning_stage_info{status,attribution_windows,last_sig_edit_ts}," +
            "ads.limit(20){id,name,status,effective_status}}",
        limit: "100",
      });

      // STEP 2 — derive the DOMINANT attribution across active campaigns'
      //   ad sets. Most accounts use one attribution everywhere; mixed-attr
      //   accounts: pick the most common (the rare odd-one-out has a small
      //   per-campaign drift the auto-verify agent will catch and flag).
      const activeRawCampaigns = (response.data || []).filter(
        (c: any) => c.status === "ACTIVE" || c.effective_status === "ACTIVE"
      );
      const windowCounts = new Map<string, number>();
      for (const c of activeRawCampaigns) {
        const adsets = c.adsets?.data || [];
        for (const a of adsets) {
          const w = attributionSpecToWindows(a.attribution_spec);
          if (!w || w.length === 0) continue;
          const key = w.slice().sort().join(",");
          windowCounts.set(key, (windowCounts.get(key) || 0) + 1);
        }
      }
      let dominantWindows: string[] | undefined;
      if (windowCounts.size > 0) {
        const [bestKey] = [...windowCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        dominantWindows = bestKey.split(",");
      }

      // STEP 3 — fetch the rest in parallel, using the derived attribution.
      const [campaignInsights, adsetInsights, adInsights, accountCurrency, windowBreakdown] = await Promise.all([
        this.getCampaignInsights(accountPath, startDate, endDate, dominantWindows),
        this.getAdSetInsights(accountPath, startDate, endDate),
        this.getAdMetricsById(accountPath, startDate, endDate),
        this.getAccountCurrency(accountPath),
        this.getCampaignWindowBreakdown(accountPath, startDate, endDate),
      ]);

      const currency = accountCurrency || "USD";

      return (response.data || []).map((c: any) => {
        const m = campaignInsights[String(c.id)];
        const conversions = m?.conversions;
        const conversionValue = m?.conversionValue;

        // Meta returns budgets in account currency *minor units* (cents). Divide by 100.
        // Campaign-level budget. May be null for CBO/ABO setups where the budget
        // is actually set at the ad-set level — fall back to summing the ad-sets.
        let dailyBudget = c.daily_budget ? parseFloat(c.daily_budget) / 100 : undefined;
        let lifetimeBudget = c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : undefined;
        const hasCampaignLevelBudget = dailyBudget !== undefined || lifetimeBudget !== undefined;
        const adsets: any[] = c.adsets?.data || [];
        if (dailyBudget === undefined && lifetimeBudget === undefined && adsets.length > 0) {
          // Sum ad-set budgets — only ACTIVELY-DELIVERING ad sets, so paused/
          // archived ad sets don't inflate the campaign's allocated budget.
          // (Previously this included PAUSED ad sets, which over-stated the
          // budget several-fold for accounts that rotate many paused ad sets.)
          const liveAdsets = adsets.filter((a) => {
            const s = (a.effective_status || a.status || "").toUpperCase();
            return s === "ACTIVE" || s === "ENABLED";
          });
          const sumDaily = liveAdsets.reduce(
            (s, a) => s + (a.daily_budget ? parseFloat(a.daily_budget) / 100 : 0),
            0
          );
          const sumLifetime = liveAdsets.reduce(
            (s, a) => s + (a.lifetime_budget ? parseFloat(a.lifetime_budget) / 100 : 0),
            0
          );
          if (sumDaily > 0) dailyBudget = sumDaily;
          if (sumLifetime > 0) lifetimeBudget = sumLifetime;
        }

        // End time: prefer campaign-level stop_time; if absent, use the latest
        // ad-set end_time (any non-null) — a campaign typically ends with its
        // last-running ad set.
        let endTime: string | undefined = c.stop_time || undefined;
        if (!endTime && adsets.length > 0) {
          const adsetEnds = adsets
            .map((a) => a.end_time)
            .filter((t): t is string => typeof t === "string");
          if (adsetEnds.length > 0) {
            endTime = adsetEnds.sort().reverse()[0]; // latest end
          }
        }

        // Children for the naming audit: ad sets + their ads, name + status +
        // per-ad-set insights (spend / impressions / clicks) so the drill view
        // can show metrics at every level.
        const adSets = adsets.map((a: any) => {
          const asm = adsetInsights[String(a.id)];
          // Meta's learning_stage_info: { status: "LEARNING" | "LEARNING_LIMITED"
          // | "SUCCESS", last_sig_edit_ts: <unix ts of last significant edit
          // that restarted the ~7-day learning window> }
          const lsi = a.learning_stage_info || null;
          return {
            id: String(a.id),
            name: String(a.name || ""),
            status: String(a.status || a.effective_status || "UNKNOWN"),
            spend: asm?.spend,
            impressions: asm?.impressions,
            clicks: asm?.clicks,
            reach: asm?.reach,
            learningStatus: lsi?.status || undefined,
            lastSigEditTs: lsi?.last_sig_edit_ts ? Number(lsi.last_sig_edit_ts) : undefined,
            optimizationGoal: a.optimization_goal || undefined,
            bidStrategy: a.bid_strategy || undefined,
            bidAmount: a.bid_amount ? parseFloat(a.bid_amount) / 100 : undefined,
            attributionSpec: Array.isArray(a.attribution_spec) ? a.attribution_spec : undefined,
            ads: (a.ads?.data || []).map((ad: any) => {
              const adm = adInsights[String(ad.id)];
              return {
              id: String(ad.id),
              name: String(ad.name || ""),
              status: String(ad.status || ad.effective_status || "UNKNOWN"),
              spend: adm?.spend,
              impressions: adm?.impressions,
              clicks: adm?.clicks,
              reach: adm?.reach,
            };
            }),
          };
        });

        // Derive this campaign's own effective attribution from the dominant
        // attribution among its live ad sets. Falls back to the account-wide
        // dominant (computed above) → Meta global default.
        const campaignWindowCounts = new Map<string, number>();
        for (const a of adSets) {
          const w = attributionSpecToWindows(a.attributionSpec);
          if (!w || w.length === 0) continue;
          const key = w.slice().sort().join(",");
          campaignWindowCounts.set(key, (campaignWindowCounts.get(key) || 0) + 1);
        }
        let effectiveWindows: string[] | undefined;
        if (campaignWindowCounts.size > 0) {
          const [k] = [...campaignWindowCounts.entries()].sort((a, b) => b[1] - a[1])[0];
          effectiveWindows = k.split(",");
        } else {
          effectiveWindows = dominantWindows ?? [...META_ATTRIBUTION_WINDOW.raw];
        }
        const effectiveAttribution = attributionWindowsToLabel(effectiveWindows);

        const wb = windowBreakdown[String(c.id)] || {};
        return {
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          platform: "meta" as const,
          createdTime: c.created_time,
          updatedTime: c.updated_time,
          endTime,
          dailyBudget,
          lifetimeBudget,
          budgetLevel: hasCampaignLevelBudget ? "campaign" as const : "adset" as const,
          spend: m?.spend,
          impressions: m?.impressions,
          clicks: m?.clicks,
          reach: m?.reach,
          videoViews: m?.videoViews,
          conversions,
          conversionValue,
          currency,
          adSets,
          effectiveAttribution,
          conv1dClick: wb.conv1dClick,
          conv7dClick: wb.conv7dClick,
          conv1dView:  wb.conv1dView,
        };
      });
    } catch (e) {
      // Surface the real Graph API error (bad token / scope / wrong account ID)
      // instead of swallowing it — the endpoint decides whether to fall back.
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /**
   * Fetch the ad account's ISO currency code (e.g. "INR", "USD").
   * `account_currency` is NOT a field on campaign objects — it lives on the
   * Ad Account node. Returns undefined on any error so the caller can fall back.
   */
  async getAccountCurrency(accountPath: string): Promise<string | undefined> {
    try {
      // Try account-level currency field first
      const res = await this.fetch<{ currency?: string; account_currency?: string }>(
        `/${accountPath}`,
        { fields: "currency,account_currency" }
      );
      return res.currency || res.account_currency || undefined;
    } catch {
      // Fallback: pull from a single-day insights row — account_currency is
      // always present in every insights response regardless of permissions.
      try {
        const res2 = await this.fetch<{ data?: Array<{ account_currency?: string }> }>(
          `/${accountPath}/insights`,
          { fields: "account_currency", date_preset: "last_7d", level: "account", limit: "1" }
        );
        return res2.data?.[0]?.account_currency || undefined;
      } catch {
        return undefined;
      }
    }
  }

  /**
   * List the user's verified domains across all Businesses they have access to.
   * Real Meta API: `/me/businesses?fields=verified_domains`. Domain verification
   * is the prerequisite for Aggregated Event Measurement (AEM) and iOS 14.5+
   * conversion attribution.
   */
  async getVerifiedDomains(): Promise<Array<{ businessId: string; businessName: string; domains: string[] }>> {
    try {
      const res = await this.fetch<{ data?: Array<{ id: string; name: string; verified_domains?: { data?: Array<{ domain: string }> } }> }>(
        `/me/businesses`,
        { fields: "id,name,verified_domains{domain}" }
      );
      return (res.data || []).map((b) => ({
        businessId: b.id,
        businessName: b.name,
        domains: (b.verified_domains?.data || []).map((d) => d.domain),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Aggregated Event Measurement (AEM) priority event list per pixel. Real
   * Meta API: `/{pixel_id}?fields=aggregated_event_configuration`. Returns
   * the up-to-8 prioritised events used for iOS 14.5+ attribution.
   * Returns empty array when the pixel has no AEM configured or when the
   * field isn't accessible on this account/token.
   */
  async getAemConfig(pixelId: string): Promise<Array<{ event_name: string; priority: number }>> {
    try {
      const res = await this.fetch<{ aggregated_event_configuration?: { data?: Array<{ event_name: string; priority: number }> } }>(
        `/${pixelId}`,
        { fields: "aggregated_event_configuration" }
      );
      const data = res.aggregated_event_configuration?.data;
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Read the ad account's default attribution spec. Real Meta API:
   * `act_<id>?fields=attribution_spec`. Tells us whether the account uses the
   * platform default (7d click + 1d view) or has overridden to something else.
   */
  async getAccountAttributionSpec(accountPath: string): Promise<Array<{ event_type: string; window_days: number }> | null> {
    try {
      const res = await this.fetch<{ attribution_spec?: Array<{ event_type: string; window_days: number }> }>(
        `/${accountPath}`,
        { fields: "attribution_spec" }
      );
      return res.attribution_spec || null;
    } catch {
      return null;
    }
  }

  /**
   * Window-accurate per-campaign metrics from the dedicated Insights edge.
   *
   * Unlike nested field-expansion insights (which Meta often returns for a
   * default/lifetime window), the `/insights?level=campaign` edge with a
   * TOP-LEVEL `time_range` is the same source Ads Manager uses and reliably
   * honors the window. `action_attribution_windows=7d_click,1d_view` matches
   * Ads Manager's default so conversions/ROAS line up.
   *
   * Returns a map keyed by campaign id. Follows paging defensively.
   */
  async getCampaignInsights(
    accountPath: string,
    startDate?: string,
    endDate?: string,
    /** Override the default 7d_click+1d_view attribution. Pass an array like
     * ["1d_click","1d_view"] derived from the account's actual attribution_spec
     * so conversions match Ads Manager exactly. */
    attributionWindows?: string[]
  ): Promise<Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number; conversions?: number; conversionValue?: number; videoViews?: number }>> {
    const out: Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number; conversions?: number; conversionValue?: number; videoViews?: number }> = {};

    // Inner runner — fetches the insights edge with (or without) attribution
    // windows. `withAttribution=false` omits action_attribution_windows entirely
    // (spend/impressions/clicks are attribution-INDEPENDENT, so they're always
    // correct even without it; only conversions vary by window).
    const runFetch = async (withAttribution: boolean) => {
      const params: Record<string, string> = {
        level: "campaign",
        fields: "campaign_id,spend,impressions,clicks,reach,actions,action_values,video_play_actions",
        limit: "500",
      };
      if (withAttribution) {
        const windowsToUse =
          attributionWindows && attributionWindows.length > 0 ? attributionWindows : [...META_ATTRIBUTION_WINDOW.raw];
        params.action_attribution_windows = JSON.stringify(windowsToUse);
      }
      if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
      else params.date_preset = "last_30d";

      let path: string | null = `/${accountPath}/insights`;
      let nextParams: Record<string, string> | undefined = params;
      for (let guard = 0; guard < 10 && path; guard++) {
        const res: { data?: any[]; paging?: { next?: string } } = nextParams
          ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
          : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
        for (const row of res.data || []) {
          const id = String(row.campaign_id);
          out[id] = {
            spend: row.spend !== undefined ? parseFloat(row.spend) : undefined,
            impressions: row.impressions !== undefined ? parseInt(row.impressions, 10) : undefined,
            clicks: row.clicks !== undefined ? parseInt(row.clicks, 10) : undefined,
            reach: row.reach !== undefined ? parseInt(row.reach, 10) : undefined,
            conversions: sumConversions(row.actions),
            conversionValue: sumConversions(row.action_values),
            videoViews: sumActionValues(row.video_play_actions),
          };
        }
        const next = res.paging?.next;
        path = next || null;
        nextParams = undefined;
      }
    };

    try {
      await runFetch(true);
    } catch {
      // A bad/unsupported attribution window (e.g. an account using engaged-view)
      // 400s the whole call. Retry WITHOUT attribution windows so spend/
      // impressions/clicks (attribution-independent) are never lost — only
      // conversions fall back to the account default.
      try {
        await runFetch(false);
      } catch {
        // Both failed — degrade gracefully (campaigns render "—").
      }
    }
    return out;
  }

  /**
   * Fetch per-campaign conversion breakdown across 1d_click, 7d_click, and 1d_view windows.
   * Makes a single Insights call with action_attribution_windows=["1d_click","7d_click","1d_view"].
   * Meta includes per-window sub-fields on each action row; we read those fields rather than `value`.
   */
  async getCampaignWindowBreakdown(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, { conv1dClick?: number; conv7dClick?: number; conv1dView?: number }>> {
    const out: Record<string, { conv1dClick?: number; conv7dClick?: number; conv1dView?: number }> = {};
    try {
      const params: Record<string, string> = {
        level: "campaign",
        fields: "campaign_id,actions",
        action_attribution_windows: JSON.stringify(["1d_click", "7d_click", "1d_view"]),
        limit: "500",
      };
      if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
      else params.date_preset = "last_30d";

      let path: string | null = `/${accountPath}/insights`;
      let nextParams: Record<string, string> | undefined = params;
      for (let guard = 0; guard < 10 && path; guard++) {
        const res: { data?: any[]; paging?: { next?: string } } = nextParams
          ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
          : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
        for (const row of res.data || []) {
          const id = String(row.campaign_id);
          out[id] = {
            conv1dClick: sumConversionsByWindow(row.actions, "1d_click"),
            conv7dClick: sumConversionsByWindow(row.actions, "7d_click"),
            conv1dView:  sumConversionsByWindow(row.actions, "1d_view"),
          };
        }
        path = res.paging?.next || null;
        nextParams = undefined;
      }
    } catch {
      // Degrade gracefully — window breakdown is supplemental; main conversions unaffected.
    }
    return out;
  }

  /**
   * Window-accurate per-ad-set metrics from the Insights edge (`level=adset`).
   * Used by the campaign drill-down. Returns a map keyed by ad-set id.
   */
  /** Full ad-set insights — name, spend, impressions, clicks, reach, frequency,
   *  conversions and conversion value. Used by the Audience Analysis tabs. */
  async getAdSetFullInsights(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{
    id: string; name: string; campaignName?: string;
    spend: number; impressions: number; clicks: number;
    reach: number; frequency: number;
    conversions: number; conversionValue: number;
    uniqueClicks?: number;
  }>> {
    const params: Record<string, string> = {
      level: "adset",
      fields: "adset_id,adset_name,campaign_name,spend,impressions,clicks,reach,frequency,actions,action_values,unique_clicks",
      limit: "500",
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";

    const out: Array<{ id: string; name: string; campaignName?: string; spend: number; impressions: number; clicks: number; reach: number; frequency: number; conversions: number; conversionValue: number; uniqueClicks?: number }> = [];
    let path: string | null = `/${accountPath}/insights`;
    let nextParams: Record<string, string> | undefined = params;
    for (let guard = 0; guard < 10 && path; guard++) {
      const res: { data?: any[]; paging?: { next?: string } } = nextParams
        ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
        : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
      for (const row of res.data || []) {
        out.push({
          id: String(row.adset_id || ""),
          name: String(row.adset_name || ""),
          campaignName: row.campaign_name ? String(row.campaign_name) : undefined,
          spend: row.spend ? parseFloat(row.spend) : 0,
          impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
          clicks: row.clicks ? parseInt(row.clicks, 10) : 0,
          reach: row.reach ? parseInt(row.reach, 10) : 0,
          frequency: row.frequency ? parseFloat(row.frequency) : 0,
          conversions: sumConversions(row.actions) || 0,
          conversionValue: sumConversions(row.action_values) || 0,
          uniqueClicks: row.unique_clicks ? parseInt(row.unique_clicks, 10) : undefined,
        });
      }
      path = res.paging?.next || null;
      nextParams = undefined;
    }
    return out;
  }

  /** Account-level reach + average frequency + impressions over the trailing
   *  365 days (one Insights call, level=account). Used by the annual
   *  frequency-distribution chart. Returns zeros when no data. */
  async getAccountAnnualReachFrequency(
    accountPath: string
  ): Promise<{ reach: number; frequency: number; impressions: number; spend: number }> {
    // Trailing 12 months: today − 365 days → today (UTC date strings).
    const until = new Date();
    const since = new Date(until.getTime() - 365 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const params: Record<string, string> = {
      level: "account",
      fields: "reach,frequency,impressions,spend",
      time_range: `{"since":"${iso(since)}","until":"${iso(until)}"}`,
    };
    const res = await this.fetch<{ data?: any[] }>(`/${accountPath}/insights`, params);
    const row = res.data?.[0] || {};
    return {
      reach: row.reach ? parseInt(row.reach, 10) : 0,
      frequency: row.frequency ? parseFloat(row.frequency) : 0,
      impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
      spend: row.spend ? parseFloat(row.spend) : 0,
    };
  }

  /** Account-level deduplicated reach + average frequency for an ARBITRARY date
   *  range (level=account). This is the TRUE cross-campaign frequency — the
   *  average impressions per unique person across every campaign in the period —
   *  and the deduplicated denominator for the cross-campaign burden metric.
   *  Returns zeros when no data. */
  async getAccountReachFrequency(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<{ reach: number; frequency: number; impressions: number }> {
    const params: Record<string, string> = {
      level: "account",
      fields: "reach,frequency,impressions",
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";
    const res = await this.fetch<{ data?: any[] }>(`/${accountPath}/insights`, params);
    const row = res.data?.[0] || {};
    return {
      reach: row.reach ? parseInt(row.reach, 10) : 0,
      frequency: row.frequency ? parseFloat(row.frequency) : 0,
      impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
    };
  }

  /** Account-level reach + frequency + impressions broken out by MONTH over the
   *  trailing 365 days (time_increment=monthly). Used by the monthly
   *  views-over-time chart. Each row's reach is the unique reach within that month. */
  async getAccountMonthlyReachFrequency(
    accountPath: string
  ): Promise<Array<{ month: string; reach: number; frequency: number; impressions: number }>> {
    const until = new Date();
    const since = new Date(until.getTime() - 365 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const params: Record<string, string> = {
      level: "account",
      fields: "reach,frequency,impressions",
      time_increment: "monthly",
      time_range: `{"since":"${iso(since)}","until":"${iso(until)}"}`,
    };
    const res = await this.fetch<{ data?: any[] }>(`/${accountPath}/insights`, params);
    return (res.data || []).map((row) => ({
      month: String(row.date_start || "").slice(0, 7), // YYYY-MM
      reach: row.reach ? parseInt(row.reach, 10) : 0,
      frequency: row.frequency ? parseFloat(row.frequency) : 0,
      impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
    }));
  }

  async getAdSetInsights(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number }>> {
    const out: Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number }> = {};
    try {
      const params: Record<string, string> = {
        level: "adset",
        fields: "adset_id,spend,impressions,clicks,reach",
        limit: "500",
      };
      if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
      else params.date_preset = "last_30d";

      let path: string | null = `/${accountPath}/insights`;
      let nextParams: Record<string, string> | undefined = params;
      for (let guard = 0; guard < 10 && path; guard++) {
        const res: { data?: any[]; paging?: { next?: string } } = nextParams
          ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
          : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
        for (const row of res.data || []) {
          const id = String(row.adset_id);
          out[id] = {
            spend: row.spend !== undefined ? parseFloat(row.spend) : undefined,
            impressions: row.impressions !== undefined ? parseInt(row.impressions, 10) : undefined,
            clicks: row.clicks !== undefined ? parseInt(row.clicks, 10) : undefined,
            reach: row.reach !== undefined ? parseInt(row.reach, 10) : undefined,
          };
        }
        const next = res.paging?.next;
        path = next || null;
        nextParams = undefined;
      }
    } catch {
      // Degrade gracefully.
    }
    return out;
  }

  /** Ad-level insights keyed by ad_id — spend, impressions, clicks, reach.
   *  Used by the drill tree to show per-ad metrics. */
  async getAdMetricsById(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number }>> {
    const out: Record<string, { spend?: number; impressions?: number; clicks?: number; reach?: number }> = {};
    try {
      const params: Record<string, string> = {
        level: "ad",
        fields: "ad_id,spend,impressions,clicks,reach",
        limit: "500",
      };
      if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
      else params.date_preset = "last_30d";

      let path: string | null = `/${accountPath}/insights`;
      let nextParams: Record<string, string> | undefined = params;
      for (let guard = 0; guard < 10 && path; guard++) {
        const res: { data?: any[]; paging?: { next?: string } } = nextParams
          ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
          : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
        for (const row of res.data || []) {
          const id = String(row.ad_id);
          out[id] = {
            spend: row.spend !== undefined ? parseFloat(row.spend) : undefined,
            impressions: row.impressions !== undefined ? parseInt(row.impressions, 10) : undefined,
            clicks: row.clicks !== undefined ? parseInt(row.clicks, 10) : undefined,
            reach: row.reach !== undefined ? parseInt(row.reach, 10) : undefined,
          };
        }
        const next = res.paging?.next;
        path = next || null;
        nextParams = undefined;
      }
    } catch {
      // Degrade gracefully — ad metrics are nice-to-have.
    }
    return out;
  }

  /**
   * Rename a campaign in Meta Ads Manager.
   * Calls POST /v18.0/{campaign_id} with body { name: "New name" }.
   * Requires the access token to have `ads_management` scope.
   *
   * Returns { success: true } on success, or { success: false, error } on
   * any Graph API error (rate limit, missing scope, invalid name, etc.).
   * Never throws — wraps the failure so the UI can surface the error.
   */
  /**
   * Batch-fetch LIFETIME insights (date_preset=maximum) for a list of campaign
   * IDs. Used by the Funnel-Separation drill-down to show paused campaigns'
   * historical spend — i.e. "before it was paused, this campaign spent ₹X".
   *
   * Graph API supports multi-ID fetch via `?ids=id1,id2,id3&fields=...`,
   * returning a map keyed by id. Single round-trip for any list size up to
   * Graph's batch limit (~50 ids).
   */
  async getCampaignLifetimeMetrics(
    ids: string[]
  ): Promise<Record<string, { spend: number; impressions: number; clicks: number; dateStart?: string; dateStop?: string }>> {
    if (!ids || ids.length === 0) return {};
    // Chunk to be safe — Graph's `?ids=` cap varies but 50 is comfortably under.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const out: Record<string, { spend: number; impressions: number; clicks: number; dateStart?: string; dateStop?: string }> = {};
    for (const chunk of chunks) {
      try {
        const res = await this.fetch<Record<string, { insights?: { data?: any[] } }>>(
          ``,
          { ids: chunk.join(","), fields: "insights.date_preset(maximum){spend,impressions,clicks,date_start,date_stop}" }
        );
        for (const id of chunk) {
          const node = (res as any)[id];
          const insight = node?.insights?.data?.[0];
          out[id] = {
            spend: insight?.spend ? parseFloat(insight.spend) : 0,
            impressions: insight?.impressions ? parseInt(insight.impressions, 10) : 0,
            clicks: insight?.clicks ? parseInt(insight.clicks, 10) : 0,
            dateStart: insight?.date_start,
            dateStop: insight?.date_stop,
          };
        }
      } catch (e) {
        // Per chunk — if Graph rejects one chunk, fill with zeros so the caller
        // can render "—" gracefully instead of bubbling an error.
        for (const id of chunk) {
          if (!out[id]) out[id] = { spend: 0, impressions: 0, clicks: 0 };
        }
      }
    }
    return out;
  }

  /**
   * Fetch per-day spend for the last 28 days for a list of campaign IDs.
   * Returns a map of id → array of { date, spend } sorted oldest-first.
   * Used by the Budget Allocation audit to compute calendar-day averages:
   *   – last 7 calendar days  ÷ 7   = "Last 7 Days Avg"
   *   – last 28 calendar days ÷ 28  = "Last 4 Weeks Avg"
   *
   * Meta's `time_increment(1)` on an insights edge returns one row per day.
   * Zero-spend days are OMITTED from the response — callers must divide by
   * the calendar-day count (not row count) to get an accurate average.
   * Batched using the same `?ids=…` technique as `getCampaignLifetimeMetrics`.
   */
  async getCampaignDailySpendTrail(
    ids: string[],
    /** Ad-account path (act_<id>). When provided, we use the RELIABLE dedicated
     * Insights edge (`/act_<id>/insights?level=campaign&time_increment=1`) which
     * reliably honors the date window — instead of the fragile nested `?ids=`
     * field-expansion pattern, which Meta intermittently ignores (returning
     * lifetime/default data → inflated "last 7d" averages). */
    accountPath?: string
  ): Promise<Record<string, Array<{ date: string; spend: number }>>> {
    if (!ids || ids.length === 0) return {};
    const out: Record<string, Array<{ date: string; spend: number }>> = {};
    const wantedIds = new Set(ids.map(String));

    // PREFERRED PATH — dedicated account-level insights edge, one row per
    // campaign per day, top-level date scoping (reliably honored by Meta).
    if (accountPath) {
      try {
        const params: Record<string, string> = {
          level: "campaign",
          time_increment: "1",
          date_preset: "last_28d",
          fields: "campaign_id,spend,date_start",
          limit: "1000",
        };
        let path: string | null = `/${accountPath}/insights`;
        let nextParams: Record<string, string> | undefined = params;
        for (let guard = 0; guard < 20 && path; guard++) {
          const res: { data?: any[]; paging?: { next?: string } } = nextParams
            ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
            : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
          for (const row of res.data || []) {
            const id = String(row.campaign_id);
            if (!wantedIds.has(id)) continue;
            if (!out[id]) out[id] = [];
            out[id].push({ date: row.date_start as string, spend: row.spend ? parseFloat(row.spend) : 0 });
          }
          const next = res.paging?.next;
          path = next || null;
          nextParams = undefined;
        }
        // Sort each campaign's rows oldest-first and return.
        for (const id of Object.keys(out)) {
          out[id].sort((a, b) => a.date.localeCompare(b.date));
        }
        // Ensure every requested id has an entry (empty = no spend in window).
        for (const id of wantedIds) if (!out[id]) out[id] = [];
        return out;
      } catch {
        // Fall through to the legacy batch path below.
      }
    }

    // FALLBACK PATH — legacy nested field-expansion (used only when accountPath
    // is unavailable). Less reliable for date scoping; kept for back-compat.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    for (const chunk of chunks) {
      try {
        const res = await this.fetch<Record<string, { insights?: { data?: any[] } }>>(
          ``,
          {
            ids: chunk.join(","),
            fields: "insights.date_preset(last_28d).time_increment(1){spend,date_start}",
          }
        );
        for (const id of chunk) {
          const node = (res as any)[id];
          const rows: Array<{ date: string; spend: number }> = (node?.insights?.data || [])
            .map((r: any) => ({
              date: r.date_start as string,
              spend: r.spend ? parseFloat(r.spend) : 0,
            }))
            .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
          out[id] = rows;
        }
      } catch {
        for (const id of chunk) {
          if (!out[id]) out[id] = [];
        }
      }
    }
    return out;
  }

  /**
   * Fetch fixed-7-day signals per campaign for the Learning Phase audit:
   * conversions (50-event rule), plus reach + frequency + impressions + spend
   * so we can derive REAL audience-size diagnostics ("audience too small =
   * high frequency on small reach", "delivery throttled = low reach despite
   * high spend"). Fixed 7-day window — independent of the global date picker.
   *
   * Reuses the same chunk-of-50 `?ids=…` batch pattern as
   * `getCampaignLifetimeMetrics` and `getCampaignDailySpendTrail`. Conversion
   * counting goes through `sumConversions()` so each underlying event is
   * counted once (purchase / lead / app_install / messaging etc., not
   * double-counted via offsite_conversion.fb_pixel_* aliases). Attribution
   * window is the account's default (typically 7-day click + 1-day view).
   */
  async getCampaignLast7dConversions(
    ids: string[]
  ): Promise<Record<string, {
    conversions7d: number;
    conversionValue7d: number;
    reach7d: number;
    frequency7d: number;
    impressions7d: number;
    spend7d: number;
  }>> {
    if (!ids || ids.length === 0) return {};
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const out: Record<string, {
      conversions7d: number;
      conversionValue7d: number;
      reach7d: number;
      frequency7d: number;
      impressions7d: number;
      spend7d: number;
    }> = {};
    for (const chunk of chunks) {
      try {
        const res = await this.fetch<Record<string, { insights?: { data?: any[] } }>>(``, {
          ids: chunk.join(","),
          fields: "insights.date_preset(last_7d){actions,action_values,reach,frequency,impressions,spend}",
        });
        for (const id of chunk) {
          const node = (res as any)[id];
          const insight = node?.insights?.data?.[0];
          out[id] = {
            conversions7d: sumConversions(insight?.actions) ?? 0,
            conversionValue7d: sumConversions(insight?.action_values) ?? 0,
            reach7d: insight?.reach ? parseInt(insight.reach, 10) : 0,
            frequency7d: insight?.frequency ? parseFloat(insight.frequency) : 0,
            impressions7d: insight?.impressions ? parseInt(insight.impressions, 10) : 0,
            spend7d: insight?.spend ? parseFloat(insight.spend) : 0,
          };
        }
      } catch {
        for (const id of chunk) {
          if (!out[id]) out[id] = { conversions7d: 0, conversionValue7d: 0, reach7d: 0, frequency7d: 0, impressions7d: 0, spend7d: 0 };
        }
      }
    }
    return out;
  }

  async renameCampaign(
    campaignId: string,
    newName: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!campaignId || !newName.trim()) {
      return { success: false, error: "campaignId and newName are required" };
    }
    try {
      const response = await fetch(`${META_API_BASE}/${encodeURIComponent(campaignId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name: newName,
          access_token: this.accessToken,
        }).toString(),
      });
      const data = await response.json();
      if (!response.ok || data?.error) {
        return {
          success: false,
          error: data?.error?.message || `HTTP ${response.status}`,
        };
      }
      return { success: data?.success === true || true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  /**
   * List all ad sets under a campaign
   */
  async listAdSets(campaignId: string): Promise<Array<{ id: string; name: string; status: string }> | null> {
    try {
      const response = await this.fetch<{ data?: any[] }>(`/${campaignId}/adsets`, {
        fields: "id,name,status",
        limit: "100",
      });

      return (response.data || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        status: a.status,
      }));
    } catch {
      return null;
    }
  }

  /**
   * List all ads under an ad set
   */
  async listAds(adSetId: string): Promise<Array<{ id: string; name: string; creativeType?: string }> | null> {
    try {
      const response = await this.fetch<{ data?: any[] }>(`/${adSetId}/ads`, {
        fields: "id,name,creative.fields(type)",
        limit: "100",
      });

      return (response.data || []).map((ad: any) => ({
        id: ad.id,
        name: ad.name,
        creativeType: ad.creative?.type,
      }));
    } catch {
      return null;
    }
  }

  /**
   * Ad-level insights — name, creative type, thumbnail, spend/impressions/clicks/conversions.
   * Used by the Creative report to rank ads and surface creative format breakdown.
   */
  async getAdInsights(
    accountPath: string,
    startDate?: string,
    endDate?: string,
    limit = 100
  ): Promise<Array<{
    id: string; name: string; campaignName?: string; adSetName?: string; adSetId?: string;
    creativeType?: string; thumbnailUrl?: string;
    spend: number; impressions: number; reach: number; clicks: number;
    conversions: number; conversionValue: number; videoViews: number;
  }>> {
    const params: Record<string, string> = {
      level: "ad",
      fields: "ad_id,ad_name,adset_id,campaign_name,adset_name,spend,impressions,reach,clicks,actions,action_values,video_play_actions",
      limit: String(limit),
      sort: "spend_descending",
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";

    const out: Array<{
      id: string; name: string; campaignName?: string; adSetName?: string;
      creativeType?: string; thumbnailUrl?: string;
      spend: number; impressions: number; reach: number; clicks: number;
      conversions: number; conversionValue: number; videoViews: number;
    }> = [];

    let res: { data?: any[] };
    try {
      res = await this.fetch<{ data?: any[] }>(`/${accountPath}/insights`, params);
    } catch {
      return out;
    }
    const baseRows = (res.data || []).map((row: any) => ({
      id: String(row.ad_id || ""),
      name: String(row.ad_name || ""),
      campaignName: row.campaign_name ? String(row.campaign_name) : undefined,
      adSetName:    row.adset_name    ? String(row.adset_name)    : undefined,
      adSetId:      row.adset_id      ? String(row.adset_id)      : undefined,
      spend: row.spend ? parseFloat(row.spend) : 0,
      impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
      reach: row.reach ? parseInt(row.reach, 10) : 0,
      clicks: row.clicks ? parseInt(row.clicks, 10) : 0,
      conversions: sumConversions(row.actions) || 0,
      conversionValue: sumConversions(row.action_values) || 0,
      videoViews: sumActionValues(row.video_play_actions) || 0,
    }));

    // Hydrate top 30 with creative details — keep it bounded so we don't burn quota.
    const topForCreative = baseRows.slice(0, 30);
    await Promise.all(
      topForCreative.map(async (r) => {
        try {
          const c = await this.fetch<{ creative?: { object_type?: string; thumbnail_url?: string } }>(`/${r.id}`, {
            fields: "creative{object_type,thumbnail_url}",
          });
          (r as any).creativeType = c.creative?.object_type;
          (r as any).thumbnailUrl = c.creative?.thumbnail_url;
        } catch { /* ignore — leave undefined */ }
      })
    );

    return baseRows;
  }

  /**
   * Account-level insights grouped by a Meta breakdown dimension.
   *
   * Returns one row per dimension value (e.g. one row per age bucket, country,
   * device platform). Used by the Targeting Insights audit to recommend which
   * demographics / places to invest more in.
   *
   * Valid `breakdown` values per Meta Graph API:
   *   - "age"                  → 13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+, unknown
   *   - "gender"               → male, female, unknown
   *   - "country"              → ISO country code
   *   - "region"               → sub-country region name
   *   - "impression_device"    → iPhone, Android, Desktop, etc.
   *   - "device_platform"      → mobile, desktop
   *   - "publisher_platform"   → facebook, instagram, audience_network, messenger
   *   - "platform_position"    → feed, stories, reels, etc.
   *   - "age,gender"           → cross-tab (age × gender)
   *
   * Conversions/ROAS use the account's default attribution (7d_click + 1d_view).
   * Spend/impressions/clicks are attribution-independent — always exact.
   */
  async getInsightsBreakdown(
    accountPath: string,
    breakdown: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{
    label: string;
    breakdownValues: Record<string, string>;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    reach?: number;
    frequency?: number;
  }>> {
    // Meta rejects `platform_position` on its own with a (#100) error — it must
    // be paired with `publisher_platform` (the only valid groupings are
    // publisher_platform[,platform_position][,impression_device]). Request the
    // valid pair, then collapse the rows back down to the caller's dimension.
    // Ref: Marketing API → Insights → Breakdowns ("Combining breakdowns").
    const wantDims = breakdown.split(",");
    const needsPub = wantDims.includes("platform_position") && !wantDims.includes("publisher_platform");
    const reqBreakdown = needsPub ? ["publisher_platform", ...wantDims].join(",") : breakdown;
    const reqDims = reqBreakdown.split(",");

    const params: Record<string, string> = {
      breakdowns: reqBreakdown,
      fields: "spend,impressions,clicks,reach,frequency,actions,action_values,video_play_actions",
      limit: "500",
      action_attribution_windows: JSON.stringify([...META_ATTRIBUTION_WINDOW.raw]),
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";

    type BRow = {
      label: string;
      breakdownValues: Record<string, string>;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversionValue: number;
      reach?: number;
      frequency?: number;
      videoViews?: number;
    };
    const out: BRow[] = [];

    // Inner runner handles a 400 by retrying without attribution windows
    // (matches the resilience pattern used by getCampaignInsights).
    const runFetch = async (withAttribution: boolean) => {
      const p = { ...params };
      if (!withAttribution) delete p.action_attribution_windows;

      let path: string | null = `/${accountPath}/insights`;
      let nextParams: Record<string, string> | undefined = p;
      for (let guard = 0; guard < 10 && path; guard++) {
        const res: { data?: any[]; paging?: { next?: string } } = nextParams
          ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
          : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);

        for (const row of res.data || []) {
          // Collect the requested breakdown values (e.g. { publisher_platform:
          // "facebook", platform_position: "feed" }).
          const breakdownValues: Record<string, string> = {};
          for (const dim of reqDims) {
            if (row[dim] !== undefined) breakdownValues[dim] = String(row[dim]);
          }
          const label = Object.values(breakdownValues).join(" · ") || "Unknown";
          out.push({
            label,
            breakdownValues,
            spend: row.spend !== undefined ? parseFloat(row.spend) : 0,
            impressions: row.impressions !== undefined ? parseInt(row.impressions, 10) : 0,
            clicks: row.clicks !== undefined ? parseInt(row.clicks, 10) : 0,
            conversions: sumConversions(row.actions) || 0,
            conversionValue: sumConversions(row.action_values) || 0,
            reach: row.reach !== undefined ? parseInt(row.reach, 10) : undefined,
            frequency: row.frequency !== undefined ? parseFloat(row.frequency) : undefined,
            videoViews: sumActionValues(row.video_play_actions) || 0,
          });
        }
        const next = res.paging?.next;
        path = next || null;
        nextParams = undefined;
      }
    };

    try {
      await runFetch(true);
    } catch {
      // Retry without attribution windows in case the account uses a
      // non-standard window (e.g. engaged-view) the default rejects.
      out.length = 0;
      await runFetch(false);
    }

    // If we augmented with publisher_platform to satisfy Meta, collapse the rows
    // back to the caller's requested dimensions (sum metrics across publishers).
    if (needsPub) {
      const merged = new Map<string, BRow>();
      for (const r of out) {
        const bv: Record<string, string> = {};
        for (const dim of wantDims) if (r.breakdownValues[dim] !== undefined) bv[dim] = r.breakdownValues[dim];
        const label = Object.values(bv).join(" · ") || "Unknown";
        const cur = merged.get(label) ?? { label, breakdownValues: bv, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, videoViews: 0 };
        cur.spend += r.spend; cur.impressions += r.impressions; cur.clicks += r.clicks;
        cur.conversions += r.conversions; cur.conversionValue += r.conversionValue;
        cur.videoViews = (cur.videoViews ?? 0) + (r.videoViews ?? 0);
        if (r.reach !== undefined) cur.reach = (cur.reach ?? 0) + r.reach;
        merged.set(label, cur);
      }
      return Array.from(merged.values());
    }

    return out;
  }

  /** List custom audiences for an ad account.
   *  Returns id, name, size, subtype/lookalike fields, and time_updated for staleness detection. */
  async getCustomAudiences(accountPath: string): Promise<Array<{
    id: string;
    name: string;
    size: number;
    subtype?: string;
    lookalikeSpec?: { ratio?: number; type?: string; origin?: any[]; startingAudienceSize?: number };
    customerFileSource?: string;
    timeUpdated?: string;
    retentionDays?: number;
  }>> {
    const out: Array<{
      id: string; name: string; size: number;
      subtype?: string;
      lookalikeSpec?: { ratio?: number; type?: string; origin?: any[]; startingAudienceSize?: number };
      customerFileSource?: string;
      timeUpdated?: string;
      retentionDays?: number;
    }> = [];
    let path: string | null = `/${accountPath}/customaudiences`;
    let nextParams: Record<string, string> | undefined = {
      fields: "id,name,approximate_count_lower_bound,approximate_count_upper_bound,subtype,lookalike_spec,customer_file_source,time_updated,retention_days",
      limit: "200",
    };

    for (let guard = 0; guard < 10 && path; guard++) {
      const res: { data?: any[]; paging?: { next?: string } } = nextParams
        ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
        : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);

      for (const row of res.data || []) {
        const lower = parseInt(row.approximate_count_lower_bound || "0", 10);
        const upper = parseInt(row.approximate_count_upper_bound || "0", 10);
        out.push({
          id: row.id,
          name: row.name || `Audience ${row.id}`,
          size: lower > 0 && upper > 0 ? Math.round((lower + upper) / 2) : lower || upper,
          subtype: row.subtype || undefined,
          lookalikeSpec: row.lookalike_spec
            ? {
                ratio: row.lookalike_spec.ratio,
                type: row.lookalike_spec.type,
                origin: row.lookalike_spec.origin,
                startingAudienceSize: row.lookalike_spec.origin?.[0]?.starting_audience_size,
              }
            : undefined,
          customerFileSource: row.customer_file_source || undefined,
          timeUpdated: row.time_updated || undefined,
          retentionDays: row.retention_days != null ? parseInt(String(row.retention_days), 10) : undefined,
        });
      }

      const next = res.paging?.next;
      path = next || null;
      nextParams = undefined;
    }

    return out.sort((a, b) => b.size - a.size);
  }

  /** Fetch per-ad-set targeting + promoted_object + campaign objective.
   *  Used by the audience tabs to classify ad sets by their REAL Meta targeting
   *  setup instead of regex-parsing the ad-set name. Batched via the IDs param. */
  /**
   * The full Meta ad-locale table: numeric locale key → language name
   * (e.g. 6 → "English (US)", 23 → "Hindi"). Meta's targeting.locales stores
   * these numeric keys; this resolves ANY of them (not just a hardcoded subset),
   * so targeted languages render with their real names. Paged; best-effort.
   */
  async getAdLocales(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    try {
      let page = await this.fetch<{ data?: Array<{ key: number; name: string }>; paging?: { next?: string } }>(
        "/search",
        { type: "adlocale", limit: "1000" }
      );
      let guard = 0;
      while (page?.data?.length && guard < 10) {
        for (const l of page.data) {
          if (l.key != null && l.name) map.set(Number(l.key), l.name);
        }
        if (page.paging?.next) { page = await this.fetchAbsolute(page.paging.next); guard++; }
        else break;
      }
    } catch { /* return whatever resolved — caller falls back gracefully */ }
    return map;
  }

  async getAdSetsTargeting(
    accountPath: string,
    adSetIds: string[]
  ): Promise<Record<string, {
    id: string;
    name: string;
    targeting?: any;
    promotedObject?: { product_set_id?: string; custom_event_type?: string };
    campaignId?: string;
    campaignObjective?: string;
  }>> {
    if (adSetIds.length === 0) return {};
    const out: Record<string, any> = {};

    // Step 1 — pull ad-set targeting + campaign_id, batched ~50 IDs per call.
    const chunks: string[][] = [];
    for (let i = 0; i < adSetIds.length; i += 50) chunks.push(adSetIds.slice(i, i + 50));

    const seenCampaignIds = new Set<string>();
    for (const chunk of chunks) {
      try {
        const res = await this.fetch<Record<string, any>>("/", {
          ids: chunk.join(","),
          fields: "id,name,targeting,promoted_object,campaign_id",
        });
        for (const [id, row] of Object.entries(res || {})) {
          const r = row as any;
          if (!r || typeof r !== "object") continue;
          out[id] = {
            id,
            name: r.name || "",
            targeting: r.targeting || undefined,
            promotedObject: r.promoted_object || undefined,
            campaignId: r.campaign_id || undefined,
          };
          if (r.campaign_id) seenCampaignIds.add(r.campaign_id);
        }
      } catch {
        // Some ad sets may 403 (Advantage+) — silent skip, name-fallback will handle them.
      }
    }

    // Step 2 — pull campaign objectives in one batched call so we can detect
    // ASC / OUTCOME_SALES via real data, not the ad-set name.
    if (seenCampaignIds.size > 0) {
      const campIds = Array.from(seenCampaignIds);
      const objectives: Record<string, string> = {};
      for (let i = 0; i < campIds.length; i += 50) {
        const chunk = campIds.slice(i, i + 50);
        try {
          const res = await this.fetch<Record<string, any>>("/", {
            ids: chunk.join(","),
            fields: "id,objective",
          });
          for (const [id, row] of Object.entries(res || {})) {
            const r = row as any;
            if (r?.objective) objectives[id] = r.objective;
          }
        } catch { /* ignore */ }
      }
      for (const id of Object.keys(out)) {
        const cid = out[id].campaignId;
        if (cid && objectives[cid]) out[id].campaignObjective = objectives[cid];
      }
    }

    return out;
  }

  /** Estimate reach for a set of custom audiences via reachestimate.
   *  Used to approximate overlap between two audiences:
   *    overlap ≈ sizeA + sizeB − combinedReach */
  async getReachEstimate(accountPath: string, audienceIds: string[]): Promise<number> {
    const targetingSpec = JSON.stringify({
      custom_audiences: audienceIds.map((id) => ({ id })),
    });
    const res = await this.fetch<{ users?: number; estimate_ready?: boolean }>(
      `/${accountPath}/reachestimate`,
      { targeting_spec: targetingSpec, currency: "USD" }
    );
    return res.users ?? 0;
  }

  /** Account-level daily insights — one row per day aggregated across all campaigns.
   *  Used by BreakdownsReport "Daily" dimension. */
  async getAccountDailyInsights(
    accountPath: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{
    label: string;
    breakdownValues: Record<string, string>;
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    conversions: number;
    conversionValue: number;
  }>> {
    const params: Record<string, string> = {
      time_increment: "1",
      fields: "spend,impressions,clicks,reach,actions,action_values,date_start",
      limit: "500",
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";

    const dayMap = new Map<string, { spend: number; impressions: number; clicks: number; reach: number; conversions: number; conversionValue: number }>();

    let path: string | null = `/${accountPath}/insights`;
    let nextParams: Record<string, string> | undefined = params;
    for (let guard = 0; guard < 15 && path; guard++) {
      const res: { data?: any[]; paging?: { next?: string } } = nextParams
        ? await this.fetch<{ data?: any[]; paging?: { next?: string } }>(path, nextParams)
        : await this.fetchAbsolute<{ data?: any[]; paging?: { next?: string } }>(path);
      for (const row of res.data || []) {
        const date: string = row.date_start || "Unknown";
        const cur = dayMap.get(date) || { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversionValue: 0 };
        cur.spend += row.spend ? parseFloat(row.spend) : 0;
        cur.impressions += row.impressions ? parseInt(row.impressions, 10) : 0;
        cur.clicks += row.clicks ? parseInt(row.clicks, 10) : 0;
        cur.reach += row.reach ? parseInt(row.reach, 10) : 0;
        cur.conversions += sumConversions(row.actions) || 0;
        cur.conversionValue += sumConversions(row.action_values) || 0;
        dayMap.set(date, cur);
      }
      const next = res.paging?.next;
      path = next || null;
      nextParams = undefined;
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ label: date, breakdownValues: { date }, ...v }));
  }
}
