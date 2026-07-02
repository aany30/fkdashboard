/**
 * Demo data — every field from the requirements doc populated with realistic values.
 * Used when token starts with "demo-" or any real API call fails.
 */

import type { MetaPixelStats } from "./api-clients/meta";
import { computeCapiHealthScore, detectAnomalies } from "./api-clients/meta";
import type { GoogleAuditResult } from "./api-clients/google";

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

export function getDemoGA4(): GoogleAuditResult["ga4"] {
  return {
    propertyId: "GA4-DEMO-001",
    totalEvents: 412000,
    eventBreakdown: [
      { event: "page_view", count: 130000, users: 45000 },
      { event: "view_item", count: 95000, users: 38000 },
      { event: "add_to_cart", count: 42000, users: 18000 },
      { event: "begin_checkout", count: 14200, users: 8500 },
      { event: "purchase", count: 8500, users: 7800 },
      { event: "newsletter_signup", count: 3200, users: 2900 },
      { event: "video_play", count: 12000, users: 6500 },
    ],
    ecommerceConfigured: true,
    conversionEvents: ["purchase", "begin_checkout"],
    customEventsCount: 2,
    utm: { consistencyScore: 72, missingSources: 4, inconsistentCampaigns: 8 },
    crossDomainTracking: { enabled: true, configuredDomains: ["shop.demo.com", "checkout.demo.com"], brokenLinks: 1 },
    referralExclusions: {
      configured: ["paypal.com"],
      missingPaymentGateways: ["stripe.com", "razorpay.com"],
    },
    consentMode: { v2Enabled: false, adUserDataSet: false, adPersonalizationSet: false },
    dataRetention: "14 months",
    source: "demo",
  };
}

export function getDemoGoogleAds(): GoogleAuditResult["ads"] {
  return {
    customerId: "123-456-7890",
    customerName: "Demo Advertiser",
    currency: "USD",
    timezone: "America/Los_Angeles",
    conversions: 8500,
    conversionValue: 425000,
    conversionActions: [
      { name: "Purchase", type: "WEBPAGE", status: "ENABLED", countingType: "ONE_PER_CLICK", category: "PRIMARY", enhancedConversionsEnabled: true, includeInConversions: true, missingValue: false },
      { name: "Lead Submit", type: "WEBPAGE", status: "ENABLED", countingType: "EVERY", category: "PRIMARY", enhancedConversionsEnabled: false, includeInConversions: true, missingValue: true },
      { name: "Add to Cart", type: "WEBPAGE", status: "ENABLED", countingType: "EVERY", category: "SECONDARY", enhancedConversionsEnabled: false, includeInConversions: false, missingValue: false },
      { name: "Newsletter Signup", type: "WEBPAGE", status: "ENABLED", countingType: "ONE_PER_CLICK", category: "SECONDARY", enhancedConversionsEnabled: false, includeInConversions: false, missingValue: false },
      { name: "Old Lead Action", type: "WEBPAGE", status: "REMOVED", countingType: "EVERY", category: "PRIMARY", enhancedConversionsEnabled: false, includeInConversions: true, missingValue: false, duplicateConversionCount: 120 },
    ],
    duplicateConversions: 120,
    missingConversionTags: ["AddPaymentInfo"],
    enhancedConversions: {
      enabled: true,
      emailMatchRate: 65,
      phoneMatchRate: 45,
      overallMatchRate: 73,
      consentCompatible: false,
    },
    attributionModel: "last-click",
    source: "demo",
  };
}

export function getDemoGTM(): GoogleAuditResult["gtm"] {
  return {
    containerId: "GTM-DEMO",
    accountId: "demo-account-001",
    containerName: "Main Website Container",
    usageContext: ["web"],
    totalTags: 45,
    activeTags: 41,
    brokenTags: 1,
    duplicateTags: 1,
    unusedTags: 3,
    missingVariables: 2,
    triggerConflicts: 1,
    jsErrors: [
      { tag: "Custom HTML — Newsletter Modal", message: "Uncaught ReferenceError: dataLayer is not defined", severity: "error" },
      { tag: "Custom HTML — A/B Test", message: "Tag fires after DOMContentLoaded — may miss early events", severity: "warning" },
    ],
    builtInTagsByType: {
      gaawe: 15,
      googtag: 8,
      ua: 5,
      img: 7,
      html: 10,
    },
    triggers: {
      total: 22,
      types: { pageview: 4, click: 6, formSubmission: 3, customEvent: 9 },
    },
    publishedVersion: "v47",
    lastPublished: new Date().toISOString(),
    source: "demo",
  };
}

export function getDemoGoogleAudit(): GoogleAuditResult {
  return {
    ga4: getDemoGA4(),
    ads: getDemoGoogleAds(),
    gtm: getDemoGTM(),
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

export function getDemoGoogleCampaigns() {
  return [
    {
      id: "2001",
      name: "ThreeZinc >> DV360 >> Sales >> Google SEM >> RSA >> Brand-Defense",
      objective: "Sales",
      status: "ENABLED",
      platform: "google" as const,
      createdTime: "2026-04-08T09:00:00Z",
      dailyBudget: 350,
      spend: 9100,
      impressions: 245000,
      clicks: 8200,
      conversions: 285,
      conversionValue: 42750,
      impressionShare: 78,
      currency: "USD",
    },
    {
      id: "2002",
      name: "winter_2024",
      objective: "Traffic",
      status: "ENABLED",
      platform: "google" as const,
      createdTime: "2026-04-12T09:00:00Z",
      dailyBudget: 100,
      spend: 2400,
      impressions: 64000,
      clicks: 1800,
      conversions: 22,
      conversionValue: 1100,
      impressionShare: 42,
      currency: "USD",
    },
    {
      id: "2003",
      name: "ThreeZinc >> Mova >> Awareness >> Google SEM >> Video >> YouTube-Prelaunch",
      objective: "Awareness",
      status: "ENABLED",
      platform: "google" as const,
      createdTime: "2026-04-18T09:00:00Z",
      dailyBudget: 220,
      spend: 5060,
      impressions: 720000,
      clicks: 3400,
      conversions: 48,
      conversionValue: 2400,
      impressionShare: 56,
      currency: "USD",
    },
    {
      id: "2004",
      name: "pmax-new",
      objective: "Sales",
      status: "ENABLED",
      platform: "google" as const,
      createdTime: "2026-04-22T09:00:00Z",
      dailyBudget: 500,
      spend: 12800,
      impressions: 312000,
      clicks: 10500,
      conversions: 376,
      conversionValue: 56400,
      impressionShare: 65,
      currency: "USD",
    },
    {
      id: "2005",
      name: "EcomAgency >> Mova >> Conversions >> Google SEM >> Static >> Q2-Performance",
      objective: "Conversions",
      status: "ENABLED",
      platform: "google" as const,
      createdTime: "2026-05-02T09:00:00Z",
      dailyBudget: 300,
      spend: 7200,
      impressions: 168000,
      clicks: 5900,
      conversions: 198,
      conversionValue: 23760,
      impressionShare: 71,
      currency: "USD",
    },
  ];
}
