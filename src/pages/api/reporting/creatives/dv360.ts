/**
 * POST /api/reporting/creatives/dv360
 *
 * Real per-creative delivery for DV360, via a Bid Manager report grouped by
 * FILTER_CREATIVE_ID (+ currency) with impressions/clicks/spend. Creative names
 * and formats come from the DV360 entity API (advertisers.creatives).
 *
 * The BM report is async (Google generates it server-side, up to ~1 min), so
 * this returns 202 { status: "pending" } while it's still running — the client
 * polls and the query resumes from cache. Decoupled from the heavy campaigns
 * route so the Creative Analysis tab only waits on THIS report.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential, getDemoDV360Campaigns } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";

export const config = { maxDuration: 60 };

export interface DV360CreativeRow {
  id: string; name: string; type: string; size?: string;
  impressions: number; clicks: number; spend: number;
}

function demoCreatives(): DV360CreativeRow[] {
  const byId = new Map<string, DV360CreativeRow>();
  for (const c of getDemoDV360Campaigns() as Array<{ adSets?: Array<{ ads?: Array<{ lineItemType?: string; creatives?: Array<{ id: string; name: string; impressions?: number; clicks?: number; spend?: number }> }> }> }>) {
    for (const io of c.adSets || []) for (const li of io.ads || []) for (const cr of li.creatives || []) {
      const ex = byId.get(cr.id);
      if (ex) { ex.impressions += cr.impressions || 0; ex.clicks += cr.clicks || 0; ex.spend += cr.spend || 0; }
      else byId.set(cr.id, { id: cr.id, name: cr.name, type: (li.lineItemType || "").includes("VIDEO") ? "Video" : "Display", impressions: cr.impressions || 0, clicks: cr.clicks || 0, spend: cr.spend || 0 });
    }
  }
  return [...byId.values()].sort((a, b) => b.impressions - a.impressions);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } = req.body || {};
  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", creatives: demoCreatives() });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  const now = new Date();
  const end = (endDate as string) || now.toISOString().slice(0, 10);
  const start = (startDate as string) || new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });
    // FILTER_CREATIVE_TYPE / FILTER_CREATIVE_SIZE give the type + size directly in
    // the BM report, so format detection no longer depends on the entity API
    // (listCreatives), which times out on large advertisers.
    const DIMS = ["FILTER_CREATIVE_ID", "FILTER_CREATIVE", "FILTER_CREATIVE_TYPE", "FILTER_CREATIVE_SIZE", "FILTER_ADVERTISER_CURRENCY"];
    const METRICS = ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_REVENUE_ADVERTISER"];
    const key = reportCacheKey({ advertiserId, startDate: start, endDate: end, dims: DIMS, t: "creative-report-v3" });

    let rows: Array<Record<string, string | number>> | null;
    const cached = reportCache.get(key);
    if (cached) {
      rows = cached;
    } else {
      const pend = queryIdCache.get(key);
      let result: BMResult;
      // Short poll budget: return 202 fast and let the client resume. The report
      // often takes minutes to generate on Google's side, so a long-held request
      // just risks a serverless/proxy timeout — the client polls instead.
      if (pend) result = await client.resumeReport(pend.queryId, pend.reportId, 15_000);
      else result = await client.runBidManagerReport({ dimensions: DIMS, metrics: METRICS, startDate: start, endDate: end }, 15_000);
      if (result.status === "pending") {
        queryIdCache.set(key, { queryId: result.queryId, reportId: result.reportId });
        return res.status(202).json({ status: "pending" });
      }
      reportCache.set(key, result.rows);
      rows = result.rows;
    }

    // Aggregate by creative id.
    const byId = new Map<string, DV360CreativeRow>();
    for (const row of rows) {
      const keys = Object.keys(row);
      const idKey = keys.find((k) => /creative id/i.test(k));
      const nameKey = keys.find((k) => /^creative$/i.test(k)) || keys.find((k) => /creative$/i.test(k) && !/id|type|size|status|source/i.test(k));
      const typeKey = keys.find((k) => /creative type/i.test(k));
      const sizeKey = keys.find((k) => /creative size/i.test(k));
      const imprKey = keys.find((k) => /^impressions$/i.test(k));
      const clickKey = keys.find((k) => /^clicks$/i.test(k));
      const spendKey = keys.find((k) => /revenue \(adv/i.test(k));
      if (!idKey) continue;
      const id = String(row[idKey]);
      if (!id || id === "0") continue;
      const num = (k?: string) => (k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0);
      const bmType = typeKey ? String(row[typeKey] ?? "").trim() : "";
      const bmSize = sizeKey ? String(row[sizeKey] ?? "").trim() : "";
      const ex = byId.get(id);
      if (ex) {
        ex.impressions += num(imprKey); ex.clicks += num(clickKey); ex.spend += num(spendKey);
        if (!ex.type && bmType) ex.type = bmType;
        if (!ex.size && bmSize) ex.size = bmSize;
      } else {
        byId.set(id, {
          id, name: nameKey && row[nameKey] ? String(row[nameKey]) : `Creative ${id}`,
          type: bmType, size: bmSize || undefined,
          impressions: num(imprKey), clicks: num(clickKey), spend: num(spendKey),
        });
      }
    }

    // Enrich names (and type, only where BM didn't provide one) from the entity
    // API — best-effort; type now comes primarily from the BM report above.
    try {
      const entities = await client.listCreatives();
      for (const e of entities) {
        const c = byId.get(String(e.creativeId));
        if (c) { if (e.displayName) c.name = e.displayName; if (!c.type && e.creativeType) c.type = e.creativeType; }
      }
    } catch { /* names/types are best-effort — BM report already supplied them */ }

    const creatives = [...byId.values()].sort((a, b) => b.impressions - a.impressions);
    return res.status(200).json({ source: "live", creatives });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 creatives report failed:", message);
    return res.status(502).json({ error: message.replace(/<[^>]*>/g, "").slice(0, 200) });
  }
}
