/**
 * POST /api/naming/campaigns/dv360
 *
 * DV360 campaign list mapped into the shared CampaignData shape:
 *   CampaignData        = DV360 Campaign
 *   CampaignData.adSets = Insertion Orders
 *   adSets[].ads        = Line Items (with lineItemType)
 *
 * Metrics come from ONE Bid Manager report at line-item grain
 * (campaign × IO × LI), rolled up server-side so Campaign = ΣIO = ΣLI.
 * The BM flow is async (create → run → poll → CSV); this route polls within a
 * ~40s budget and caches results (queryIdCache + reportCache) — if the report
 * isn't ready in time, the hierarchy is returned with zeroed metrics and the
 * next refetch resumes the same query and completes fast.
 *
 * Body: { clientId, clientSecret, refreshToken, advertiserId, partnerId?,
 *         startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, rawDateToIso, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential, getDemoDV360Campaigns } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey, entityCache, creativeEntityCache } from "@/lib/report-cache";
import type { CampaignData, AdSetData, AdData, AdGroupData, AdGroupAdData, CreativeData, DV360BidStrategy } from "@/types";

export const config = { maxDuration: 60 };

// FILTER_ADVERTISER_CURRENCY is REQUIRED whenever METRIC_REVENUE_ADVERTISER
// (spend) is requested — Bid Manager 400s otherwise.
const LI_DIMENSIONS = ["FILTER_MEDIA_PLAN", "FILTER_INSERTION_ORDER", "FILTER_LINE_ITEM", "FILTER_ADVERTISER_CURRENCY"];

// Reach metrics (METRIC_UNIQUE_REACH_*) require a separate REACH report type and
// cannot combine with standard metrics — deliberately NOT requested here (reach
// stays 0 for DV360 rows; the UI tolerates it).
const CORE_METRICS = [
  "METRIC_IMPRESSIONS",
  "METRIC_CLICKS",
  "METRIC_REVENUE_ADVERTISER",       // media cost in advertiser currency (spend)
  "METRIC_TOTAL_CONVERSIONS",
];
// TrueView views are safe to request (return 0 for non-YouTube line items).
// CM360 post-click revenue is intentionally NOT requested by default — it 400s
// for advertisers without a CM360/Floodlight link (the common case) and would
// force a slow failed-then-retry cycle. The fallback below still protects us if
// TrueView is ever rejected.
const RICH_METRICS = [
  ...CORE_METRICS,
  "METRIC_TRUEVIEW_VIEWS",
];

/** Bid Manager 400s for unsupported metrics/combos — safe to retry with fewer metrics. */
function isMetricComboError(message: string): boolean {
  return /HTTP 400/.test(message) && /not supported|combination of dimensions|invalid/i.test(message);
}

interface LiMetricRow {
  spend: number; impressions: number; clicks: number; conversions: number;
  conversionValue: number; videoViews: number; reach: number;
}

function emptyMetrics(): LiMetricRow {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, videoViews: 0, reach: 0 };
}

const GOAL_TYPE_LABELS: Record<string, string> = {
  PERFORMANCE_GOAL_TYPE_CPA: "Target CPA",
  PERFORMANCE_GOAL_TYPE_ROAS: "Target ROAS",
  PERFORMANCE_GOAL_TYPE_CPM: "Target CPM",
  PERFORMANCE_GOAL_TYPE_CPC: "Target CPC",
  PERFORMANCE_GOAL_TYPE_CTR: "Target CTR",
  PERFORMANCE_GOAL_TYPE_VIEWABILITY: "Target Viewability",
  PERFORMANCE_GOAL_TYPE_CPIAVC: "Target CPIAVC",
  PERFORMANCE_GOAL_TYPE_CLICK_CVR: "Target Click CVR",
  PERFORMANCE_GOAL_TYPE_IMPRESSION_CVR: "Target Impression CVR",
};

function mapBidStrategy(li: import("@/lib/api-clients/dv360").DV360LineItem): DV360BidStrategy | undefined {
  const bs = li.bidStrategy;
  if (!bs) return undefined;
  if (bs.fixedBid) {
    const micros = Number(bs.fixedBid.bidAmountMicros ?? 0);
    return { type: "fixed", label: "Fixed Bid", targetAmount: micros / 1_000_000 };
  }
  if (bs.maximizeSpendAutoBid) {
    const micros = Number(bs.maximizeSpendAutoBid.maxAverageCpmBidAmountMicros ?? 0);
    const goalType = bs.maximizeSpendAutoBid.performanceGoalType;
    return {
      type: "maximize_spend",
      label: "Maximize Spend",
      targetAmount: micros > 0 ? micros / 1_000_000 : undefined,
      goalType,
    };
  }
  if (bs.performanceGoalAutoBid) {
    const goalType = bs.performanceGoalAutoBid.performanceGoalType ?? "";
    const micros = Number(bs.performanceGoalAutoBid.performanceGoalAmountMicros ?? 0);
    return {
      type: "performance_goal",
      label: GOAL_TYPE_LABELS[goalType] ?? "Performance Goal",
      targetAmount: micros > 0 ? micros / 1_000_000 : undefined,
      goalType,
    };
  }
  return undefined;
}

/** BM CSV headers → per-LI metric map keyed by lineItemId. */
function indexReportRows(rows: Array<Record<string, string | number>>): Map<string, LiMetricRow> {
  const byLi = new Map<string, LiMetricRow>();
  for (const row of rows) {
    // BM emits "Line Item ID" / "Line Item" style columns; ids come through as
    // numbers in some locales — normalize to string.
    const liId = String(row["Line Item ID"] ?? row["Line Item Id"] ?? "");
    if (!liId) continue;
    const num = (k: string) => {
      const v = row[k];
      return typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
    };
    const cur = byLi.get(liId) ?? emptyMetrics();
    cur.impressions += num("Impressions");
    cur.clicks += num("Clicks");
    cur.spend += num("Revenue (Adv Currency)");
    cur.conversions += num("Total Conversions");
    cur.videoViews += num("TrueView Views");
    cur.conversionValue += num("CM360 Post-Click Revenue");
    // reach intentionally stays 0 — unique-reach metrics need a REACH-type query
    byLi.set(liId, cur);
  }
  return byLi;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CampaignData[] | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } = req.body || {};

  if (!refreshToken || !advertiserId) {
    res.status(400).json({ error: "Missing refreshToken or advertiserId" });
    return;
  }

  // Demo credentials → deterministic demo hierarchy.
  if (isDemoCredential(refreshToken)) {
    res.status(200).json(getDemoDV360Campaigns() as unknown as CampaignData[]);
    return;
  }
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: "Missing clientId or clientSecret" });
    return;
  }

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // 1. Entity hierarchy + advertiser currency.
    // Cached per-advertiser for 10 min (entityCache) so the 7 parallel API
    // calls are only made once per warm server instance — subsequent requests
    // in the same window skip the ~3-8s entity round-trip entirely.
    const t0 = Date.now();
    const withCap = <T,>(p: Promise<T>, ms: number, fallback: T, label: string): Promise<T> =>
      Promise.race([
        p.catch((e) => { console.warn(`[campaigns/dv360] ${label} failed:`, e instanceof Error ? e.message : e); return fallback; }),
        new Promise<T>((res) => setTimeout(() => { console.warn(`[campaigns/dv360] ${label} timed out (${ms}ms) — using fallback`); res(fallback); }, ms)),
      ]);

    const cachedEntities = entityCache.get(advertiserId);
    const cachedCreativeEntities = creativeEntityCache.get(advertiserId);
    let advertiser: Awaited<ReturnType<typeof client.getAdvertiser>> | null;
    let campaigns: Awaited<ReturnType<typeof client.listCampaigns>>;
    let insertionOrders: Awaited<ReturnType<typeof client.listInsertionOrders>>;
    let lineItems: Awaited<ReturnType<typeof client.listLineItems>>;
    let adGroups: Awaited<ReturnType<typeof client.listAdGroups>>;
    let adGroupAds: Awaited<ReturnType<typeof client.listAdGroupAds>>;
    let creativeEntities: Awaited<ReturnType<typeof client.listCreatives>>;

    // Kick off creative entity fetch early, in parallel — independent of the
    // main entity cache so a timeout on the first call doesn't poison it.
    // 35s cap (up from 20s) since large accounts can have many creatives to page.
    const creativesPromise: Promise<Awaited<ReturnType<typeof client.listCreatives>>> = cachedCreativeEntities
      ? Promise.resolve(cachedCreativeEntities)
      : withCap(client.listCreatives(), 35_000, [], "listCreatives");

    if (cachedEntities) {
      ({ advertiser, campaigns, insertionOrders, lineItems, adGroups, adGroupAds } =
        cachedEntities as typeof cachedEntities & {
          advertiser: typeof advertiser;
          campaigns: typeof campaigns;
          insertionOrders: typeof insertionOrders;
          lineItems: typeof lineItems;
          adGroups: typeof adGroups;
          adGroupAds: typeof adGroupAds;
        });
      console.log(`[campaigns/dv360] entity cache HIT (${advertiserId}) · LIs=${lineItems.length} · creatives=${cachedCreativeEntities ? cachedCreativeEntities.length : "fetching"}`);
    } else {
      [advertiser, campaigns, insertionOrders, lineItems, adGroups, adGroupAds] = await Promise.all([
        withCap(client.getAdvertiser(), 15_000, null as Awaited<ReturnType<typeof client.getAdvertiser>> | null, "getAdvertiser"),
        withCap(client.listCampaigns(), 30_000, [], "listCampaigns"),
        withCap(client.listInsertionOrders(), 30_000, [], "listInsertionOrders"),
        withCap(client.listLineItems(), 30_000, [], "listLineItems"),
        withCap(client.listAdGroups(), 20_000, [], "listAdGroups"),
        withCap(client.listAdGroupAds(), 20_000, [], "listAdGroupAds"),
      ]);
      // Only cache when we got real entity data (don't cache empty fallbacks).
      if (campaigns.length > 0 || lineItems.length > 0) {
        entityCache.set(advertiserId, { advertiser, campaigns, insertionOrders, lineItems, adGroups, adGroupAds });
      }
      console.log(`[campaigns/dv360] entities fetched in ${Date.now() - t0}ms · LIs=${lineItems.length}`);
    }

    // Await creatives — either the cached result (instant) or the parallel fetch.
    creativeEntities = await creativesPromise;
    if (creativeEntities.length > 0 && !cachedCreativeEntities) {
      creativeEntityCache.set(advertiserId, creativeEntities);
      console.log(`[campaigns/dv360] creative entities cached · count=${creativeEntities.length}`);
    } else if (creativeEntities.length === 0 && !cachedCreativeEntities) {
      console.warn(`[campaigns/dv360] listCreatives() returned empty — names will fall back to BM report column`);
    }
    const currency = (advertiser as { generalConfig?: { currencyCode?: string } } | null)?.generalConfig?.currencyCode ?? "USD";
    const creativeNameById = new Map<string, string>();
    const creativeTypeById = new Map<string, string>();
    for (const cr of creativeEntities) {
      creativeNameById.set(String(cr.creativeId), cr.displayName);
      if (cr.creativeType) creativeTypeById.set(String(cr.creativeId), cr.creativeType);
    }

    // 2. LI-grain metrics via Bid Manager (cached; resumes a pending query).
    // Try the rich metric set first; some advertisers reject TrueView/CM360
    // metrics (HTTP 400) — fall back to the core set so campaigns still load.
    // Kick off the per-creative report NOW so it runs concurrently with the
    // LI-metrics report below (no added latency). Returns rows, or null when
    // still pending (queryId cached for the next request to resume).
    // FILTER_CREATIVE adds the creative name column directly to the BM CSV —
    // primary name source, independent of the entity API. Falls back to
    // FILTER_CREATIVE_ID-only if BM rejects the combination (some accounts).
    const CR_DIMS_RICH = ["FILTER_LINE_ITEM", "FILTER_CREATIVE_ID", "FILTER_CREATIVE", "FILTER_ADVERTISER_CURRENCY"];
    const CR_DIMS_CORE = ["FILTER_LINE_ITEM", "FILTER_CREATIVE_ID", "FILTER_ADVERTISER_CURRENCY"];
    const CR_METRICS = ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER"];
    const crKeyRich = (startDate && endDate) ? reportCacheKey({ advertiserId, startDate, endDate, dims: CR_DIMS_RICH, t: "creatives-v2" }) : "";
    const crKeyCore = (startDate && endDate) ? reportCacheKey({ advertiserId, startDate, endDate, dims: CR_DIMS_CORE, t: "creatives" }) : "";
    const crRowsPromise: Promise<Array<Record<string, string | number>> | null> = (async () => {
      if (!startDate || !endDate) return null;
      // Try rich dims (with creative name column) first.
      const cachedRich = reportCache.get(crKeyRich);
      if (cachedRich) return cachedRich;
      // Also accept an already-running rich query.
      const pendRich = queryIdCache.get(crKeyRich);
      if (pendRich) {
        try {
          const r = await client.resumeReport(pendRich.queryId, pendRich.reportId, 8_000);
          if (r.status === "done") { reportCache.set(crKeyRich, r.rows); return r.rows; }
          queryIdCache.set(crKeyRich, { queryId: r.queryId, reportId: r.reportId });
          return null;
        } catch { /* fall through to core */ }
      }
      // Try launching the rich report.
      try {
        const r = await client.runBidManagerReport({ dimensions: CR_DIMS_RICH, metrics: CR_METRICS, startDate, endDate }, 8_000);
        if (r.status === "done") { reportCache.set(crKeyRich, r.rows); return r.rows; }
        queryIdCache.set(crKeyRich, { queryId: r.queryId, reportId: r.reportId });
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isMetricComboError(msg)) {
          console.warn("[Creatives] rich report failed:", msg);
          return null; // non-400 error — don't attempt fallback
        }
        console.warn("[Creatives] rich dims rejected by BM — falling back to core dims");
      }
      // Fallback: core dims without FILTER_CREATIVE (ids only, names from entity API).
      const cachedCore = reportCache.get(crKeyCore);
      if (cachedCore) return cachedCore;
      try {
        const pend = queryIdCache.get(crKeyCore);
        const r = pend
          ? await client.resumeReport(pend.queryId, pend.reportId, 8_000)
          : await client.runBidManagerReport({ dimensions: CR_DIMS_CORE, metrics: CR_METRICS, startDate, endDate }, 8_000);
        if (r.status === "done") { reportCache.set(crKeyCore, r.rows); return r.rows; }
        queryIdCache.set(crKeyCore, { queryId: r.queryId, reportId: r.reportId });
        return null;
      } catch (e) {
        console.warn("[Creatives] core report failed:", e instanceof Error ? e.message : e);
        return null;
      }
    })();

    // All-time per-campaign delivery — a WIDE fixed window (~15 months) that is
    // INDEPENDENT of the dashboard date picker, so recommendations reason over
    // the campaign's full history and stay stable across 7d/30d/90d views. The
    // cache key deliberately omits the dates → one query serves every timeframe.
    const AT_DIMS = ["FILTER_MEDIA_PLAN", "FILTER_ADVERTISER_CURRENCY"];
    const AT_METRICS = ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER", "METRIC_TOTAL_CONVERSIONS"];
    const atEnd = new Date().toISOString().slice(0, 10);
    const atStart = new Date(Date.now() - 456 * 86_400_000).toISOString().slice(0, 10);
    const atKey = reportCacheKey({ advertiserId, dims: AT_DIMS, t: "alltime-campaign" });
    const allTimePromise: Promise<Array<Record<string, string | number>> | null> = (async () => {
      const cached = reportCache.get(atKey);
      if (cached) return cached;
      try {
        const pend = queryIdCache.get(atKey);
        const result = pend
          ? await client.resumeReport(pend.queryId, pend.reportId, 8_000)
          : await client.runBidManagerReport({ dimensions: AT_DIMS, metrics: AT_METRICS, startDate: atStart, endDate: atEnd }, 8_000);
        if (result.status === "done") { reportCache.set(atKey, result.rows); return result.rows; }
        queryIdCache.set(atKey, { queryId: result.queryId, reportId: result.reportId });
        return null;
      } catch (e) {
        console.warn("[AllTime] report failed:", e instanceof Error ? e.message : e);
        return null;
      }
    })();

    // Campaign-level unique reach + average frequency. These metrics live in a
    // separate Bid Manager REACH report (they can't combine with delivery
    // metrics), keyed by campaign (FILTER_MEDIA_PLAN) so reach is de-duplicated
    // per campaign — never summed from line items (that would overcount users).
    // Parallel + cached + non-blocking: returns null while the async report is
    // still generating (queryId cached for the next request to resume).
    const REACH_METRICS = ["METRIC_UNIQUE_REACH_IMPRESSION_REACH", "METRIC_UNIQUE_REACH_AVERAGE_IMPRESSION_FREQUENCY"];
    // Reach is de-duplicated, so it can't be summed across levels — each drill
    // level (campaign / IO / line item / week) needs its OWN keyed REACH report.
    // Each runs in parallel, is cached, and is non-blocking (returns null while
    // still generating; queryId cached to resume on the next request). `pending`
    // is tracked so the UI can show a loading state instead of a misleading 0.
    let reachPending = false;
    const reachReport = (dims: string[], tag: string): Promise<Array<Record<string, string | number>> | null> => (async () => {
      if (!startDate || !endDate) return null;
      const key = reportCacheKey({ advertiserId, startDate, endDate, dims, t: tag });
      const cached = reportCache.get(key);
      if (cached) return cached;
      try {
        const pend = queryIdCache.get(key);
        const result = pend
          ? await client.resumeReport(pend.queryId, pend.reportId, 8_000)
          : await client.runBidManagerReport({ dimensions: dims, metrics: REACH_METRICS, startDate, endDate, reportType: "REACH" }, 8_000);
        if (result.status === "done") { reportCache.set(key, result.rows); return result.rows; }
        queryIdCache.set(key, { queryId: result.queryId, reportId: result.reportId });
        reachPending = true;
        return null;
      } catch (e) {
        console.warn(`[Reach:${tag}] report failed:`, e instanceof Error ? e.message : e);
        return null;
      }
    })();
    const reachRowsPromise = reachReport(["FILTER_MEDIA_PLAN"], "reach");
    const ioReachPromise = reachReport(["FILTER_INSERTION_ORDER"], "reach-io");
    const liReachPromise = reachReport(["FILTER_LINE_ITEM"], "reach-li");

    let liMetrics = new Map<string, LiMetricRow>();
    if (startDate && endDate) {
      const fetchWithMetrics = async (metrics: string[]): Promise<Map<string, LiMetricRow>> => {
        const cacheKey = reportCacheKey({ advertiserId, startDate, endDate, dims: LI_DIMENSIONS, metrics });
        const cached = reportCache.get(cacheKey);
        if (cached) return indexReportRows(cached);

        let result: BMResult;
        const pendingIds = queryIdCache.get(cacheKey);
        if (pendingIds) {
          result = await client.resumeReport(pendingIds.queryId, pendingIds.reportId, 40_000);
        } else {
          result = await client.runBidManagerReport(
            { dimensions: LI_DIMENSIONS, metrics, startDate, endDate },
            40_000
          );
        }
        if (result.status === "done") {
          reportCache.set(cacheKey, result.rows);
          return indexReportRows(result.rows);
        }
        // Report still running — remember ids so the next request resumes it,
        // and return the hierarchy with zeroed metrics rather than blocking.
        queryIdCache.set(cacheKey, { queryId: result.queryId, reportId: result.reportId });
        return new Map<string, LiMetricRow>();
      };

      try {
        liMetrics = await fetchWithMetrics(RICH_METRICS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isMetricComboError(msg)) {
          console.warn("DV360 rich metrics rejected, retrying with core set:", msg.slice(0, 200));
          liMetrics = await fetchWithMetrics(CORE_METRICS);
        } else {
          throw err;
        }
      }
    }

    // 2b0. Resolve the REACH reports (ran in parallel). Each is keyed by a
    // different id column; parse generically into id → {reach, frequency}.
    const parseReach = (rows: Array<Record<string, string | number>> | null, idRe: RegExp): Map<string, { reach: number; frequency: number }> => {
      const map = new Map<string, { reach: number; frequency: number }>();
      if (!rows) return map;
      for (const row of rows) {
        const keys = Object.keys(row);
        const idKey = keys.find((k) => idRe.test(k));
        const reachCol = keys.find((k) => /reach/i.test(k) && !/frequency/i.test(k));
        const freqCol = keys.find((k) => /frequency/i.test(k));
        if (!idKey) continue;
        const id = String(row[idKey]);
        if (!id || id === "0") continue;
        const num = (k?: string) => (k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0);
        map.set(id, { reach: num(reachCol), frequency: num(freqCol) });
      }
      return map;
    };
    const [reachRows, ioReachRows, liReachRows] = await Promise.all([
      reachRowsPromise, ioReachPromise, liReachPromise,
    ]);
    const reachByCampaign = parseReach(reachRows, /campaign id|media plan id/i);
    const reachByIo = parseReach(ioReachRows, /insertion order id/i);
    const reachByLi = parseReach(liReachRows, /line item id/i);

    // 2a2. Resolve the all-time (wide-window) per-campaign report → totals keyed
    // by campaign id, for window-independent recommendations.
    const allTimeByCampaign = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    const allTimeRows = await allTimePromise;
    if (allTimeRows) {
      for (const row of allTimeRows) {
        const keys = Object.keys(row);
        const idKey = keys.find((k) => /(campaign|media.?plan).*id/i.test(k));
        if (!idKey) continue;
        const id = String(row[idKey]);
        if (!id || id === "0") continue;
        const num = (re: RegExp) => {
          const k = keys.find((kk) => re.test(kk));
          return k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0;
        };
        allTimeByCampaign.set(id, {
          impressions: num(/^impressions$/i),
          clicks: num(/^clicks$/i),
          spend: num(/revenue \(adv/i),
          conversions: num(/total conversions/i),
        });
      }
    }

    // 2b. Resolve the per-creative report started above (ran in parallel).
    const creativesByLi = new Map<string, Array<{ id: string; name: string; impressions: number; clicks: number; spend: number }>>();
    const crRows = await crRowsPromise;
    if (crRows) {
      for (const row of crRows) {
        const keys = Object.keys(row);
        const liIdKey = keys.find((k) => /line item id/i.test(k));
        const crIdKey = keys.find((k) => /creative id/i.test(k));
        // BM column for creative name varies: "Creative", "Creative (Inactive)", etc.
        // Try exact match first, then any creative-containing column that isn't the ID.
        const crNameKey =
          keys.find((k) => /^creative$/i.test(k)) ||
          keys.find((k) => /^creative[\s(]/i.test(k) && !/id/i.test(k)) ||
          keys.find((k) => /creative/i.test(k) && !/id/i.test(k) && !/type/i.test(k));
        const imprKey = keys.find((k) => /^impressions$/i.test(k));
        const clickKey = keys.find((k) => /^clicks$/i.test(k));
        const spendKey = keys.find((k) => /revenue \(adv/i.test(k));
        if (!liIdKey || !crIdKey) continue;
        const liId = String(row[liIdKey]); const crId = String(row[crIdKey]);
        if (!crId || crId === "0") continue;
        const num = (k?: string) => (k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0);
        const arr = creativesByLi.get(liId) ?? [];
        arr.push({ id: crId, name: crNameKey && row[crNameKey] ? String(row[crNameKey]) : `Creative ${crId}`, impressions: num(imprKey), clicks: num(clickKey), spend: num(spendKey) });
        creativesByLi.set(liId, arr);
      }
    }

    // 2c. Targeted creative name lookup — for any creative ID from the BM report
    // that the global listCreatives() didn't resolve, fetch just those IDs via
    // the entity API filter. This is O(delivered creatives) not O(all advertiser
    // creatives) — typically 10-50 IDs vs potentially thousands — so it's fast
    // even when the global fetch times out.
    {
      const unresolvedIds = Array.from(
        new Set(
          Array.from(creativesByLi.values())
            .flat()
            .filter((c) => !creativeNameById.has(c.id) && c.name.startsWith("Creative "))
            .map((c) => c.id)
        )
      );
      if (unresolvedIds.length > 0) {
        console.log(`[campaigns/dv360] targeted creative lookup for ${unresolvedIds.length} unresolved IDs`);
        try {
          const fetched = await client.getCreativesByIds(unresolvedIds);
          for (const cr of fetched) {
            creativeNameById.set(String(cr.creativeId), cr.displayName);
            if (cr.creativeType) creativeTypeById.set(String(cr.creativeId), cr.creativeType);
          }
          console.log(`[campaigns/dv360] targeted creative lookup resolved ${fetched.length}/${unresolvedIds.length} names`);
          // Cache the newly fetched names alongside any already in creativeEntityCache.
          if (fetched.length > 0) {
            const existing = creativeEntityCache.get(advertiserId) ?? [];
            const existingIds = new Set(existing.map((c) => String(c.creativeId)));
            const merged = [...existing, ...fetched.filter((c) => !existingIds.has(String(c.creativeId)))];
            creativeEntityCache.set(advertiserId, merged);
          }
        } catch (e) {
          console.warn("[campaigns/dv360] targeted creative lookup failed:", e instanceof Error ? e.message : e);
        }
      }
    }

    // 3. Assemble Campaign → IO → LI → Ad Group → Ad Group Ad with rollups.

    // 3a. Ad Group Ads → keyed by adGroupId
    const agAdsByAg = new Map<string, AdGroupAdData[]>();
    for (const aga of adGroupAds) {
      const entry: AdGroupAdData = {
        id: String(aga.adGroupAdId),
        name: aga.displayName || `Ad ${aga.adGroupAdId}`,
        status: aga.entityStatus,
      };
      const arr = agAdsByAg.get(String(aga.adGroupId)) ?? [];
      arr.push(entry);
      agAdsByAg.set(String(aga.adGroupId), arr);
    }

    // 3b. Ad Groups → keyed by lineItemId
    const agsByLi = new Map<string, AdGroupData[]>();
    for (const ag of adGroups) {
      const entry: AdGroupData = {
        id: String(ag.adGroupId),
        name: ag.displayName,
        status: ag.entityStatus,
        format: ag.adGroupFormat,
        ads: agAdsByAg.get(String(ag.adGroupId)),
      };
      const arr = agsByLi.get(String(ag.lineItemId)) ?? [];
      arr.push(entry);
      agsByLi.set(String(ag.lineItemId), arr);
    }

    // 3c. Line Items → keyed by IO id
    const lisByIo = new Map<string, AdData[]>();
    for (const li of lineItems) {
      const m = liMetrics.get(String(li.lineItemId)) ?? emptyMetrics();
      const liFlightStart = li.flight?.dateRange?.startDate ? rawDateToIso(li.flight.dateRange.startDate) : undefined;
      const liFlightEnd = li.flight?.dateRange?.endDate ? rawDateToIso(li.flight.dateRange.endDate) : undefined;
      const ad: AdData = {
        id: String(li.lineItemId),
        name: li.displayName,
        status: li.entityStatus,
        lineItemType: li.lineItemType,
        spend: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        reach: reachByLi.get(String(li.lineItemId))?.reach ?? m.reach,
        adGroups: agsByLi.get(String(li.lineItemId)),
        creatives: (creativesByLi.get(String(li.lineItemId)) ?? []).map<CreativeData>((c) => ({
          id: c.id, name: creativeNameById.get(c.id) || c.name, type: creativeTypeById.get(c.id),
          impressions: c.impressions, clicks: c.clicks, spend: c.spend,
        })),
        dv360BidStrategy: mapBidStrategy(li),
        updateTime: li.updateTime,
        liFlightStart,
        liFlightEnd,
      };
      const arr = lisByIo.get(String(li.insertionOrderId)) ?? [];
      arr.push(ad);
      lisByIo.set(String(li.insertionOrderId), arr);
    }

    const iosByCampaign = new Map<string, AdSetData[]>();
    const ioTotals = new Map<string, LiMetricRow>();
    for (const io of insertionOrders) {
      const lis = lisByIo.get(String(io.insertionOrderId)) ?? [];
      const total = emptyMetrics();
      for (const li of lis) {
        const m = liMetrics.get(li.id) ?? emptyMetrics();
        total.spend += m.spend; total.impressions += m.impressions; total.clicks += m.clicks;
        total.conversions += m.conversions; total.conversionValue += m.conversionValue;
        total.videoViews += m.videoViews; total.reach += m.reach;
      }
      ioTotals.set(String(io.insertionOrderId), total);
      const adSet: AdSetData = {
        id: String(io.insertionOrderId),
        name: io.displayName,
        status: io.entityStatus,
        spend: total.spend,
        impressions: total.impressions,
        clicks: total.clicks,
        reach: reachByIo.get(String(io.insertionOrderId))?.reach ?? total.reach,
        ads: lis,
      };
      const arr = iosByCampaign.get(String(io.campaignId)) ?? [];
      arr.push(adSet);
      iosByCampaign.set(String(io.campaignId), arr);
    }

    // Campaign budget = sum of its insertion orders' budget segments. DV360
    // sets budgets on IOs (in micros of the advertiser currency), not on the
    // campaign, so we roll them up here. Only currency-unit budgets are money;
    // impression-goal budgets are skipped (can't be shown as an amount).
    const budgetByCampaign = new Map<string, number>();
    for (const io of insertionOrders) {
      const b = io.budget;
      if (!b) continue;
      if (b.budgetUnit && b.budgetUnit !== "BUDGET_UNIT_CURRENCY") continue;
      let ioBudget = 0;
      for (const seg of b.budgetSegments ?? []) {
        ioBudget += Number(seg.budgetAmountMicros ?? 0) / 1_000_000;
      }
      if (ioBudget > 0) {
        budgetByCampaign.set(String(io.campaignId), (budgetByCampaign.get(String(io.campaignId)) ?? 0) + ioBudget);
      }
    }

    const out: CampaignData[] = campaigns.map((c) => {
      const ios = iosByCampaign.get(String(c.campaignId)) ?? [];
      const total = emptyMetrics();
      for (const io of ios) {
        const t = ioTotals.get(io.id) ?? emptyMetrics();
        total.spend += t.spend; total.impressions += t.impressions; total.clicks += t.clicks;
        total.conversions += t.conversions; total.conversionValue += t.conversionValue;
        total.videoViews += t.videoViews; total.reach += t.reach;
      }
      // De-duplicated reach + frequency from the campaign-level REACH report
      // (null while it's still generating → 0/undefined, fills on the next load).
      const cr = reachByCampaign.get(String(c.campaignId));
      return {
        id: String(c.campaignId),
        name: c.displayName,
        objective: friendlyGoal(c.campaignGoal?.campaignGoalType),
        status: c.entityStatus,
        platform: "dv360",
        updatedTime: c.updateTime,
        flightStart: rawDateToIso(c.campaignFlight?.plannedDates?.startDate),
        flightEnd: rawDateToIso(c.campaignFlight?.plannedDates?.endDate),
        spend: total.spend,
        impressions: total.impressions,
        clicks: total.clicks,
        reach: cr?.reach ?? total.reach,
        frequency: cr?.frequency,
        reachPending,
        // Total planned budget across the campaign's insertion orders (flight
        // total). Mapped to lifetimeBudget so the "Budget (setting)" column
        // shows it; undefined when no currency budget is set on any IO.
        lifetimeBudget: (budgetByCampaign.get(String(c.campaignId)) ?? 0) > 0
          ? budgetByCampaign.get(String(c.campaignId))
          : undefined,
        // All-time delivery (wide fixed window, date-range independent) — powers
        // window-stable recommendations. Undefined while the report is pending.
        allTimeSpend: allTimeByCampaign.get(String(c.campaignId))?.spend,
        allTimeImpressions: allTimeByCampaign.get(String(c.campaignId))?.impressions,
        allTimeClicks: allTimeByCampaign.get(String(c.campaignId))?.clicks,
        allTimeConversions: allTimeByCampaign.get(String(c.campaignId))?.conversions,
        conversions: total.conversions,
        conversionValue: total.conversionValue,
        videoViews: total.videoViews,
        currency,
        adSets: ios,
      };
    });

    res.status(200).json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 campaigns fetch failed:", message);
    res.status(502).json({ error: message });
  }
}

function friendlyGoal(goal?: string): string | undefined {
  if (!goal) return undefined;
  const map: Record<string, string> = {
    CAMPAIGN_GOAL_TYPE_BRAND_AWARENESS: "Brand awareness",
    CAMPAIGN_GOAL_TYPE_ONLINE_ACTION: "Conversions",
    CAMPAIGN_GOAL_TYPE_OFFLINE_ACTION: "Offline action",
    CAMPAIGN_GOAL_TYPE_APP_INSTALL: "App installs",
  };
  return map[goal] ?? goal.replace("CAMPAIGN_GOAL_TYPE_", "").replace(/_/g, " ").toLowerCase();
}
