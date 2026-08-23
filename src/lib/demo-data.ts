/**
 * Demo data — every field from the requirements doc populated with realistic values.
 * Used when token starts with "demo-" or any real API call fails.
 */

import type { MetaPixelStats } from "./api-clients/meta";
import { computeCapiHealthScore, detectAnomalies } from "./api-clients/meta";

export function isDemoCredential(token: string | undefined | null): boolean {
  if (!token) return true;
  return token.startsWith("demo-") || token === "test123" || token.length < 20;
}

export function getDemoMetaAudit(pixelId: string): MetaPixelStats {
  const eventBreakdown = [
    {
      event: "PageView", count: 125000, browserCount: 80000, serverCount: 75000,
      dedupRate: 95, matchScore: 6.8, avgLatencyMs: 320, eventIdCoverage: 92, payloadCompleteness: 88,
      duplicateRate: 5, last24hCount: 17800, baseline7dAvg: 17900,
    },
    {
      event: "ViewContent", count: 95000, browserCount: 60000, serverCount: 58000,
      dedupRate: 92, matchScore: 6.2, avgLatencyMs: 380, eventIdCoverage: 88, payloadCompleteness: 85,
      duplicateRate: 8, last24hCount: 13500, baseline7dAvg: 13600,
    },
    {
      event: "AddToCart", count: 45000, browserCount: 28000, serverCount: 26000,
      dedupRate: 88, matchScore: 6.9, avgLatencyMs: 410, eventIdCoverage: 78, payloadCompleteness: 75,
      duplicateRate: 12, last24hCount: 6400, baseline7dAvg: 6500,
    },
    {
      event: "InitiateCheckout", count: 15000, browserCount: 9000, serverCount: 8500,
      dedupRate: 85, matchScore: 7.8, avgLatencyMs: 450, eventIdCoverage: 72, payloadCompleteness: 70,
      duplicateRate: 15, last24hCount: 1100, baseline7dAvg: 2140,    // drop anomaly
    },
    {
      event: "AddPaymentInfo", count: 11000, browserCount: 6500, serverCount: 6200,
      dedupRate: 82, matchScore: 7.2, avgLatencyMs: 480, eventIdCoverage: 65, payloadCompleteness: 60,
      duplicateRate: 18, last24hCount: 1570, baseline7dAvg: 1571,
    },
    {
      event: "Purchase", count: 8500, browserCount: 5200, serverCount: 5000,
      dedupRate: 90, matchScore: 8.4, avgLatencyMs: 360, eventIdCoverage: 95, payloadCompleteness: 92,
      duplicateRate: 6, last24hCount: 1200, baseline7dAvg: 1214,
    },
  ];

  const capiBreakdown = {
    deduplication: 88,
    eventIdConsistency: 81,
    payloadCompleteness: 78,
    authStatus: 95,
    avgServerLatencyMs: 400,
    apiFailureRate: 1.2,
  };

  return {
    pixelId,
    name: pixelId.includes("002") ? "Checkout Pixel" : "Main Pixel",
    status: "active",
    totalEvents: 299500,
    eventBreakdown,
    capi: {
      enabled: true,
      browserShare: 55,
      serverShare: 45,
      avgDedupRate: 88,
      lastServerEventTime: new Date(Date.now() - 4 * 60000).toISOString(),
      capiHealthScore: computeCapiHealthScore(capiBreakdown),
      capiBreakdown,
      authIssues: [
        { type: "token_expiry", message: "System User token expires in 14 days", severity: "warning" },
      ],
    },
    emq: {
      overallScore: 7.1,
      matchKeys: [
        { key: "em", coverage: 65, benchmark: 70 },
        { key: "ph", coverage: 45, benchmark: 70 },
        { key: "external_id", coverage: 78, benchmark: 80 },
        { key: "client_ip", coverage: 95, benchmark: 90 },
        { key: "client_user_agent", coverage: 98, benchmark: 90 },
        { key: "fbc", coverage: 62, benchmark: 70 },
        { key: "fbp", coverage: 88, benchmark: 85 },
      ],
      serverSideEnrichment: true,
    },
    diagnostics: {
      warnings: 3,
      errors: 1,
      lastUpdated: new Date().toISOString(),
      dataFreshnessMins: 4,
      issues: [
        { code: "MISSING_EVENT_ID", message: "12% of AddToCart events missing event_id", severity: "warning", affectedEvent: "AddToCart" },
        { code: "LOW_MATCH_SCORE", message: "AddPaymentInfo EMQ below benchmark (7.2 vs 8.5)", severity: "error", affectedEvent: "AddPaymentInfo" },
        { code: "PAYLOAD_INCOMPLETE", message: "InitiateCheckout missing value parameter on 30% of events", severity: "warning", affectedEvent: "InitiateCheckout" },
        { code: "BROWSER_ONLY", message: "Purchase event browser-only on 8% of conversions", severity: "warning", affectedEvent: "Purchase" },
      ],
      recentActivity: [
        { time: "2m ago", event: "Purchase", type: "server", status: "ok" },
        { time: "3m ago", event: "AddToCart", type: "browser", status: "ok" },
        { time: "3m ago", event: "InitiateCheckout", type: "server", status: "warning" },
        { time: "5m ago", event: "ViewContent", type: "browser", status: "ok" },
        { time: "8m ago", event: "PageView", type: "browser", status: "ok" },
      ],
    },
    eventManager: {
      automaticMatchingEnabled: true,
      automaticMatchingFields: ["em", "ph", "external_id", "fbc", "fbp"],
      dataUseSetting: "ADVERTISING",
      activeEventCount: 6,
    },
    anomalies: detectAnomalies(eventBreakdown),
    funnelIntegrity: {
      duplicatePurchases: 510,
      duplicatePurchaseRate: 6,
      sequencingIssues: [
        { event: "Purchase", issue: "8% of Purchase events fire without preceding AddPaymentInfo" },
      ],
      brokenAttributionChains: 240,
    },
    config: {
      createdAt: "2024-01-15T10:00:00Z",
      dataUseSetting: "ADVERTISING_AND_ANALYTICS",
      automaticMatchingEnabled: true,
      automaticMatchingFields: ["em", "ph", "fn", "ln", "ct", "st", "zp"],
      ownerBusiness: { id: "demo-business-001", name: "Demo Business" },
      isConsolidatedContainer: false,
      isUnavailable: false,
      lastFiredTime: new Date(Date.now() - 15 * 60000).toISOString(),
    },
  };
}

/**
 * Demo campaigns — used by the Naming Convention audit when credentials
 * don't have access to a real campaigns endpoint. Mix of well-formed and
 * intentionally broken names so the Pass/Fail/Fix workflow is exercisable
 * in demo mode.
 */
export function getDemoMetaCampaigns() {
  return [
    {
      id: "1001",
      name: "ThreeZinc >> Mova >> Awareness >> Meta >> Carousel >> Q2-Launch",
      objective: "Awareness",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-04-10T09:00:00Z",
      dailyBudget: 250,
      budgetLevel: "campaign" as const,
      spend: 5840,
      impressions: 412000,
      reach: 168000,
      videoViews: 124000,
      clicks: 6200,
      conversions: 142,
      conversionValue: 11360,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 88, conv7dClick: 131, conv1dView: 11,
      adSets: [
        { id: "as-101", name: "Carousel — 25-44 Broad", status: "ACTIVE", spend: 3200, impressions: 238000, clicks: 3600, reach: 98000, ads: [
          { id: "ad-1011", name: "Carousel_Mova_Serum_25-44", status: "ACTIVE", spend: 1800, impressions: 134000, clicks: 2100, reach: 56000 },
          { id: "ad-1012", name: "Carousel_Mova_Cream_25-44", status: "ACTIVE", spend: 1400, impressions: 104000, clicks: 1500, reach: 42000 },
        ] },
        { id: "as-102", name: "Carousel — Lookalike 1%", status: "ACTIVE", spend: 2640, impressions: 174000, clicks: 2600, reach: 70000, ads: [
          { id: "ad-1021", name: "Carousel_Mova_Serum_LAL1", status: "ACTIVE", spend: 1540, impressions: 98000, clicks: 1500, reach: 40000 },
          { id: "ad-1022", name: "Carousel_Mova_Cream_LAL1", status: "ACTIVE", spend: 1100, impressions: 76000, clicks: 1100, reach: 30000 },
        ] },
      ],
    },
    {
      id: "1002",
      name: "ThreeZinc >> Mova >> Sales >> Meta >> Video >> W1-Promo",
      objective: "Sales",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-04-15T09:00:00Z",
      dailyBudget: 400,
      budgetLevel: "adset" as const,
      spend: 11200,
      impressions: 285000,
      reach: 118000,
      videoViews: 142000,
      clicks: 9800,
      conversions: 312,
      conversionValue: 38900,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 198, conv7dClick: 289, conv1dView: 23,
      adSets: [
        { id: "as-201", name: "Video — Interest: Skincare", status: "ACTIVE", spend: 4800, impressions: 125000, clicks: 4200, reach: 52000, ads: [
          { id: "ad-2011", name: "Video_15s_Serum_Interest", status: "ACTIVE", spend: 2800, impressions: 72000, clicks: 2400, reach: 30000 },
          { id: "ad-2012", name: "Video_30s_FullRange_Interest", status: "ACTIVE", spend: 2000, impressions: 53000, clicks: 1800, reach: 22000 },
        ] },
        { id: "as-202", name: "Video — Retargeting 30d", status: "ACTIVE", spend: 3600, impressions: 92000, clicks: 3200, reach: 38000, ads: [
          { id: "ad-2021", name: "Video_15s_Serum_Retarget", status: "ACTIVE", spend: 2100, impressions: 54000, clicks: 1900, reach: 22000 },
          { id: "ad-2022", name: "Video_30s_FullRange_Retarget", status: "ACTIVE", spend: 1500, impressions: 38000, clicks: 1300, reach: 16000 },
        ] },
        { id: "as-203", name: "Video — Custom Audience", status: "ACTIVE", spend: 2800, impressions: 68000, clicks: 2400, reach: 28000, ads: [] },
      ],
    },
    {
      id: "1003",
      name: "summer_sale_promo",
      objective: "Sales",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-04-20T09:00:00Z",
      dailyBudget: 150,
      budgetLevel: "adset" as const,
      spend: 4350,
      impressions: 98000,
      reach: 44000,
      videoViews: 8200,
      clicks: 2100,
      conversions: 38,
      conversionValue: 4180,
      currency: "USD",
      effectiveAttribution: "1d_click",
      conv1dClick: 38, conv7dClick: 38, conv1dView: 0,
    },
    {
      id: "1004",
      name: "test_campaign_v2",
      objective: "Traffic",
      status: "PAUSED",
      platform: "meta" as const,
      createdTime: "2026-04-25T09:00:00Z",
      dailyBudget: 50,
      budgetLevel: "campaign" as const,
      spend: 320,
      impressions: 12000,
      reach: 6100,
      videoViews: 1500,
      clicks: 380,
      conversions: 4,
      conversionValue: 80,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 2, conv7dClick: 4, conv1dView: 0,
    },
    {
      id: "1005",
      name: "EcomAgency >> Mova >> Engagement >> Meta >> Stories >> May-Burst",
      objective: "Engagement",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-05-01T09:00:00Z",
      dailyBudget: 200,
      budgetLevel: "adset" as const,
      spend: 4100,
      impressions: 156000,
      reach: 62000,
      videoViews: 78000,
      clicks: 4800,
      conversions: 65,
      conversionValue: 7200,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 41, conv7dClick: 60, conv1dView: 5,
    },
    {
      id: "1006",
      name: "BlackFriday",
      objective: "Conversions",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-05-05T09:00:00Z",
      dailyBudget: 600,
      budgetLevel: "campaign" as const,
      spend: 18900,
      impressions: 380000,
      reach: 152000,
      videoViews: 45000,
      clicks: 12400,
      conversions: 410,
      conversionValue: 82000,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 254, conv7dClick: 381, conv1dView: 29,
    },
    {
      id: "1007",
      name: "ThreeZinc >> Mova >> Lead Generation >> Meta >> Static >> Mid-Funnel",
      objective: "Lead Generation",
      status: "ACTIVE",
      platform: "meta" as const,
      createdTime: "2026-05-10T09:00:00Z",
      dailyBudget: 180,
      budgetLevel: "campaign" as const,
      spend: 3240,
      impressions: 87000,
      reach: 39000,
      videoViews: 12000,
      clicks: 2900,
      conversions: 91,
      conversionValue: 6370,
      currency: "USD",
      effectiveAttribution: "7d_click + 1d_view",
      conv1dClick: 58, conv7dClick: 84, conv1dView: 7,
    },
  ];
}


// ─── DV360 demo data ─────────────────────────────────────────────────────────
// Campaign → Insertion Order → Line Item hierarchy mapped into CampaignData's
// nesting slots (adSets = insertion orders, adSets[].ads = line items).
// Metrics sum correctly up the tree so drill rollups verify.

export function getDemoDV360Campaigns() {
  const aga = (id: string, name: string) => ({ id, name, status: "ENTITY_STATUS_ACTIVE" });
  const ag = (id: string, name: string, fmt: string, ads: ReturnType<typeof aga>[]) => ({
    id, name, status: "ENTITY_STATUS_ACTIVE", format: fmt, ads: ads.length ? ads : undefined,
  });
  type BidStrategyDef = { type: "fixed" | "maximize_spend" | "performance_goal"; label: string; targetAmount?: number; goalType?: string };
  const li = (id: string, name: string, type: string, spend: number, imp: number, clicks: number,
    opts?: { adGroups?: ReturnType<typeof ag>[]; conversions?: number; bidStrategy?: BidStrategyDef; updateTime?: string; liFlightStart?: string; liFlightEnd?: string }) => {
    const short = name.replace(/^LI — /, "");
    return {
      id, name, status: "ENTITY_STATUS_ACTIVE", lineItemType: type,
      spend, impressions: imp, clicks, reach: Math.round(imp * 0.42),
      conversions: opts?.conversions ?? 0,
      adGroups: opts?.adGroups?.length ? opts.adGroups : undefined,
      dv360BidStrategy: opts?.bidStrategy,
      updateTime: opts?.updateTime,
      liFlightStart: opts?.liFlightStart,
      liFlightEnd: opts?.liFlightEnd,
      creatives: [
        { id: `${id}-cr1`, name: `${short} — 300x250`, impressions: Math.round(imp * 0.58), clicks: Math.round(clicks * 0.6), spend: Math.round(spend * 0.58) },
        { id: `${id}-cr2`, name: `${short} — 728x90`,  impressions: Math.round(imp * 0.42), clicks: Math.round(clicks * 0.4), spend: Math.round(spend * 0.42) },
      ],
    };
  };
  const io = (id: string, name: string, lis: ReturnType<typeof li>[]) => ({
    id, name, status: "ENTITY_STATUS_ACTIVE",
    spend: lis.reduce((s, l) => s + l.spend, 0),
    impressions: lis.reduce((s, l) => s + l.impressions, 0),
    clicks: lis.reduce((s, l) => s + l.clicks, 0),
    reach: Math.round(lis.reduce((s, l) => s + l.impressions, 0) * 0.4),
    ads: lis,
  });

  const mk = (
    id: string, name: string, objective: string, status: string,
    ios: ReturnType<typeof io>[], conversions: number, conversionValue: number, videoViews: number
  ) => ({
    id, name, objective, status,
    platform: "dv360" as const,
    createdTime: "2026-05-05T09:00:00Z",
    spend: ios.reduce((s, x) => s + x.spend, 0),
    impressions: ios.reduce((s, x) => s + x.impressions, 0),
    clicks: ios.reduce((s, x) => s + x.clicks, 0),
    reach: Math.round(ios.reduce((s, x) => s + x.impressions, 0) * 0.38),
    // Demo IO budget = ~25% headroom over spend (flight total) so the
    // "Budget (setting)" column renders in demo mode too.
    lifetimeBudget: Math.round((ios.reduce((s, x) => s + x.spend, 0) * 1.25) / 100) * 100,
    // All-time delivery ≈ 2.4× the window slice, so recommendations have full
    // history to reason over even in demo mode.
    allTimeSpend: Math.round(ios.reduce((s, x) => s + x.spend, 0) * 2.4),
    allTimeImpressions: Math.round(ios.reduce((s, x) => s + x.impressions, 0) * 2.4),
    allTimeClicks: Math.round(ios.reduce((s, x) => s + x.clicks, 0) * 2.4),
    allTimeConversions: Math.round(conversions * 2.4),
    conversions, conversionValue, videoViews,
    currency: "INR",
    adSets: ios,
  });

  return [
    mk("dv-3001", "GW_Brand_Awareness_CTV_Jun'26", "Brand awareness", "ENTITY_STATUS_ACTIVE", [
      io("dvio-1a", "IO — CTV India Metros", [
        li("dvli-1a1", "LI — YouTube CTV 18-44", "LINE_ITEM_TYPE_YOUTUBE_AND_PARTNERS_VIDEO_SEQUENCE", 92000, 3_800_000, 4100, {
          adGroups: [
            ag("dvag-1a1a", "AG — In-Stream Skippable", "AD_GROUP_FORMAT_IN_STREAM", [
              aga("dvaga-1", "Ad — Brand Film 30s"),
              aga("dvaga-2", "Ad — Product Hero 15s"),
            ]),
            ag("dvag-1a1b", "AG — Bumper 6s", "AD_GROUP_FORMAT_BUMPER", [
              aga("dvaga-3", "Ad — Bumper Skincare"),
            ]),
          ],
          // Maximize Spend — brand awareness, CPM-capped. Uses automated bidding.
          bidStrategy: { type: "maximize_spend", label: "Maximize Spend", targetAmount: 85, goalType: "PERFORMANCE_GOAL_TYPE_CPM" },
          conversions: 0,
          updateTime: "2026-06-01T08:00:00Z",
          liFlightStart: "2026-06-01", liFlightEnd: "2026-06-30",
        }),
        li("dvli-1a2", "LI — Video Open Auction 1080p", "LINE_ITEM_TYPE_VIDEO_DEFAULT", 64000, 2_600_000, 3600, {
          adGroups: [
            ag("dvag-1a2a", "AG — Video Pre-Roll", "AD_GROUP_FORMAT_IN_STREAM", [
              aga("dvaga-4", "Ad — Awareness 20s"),
              aga("dvaga-5", "Ad — Testimonial 15s"),
            ]),
          ],
          bidStrategy: { type: "fixed", label: "Fixed Bid", targetAmount: 45 },
          conversions: 0,
          updateTime: "2026-06-01T08:00:00Z",
          liFlightStart: "2026-06-01", liFlightEnd: "2026-06-30",
        }),
      ]),
      io("dvio-1b", "IO — Audio + Display Support", [
        li("dvli-1b1", "LI — Audio Streaming 15s", "LINE_ITEM_TYPE_AUDIO_DEFAULT", 21000, 900_000, 700, {
          bidStrategy: { type: "fixed", label: "Fixed Bid", targetAmount: 30 },
          conversions: 0,
          updateTime: "2026-06-01T08:00:00Z",
          liFlightStart: "2026-06-01", liFlightEnd: "2026-06-30",
        }),
        li("dvli-1b2", "LI — Display Rich Media", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 18000, 1_450_000, 5200, {
          adGroups: [
            ag("dvag-1b2a", "AG — Rich Media 300x250", "AD_GROUP_FORMAT_NON_SKIPPABLE_IN_STREAM", [
              aga("dvaga-6", "Ad — Interactive Expandable"),
              aga("dvaga-7", "Ad — Standard Banner"),
            ]),
          ],
          bidStrategy: { type: "fixed", label: "Fixed Bid", targetAmount: 22 },
          conversions: 0,
          updateTime: "2026-06-01T08:00:00Z",
          liFlightStart: "2026-06-01", liFlightEnd: "2026-06-30",
        }),
      ]),
    ], 310, 96000, 1_240_000),
    mk("dv-3002", "GW_Perf_Prospecting_Display_Jun'26", "Conversions", "ENTITY_STATUS_ACTIVE", [
      io("dvio-2a", "IO — Prospecting In-Market", [
        // Target CPA — optimizing, hit 50+ conversions
        li("dvli-2a1", "LI — In-Market Beauty", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 42000, 2_050_000, 9800, {
          bidStrategy: { type: "performance_goal", label: "Target CPA", targetAmount: 780, goalType: "PERFORMANCE_GOAL_TYPE_CPA" },
          conversions: 68,
          updateTime: "2026-05-20T10:30:00Z",
          liFlightStart: "2026-05-01", liFlightEnd: "2026-07-31",
        }),
        // Target CPA — limited, only 22 conversions in 30d window
        li("dvli-2a2", "LI — Affinity Skincare", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 31000, 1_600_000, 6200, {
          bidStrategy: { type: "performance_goal", label: "Target CPA", targetAmount: 900, goalType: "PERFORMANCE_GOAL_TYPE_CPA" },
          conversions: 22,
          updateTime: "2026-06-10T09:00:00Z",
          liFlightStart: "2026-05-01", liFlightEnd: "2026-07-31",
        }),
        // Target ROAS — new line item, still warming up
        li("dvli-2a3", "LI — Similar Audiences", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 26000, 1_200_000, 5400, {
          bidStrategy: { type: "performance_goal", label: "Target ROAS", targetAmount: 3.5, goalType: "PERFORMANCE_GOAL_TYPE_ROAS" },
          conversions: 11,
          updateTime: "2026-07-05T11:00:00Z",
          liFlightStart: "2026-07-05", liFlightEnd: "2026-08-31",
        }),
      ]),
    ], 540, 410000, 0),
    mk("dv-3003", "GW_Retargeting_DPA_Jun'26", "Conversions", "ENTITY_STATUS_ACTIVE", [
      io("dvio-3a", "IO — Site Visitors 30d", [
        // Target CPA — optimizing
        li("dvli-3a1", "LI — Cart Abandoners Dynamic", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 28000, 820_000, 7100, {
          bidStrategy: { type: "performance_goal", label: "Target CPA", targetAmount: 550, goalType: "PERFORMANCE_GOAL_TYPE_CPA" },
          conversions: 87,
          updateTime: "2026-05-15T08:00:00Z",
          liFlightStart: "2026-05-01", liFlightEnd: "2026-07-31",
        }),
        li("dvli-3a2", "LI — Product Viewers Dynamic", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 19000, 640_000, 4800, {
          bidStrategy: { type: "performance_goal", label: "Target CPA", targetAmount: 650, goalType: "PERFORMANCE_GOAL_TYPE_CPA" },
          conversions: 55,
          updateTime: "2026-05-15T08:00:00Z",
          liFlightStart: "2026-05-01", liFlightEnd: "2026-07-31",
        }),
      ]),
    ], 620, 520000, 0),
    mk("dv-3004", "GW_Video_Reach_Festive_Teaser", "Brand awareness", "ENTITY_STATUS_PAUSED", [
      io("dvio-4a", "IO — Festive Teaser Wave 1", [
        li("dvli-4a1", "LI — Video 6s Bumpers", "LINE_ITEM_TYPE_VIDEO_DEFAULT", 15000, 1_900_000, 900, {
          bidStrategy: { type: "fixed", label: "Fixed Bid", targetAmount: 18 },
          conversions: 0,
          liFlightStart: "2026-04-01", liFlightEnd: "2026-04-30",
        }),
      ]),
    ], 20, 4000, 860_000),
    mk("dv-3005", "GW_AlwaysOn_Display_Traffic", "Clicks", "ENTITY_STATUS_ACTIVE", [
      io("dvio-5a", "IO — Always-On Display", [
        li("dvli-5a1", "LI — Standard Display 300x250", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 12000, 1_150_000, 8600, {
          bidStrategy: { type: "maximize_spend", label: "Maximize Spend", goalType: "PERFORMANCE_GOAL_TYPE_CPC" },
          conversions: 8,
          updateTime: "2026-07-10T10:00:00Z",
          liFlightStart: "2026-07-01", liFlightEnd: "2026-09-30",
        }),
        li("dvli-5a2", "LI — Native Content Feed", "LINE_ITEM_TYPE_DISPLAY_DEFAULT", 9800, 760_000, 5900, {
          bidStrategy: { type: "maximize_spend", label: "Maximize Spend", goalType: "PERFORMANCE_GOAL_TYPE_CPC" },
          conversions: 6,
          updateTime: "2026-07-10T10:00:00Z",
          liFlightStart: "2026-07-01", liFlightEnd: "2026-09-30",
        }),
      ]),
    ], 95, 31000, 0),
  ];
}

export function getDemoDV360Breakdown(dimension: string) {
  const mk = (label: string, spend: number, imp: number, clicks: number, conv: number, val: number, vv = 0) =>
    ({ label, breakdownValues: { [dimension]: label }, spend, impressions: imp, clicks, conversions: conv, conversionValue: val, videoViews: vv });
  switch (dimension) {
    case "age":
      return [
        mk("18-24", 52000, 2_400_000, 9800, 210, 138000),
        mk("25-34", 118000, 4_900_000, 22400, 585, 428000),
        mk("35-44", 86000, 3_300_000, 14100, 388, 289000),
        mk("45-54", 51000, 1_900_000, 7300, 195, 141000),
        mk("55-64", 39000, 1_300_000, 4100, 130, 92000),
        mk("65+", 31800, 1_020_000, 2900, 77, 53000),
      ];
    case "gender":
      return [
        mk("Female", 208000, 8_400_000, 36800, 940, 690000),
        mk("Male", 152000, 5_900_000, 22100, 590, 421000),
        mk("Unknown", 17800, 520_000, 1700, 55, 30000),
      ];
    case "age,gender":
      return [
        mk("18-24 · Female", 31000, 1_400_000, 5900, 128, 84000),
        mk("18-24 · Male",   21000, 1_000_000, 3900,  82, 54000),
        mk("25-34 · Female", 71000, 2_950_000, 13600, 356, 261000),
        mk("25-34 · Male",   47000, 1_950_000,  8800, 229, 167000),
        mk("35-44 · Female", 52000, 2_000_000,  8600, 236, 176000),
        mk("35-44 · Male",   34000, 1_300_000,  5500, 152, 113000),
        mk("45-54 · Female", 30000, 1_120_000,  4300, 115,  83000),
        mk("45-54 · Male",   21000,   780_000,  3000,  80,  58000),
        mk("55-64 · Female", 23000,   770_000,  2400,  77,  54000),
        mk("55-64 · Male",   16000,   530_000,  1700,  53,  38000),
      ];
    case "country":
      return [
        mk("India", 289000, 11_600_000, 48200, 1240, 905000),
        mk("United Arab Emirates", 41000, 1_500_000, 6100, 170, 128000),
        mk("Singapore", 24000, 830_000, 3300, 92, 64000),
        mk("United Kingdom", 15800, 540_000, 2100, 58, 32000),
        mk("United States", 8000, 350_000, 900, 25, 12000),
      ];
    case "region":
      return [
        mk("Maharashtra", 92000, 3_700_000, 15400, 396, 289000),
        mk("Karnataka",   68000, 2_720_000, 11300, 291, 213000),
        mk("Delhi",       54000, 2_160_000,  9000, 231, 169000),
        mk("Tamil Nadu",  41000, 1_640_000,  6800, 175, 128000),
        mk("Telangana",   29000, 1_160_000,  4800, 124,  90000),
        mk("West Bengal", 18000,   720_000,  3000,  77,  56000),
        mk("Gujarat",     14000,   560_000,  2330,  60,  44000),
      ];
    case "city":
    case "region,city": {
      // region · city with per-dimension breakdownValues so the geo drilldown
      // can nest cities under their region.
      const city = (region: string, cityName: string, spend: number, imp: number, clicks: number, conv: number, val: number) => ({
        label: `${region} · ${cityName}`,
        breakdownValues: { region, city: cityName, "region,city": `${region} · ${cityName}` },
        spend, impressions: imp, clicks, conversions: conv, conversionValue: val,
      });
      return [
        city("Maharashtra", "Mumbai",     48000, 1_920_000, 8000, 206, 150000),
        city("Maharashtra", "Pune",       27000, 1_080_000, 4500, 116,  85000),
        city("Karnataka",   "Bengaluru",  44000, 1_760_000, 7300, 189, 138000),
        city("Karnataka",   "Mysuru",     10000,   400_000, 1660,  43,  31000),
        city("Delhi",       "New Delhi",  39000, 1_560_000, 6500, 167, 122000),
        city("Telangana",   "Hyderabad",  24000,   960_000, 4000, 103,  75000),
        city("Tamil Nadu",  "Chennai",    22000,   880_000, 3670,  94,  69000),
        city("West Bengal", "Kolkata",    15000,   600_000, 2500,  64,  47000),
        city("Gujarat",     "Ahmedabad",  11000,   440_000, 1830,  47,  34000),
      ];
    }
    case "zip":
      return [
        mk("400001", 12000, 480_000, 2000, 52, 38000),
        mk("560001", 11000, 440_000, 1830, 47, 34000),
        mk("110001",  9500, 380_000, 1580, 41, 30000),
        mk("500081",  7800, 312_000, 1300, 34, 24500),
        mk("600002",  6400, 256_000, 1070, 27, 20000),
        mk("411001",  5200, 208_000,  870, 22, 16000),
      ];
    case "language":
      return [
        mk("English", 198000, 7_900_000, 33800, 890, 640000),
        mk("Hindi",   96000, 3_840_000, 15900, 410, 300000),
        mk("Telugu",  38000, 1_520_000,  6300, 165, 120000),
        mk("Tamil",   24000,   960_000,  4000, 104,  76000),
        mk("Kannada", 15000,   600_000,  2500,  64,  47000),
        mk("Marathi", 11000,   440_000,  1830,  47,  34000),
      ];
    case "device":
      return [
        mk("Smart Phone", 218000, 9_100_000, 41800, 1010, 742000),
        mk("Connected TV", 92000, 3_400_000, 1900, 105, 74000),
        mk("Desktop", 48000, 1_700_000, 13200, 390, 285000),
        mk("Tablet", 19800, 620_000, 3700, 80, 40000),
      ];
    case "daily": {
      // 30-day deterministic wave, same shape as the Meta daily demo.
      const out: ReturnType<typeof mk>[] = [];
      const today = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const label = d.toISOString().slice(0, 10);
        const wave = 1 + 0.45 * Math.sin(i / 4.5) + (i % 7 === 0 ? 0.35 : 0);
        const spend = Math.round(9800 * wave);
        const imp = Math.round(410_000 * wave);
        const clicks = Math.round(1750 * wave);
        const conv = Math.round(48 * wave);
        out.push(mk(label, spend, imp, clicks, conv, conv * 720));
      }
      return out;
    }
    case "exchange":
      return [
        mk("Google Ad Manager",  142000, 5_800_000, 24800, 640, 468000),
        mk("YouTube & partners", 108000, 4_200_000, 11200, 310, 226000),
        mk("OpenX",               42000, 1_700_000,  7100, 185, 135000),
        mk("PubMatic",            38000, 1_520_000,  6300, 165, 120000),
        mk("Magnite DV+",         24000,   960_000,  4000, 104,  76000),
        mk("BidSwitch",           15000,   600_000,  2500,  64,  47000),
        mk("Equativ",              9000,   360_000,  1500,  39,  28000),
      ];
    case "creative_type":
      return [
        mk("Display",   168000, 6_900_000, 32400, 820, 600000),
        mk("Video",     142000, 5_200_000, 14600, 420, 308000, 1_820_000),
        mk("Audio",      32000, 1_280_000,  3400,  92,  67000, 448_000),
        mk("Rich Media", 24000,   960_000,  7200, 195, 142000),
        mk("Native",     12000,   480_000,  3000,  58,  42000),
      ];
    default:
      return [];
  }
}

export function getDemoFloodlight() {
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  // 14-day trend arrays: [oldest … newest]
  const trend = (base: number, slope: number, noiseSeed = 1) =>
    Array.from({ length: 14 }, (_, i) =>
      Math.max(0, Math.round(base + slope * i + Math.sin((i + noiseSeed) * 1.7) * base * 0.12))
    );

  const activities = [
    {
      id: "fl-9001", name: "Purchase — Thank You Page", type: "TRANSACTIONS", countingMethod: "TRANSACTIONS_COUNTING",
      clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: trend(46, 0.6), revenue14d: trend(33000, 420, 2),
    },
    {
      id: "fl-9002", name: "Add To Cart", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: trend(210, 1.4, 3), revenue14d: trend(0, 0),
    },
    {
      id: "fl-9003", name: "Lead Form Submit", type: "STANDARD", countingMethod: "UNIQUE_COUNTING",
      clickLookbackDays: 14, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: trend(38, -1.9, 4), revenue14d: trend(0, 0), // declining
    },
    {
      id: "fl-9004", name: "Newsletter Signup", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: trend(24, 0.3, 5), revenue14d: trend(0, 0),
    },
    {
      id: "fl-9005", name: "App Install (legacy)", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 90, viewLookbackDays: 14, servingStatus: "ENABLED",
      conversions14d: Array(14).fill(0), revenue14d: Array(14).fill(0), // zero — likely dead tag
    },
    {
      id: "fl-9006", name: "Store Locator View", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 7, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: Array(14).fill(0), revenue14d: Array(14).fill(0), // zero — unmapped
    },
    {
      id: "fl-9007", name: "Old Promo Landing (2024)", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "DISABLED",
      conversions14d: Array(14).fill(0), revenue14d: Array(14).fill(0), // inactive
    },
    {
      id: "fl-9008", name: "Begin Checkout", type: "STANDARD", countingMethod: "STANDARD_COUNTING",
      clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED",
      conversions14d: trend(96, 0.9, 6), revenue14d: trend(0, 0),
    },
  ];

  return {
    group: { id: "fg-555001", name: "GW Floodlight Group" },
    windowStart: day(13),
    windowEnd: day(0),
    activities,
  };
}

export function getDemoDV360FrequencyBurden(startDate: string, endDate: string) {
  const monthLabel = (offset: number) => {
    const d = new Date(`${endDate}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - offset);
    return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const spanMonths = Math.max(1, Math.min(6, Math.round((end.getTime() - start.getTime()) / (30 * 86_400_000)) + 1));

  const monthly = Array.from({ length: spanMonths }, (_, i) => {
    const idx = spanMonths - 1 - i;
    return {
      month: monthLabel(idx),
      partial: false,
      reach: Math.round(38_000 + Math.sin(i * 1.3) * 6_000 + i * 1_500),
      frequency: Number((3.1 + Math.sin(i * 0.9) * 0.6 + i * 0.08).toFixed(1)),
    };
  });

  const crossCampaignReach = Math.round(monthly.reduce((s, m) => s + m.reach, 0) * 0.62); // dedup across months, not a plain sum
  const crossCampaignFrequency = Number((monthly.reduce((s, m) => s + m.frequency, 0) / monthly.length + 1.4).toFixed(1));

  return {
    source: "demo",
    crossCampaign: { reach: crossCampaignReach, frequency: crossCampaignFrequency },
    crossCampaignPending: false,
    monthly,
    monthlyPending: false,
    notes: [] as string[],
  };
}
