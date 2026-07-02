/**
 * POST /api/audience/frequency/meta
 *
 * Account-level reach + average frequency + impressions over the trailing
 * 365 days. Feeds the annual frequency-distribution chart in Audience Overlap.
 *
 * NOTE: Meta's auction Insights API does NOT expose a per-user frequency
 * histogram — only the average. The distribution itself is modeled client-side
 * from these real reach/frequency numbers (see useAnnualFrequency / the chart).
 *
 * Body: { accessToken, businessId }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

export interface MonthlyReachFrequency {
  month: string; // YYYY-MM
  reach: number;
  frequency: number;
  impressions: number;
}

export interface AnnualFrequencyResponse {
  source: "demo" | "live";
  reach: number;
  frequency: number;
  impressions: number;
  monthly: MonthlyReachFrequency[];
  currency: string;
}

// Demo: trailing 12 months ending at the current month, with seasonal spikes in
// frequency (heavier exposure in a few months) so the chart is illustrative.
function demoMonthly(): MonthlyReachFrequency[] {
  const now = new Date();
  // Trailing 12 months ending at the current month. Higher frequency in a few
  // months (the "Apr/May/Aug ran hot" pattern from the user's example) and
  // monthly reach values calibrated so that Σ monthly reach ≈ 2.8× annual
  // reach — i.e. avg user appears in ~2.8 distinct months (realistic for DTC).
  const freqByOffset = [4.2, 4.8, 9.1, 8.4, 5.6, 4.4, 4.0, 9.6, 5.1, 6.2, 5.8, 7.2]; // 11mo ago → now
  const reachByOffset = [310_000, 340_000, 420_000, 410_000, 280_000, 270_000, 260_000, 430_000, 285_000, 305_000, 295_000, 360_000];
  const out: MonthlyReachFrequency[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const f = freqByOffset[11 - i];
    const reach = reachByOffset[11 - i];
    out.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      reach,
      frequency: f,
      impressions: Math.round(reach * f),
    });
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, businessId } = req.body || {};
  if (!accessToken || !businessId) {
    res.status(400).json({ error: "Missing accessToken or businessId" });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({
      source: "demo",
      reach: 1_240_000,
      frequency: 7.5,
      impressions: 9_300_000,
      monthly: demoMonthly(),
      currency: "INR",
    });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    const [annual, monthly, currency] = await Promise.all([
      client.getAccountAnnualReachFrequency(accountPath),
      client.getAccountMonthlyReachFrequency(accountPath).catch(() => []),
      client.getAccountCurrency(accountPath),
    ]);
    res.status(200).json({
      source: "live",
      reach: annual.reach,
      frequency: annual.frequency,
      impressions: annual.impressions,
      monthly,
      currency: currency || "USD",
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Annual frequency fetch failed" });
  }
}
