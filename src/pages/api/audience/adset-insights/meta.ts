/**
 * POST /api/audience/adset-insights/meta
 *
 * Returns ad-set level insights from Meta Insights API at level=adset.
 * Provides name, spend, impressions, clicks, reach, frequency, conversions,
 * conversionValue — the full dataset needed by the Audience Analysis tabs.
 *
 * Body: { accessToken, businessId, startDate?, endDate? }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";
import type { AdSetTargeting, CustomAudienceDetail } from "@/lib/audience-classifier";

export interface AdSetRow {
  id: string;
  name: string;
  campaignName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversionValue: number;
  uniqueClicks?: number;
  /** Real Meta targeting spec — used by the audience classifier. Undefined when
   *  Meta hid it (Advantage+ Shopping) or the fetch failed; classifier falls
   *  back to name parsing in that case. */
  targeting?: AdSetTargeting;
  promotedObject?: { product_set_id?: string; custom_event_type?: string };
  campaignObjective?: string;
}

export interface AdSetInsightsResponse {
  source: "demo" | "live";
  adsets: AdSetRow[];
  audiences: CustomAudienceDetail[];
  currency: string;
  /** Account-level deduplicated reach + true cross-campaign frequency for the
   *  selected period. Real Meta fields (level=account). Used by the
   *  cross-campaign frequency-burden card. */
  accountReach: number;
  accountFrequency: number;
}

const DEMO_AUDIENCES: CustomAudienceDetail[] = [
  { id: "ca1", name: "Purchasers LAL 1%",         size: 2100000, subtype: "LOOKALIKE",     lookalikeSpec: { ratio: 0.01, type: "similarity", startingAudienceSize: 340 },   timeUpdated: new Date(Date.now() - 97 * 86400000).toISOString() },
  { id: "ca2", name: "Website Visitors 30d",       size: 180000,  subtype: "WEBSITE",       timeUpdated: new Date(Date.now() - 2  * 86400000).toISOString(), retentionDays: 30 },
  { id: "ca3", name: "Video Viewers 75% 90d",      size: 95000,   subtype: "ENGAGEMENT",    timeUpdated: new Date(Date.now() - 14 * 86400000).toISOString(), retentionDays: 90 },
  { id: "ca4", name: "ATC last 7d",                size: 52000,   subtype: "WEBSITE",       timeUpdated: new Date(Date.now() - 1  * 86400000).toISOString(), retentionDays: 7 },
  { id: "ca5", name: "Checkout Abandoned 3d",      size: 28000,   subtype: "WEBSITE",       timeUpdated: new Date(Date.now() - 3  * 86400000).toISOString(), retentionDays: 3 },
  { id: "ca6", name: "Existing Customers 180d",    size: 45000,   subtype: "CUSTOMER_LIST", lookalikeSpec: { ratio: 0.08, type: "similarity", startingAudienceSize: 620 },  timeUpdated: new Date(Date.now() - 63 * 86400000).toISOString() },
  { id: "ca7", name: "IG Engaged 60d",             size: 68000,   subtype: "ENGAGEMENT",    timeUpdated: new Date(Date.now() - 8  * 86400000).toISOString(), retentionDays: 60 },
  { id: "ca8", name: "Newsletter Signups 7d",      size: 640,     subtype: "WEBSITE",       timeUpdated: new Date(Date.now() - 5  * 86400000).toISOString(), retentionDays: 7 },
];

const DEMO_ADSETS: AdSetRow[] = [
  { id: "a001", name: "TOF - Broad - All India",             campaignName: "Awareness - Broad India",        spend: 48000, impressions: 1850000, clicks: 22000, reach: 820000, frequency: 2.3, conversions: 180, conversionValue: 126000, uniqueClicks: 18200,
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["IN"] } }, campaignObjective: "OUTCOME_AWARENESS" },
  { id: "a002", name: "TOF - Interest - Fashion & Lifestyle",campaignName: "Awareness - Interest Stacks",    spend: 32000, impressions: 1120000, clicks: 15000, reach: 560000, frequency: 2.0, conversions: 145, conversionValue: 101500, uniqueClicks: 12800,
    targeting: { flexible_spec: [{ interests: [{ id: "6003107", name: "Fashion" }, { id: "6003139", name: "Lifestyle" }] }] }, campaignObjective: "OUTCOME_AWARENESS" },
  { id: "a003", name: "TOF - LAL 1pct Purchasers",           campaignName: "Prospecting - LAL",              spend: 28000, impressions: 980000,  clicks: 13000, reach: 490000, frequency: 2.0, conversions: 168, conversionValue: 134400, uniqueClicks: 11200,
    targeting: { custom_audiences: [{ id: "ca1" }] }, campaignObjective: "OUTCOME_SALES" },
  { id: "a004", name: "MOF - Website Visitors 30d",          campaignName: "Retargeting - Web Visitors",     spend: 22000, impressions: 680000,  clicks: 11000, reach: 180000, frequency: 3.8, conversions: 132, conversionValue: 105600, uniqueClicks: 7800,
    targeting: { custom_audiences: [{ id: "ca2" }], excluded_custom_audiences: [{ id: "ca6" }] }, campaignObjective: "OUTCOME_SALES" },
  { id: "a005", name: "MOF - Video Viewers 75pct",           campaignName: "Retargeting - Video Viewers",    spend: 12000, impressions: 420000,  clicks: 6200,  reach: 95000,  frequency: 4.4, conversions: 65,  conversionValue: 52000,  uniqueClicks: 4900,
    targeting: { custom_audiences: [{ id: "ca3" }] }, campaignObjective: "OUTCOME_ENGAGEMENT" },
  { id: "a006", name: "BOF - ATC 7d",                        campaignName: "Conversion - ATC Retargeting",   spend: 18000, impressions: 380000,  clicks: 8500,  reach: 52000,  frequency: 7.3, conversions: 198, conversionValue: 178200, uniqueClicks: 5200,
    targeting: { custom_audiences: [{ id: "ca4" }], excluded_custom_audiences: [{ id: "ca6" }] }, campaignObjective: "OUTCOME_SALES" },
  { id: "a007", name: "BOF - Checkout Abandon 3d",           campaignName: "Conversion - Checkout Recovery", spend: 9500,  impressions: 195000,  clicks: 4800,  reach: 28000,  frequency: 6.96,conversions: 128, conversionValue: 128000, uniqueClicks: 3100,
    targeting: { custom_audiences: [{ id: "ca5" }], excluded_custom_audiences: [{ id: "ca6" }] }, campaignObjective: "OUTCOME_SALES" },
  { id: "a008", name: "LOY - Existing Customers 180d",       campaignName: "Loyalty - Repeat Purchase",      spend: 8000,  impressions: 240000,  clicks: 4200,  reach: 45000,  frequency: 5.3, conversions: 95,  conversionValue: 114000, uniqueClicks: 3600,
    targeting: { custom_audiences: [{ id: "ca6" }] }, campaignObjective: "OUTCOME_SALES" },
  { id: "a009", name: "TOF - Broad 18-35 Female",            campaignName: "Awareness - Broad India",        spend: 22000, impressions: 960000,  clicks: 12500, reach: 440000, frequency: 2.2, conversions: 88,  conversionValue: 52800,  uniqueClicks: 10500,
    targeting: { age_min: 18, age_max: 35, genders: [2], geo_locations: { countries: ["IN"] } }, campaignObjective: "OUTCOME_AWARENESS" },
  { id: "a010", name: "MOF - IG Engaged 60d",                campaignName: "Retargeting - Social Engaged",   spend: 7500,  impressions: 285000,  clicks: 4100,  reach: 68000,  frequency: 4.2, conversions: 42,  conversionValue: 33600,  uniqueClicks: 3400,
    targeting: { custom_audiences: [{ id: "ca7" }] }, campaignObjective: "OUTCOME_ENGAGEMENT" },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, businessId, startDate, endDate } = req.body || {};
  if (!accessToken || !businessId) {
    res.status(400).json({ error: "Missing accessToken or businessId" });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({
      source: "demo", adsets: DEMO_ADSETS, audiences: DEMO_AUDIENCES, currency: "INR",
      accountReach: 1_450_000, accountFrequency: 4.9,
    });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;

    // Fetch insights + currency + custom audiences + account-level reach in parallel.
    const [insights, currency, audiences, account] = await Promise.all([
      client.getAdSetFullInsights(accountPath, startDate, endDate),
      client.getAccountCurrency(accountPath),
      client.getCustomAudiences(accountPath).catch(() => []),
      client.getAccountReachFrequency(accountPath, startDate, endDate).catch(() => ({ reach: 0, frequency: 0, impressions: 0 })),
    ]);

    // Fetch targeting for the ad sets we got insights for (batched), then merge.
    const adSetIds = insights.map((a) => a.id).filter(Boolean);
    const targetingMap: Record<string, Awaited<ReturnType<typeof client.getAdSetsTargeting>>[string]> =
      await client.getAdSetsTargeting(accountPath, adSetIds).catch(() => ({}));

    const adsets: AdSetRow[] = insights.map((r) => {
      const t = targetingMap[r.id];
      return {
        ...r,
        targeting: t?.targeting,
        promotedObject: t?.promotedObject,
        campaignObjective: t?.campaignObjective,
      };
    });

    res.status(200).json({
      source: "live", adsets, audiences, currency: currency || "USD",
      accountReach: account.reach, accountFrequency: account.frequency,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Ad set insights fetch failed" });
  }
}
