/**
 * POST /api/reporting/dv360-reach
 *
 * Dedicated DV360 unique-reach fetch using FILTER_LINE_ITEM alone —
 * the same dimension the Saturation tab uses, which reliably returns data.
 *
 * Returns per-line-item reach + frequency. The CLIENT maps LI → campaign
 * using the campaign hierarchy (adSets → ads) and sums per campaign.
 *
 * The caller can pass `flightStart` / `flightEnd` (earliest/latest campaign
 * flight dates) so the 92-day REACH window covers the actual delivery period
 * instead of always using "last 92 days from today" (which misses ended flights).
 *
 * Body: { clientId, clientSecret, refreshToken, advertiserId, partnerId?,
 *         startDate?, endDate?, flightStart?, flightEnd? }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";

export const config = { maxDuration: 60 };

interface Body {
  clientId?: string; clientSecret?: string; refreshToken?: string;
  advertiserId?: string; partnerId?: string;
  startDate?: string; endDate?: string;
  flightStart?: string; flightEnd?: string;
}

export interface DV360ReachResponse {
  source?: "demo";
  reachByLineItem: Record<string, { reach: number; frequency: number; campaignId?: string; name: string }>;
  available: boolean;
  pending: boolean;
}

const REACH_METRICS = ["METRIC_UNIQUE_REACH_IMPRESSION_REACH", "METRIC_UNIQUE_REACH_AVERAGE_IMPRESSION_FREQUENCY"];
const DAY_MS = 86_400_000;
const MAX_REACH_DAYS = 92;

const numOf = (row: Record<string, string | number>, k?: string): number =>
  k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0;

/** Pick the best 92-day window that covers the campaigns' actual delivery. */
function pickWindow(startDate?: string, endDate?: string, flightStart?: string, flightEnd?: string): { start: string; end: string } {
  const today = new Date().toISOString().slice(0, 10);

  // Prefer flight dates (covers ended campaigns), fall back to request dates.
  const wantEnd = flightEnd || endDate || today;
  const wantStart = flightStart || startDate || new Date(Date.now() - MAX_REACH_DAYS * DAY_MS).toISOString().slice(0, 10);

  let end = wantEnd > today ? today : wantEnd;
  let start = wantStart;

  const span = new Date(end).getTime() - new Date(start).getTime();
  if (span > MAX_REACH_DAYS * DAY_MS) {
    // Window too wide — anchor end at flight end (capped to today) and go back 92d.
    start = new Date(new Date(end).getTime() - MAX_REACH_DAYS * DAY_MS).toISOString().slice(0, 10);
  }
  return { start, end };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<DV360ReachResponse | { error: string }>) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId,
          startDate, endDate, flightStart, flightEnd } = (req.body || {}) as Body;
  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({
      source: "demo",
      reachByLineItem: {
        "demo-li-1": { reach: 920000, frequency: 2.3, campaignId: "demo-campaign-1", name: "Demo LI — Display 35-54" },
        "demo-li-2": { reach: 720000, frequency: 2.0, campaignId: "demo-campaign-1", name: "Demo LI — CTV" },
        "demo-li-3": { reach: 2100000, frequency: 1.7, campaignId: "demo-campaign-2", name: "Demo LI — Programmatic" },
        "demo-li-4": { reach: 1470600, frequency: 3.2, campaignId: "demo-campaign-3", name: "Demo LI — Retargeting" },
      },
      available: true, pending: false,
    });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  const { start, end } = pickWindow(startDate, endDate, flightStart, flightEnd);
  const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

  // Use FILTER_LINE_ITEM only — the proven approach (same as Saturation tab).
  const DIMS = ["FILTER_LINE_ITEM"];
  const key = reportCacheKey({ advertiserId, startDate: start, endDate: end, dims: DIMS, metrics: REACH_METRICS, t: "reach-li" });
  const cached = reportCache.get(key);

  let rows: Array<Record<string, string | number>> | null = null;
  let pending = false;
  let errored = false;

  if (cached) {
    rows = cached;
  } else {
    try {
      const pend = queryIdCache.get(key);
      const result = pend
        ? await client.resumeReport(pend.queryId, pend.reportId, 45_000)
        : await client.runBidManagerReport({ dimensions: DIMS, metrics: REACH_METRICS, startDate: start, endDate: end, reportType: "REACH" }, 45_000);
      if (result.status === "done") { reportCache.set(key, result.rows); rows = result.rows; }
      else { queryIdCache.set(key, { queryId: result.queryId, reportId: result.reportId }); pending = true; }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[dv360-reach] failed:", msg);
      if (/abort/i.test(msg) || /timeout/i.test(msg) || /ECONNRESET/i.test(msg)) {
        pending = true;
      } else {
        errored = true;
      }
    }
  }

  const reachByLineItem: Record<string, { reach: number; frequency: number; name: string }> = {};

  if (rows) {
    for (const row of rows) {
      const keys = Object.keys(row);
      const liIdKey = keys.find((k) => /line item id/i.test(k));
      const liNameKey = keys.find((k) => /line item/i.test(k) && !/id/i.test(k));
      const reachCol = keys.find((k) => /reach/i.test(k) && !/frequency/i.test(k));
      const freqCol = keys.find((k) => /frequency/i.test(k));

      const liId = liIdKey ? String(row[liIdKey]) : "";
      if (!liId || liId === "0") continue;

      const reach = numOf(row, reachCol);
      const frequency = numOf(row, freqCol);
      if (reach <= 0) continue;

      const name = liNameKey ? String(row[liNameKey]) : liId;
      reachByLineItem[liId] = { reach, frequency, name };
    }
  }

  console.log(`[dv360-reach] rows=${rows?.length ?? (pending ? "pending" : "err")} parsedLIs=${Object.keys(reachByLineItem).length} window=${start}..${end} | pending=${pending}`);

  return res.status(200).json({ reachByLineItem, available: !errored, pending });
}
