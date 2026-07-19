/**
 * POST /api/audit/dv360-frequency-burden
 *
 * Cross-campaign frequency burden + monthly exposure intensity for DV360.
 *
 * Reach is de-duplicated only within the scope of a single Bid Manager REACH
 * query — summing per-campaign reach numbers overcounts users who were shown
 * ads by more than one campaign. To get a genuine cross-campaign unique reach
 * + average frequency, this route runs a REACH report scoped to the WHOLE
 * advertiser (no campaign/IO/line-item dimension), so Google's own dedup
 * logic operates across every campaign at once.
 *
 * "Monthly exposure intensity" is the same idea sliced by calendar month:
 * one REACH query per month (its own start/end date IS the dedup scope, no
 * FILTER_MONTH dimension needed), so each month's reach/frequency is an
 * independent, correctly-deduplicated figure — not a slice of a summed total.
 *
 * Each query is async or cached individually — this route degrades to
 * `null` sections (with a note) instead of ever fabricating a number.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential, getDemoDV360FrequencyBurden } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";

export const config = { maxDuration: 60 };

const REACH_METRICS = ["METRIC_UNIQUE_REACH_IMPRESSION_REACH", "METRIC_UNIQUE_REACH_AVERAGE_IMPRESSION_FREQUENCY"];
const MAX_MONTH_BUCKETS = 12;

interface MonthBucket { start: string; end: string; label: string; partial: boolean }

function monthBuckets(start: string, end: string): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const rangeStart = new Date(`${start}T00:00:00Z`);
  const rangeEnd = new Date(`${end}T00:00:00Z`);
  let cur = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
  while (cur <= rangeEnd && buckets.length < MAX_MONTH_BUCKETS) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
    // Clip the bucket to the selected range — the first/last month may only be
    // partly covered.
    const bStart = monthStart > rangeStart ? monthStart : rangeStart;
    const bEnd = monthEnd < rangeEnd ? monthEnd : rangeEnd;
    const partial = bStart.getTime() !== monthStart.getTime() || bEnd.getTime() !== monthEnd.getTime();
    const monthName = monthStart.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const year = monthStart.getUTCFullYear();
    // A partial month gets an honest day-range label (e.g. "Jun 16–30") so a
    // clipped bucket is never shown as if it were a full calendar month.
    const label = partial
      ? `${monthName} ${bStart.getUTCDate()}–${bEnd.getUTCDate()}`
      : `${monthName} ${year}`;
    buckets.push({
      start: bStart.toISOString().slice(0, 10),
      end: bEnd.toISOString().slice(0, 10),
      label,
      partial,
    });
    cur = new Date(Date.UTC(y, m + 1, 1));
  }
  return buckets;
}

function parseReachTotals(rows: Array<Record<string, string | number>> | null): { reach: number; frequency: number } | null {
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const keys = Object.keys(row);
  const reachKey = keys.find((k) => /reach/i.test(k) && !/frequency/i.test(k));
  const freqKey = keys.find((k) => /frequency/i.test(k));
  const num = (k?: string) => (k ? (typeof row[k] === "number" ? (row[k] as number) : Number(String(row[k]).replace(/,/g, "")) || 0) : 0);
  const reach = num(reachKey);
  if (reach <= 0) return null;
  return { reach, frequency: num(freqKey) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } = req.body || {};
  if (!refreshToken || !advertiserId || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing refreshToken, advertiserId, startDate, or endDate" });
  }

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json(getDemoDV360FrequencyBurden(startDate, endDate));
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // A REACH query with no groupBy dimension returns a single aggregate row —
    // Google dedups across every campaign/IO/line item in the advertiser.
    const runAggregateReach = async (
      qStart: string,
      qEnd: string,
      tag: string
    ): Promise<{ totals: { reach: number; frequency: number } | null; pending: boolean }> => {
      const key = reportCacheKey({ advertiserId, startDate: qStart, endDate: qEnd, t: `freq-burden-${tag}` });
      const cached = reportCache.get(key);
      if (cached) return { totals: parseReachTotals(cached), pending: false };
      try {
        const pend = queryIdCache.get(key);
        const result: BMResult = pend
          ? await client.resumeReport(pend.queryId, pend.reportId, 8_000)
          : await client.runBidManagerReport({ dimensions: [], metrics: REACH_METRICS, startDate: qStart, endDate: qEnd, reportType: "REACH" }, 8_000);
        if (result.status === "done") {
          reportCache.set(key, result.rows);
          return { totals: parseReachTotals(result.rows), pending: false };
        }
        queryIdCache.set(key, { queryId: result.queryId, reportId: result.reportId });
        return { totals: null, pending: true };
      } catch (e) {
        console.warn(`[FreqBurden:${tag}] reach query failed:`, e instanceof Error ? e.message : e);
        return { totals: null, pending: false };
      }
    };

    const buckets = monthBuckets(startDate, endDate);

    const [crossCampaignResult, ...monthlyResults] = await Promise.all([
      runAggregateReach(startDate, endDate, "cross-campaign"),
      ...buckets.map((b) => runAggregateReach(b.start, b.end, `month-${b.start}`)),
    ]);

    const monthly = buckets
      .map((b, i) => ({ month: b.label, partial: b.partial, reach: monthlyResults[i].totals?.reach ?? null, frequency: monthlyResults[i].totals?.frequency ?? null }))
      .filter((m) => m.reach !== null);
    const monthlyPending = monthlyResults.some((r) => r.pending);

    const notes: string[] = [];
    if (!crossCampaignResult.totals && !crossCampaignResult.pending) {
      notes.push("Cross-campaign reach could not be computed for this advertiser (no REACH data returned).");
    }
    if (monthly.length === 0 && !monthlyPending) {
      notes.push("Monthly exposure intensity could not be computed for this date range.");
    }

    return res.status(200).json({
      source: "live",
      crossCampaign: crossCampaignResult.totals,
      crossCampaignPending: crossCampaignResult.pending,
      monthly,
      monthlyPending,
      notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 frequency burden audit failed:", message);
    return res.status(502).json({ error: message });
  }
}
