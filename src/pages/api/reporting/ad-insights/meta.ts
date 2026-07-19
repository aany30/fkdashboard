/**
 * POST /api/reporting/ad-insights/meta
 *
 * Ad-level insights — top ads ranked by spend with creative type + thumbnail.
 * Language is derived from the ad set's targeting.locales[] field (Meta locale IDs).
 * Used by the Creative report.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

export interface AdInsightRow {
  id: string;
  name: string;
  campaignName?: string;
  adSetName?: string;
  adSetId?: string;
  creativeType?: string;
  thumbnailUrl?: string;
  language?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

// Meta's full ad-locale table is static reference data — fetch once and cache
// for the server's lifetime so we don't re-pull it on every request.
let localeMapCache: Map<number, string> | null = null;
async function getLocaleNameMap(client: MetaApiClient): Promise<Map<number, string>> {
  if (localeMapCache && localeMapCache.size > 0) return localeMapCache;
  const m = await client.getAdLocales();
  if (m.size > 0) localeMapCache = m;
  return m;
}

// Meta locale ID → language name (most common ones) — built-in fallback used when
// the full ad-locale fetch is unavailable.
export const META_LOCALE_MAP: Record<number, string> = {
  6:   "English",
  24:  "English",
  4:   "English",
  23:  "Hindi",
  45:  "Tamil",
  57:  "Kannada",
  67:  "Malayalam",
  74:  "Marathi",
  50:  "Bengali",
  90:  "Telugu",
  54:  "Gujarati",
  81:  "Punjabi",
  28:  "Spanish",
  25:  "French",
  14:  "German",
  5:   "Italian",
  27:  "Portuguese",
  31:  "Arabic",
  7:   "Japanese",
  10:  "Korean",
  29:  "Chinese (Simplified)",
};

/**
 * Resolve locale IDs to a display language string.
 * - No locales targeted → "All languages" (genuinely no language restriction).
 * - Locales present → their real names via `nameMap` (Meta's full ad-locale
 *   table), falling back to the small built-in map. If IDs still can't be
 *   resolved we return "Unknown" — NEVER "All languages", which would falsely
 *   imply the ad set wasn't language-targeted.
 */
export function localesToLanguage(locales: number[] | undefined, nameMap?: Map<number, string>): string {
  if (!locales || locales.length === 0) return "All languages";
  const resolve = (id: number) => nameMap?.get(id) ?? META_LOCALE_MAP[id];
  const names = [...new Set(locales.map(resolve).filter(Boolean))];
  return names.length > 0 ? names.join(" / ") : "Unknown";
}

// Demo: adSetId → locales mapping (realistic for an Indian DTC brand)
const DEMO_ADSET_LOCALES: Record<string, number[]> = {
  "as_001": [6, 23],     // English + Hindi (Broad All India)
  "as_002": [6],          // English (Interest - Skincare)
  "as_003": [6],          // English (LAL)
  "as_004": [6, 23],     // English + Hindi (Broad Female)
  "as_005": [6],          // English (Website Visitors)
  "as_006": [6],          // English (Video Viewers)
  "as_007": [6, 23],     // English + Hindi (ATC)
  "as_008": [6],          // English (Checkout Abandon)
  "as_009": [6],          // English (LAL Engagers)
  "as_010": [6, 23],     // English + Hindi (Broad All India)
};

const DEMO_ADS: AdInsightRow[] = [
  { id: "ad_01", adSetId: "as_001", name: "Hero Reel — Skincare Routine v3",     campaignName: "GW_All_Product_Sales_Campaign_7_May'26",        adSetName: "TOF - Broad - All India",         creativeType: "VIDEO",    language: "English / Hindi", spend: 18500, impressions: 920000, clicks: 14200, conversions: 142, conversionValue: 96000 },
  { id: "ad_02", adSetId: "as_002", name: "Static — B1G1 Offer Banner",           campaignName: "Plenaire - TOF - B1G1 - 21/05",                 adSetName: "TOF - Interest - Skincare",       creativeType: "PHOTO",    language: "English",         spend: 14200, impressions: 780000, clicks: 11800, conversions: 110, conversionValue: 71500 },
  { id: "ad_03", adSetId: "as_003", name: "Carousel — Product Range Tour",        campaignName: "GW_All_Product_Sales_Campaign_7_May'26",        adSetName: "TOF - LAL 1pct Purchasers",       creativeType: "CAROUSEL", language: "English",         spend: 12800, impressions: 540000, clicks: 9600,  conversions: 132, conversionValue: 102000 },
  { id: "ad_04", adSetId: "as_004", name: "UGC Video — Customer Testimonial",     campaignName: "Plenaire - TOF - Glacee - 21/05",               adSetName: "TOF - Broad 18-35 Female",        creativeType: "VIDEO",    language: "English / Hindi", spend: 9800,  impressions: 410000, clicks: 7200,  conversions: 88,  conversionValue: 61000 },
  { id: "ad_05", adSetId: "as_005", name: "Static — Limited Time Offer",          campaignName: "GW_Add_Cart_Retargeting_22nd_May'26",           adSetName: "MOF - Website Visitors 30d",      creativeType: "PHOTO",    language: "English",         spend: 8200,  impressions: 280000, clicks: 6400,  conversions: 95,  conversionValue: 78000 },
  { id: "ad_06", adSetId: "as_006", name: "Reel — 30s Founder Story",             campaignName: "Plenaire - TOF - Aesthetique - 03/06",          adSetName: "MOF - Video Viewers 75pct",       creativeType: "VIDEO",    language: "English",         spend: 7500,  impressions: 320000, clicks: 5100,  conversions: 42,  conversionValue: 33000 },
  { id: "ad_07", adSetId: "as_007", name: "Carousel — Bestsellers Top 5",         campaignName: "GW_All_Product_Sales_Campaign_8th_June'26",     adSetName: "BOF - ATC 7d",                    creativeType: "CAROUSEL", language: "English / Hindi", spend: 6800,  impressions: 145000, clicks: 4400,  conversions: 118, conversionValue: 102000 },
  { id: "ad_08", adSetId: "as_008", name: "Static — Free Sample Promo",           campaignName: "GW_All_Product_Catalogue_Sales_Campaign_12_May",adSetName: "BOF - Checkout Abandon 3d",       creativeType: "PHOTO",    language: "English",         spend: 5200,  impressions: 98000,  clicks: 3800,  conversions: 78,  conversionValue: 78000 },
  { id: "ad_09", adSetId: "as_009", name: "Reel — Influencer Collab #2",          campaignName: "Plenaire - TOF - Consolidate - BC - 14/05",     adSetName: "TOF - LAL 2pct Engagers",         creativeType: "VIDEO",    language: "English",         spend: 4500,  impressions: 195000, clicks: 2900,  conversions: 38,  conversionValue: 26000 },
  { id: "ad_10", adSetId: "as_010", name: "Static — Brand Awareness",             campaignName: "Plenaire - TOF - B1G1 - 21/05",                 adSetName: "TOF - Broad - All India",         creativeType: "PHOTO",    language: "English / Hindi", spend: 3800,  impressions: 142000, clicks: 2100,  conversions: 24,  conversionValue: 16000 },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { accessToken, businessId, startDate, endDate, limit } = req.body || {};
  if (!accessToken || !businessId) { res.status(400).json({ error: "Missing accessToken or businessId" }); return; }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", ads: DEMO_ADS, currency: "INR" });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    const [ads, currency] = await Promise.all([
      client.getAdInsights(accountPath, startDate, endDate, limit || 100),
      client.getAccountCurrency(accountPath),
    ]);

    // Fetch targeting locales for the unique ad sets represented in this batch.
    const adSetIds = [...new Set(ads.map(a => a.adSetId).filter(Boolean) as string[])];
    type TargetingMap = Awaited<ReturnType<typeof client.getAdSetsTargeting>>;
    const [targetingMap, localeNames] = await Promise.all([
      adSetIds.length
        ? client.getAdSetsTargeting(accountPath, adSetIds).catch(() => ({} as TargetingMap))
        : Promise.resolve({} as TargetingMap),
      getLocaleNameMap(client),
    ]);

    const localesFor = (adSetId?: string): number[] | undefined =>
      adSetId && targetingMap[adSetId]?.targeting?.locales ? targetingMap[adSetId].targeting!.locales : undefined;

    const enriched: AdInsightRow[] = ads.map(a => ({
      ...a,
      language: localesToLanguage(localesFor(a.adSetId), localeNames),
    }));

    res.status(200).json({ source: "live", ads: enriched, currency: currency || "USD" });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Ad insights fetch failed" });
  }
}
