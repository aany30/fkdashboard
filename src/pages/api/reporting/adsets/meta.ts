/**
 * POST /api/reporting/adsets/meta
 *
 * Returns Meta ad-set-level insights with targeting summaries, spend,
 * reach/frequency, conversions, and video views. Used by the Audience
 * Analysis / Ad Set drill-down views.
 *
 * Body: { accessToken, businessId, startDate?, endDate? }
 *
 * Demo passthrough: when accessToken is a demo placeholder, returns ~15
 * realistic Indian-market ad sets so the dashboard can preview the UI
 * without a real Meta connection.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { isDemoCredential } from "@/lib/demo-data";

const META_API_BASE = "https://graph.facebook.com/v18.0";

type AdSetRow = {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  targeting: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversionValue: number;
  cpm: number;
  ctr: number;
  videoViews: number;
};

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

function getDemoAdSets(): AdSetRow[] {
  return [
    {
      id: "demo_adset_001", name: "Prospecting - Fashion Interest - Mumbai+Delhi",
      campaignId: "demo_camp_001", campaignName: "Summer Sale 2026",
      targeting: "Women 25-44, Mumbai + Delhi, Interest: Fashion & Beauty",
      spend: 48500, impressions: 1280000, clicks: 19200, reach: 620000, frequency: 2.06,
      conversions: 342, conversionValue: 1710000, cpm: 37.89, ctr: 1.50, videoViews: 18400,
    },
    {
      id: "demo_adset_002", name: "Retargeting - Website Visitors 30d",
      campaignId: "demo_camp_001", campaignName: "Summer Sale 2026",
      targeting: "Men 18-34, Tier 1 Cities, Custom Audience: Website Visitors",
      spend: 32000, impressions: 540000, clicks: 16200, reach: 185000, frequency: 2.92,
      conversions: 480, conversionValue: 2400000, cpm: 59.26, ctr: 3.00, videoViews: 4200,
    },
    {
      id: "demo_adset_003", name: "Lookalike - Purchase 1% IN",
      campaignId: "demo_camp_002", campaignName: "Monsoon Collection Launch",
      targeting: "All Genders 21-45, India, Lookalike: Purchasers 1%",
      spend: 42000, impressions: 1050000, clicks: 14700, reach: 510000, frequency: 2.06,
      conversions: 285, conversionValue: 1425000, cpm: 40.00, ctr: 1.40, videoViews: 22100,
    },
    {
      id: "demo_adset_004", name: "Broad - Women 25-54 Metro",
      campaignId: "demo_camp_002", campaignName: "Monsoon Collection Launch",
      targeting: "Women 25-54, Bengaluru + Hyderabad + Chennai, Broad Targeting",
      spend: 28500, impressions: 820000, clicks: 10660, reach: 390000, frequency: 2.10,
      conversions: 195, conversionValue: 975000, cpm: 34.76, ctr: 1.30, videoViews: 15800,
    },
    {
      id: "demo_adset_005", name: "Interest - Home Decor Enthusiasts",
      campaignId: "demo_camp_003", campaignName: "Home Makeover Diwali",
      targeting: "Women 28-50, Pan India, Interest: Home Decor & Interior Design",
      spend: 22000, impressions: 620000, clicks: 8060, reach: 310000, frequency: 2.00,
      conversions: 148, conversionValue: 1184000, cpm: 35.48, ctr: 1.30, videoViews: 9500,
    },
    {
      id: "demo_adset_006", name: "Custom Audience - Email Subscribers",
      campaignId: "demo_camp_003", campaignName: "Home Makeover Diwali",
      targeting: "All Genders 22-55, Custom Audience: Email Subscribers (45K list)",
      spend: 15200, impressions: 280000, clicks: 11200, reach: 38000, frequency: 7.37,
      conversions: 312, conversionValue: 1560000, cpm: 54.29, ctr: 4.00, videoViews: 2100,
    },
    {
      id: "demo_adset_007", name: "Lookalike - ATC 3% South India",
      campaignId: "demo_camp_004", campaignName: "Clearance - End of Season",
      targeting: "All Genders 18-40, Karnataka + Tamil Nadu + Kerala, Lookalike: Add-to-Cart 3%",
      spend: 18500, impressions: 520000, clicks: 7280, reach: 260000, frequency: 2.00,
      conversions: 112, conversionValue: 448000, cpm: 35.58, ctr: 1.40, videoViews: 11200,
    },
    {
      id: "demo_adset_008", name: "Demographic - Young Professionals",
      campaignId: "demo_camp_004", campaignName: "Clearance - End of Season",
      targeting: "Men 22-35, Delhi NCR + Pune, Interest: Fitness & Lifestyle, Income: Top 25%",
      spend: 12800, impressions: 360000, clicks: 5040, reach: 175000, frequency: 2.06,
      conversions: 88, conversionValue: 440000, cpm: 35.56, ctr: 1.40, videoViews: 6700,
    },
    {
      id: "demo_adset_009", name: "Retargeting - Cart Abandoners 7d",
      campaignId: "demo_camp_005", campaignName: "Always-On Retargeting",
      targeting: "All Genders 18-55, India, Custom Audience: Cart Abandoners (7 days)",
      spend: 9800, impressions: 145000, clicks: 7250, reach: 42000, frequency: 3.45,
      conversions: 210, conversionValue: 1050000, cpm: 67.59, ctr: 5.00, videoViews: 980,
    },
    {
      id: "demo_adset_010", name: "Interest - Skincare & Wellness",
      campaignId: "demo_camp_005", campaignName: "Always-On Retargeting",
      targeting: "Women 20-38, Tier 1 + Tier 2 Cities, Interest: Skincare & Wellness",
      spend: 35000, impressions: 980000, clicks: 13720, reach: 480000, frequency: 2.04,
      conversions: 228, conversionValue: 1140000, cpm: 35.71, ctr: 1.40, videoViews: 19600,
    },
    {
      id: "demo_adset_011", name: "Lookalike - High-Value Buyers 1%",
      campaignId: "demo_camp_006", campaignName: "Premium Collection",
      targeting: "All Genders 28-50, India, Lookalike: High-Value Purchasers 1% (AOV > Rs 5000)",
      spend: 38000, impressions: 850000, clicks: 10200, reach: 420000, frequency: 2.02,
      conversions: 165, conversionValue: 1650000, cpm: 44.71, ctr: 1.20, videoViews: 14300,
    },
    {
      id: "demo_adset_012", name: "Geo - Tier 2 Cities Expansion",
      campaignId: "demo_camp_006", campaignName: "Premium Collection",
      targeting: "Women 22-40, Jaipur + Lucknow + Chandigarh + Kochi, Interest: Online Shopping",
      spend: 8500, impressions: 310000, clicks: 4030, reach: 155000, frequency: 2.00,
      conversions: 62, conversionValue: 248000, cpm: 27.42, ctr: 1.30, videoViews: 7200,
    },
    {
      id: "demo_adset_013", name: "Video Views - Brand Awareness",
      campaignId: "demo_camp_007", campaignName: "Brand Awareness - Video",
      targeting: "All Genders 18-45, Pan India, Interest: Fashion & Lifestyle, Optimized for ThruPlay",
      spend: 25000, impressions: 1450000, clicks: 5800, reach: 720000, frequency: 2.01,
      conversions: 42, conversionValue: 168000, cpm: 17.24, ctr: 0.40, videoViews: 185000,
    },
    {
      id: "demo_adset_014", name: "Retargeting - Video Viewers 50%",
      campaignId: "demo_camp_007", campaignName: "Brand Awareness - Video",
      targeting: "All Genders 18-45, India, Custom Audience: Video Viewers (50%+ watched, 30d)",
      spend: 11000, impressions: 220000, clicks: 6600, reach: 68000, frequency: 3.24,
      conversions: 135, conversionValue: 675000, cpm: 50.00, ctr: 3.00, videoViews: 3200,
    },
    {
      id: "demo_adset_015", name: "Interest - Tech & Gadgets Male",
      campaignId: "demo_camp_008", campaignName: "Tech Accessories Push",
      targeting: "Men 18-30, Mumbai + Bengaluru + Delhi, Interest: Technology & Gadgets",
      spend: 5200, impressions: 185000, clicks: 3330, reach: 92000, frequency: 2.01,
      conversions: 55, conversionValue: 220000, cpm: 28.11, ctr: 1.80, videoViews: 4800,
    },
  ];
}

// ---------------------------------------------------------------------------
// Targeting parser — converts the Meta targeting JSON into a human summary
// ---------------------------------------------------------------------------

function parseTargetingSummary(targeting: any): string {
  if (!targeting || typeof targeting !== "object") return "All audiences";

  const parts: string[] = [];

  // Age + gender
  const ageMin = targeting.age_min;
  const ageMax = targeting.age_max;
  const genders: number[] | undefined = targeting.genders; // [1]=male, [2]=female
  const genderLabel =
    genders?.length === 1
      ? genders[0] === 1
        ? "Men"
        : "Women"
      : "All Genders";
  if (ageMin || ageMax) {
    parts.push(`${genderLabel} ${ageMin || 13}-${ageMax || "65+"}`);
  } else if (genderLabel !== "All Genders") {
    parts.push(genderLabel);
  }

  // Geo — cities, regions, countries
  const geo = targeting.geo_locations;
  if (geo) {
    const cities = (geo.cities || []).map((c: any) => c.name).filter(Boolean);
    const regions = (geo.regions || []).map((r: any) => r.name).filter(Boolean);
    const countries = (geo.countries || []) as string[];
    if (cities.length > 0) parts.push(cities.slice(0, 3).join(" + ") + (cities.length > 3 ? ` +${cities.length - 3} more` : ""));
    else if (regions.length > 0) parts.push(regions.slice(0, 3).join(" + ") + (regions.length > 3 ? ` +${regions.length - 3} more` : ""));
    else if (countries.length > 0) parts.push(countries.join(", "));
  }

  // Interests
  const interests = targeting.flexible_spec;
  if (Array.isArray(interests)) {
    const names: string[] = [];
    for (const spec of interests) {
      for (const arr of Object.values(spec)) {
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && typeof item === "object" && item.name) names.push(item.name);
          }
        }
      }
    }
    if (names.length > 0) parts.push("Interest: " + names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : ""));
  }

  // Custom audiences
  const customAudiences = targeting.custom_audiences;
  if (Array.isArray(customAudiences) && customAudiences.length > 0) {
    const caNames = customAudiences.map((ca: any) => ca.name).filter(Boolean);
    if (caNames.length > 0) parts.push("Custom Audience: " + caNames.slice(0, 2).join(", ") + (caNames.length > 2 ? ` +${caNames.length - 2} more` : ""));
  }

  // Excluded custom audiences
  const excluded = targeting.excluded_custom_audiences;
  if (Array.isArray(excluded) && excluded.length > 0) {
    parts.push(`Excluding ${excluded.length} audience${excluded.length > 1 ? "s" : ""}`);
  }

  return parts.length > 0 ? parts.join(", ") : "Broad targeting";
}

// ---------------------------------------------------------------------------
// Meta API helpers
// ---------------------------------------------------------------------------

function parseMetaError(status: number, body: string): string {
  if (status === 429) return "Meta API rate limit reached. Please wait a few minutes and try again.";
  if (status === 401 || status === 403) return "Meta access token expired or lacks permissions. Please reconnect your account.";
  if (body.trimStart().startsWith("<")) {
    return `Meta API error (HTTP ${status}). Facebook may be temporarily unavailable.`;
  }
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message || json?.message;
    if (msg) return `Meta API: ${msg}`;
  } catch {}
  return `Meta API ${status}: ${body.slice(0, 120)}`;
}

async function metaFetch<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseMetaError(res.status, body));
  }
  return res.json();
}

/** Follow pagination to collect all rows from a Meta Graph API edge. */
async function metaFetchAll<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = null;

  // First page — use path + params
  const firstUrl = new URL(`${META_API_BASE}${path}`);
  firstUrl.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) firstUrl.searchParams.set(k, v);
  url = firstUrl.toString();

  for (let page = 0; page < 10 && url; page++) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(parseMetaError(res.status, body));
    }
    const json = await res.json() as { data?: T[]; paging?: { next?: string } };
    if (json.data) rows.push(...json.data);
    url = json.paging?.next || null;
  }
  return rows;
}

/**
 * Sum conversion events from a Meta actions array, deduplicating aliases.
 * Same logic as the main MetaApiClient.
 */
function sumConversions(rows: Array<{ action_type: string; value: string }> | undefined): number {
  if (!rows || rows.length === 0) return 0;
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.action_type] = (byType[r.action_type] || 0) + (parseFloat(r.value) || 0);

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
  let total = 0;
  for (const group of groups) {
    for (const t of group) {
      if (byType[t] !== undefined) { total += byType[t]; break; }
    }
  }
  return total;
}

function sumActionValues(rows: Array<{ action_type: string; value: string }> | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

  // ---- Demo mode ----
  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", rows: getDemoAdSets() });
    return;
  }

  // ---- Live mode ----
  try {
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;

    // Step 1: Fetch ad sets with targeting + parent campaign name
    const adSetsRaw = await metaFetchAll<any>(accessToken, `/${accountPath}/adsets`, {
      fields: "id,name,campaign_id,campaign{name},targeting",
      limit: "500",
    });

    if (!adSetsRaw || adSetsRaw.length === 0) {
      res.status(200).json({ source: "live", rows: [] });
      return;
    }

    // Step 2: Fetch insights at adset level (one call with level=adset)
    const timeParams: Record<string, string> = {
      level: "adset",
      fields: "adset_id,spend,impressions,clicks,reach,frequency,actions,action_values,video_play_actions",
      limit: "500",
    };
    if (startDate && endDate) {
      timeParams.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    } else {
      timeParams.date_preset = "last_30d";
    }

    const insightsRaw = await metaFetchAll<any>(accessToken, `/${accountPath}/insights`, timeParams);

    // Build a map of adset_id -> insights
    const insightsMap: Record<string, any> = {};
    for (const row of insightsRaw) {
      insightsMap[String(row.adset_id)] = row;
    }

    // Step 3: Merge ad set metadata with insights
    const rows: AdSetRow[] = adSetsRaw.map((adset: any) => {
      const id = String(adset.id);
      const ins = insightsMap[id];
      const spend = ins?.spend ? parseFloat(ins.spend) : 0;
      const impressions = ins?.impressions ? parseInt(ins.impressions, 10) : 0;
      const clicks = ins?.clicks ? parseInt(ins.clicks, 10) : 0;
      const reach = ins?.reach ? parseInt(ins.reach, 10) : 0;
      const frequency = ins?.frequency ? parseFloat(ins.frequency) : 0;
      const conversions = sumConversions(ins?.actions);
      const conversionValue = sumConversions(ins?.action_values);
      const videoViews = sumActionValues(ins?.video_play_actions);

      return {
        id,
        name: String(adset.name || ""),
        campaignId: String(adset.campaign_id || ""),
        campaignName: adset.campaign?.name ? String(adset.campaign.name) : "",
        targeting: parseTargetingSummary(adset.targeting),
        spend,
        impressions,
        clicks,
        reach,
        frequency,
        conversions,
        conversionValue,
        cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 100 * 100) / 100 : 0,
        videoViews,
      };
    });

    res.status(200).json({ source: "live", rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Meta ad set insights fetch failed";
    console.error("[Meta adsets] failed:", message);
    res.status(500).json({ error: message });
  }
}
