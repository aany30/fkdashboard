/**
 * POST /api/reporting/adsets/dv360
 *
 * DV360 line-item-level data with audience/targeting info.
 *
 * Live mode: runs a Bid Manager query keyed by FILTER_LINE_ITEM and
 * FILTER_INSERTION_ORDER, then enriches with targeting details from the
 * DV360 Display & Video 360 API v4 (assigned targeting options per LI).
 *
 * Demo mode: returns ~12 realistic line items with DV360-style targeting
 * descriptions and INR spend figures.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";

export const config = { maxDuration: 60 };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DV360LineItemRow {
  id: string;
  name: string;
  insertionOrderId: string;
  insertionOrderName: string;
  audienceType: string;
  targeting: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpm: number;
  ctr: number;
  videoViews: number;
}

type SuccessResponse = { source: "demo" | "live"; rows: DV360LineItemRow[] };
type PendingResponse = { status: "pending" };
type ErrorResponse = { error: string };

// ─── Demo data ───────────────────────────────────────────────────────────────

function getDemoLineItems(): DV360LineItemRow[] {
  const ios: Array<{ id: string; name: string }> = [
    { id: "IO-88001", name: "Brand Awareness - Auto Q3" },
    { id: "IO-88002", name: "Performance - Travel India" },
    { id: "IO-88003", name: "Retargeting - CRM Audiences" },
    { id: "IO-88004", name: "YouTube Pre-Roll - Festive" },
  ];

  const items: Array<{
    id: string; name: string; ioIdx: number;
    audienceType: string; targeting: string;
    spend: number; impressions: number; clicks: number;
    conversions: number; videoViews: number;
  }> = [
    {
      id: "LI-990001", name: "Display - Affinity Auto Enthusiasts M25-54",
      ioIdx: 0, audienceType: "Affinity",
      targeting: "Affinity: Auto Enthusiasts, Males 25-54, Tier 1 Metro",
      spend: 285000, impressions: 4120000, clicks: 28400,
      conversions: 312, videoViews: 0,
    },
    {
      id: "LI-990002", name: "Display - Affinity Sports & Fitness F18-34",
      ioIdx: 0, audienceType: "Affinity",
      targeting: "Affinity: Sports & Fitness Enthusiasts, Females 18-34, All India",
      spend: 195000, impressions: 3100000, clicks: 21700,
      conversions: 198, videoViews: 0,
    },
    {
      id: "LI-990003", name: "Display - In-Market Travel India",
      ioIdx: 1, audienceType: "In-Market",
      targeting: "In-Market: Travel India, Custom: Domestic Flights, Age 25-44",
      spend: 420000, impressions: 5600000, clicks: 56000,
      conversions: 840, videoViews: 0,
    },
    {
      id: "LI-990004", name: "Display - In-Market Hotels & Accommodation",
      ioIdx: 1, audienceType: "In-Market",
      targeting: "In-Market: Hotels & Accommodation, Custom: Weekend Getaways, Tier 1+2 Cities",
      spend: 310000, impressions: 4200000, clicks: 37800,
      conversions: 567, videoViews: 0,
    },
    {
      id: "LI-990005", name: "Display - In-Market Travel Packages",
      ioIdx: 1, audienceType: "In-Market",
      targeting: "In-Market: Travel India, Custom: Holiday Packages, Males 30-54",
      spend: 175000, impressions: 2800000, clicks: 22400,
      conversions: 290, videoViews: 0,
    },
    {
      id: "LI-990006", name: "Display - CRM Upload Retargeting",
      ioIdx: 2, audienceType: "First Party",
      targeting: "First Party: CRM Upload, Website Retargeting, All Genders 18-65",
      spend: 480000, impressions: 3200000, clicks: 64000,
      conversions: 1280, videoViews: 0,
    },
    {
      id: "LI-990007", name: "Display - Website Retargeting Tier 1 Metro",
      ioIdx: 2, audienceType: "First Party",
      targeting: "First Party: Website Retargeting, Tier 1 Metro, Cart Abandoners",
      spend: 365000, impressions: 2400000, clicks: 48000,
      conversions: 960, videoViews: 0,
    },
    {
      id: "LI-990008", name: "Display - Similar to Converters",
      ioIdx: 2, audienceType: "Similar",
      targeting: "Similar: Lookalike of Purchase Converters, Females 25-44, Top 5 Metros",
      spend: 225000, impressions: 3600000, clicks: 25200,
      conversions: 378, videoViews: 0,
    },
    {
      id: "LI-990009", name: "Display - Custom Intent Auto Loans",
      ioIdx: 0, audienceType: "Custom",
      targeting: "Custom: Auto Loan Intenders, In-Market: Auto Vehicles, Males 25-54",
      spend: 150000, impressions: 2100000, clicks: 14700,
      conversions: 147, videoViews: 0,
    },
    {
      id: "LI-990010", name: "YouTube Pre-Roll - Festive Season Awareness",
      ioIdx: 3, audienceType: "Affinity",
      targeting: "Affinity: Shoppers, In-Market: Festival Deals, Age 18-44, Hindi + English",
      spend: 520000, impressions: 6800000, clicks: 34000,
      conversions: 510, videoViews: 2720000,
    },
    {
      id: "LI-990011", name: "YouTube Pre-Roll - Custom CRM Retargeting",
      ioIdx: 3, audienceType: "First Party",
      targeting: "First Party: CRM Upload, App Users, Tier 1 Metro, Age 18-54",
      spend: 340000, impressions: 4400000, clicks: 22000,
      conversions: 440, videoViews: 1760000,
    },
    {
      id: "LI-990012", name: "YouTube Bumper - Brand Reach Broad",
      ioIdx: 3, audienceType: "In-Market",
      targeting: "In-Market: Consumer Electronics, Custom: Tech Reviews, All India, Age 18-34",
      spend: 88000, impressions: 5200000, clicks: 10400,
      conversions: 104, videoViews: 4680000,
    },
  ];

  return items.map((li) => {
    const io = ios[li.ioIdx];
    const impressions = li.impressions;
    const cpm = impressions > 0 ? (li.spend / impressions) * 1000 : 0;
    const ctr = impressions > 0 ? (li.clicks / impressions) * 100 : 0;
    return {
      id: li.id,
      name: li.name,
      insertionOrderId: io.id,
      insertionOrderName: io.name,
      audienceType: li.audienceType,
      targeting: li.targeting,
      spend: li.spend,
      impressions,
      clicks: li.clicks,
      conversions: li.conversions,
      cpm: Math.round(cpm * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      videoViews: li.videoViews,
    };
  });
}

// ─── Targeting resolution helpers ────────────────────────────────────────────

/** Summarise audience/targeting from DV360 assigned targeting options. */
function summariseTargeting(
  targeting: Record<string, unknown[]>
): { audienceType: string; targeting: string } {
  const parts: string[] = [];
  let audienceType = "Unknown";

  // Audience groups
  const audienceGroups = targeting["TARGETING_TYPE_AUDIENCE_GROUP"] as
    | Array<{ audienceGroupDetails?: Record<string, unknown> }>
    | undefined;
  if (audienceGroups?.length) {
    for (const ag of audienceGroups) {
      const details = ag.audienceGroupDetails;
      if (!details) continue;
      const included = details.includedFirstAndThirdPartyAudienceGroups as
        | Array<{ settings?: Array<{ firstAndThirdPartyAudienceId?: string }> }>
        | undefined;
      if (included?.length) {
        audienceType = "First Party";
        parts.push(`Audience Group (${included.length} segment${included.length > 1 ? "s" : ""})`);
      }
    }
  }

  // Age ranges
  const ages = targeting["TARGETING_TYPE_AGE_RANGE"] as
    | Array<{ ageRange?: string }>
    | undefined;
  if (ages?.length) {
    const labels = ages
      .map((a) =>
        (a.ageRange ?? "")
          .replace("AGE_RANGE_", "")
          .replace(/_/g, "-")
      )
      .filter(Boolean);
    if (labels.length) parts.push(`Age: ${labels.join(", ")}`);
  }

  // Gender
  const genders = targeting["TARGETING_TYPE_GENDER"] as
    | Array<{ gender?: string }>
    | undefined;
  if (genders?.length) {
    const labels = genders
      .map((g) => (g.gender ?? "").replace("GENDER_", "").replace(/_/g, " "))
      .filter(Boolean);
    if (labels.length) parts.push(`Gender: ${labels.join(", ")}`);
  }

  // Geo
  const geos = targeting["TARGETING_TYPE_GEO_REGION"] as
    | Array<{ displayName?: string }>
    | undefined;
  if (geos?.length) {
    const names = geos.map((g) => g.displayName).filter(Boolean).slice(0, 5);
    if (names.length) parts.push(`Geo: ${names.join(", ")}${geos.length > 5 ? ` +${geos.length - 5} more` : ""}`);
  }

  // Device
  const devices = targeting["TARGETING_TYPE_DEVICE_TYPE"] as
    | Array<{ deviceType?: string }>
    | undefined;
  if (devices?.length) {
    const labels = devices
      .map((d) =>
        (d.deviceType ?? "")
          .replace("DEVICE_TYPE_", "")
          .replace(/_/g, " ")
      )
      .filter(Boolean);
    if (labels.length) parts.push(`Device: ${labels.join(", ")}`);
  }

  // Language
  const langs = targeting["TARGETING_TYPE_LANGUAGE"] as
    | Array<{ displayName?: string }>
    | undefined;
  if (langs?.length) {
    const names = langs.map((l) => l.displayName).filter(Boolean).slice(0, 3);
    if (names.length) parts.push(`Lang: ${names.join(", ")}`);
  }

  if (audienceType === "Unknown" && parts.length > 0) audienceType = "Custom";

  return {
    audienceType,
    targeting: parts.length > 0 ? parts.join(", ") : "Broad / no specific targeting",
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | PendingResponse | ErrorResponse>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } =
    req.body || {};

  if (!refreshToken || !advertiserId) {
    return res.status(400).json({ error: "Missing refreshToken or advertiserId" });
  }

  // ── Demo mode ──────────────────────────────────────────────────────────────
  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", rows: getDemoLineItems() });
  }

  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: "Missing clientId or clientSecret" });
  }

  // ── Live mode ──────────────────────────────────────────────────────────────
  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // Step 1: Bid Manager report for per-line-item delivery metrics
    const bmDims = ["FILTER_LINE_ITEM", "FILTER_INSERTION_ORDER", "FILTER_ADVERTISER_CURRENCY"];
    const bmMetrics = [
      "METRIC_IMPRESSIONS",
      "METRIC_CLICKS",
      "METRIC_REVENUE_ADVERTISER",
      "METRIC_TOTAL_CONVERSIONS",
      "METRIC_TRUEVIEW_VIEWS",
    ];

    const cacheKey = reportCacheKey({
      advertiserId, startDate, endDate,
      dim: bmDims.join("+"),
      rt: "STANDARD",
      metrics: bmMetrics,
      endpoint: "adsets",
    });

    let bmRows: Array<Record<string, string | number>>;
    const cached = reportCache.get(cacheKey);
    if (cached) {
      bmRows = cached;
    } else {
      let result: BMResult;
      const pendingIds = queryIdCache.get(cacheKey);
      if (pendingIds) {
        result = await client.resumeReport(pendingIds.queryId, pendingIds.reportId, 40_000);
      } else {
        result = await client.runBidManagerReport(
          { dimensions: bmDims, metrics: bmMetrics, startDate, endDate },
          40_000
        );
      }
      if (result.status === "pending") {
        queryIdCache.set(cacheKey, { queryId: result.queryId, reportId: result.reportId });
        return res.status(202).json({ status: "pending" });
      }
      reportCache.set(cacheKey, result.rows);
      bmRows = result.rows;
    }

    // Step 2: Fetch IO names + line item entity data for targeting enrichment
    const [insertionOrders, lineItemEntities] = await Promise.all([
      client.listInsertionOrders().catch(() => []),
      client.listLineItems().catch(() => []),
    ]);

    const ioNameMap = new Map<string, string>();
    for (const io of insertionOrders) {
      ioNameMap.set(io.insertionOrderId, io.displayName);
    }

    // Step 3: Fetch targeting for active line items (parallel, capped)
    const activeLiIds = new Set(
      lineItemEntities
        .filter((li) => li.entityStatus === "ENTITY_STATUS_ACTIVE")
        .map((li) => li.lineItemId)
    );
    // Only fetch targeting for LIs that appear in the BM report
    const bmLiIds = new Set<string>();
    for (const row of bmRows) {
      const keys = Object.keys(row);
      const liIdKey = keys.find((k) => /line item id/i.test(k));
      if (liIdKey) bmLiIds.add(String(row[liIdKey]));
    }
    const targetLiIds = [...bmLiIds].filter((id) => activeLiIds.has(id)).slice(0, 30);

    const targetingByLi = new Map<string, { audienceType: string; targeting: string }>();
    const CONCURRENCY = 6;
    for (let i = 0; i < targetLiIds.length; i += CONCURRENCY) {
      const batch = targetLiIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (liId) => {
          try {
            const t = await client.listLineItemAllTargeting(liId);
            return { liId, result: summariseTargeting(t) };
          } catch {
            return { liId, result: { audienceType: "Unknown", targeting: "Targeting info unavailable" } };
          }
        })
      );
      for (const { liId, result } of results) {
        targetingByLi.set(liId, result);
      }
    }

    // Step 4: Assemble rows
    const num = (row: Record<string, string | number>, k: string) => {
      const v = row[k];
      return typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
    };

    const resolveCol = (row: Record<string, string | number>, re: RegExp): string | undefined => {
      return Object.keys(row).find((k) => re.test(k));
    };

    const rows: DV360LineItemRow[] = bmRows
      .map((row) => {
        const liIdKey = resolveCol(row, /line item id/i);
        const liNameKey = resolveCol(row, /^line item$/i) || resolveCol(row, /line item(?! id)/i);
        const ioIdKey = resolveCol(row, /insertion order id/i);
        const ioNameBmKey = resolveCol(row, /^insertion order$/i) || resolveCol(row, /insertion order(?! id)/i);

        const liId = liIdKey ? String(row[liIdKey]) : "";
        const liName = liNameKey ? String(row[liNameKey]) : `Line Item ${liId}`;
        const ioId = ioIdKey ? String(row[ioIdKey]) : "";
        const ioName = ioNameBmKey ? String(row[ioNameBmKey]) : ioNameMap.get(ioId) ?? `IO ${ioId}`;

        if (!liId) return null;

        const spend = num(row, "Revenue (Adv Currency)");
        const impressions = num(row, "Impressions");
        const clicks = num(row, "Clicks");
        const conversions = num(row, "Total Conversions");
        const videoViews = num(row, "TrueView Views");
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        const tgt = targetingByLi.get(liId) ?? {
          audienceType: "Unknown",
          targeting: "Targeting details require DV360 API v4 entity access",
        };

        return {
          id: liId,
          name: liName,
          insertionOrderId: ioId,
          insertionOrderName: ioName,
          audienceType: tgt.audienceType,
          targeting: tgt.targeting,
          spend,
          impressions,
          clicks,
          conversions,
          cpm: Math.round(cpm * 100) / 100,
          ctr: Math.round(ctr * 100) / 100,
          videoViews,
        };
      })
      .filter((r): r is DV360LineItemRow => r !== null);

    return res.status(200).json({ source: "live", rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 adsets fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
