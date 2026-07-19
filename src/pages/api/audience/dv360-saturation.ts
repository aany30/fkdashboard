/**
 * POST /api/audience/dv360-saturation
 *
 * Per-line-item performance for DV360 Saturation & Expansion analysis — 100%
 * real Bid Manager data, no proxies:
 *
 *  - Standard report (FILTER_LINE_ITEM): spend, impressions, clicks,
 *    conversions, and — when CM360 revenue is linked — conversion revenue.
 *    Derives CTR, CPM, CPA, ROAS, spend share.
 *  - REACH report (separate query type): unique reach + average impression
 *    frequency per line item. Reach metrics can't combine with the standard
 *    set, so they run as their own query. If the advertiser doesn't support
 *    reach reports the call is skipped and `reachAvailable:false` is returned
 *    (the UI then shows an honest note instead of a proxy).
 *
 * Flags returned: reachAvailable, revenueAvailable — the UI uses these to show
 * only metrics that are genuinely present.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";

export const config = { maxDuration: 60 };

export interface DV360SaturationRow {
  lineItem: string;
  lineItemId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;      // %
  cpm: number;
  cpa: number;      // 0 when no conversions
  roas: number;     // 0 when no revenue
  reach: number;    // 0 when reach unavailable
  frequency: number;// 0 when reach unavailable
  spendPct: number; // share of total spend, %
}

interface Body {
  clientId?: string; clientSecret?: string; refreshToken?: string;
  advertiserId?: string; partnerId?: string;
  startDate?: string; endDate?: string;
}

function num(row: Record<string, string | number>, keyTest: RegExp): number {
  const key = Object.keys(row).find((k) => keyTest.test(k));
  if (!key) return NaN; // NaN signals "column absent"
  const v = row[key];
  return typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
}

function demoRows(): DV360SaturationRow[] {
  const base = [
    { lineItem: "158486_HonerHomes_MF35to54_HYD_120326_MRPR", spend: 47000, impressions: 2100000, clicks: 3700, conversions: 96, revenue: 156190, reach: 920000, frequency: 2.3 },
    { lineItem: "158487_HonerHomes_HYD_CTV_120326_MRPR", spend: 30073, impressions: 1450000, clicks: 2050, conversions: 148, revenue: 55920, reach: 720000, frequency: 2.0 },
    { lineItem: "AM03-CBO-ADV+-Jul26", spend: 59498, impressions: 3600000, clicks: 5900, conversions: 66, revenue: 26794, reach: 2100000, frequency: 1.7 },
    { lineItem: "GW_All_Product_Sales_7_May26", spend: 98900, impressions: 5200000, clicks: 7400, conversions: 90, revenue: 47952, reach: 3050000, frequency: 1.7 },
  ];
  const total = base.reduce((s, r) => s + r.spend, 0);
  return base.map((r, i) => ({
    ...r,
    lineItemId: `demo-li-${i + 1}`,
    ctr: r.impressions > 0 ? +(r.clicks / r.impressions * 100).toFixed(2) : 0,
    cpm: r.impressions > 0 ? +(r.spend / r.impressions * 1000).toFixed(2) : 0,
    cpa: r.conversions > 0 ? +(r.spend / r.conversions).toFixed(0) : 0,
    roas: r.spend > 0 ? +(r.revenue / r.spend).toFixed(2) : 0,
    spendPct: total > 0 ? +(r.spend / total * 100).toFixed(1) : 0,
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } = (req.body || {}) as Body;
  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", rows: demoRows(), reachAvailable: true, revenueAvailable: true });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  const now = new Date();
  const end = endDate || now.toISOString().slice(0, 10);
  const start = startDate || new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    const LI_DIMS = ["FILTER_LINE_ITEM", "FILTER_ADVERTISER_CURRENCY"];
    const CORE = ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER", "METRIC_TOTAL_CONVERSIONS"];
    const WITH_REV = [...CORE, "METRIC_CM360_POST_CLICK_REVENUE"];
    const PENDING = Symbol("pending");

    // ── Standard per-line-item report (with revenue fallback) ────────────────
    const runStd = async (metrics: string[]): Promise<Array<Record<string, string | number>> | typeof PENDING> => {
      const cacheKey = reportCacheKey({ advertiserId, startDate: start, endDate: end, dims: LI_DIMS, metrics });
      const cached = reportCache.get(cacheKey);
      if (cached) return cached;
      let result: BMResult;
      const pending = queryIdCache.get(cacheKey);
      if (pending) result = await client.resumeReport(pending.queryId, pending.reportId, 40_000);
      else result = await client.runBidManagerReport({ dimensions: LI_DIMS, metrics, startDate: start, endDate: end }, 40_000);
      if (result.status === "pending") { queryIdCache.set(cacheKey, { queryId: result.queryId, reportId: result.reportId }); return PENDING; }
      reportCache.set(cacheKey, result.rows);
      return result.rows;
    };

    let revenueAvailable = true;
    let stdRows: Array<Record<string, string | number>> | typeof PENDING;
    try {
      stdRows = await runStd(WITH_REV);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/HTTP 400|not supported|combination|invalid/i.test(msg)) {
        revenueAvailable = false;
        stdRows = await runStd(CORE);
      } else throw e;
    }
    if (stdRows === PENDING) return res.status(202).json({ status: "pending" });

    // ── REACH report (frequency + unique reach) — optional ───────────────────
    const REACH_DIMS = ["FILTER_LINE_ITEM"];
    const REACH_METRICS = ["METRIC_UNIQUE_REACH_IMPRESSION_REACH", "METRIC_UNIQUE_REACH_AVERAGE_IMPRESSION_FREQUENCY"];
    const reachByLi = new Map<string, { reach: number; frequency: number }>();
    let reachAvailable = false;
    try {
      const reachKey = reportCacheKey({ advertiserId, startDate: start, endDate: end, dims: REACH_DIMS, metrics: REACH_METRICS, t: "REACH" });
      const cachedReach = reportCache.get(reachKey);
      let reachResult: BMResult;
      if (cachedReach) {
        reachResult = { status: "done", rows: cachedReach };
      } else {
        const pending = queryIdCache.get(reachKey);
        if (pending) reachResult = await client.resumeReport(pending.queryId, pending.reportId, 30_000);
        else reachResult = await client.runBidManagerReport({ dimensions: REACH_DIMS, metrics: REACH_METRICS, startDate: start, endDate: end, reportType: "REACH" }, 30_000);
        if (reachResult.status === "pending") queryIdCache.set(reachKey, { queryId: reachResult.queryId, reportId: reachResult.reportId });
        else reportCache.set(reachKey, reachResult.rows);
      }
      if (reachResult.status === "done") {
        for (const row of reachResult.rows) {
          const idKey = Object.keys(row).find((k) => /line item id/i.test(k));
          const nameKey = Object.keys(row).find((k) => /line item/i.test(k) && !/id/i.test(k));
          const id = idKey ? String(row[idKey]) : (nameKey ? String(row[nameKey]) : "");
          if (!id) continue;
          const reach = num(row, /reach/i);
          const frequency = num(row, /frequency/i);
          reachByLi.set(id, { reach: Number.isFinite(reach) ? reach : 0, frequency: Number.isFinite(frequency) ? frequency : 0 });
        }
        reachAvailable = reachByLi.size > 0;
      }
    } catch (e) {
      console.warn("[DV360 Saturation] REACH report unavailable:", e instanceof Error ? e.message : e);
      reachAvailable = false;
    }

    // ── Merge + derive ───────────────────────────────────────────────────────
    const rows: DV360SaturationRow[] = stdRows.map((row) => {
      const idKey = Object.keys(row).find((k) => /line item id/i.test(k));
      const nameKey = Object.keys(row).find((k) => /line item/i.test(k) && !/id/i.test(k));
      const lineItemId = idKey ? String(row[idKey]) : "";
      const lineItem = nameKey ? String(row[nameKey]) : (lineItemId || "Unknown");
      const impressions = Math.max(0, num(row, /^impressions$/i));
      const clicks = Math.max(0, num(row, /^clicks$/i));
      const spend = Math.max(0, num(row, /revenue \(adv/i));
      const conversions = Math.max(0, num(row, /total conversions/i));
      const revRaw = num(row, /post.?click revenue/i);
      const revenue = Number.isFinite(revRaw) ? Math.max(0, revRaw) : 0;
      const reachRec = reachByLi.get(lineItemId) || reachByLi.get(lineItem);
      return {
        lineItem, lineItemId,
        spend, impressions, clicks, conversions, revenue,
        ctr: impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0,
        cpm: impressions > 0 ? +(spend / impressions * 1000).toFixed(2) : 0,
        cpa: conversions > 0 ? +(spend / conversions).toFixed(0) : 0,
        roas: spend > 0 && revenue > 0 ? +(revenue / spend).toFixed(2) : 0,
        reach: reachRec?.reach ?? 0,
        frequency: reachRec?.frequency ?? 0,
        spendPct: 0, // filled below
      };
    }).filter((r) => r.impressions > 0 || r.spend > 0);

    // Resolve line-item IDs → display names when BM only returned numeric IDs.
    if (rows.some((r) => /^\d+$/.test(r.lineItem))) {
      try {
        const lineItems = await client.listLineItems();
        const nameById = new Map(lineItems.map((li) => [String(li.lineItemId), li.displayName]));
        for (const r of rows) {
          const resolved = (r.lineItemId ? nameById.get(r.lineItemId) : undefined) || nameById.get(r.lineItem);
          if (resolved) r.lineItem = resolved;
        }
      } catch (e) {
        console.warn("[DV360 Saturation] line-item name resolution failed:", e instanceof Error ? e.message : e);
      }
    }

    const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
    for (const r of rows) r.spendPct = totalSpend > 0 ? +(r.spend / totalSpend * 100).toFixed(1) : 0;

    // revenueAvailable is only true if the column existed AND some revenue landed
    if (revenueAvailable && rows.every((r) => r.revenue === 0)) revenueAvailable = false;

    return res.status(200).json({ source: "live", rows, reachAvailable, revenueAvailable });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 saturation failed:", message);
    return res.status(502).json({ error: message.replace(/<[^>]*>/g, "").slice(0, 200) });
  }
}
