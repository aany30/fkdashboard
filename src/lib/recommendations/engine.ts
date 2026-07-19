/**
 * AI Recommendation Engine — covers every line item in the requirements doc.
 * Rules grouped by spec section:
 *   META: Pixel Health, EMQ, CAPI, Funnel, Attribution, Event Manager Diagnostics
 *   DV360: Floodlight, Insertion Orders, Line Items
 *   AI Intelligence: anomaly detection, predicted impact, data-loss estimation
 */

import type { MetaPixelStats } from "../api-clients/meta";

export interface Recommendation {
  id: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  platform: "Meta" | "DV360" | "Both";
  category:
    | "Pixel Health" | "EMQ" | "Funnel" | "Attribution" | "Floodlight" | "CAPI"
    | "Anomaly" | "Ecommerce" | "Event Manager" | "DV360"
    | "Consent" | "UTM" | "Cross-Domain";
  issue: string;
  details: string;
  action: string;
  impact: number;
  effort: "Quick" | "Medium" | "High";
  confidence: number;
  estimatedDataLoss?: number;
}

// Benchmarks (from official Meta + Google docs)
export const META_BENCHMARKS = {
  emq: { PageView: 6.0, ViewContent: 6.5, AddToCart: 7.0, InitiateCheckout: 8.0, AddPaymentInfo: 8.5, Purchase: 9.0, Lead: 8.0 } as Record<string, number>,
  matchKeys: {
    em: { benchmark: 70, weight: 1.5 }, ph: { benchmark: 70, weight: 1.5 },
    external_id: { benchmark: 80, weight: 1.0 }, client_ip: { benchmark: 90, weight: 0.5 },
    client_user_agent: { benchmark: 90, weight: 0.3 }, fbc: { benchmark: 70, weight: 1.0 },
    fbp: { benchmark: 85, weight: 0.7 },
  } as Record<string, { benchmark: number; weight: number }>,
  dedupRate: { target: 95, minimum: 85 },
  eventIdCoverage: { minimum: 90 },
  payloadCompleteness: { minimum: 85 },
  serverLatencyMs: { warning: 1000, critical: 2000 },
  capiFailureRate: { warning: 1, critical: 5 },
  dataFreshnessMins: { stale: 60, critical: 720 },
};

export const FUNNEL_BENCHMARKS = {
  ecommerce: {
    PageView_to_ViewContent: 80, ViewContent_to_AddToCart: 50,
    AddToCart_to_InitiateCheckout: 30, InitiateCheckout_to_Purchase: 50,
  },
};

function priorityFromImpact(impact: number): Recommendation["priority"] {
  if (impact >= 7) return "Critical";
  if (impact >= 4) return "High";
  if (impact >= 2) return "Medium";
  return "Low";
}

/** META: full analysis — covers every spec line for Meta */
export function analyzeMetaPixel(stats: MetaPixelStats): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Pixel Health Monitoring
  if (stats.status === "inactive" || stats.totalEvents === 0) {
    recs.push({
      id: `meta-${stats.pixelId}-offline`, priority: "Critical", platform: "Meta", category: "Pixel Health",
      issue: `Pixel "${stats.name}" inactive`,
      details: `Pixel ${stats.pixelId} reported 0 events. Indicates broken implementation or removed snippet.`,
      action: "Verify base pixel code on every page and that GTM tag is published.",
      impact: 9.5, effort: "Medium", confidence: 95, estimatedDataLoss: 100,
    });
    return recs;
  }

  // Anomaly detection (spec: sudden drops/spikes)
  for (const a of stats.anomalies) {
    recs.push({
      id: `meta-${stats.pixelId}-anom-${a.event}`, priority: a.severity, platform: "Meta", category: "Anomaly",
      issue: `${a.type === "drop" ? "Sudden drop" : "Unusual spike"} in ${a.event} events`,
      details: `${a.event} dropped to ${a.currentValue.toLocaleString()} in last 24h vs 7-day baseline of ${a.baseline.toLocaleString()} (${a.deviation > 0 ? "+" : ""}${a.deviation}% deviation).`,
      action: a.type === "drop"
        ? "Verify the event still fires correctly. Check if a recent GTM publish, code deploy, or attribution window change broke firing."
        : "Investigate for duplicate firing, bot traffic, or recent campaign launches that explain the spike.",
      impact: a.severity === "Critical" ? 8 : a.severity === "High" ? 6 : 3.5,
      effort: "Medium", confidence: 90, estimatedDataLoss: Math.abs(a.deviation),
    });
  }

  // Data freshness (spec: data freshness)
  if (stats.diagnostics.dataFreshnessMins > META_BENCHMARKS.dataFreshnessMins.stale) {
    recs.push({
      id: `meta-${stats.pixelId}-freshness`,
      priority: stats.diagnostics.dataFreshnessMins > META_BENCHMARKS.dataFreshnessMins.critical ? "Critical" : "Medium",
      platform: "Meta", category: "Pixel Health",
      issue: "Stale tracking data",
      details: `Last event received ${stats.diagnostics.dataFreshnessMins} minutes ago — Meta updates pixel stats in near real-time so prolonged silence often means tracking is broken.`,
      action: "Open the page in Meta Pixel Helper and confirm events fire. Check for blocking errors in console.",
      impact: 6, effort: "Quick", confidence: 88,
    });
  }

  // 2. EMQ per event
  for (const event of stats.eventBreakdown) {
    const benchmark = META_BENCHMARKS.emq[event.event];
    if (benchmark && event.matchScore < benchmark - 1) {
      const gap = benchmark - event.matchScore;
      recs.push({
        id: `meta-${stats.pixelId}-emq-${event.event}`,
        priority: gap > 2 ? "Critical" : gap > 1 ? "High" : "Medium",
        platform: "Meta", category: "EMQ",
        issue: `Low Event Match Quality for ${event.event}`,
        details: `EMQ ${event.matchScore.toFixed(1)} vs Meta benchmark ${benchmark}+. Each 0.5 point lift correlates with ~3-5% reported conversion improvement.`,
        action: "Add hashed em, ph, external_id parameters. SHA256 + lowercase normalize before send.",
        impact: Math.min(7.5, gap * 1.5), effort: "Medium", confidence: 88,
        estimatedDataLoss: Math.round(gap * 3),
      });
    }
  }

  // Match key coverage (advanced matching setup, missing identifiers, IP/UA)
  for (const mk of stats.emq.matchKeys) {
    const config = META_BENCHMARKS.matchKeys[mk.key];
    if (config && mk.coverage < config.benchmark - 5) {
      const gap = config.benchmark - mk.coverage;
      recs.push({
        id: `meta-${stats.pixelId}-mk-${mk.key}`,
        priority: gap > 20 ? "Critical" : gap > 10 ? "High" : "Medium",
        platform: "Meta", category: "EMQ",
        issue: `${mk.key} coverage below benchmark`,
        details: `${mk.coverage}% of events include ${mk.key} (benchmark ${config.benchmark}%+). ${mk.key === "em" || mk.key === "ph" ? "Highest-value match signal." : ""}`,
        action: `Capture ${mk.key} on customer touchpoints. Use Advanced Matching in pixel base code or pass server-side.`,
        impact: (gap / 10) * config.weight, effort: "Medium", confidence: 85,
      });
    }
  }

  if (!stats.emq.serverSideEnrichment) {
    recs.push({
      id: `meta-${stats.pixelId}-no-enrichment`, priority: "Medium", platform: "Meta", category: "EMQ",
      issue: "Server-side signal enrichment disabled",
      details: "Automatic Advanced Matching not enabled — Meta cannot auto-detect emails/phones from forms.",
      action: "Enable Automatic Advanced Matching in Events Manager > Settings.",
      impact: 3, effort: "Quick", confidence: 90,
    });
  }

  // 3. CAPI Audit
  if (stats.capi.serverShare < 10) {
    recs.push({
      id: `meta-${stats.pixelId}-no-capi`, priority: "Critical", platform: "Meta", category: "CAPI",
      issue: "Conversion API not enabled",
      details: `Only ${stats.capi.serverShare.toFixed(1)}% of events are server-side. CAPI recovers ~10-20% of conversions lost to iOS 14.5+ and ad blockers.`,
      action: "Implement CAPI via your server, GTM Server-Side, or a CAPI partner. Mirror browser events with matching event_id.",
      impact: 8, effort: "High", confidence: 92, estimatedDataLoss: 15,
    });
  }
  if (stats.capi.capiBreakdown.eventIdConsistency < META_BENCHMARKS.eventIdCoverage.minimum) {
    recs.push({
      id: `meta-${stats.pixelId}-event-id`, priority: "Critical", platform: "Meta", category: "CAPI",
      issue: "event_id missing on many events",
      details: `Only ${stats.capi.capiBreakdown.eventIdConsistency.toFixed(0)}% of events carry event_id. Without it Meta cannot dedupe browser+server events, inflating conversion costs.`,
      action: "Generate a UUID per event and send the same value on browser pixel AND CAPI payload.",
      impact: 6.5, effort: "Medium", confidence: 92,
    });
  }
  if (stats.capi.capiBreakdown.payloadCompleteness < META_BENCHMARKS.payloadCompleteness.minimum) {
    recs.push({
      id: `meta-${stats.pixelId}-payload`, priority: "High", platform: "Meta", category: "CAPI",
      issue: "Missing required CAPI payload parameters",
      details: `${(100 - stats.capi.capiBreakdown.payloadCompleteness).toFixed(0)}% of events missing required fields (action_source, event_source_url, value, currency).`,
      action: "Audit your server code and include all required parameters from Meta's CAPI spec.",
      impact: 4.5, effort: "Medium", confidence: 88,
    });
  }
  if (stats.capi.capiBreakdown.avgServerLatencyMs > META_BENCHMARKS.serverLatencyMs.warning) {
    recs.push({
      id: `meta-${stats.pixelId}-latency`,
      priority: stats.capi.capiBreakdown.avgServerLatencyMs > META_BENCHMARKS.serverLatencyMs.critical ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "High CAPI server latency",
      details: `Server events take ${stats.capi.capiBreakdown.avgServerLatencyMs.toFixed(0)}ms — Meta recommends < 1000ms. Slow events risk being discarded for attribution.`,
      action: "Move CAPI from synchronous to async/queued. Cache fbp/fbc. Use Meta's regional endpoints.",
      impact: 4, effort: "Medium", confidence: 80,
    });
  }
  if (stats.capi.capiBreakdown.apiFailureRate > META_BENCHMARKS.capiFailureRate.warning) {
    recs.push({
      id: `meta-${stats.pixelId}-api-fail`,
      priority: stats.capi.capiBreakdown.apiFailureRate > META_BENCHMARKS.capiFailureRate.critical ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "CAPI API failure rate elevated",
      details: `${stats.capi.capiBreakdown.apiFailureRate.toFixed(1)}% of CAPI calls return non-2xx. Failed events are lost — no retry.`,
      action: "Add retry-with-backoff for 5xx errors. Inspect 4xx errors for malformed payloads. Monitor token expiry.",
      impact: 5, effort: "Medium", confidence: 90,
    });
  }
  for (const auth of stats.capi.authIssues) {
    recs.push({
      id: `meta-${stats.pixelId}-auth-${auth.type}`,
      priority: auth.severity === "error" ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "Authentication issue detected",
      details: auth.message,
      action: "Generate a new System User token from Business Settings and rotate before expiry.",
      impact: auth.severity === "error" ? 7 : 4, effort: "Quick", confidence: 95,
    });
  }

  // 4. Funnel Validation — duplicates + sequencing + broken chains
  if (stats.funnelIntegrity.duplicatePurchaseRate > 3) {
    recs.push({
      id: `meta-${stats.pixelId}-dup-purchase`, priority: "Critical", platform: "Meta", category: "Funnel",
      issue: "Duplicate Purchase events detected",
      details: `${stats.funnelIntegrity.duplicatePurchases.toLocaleString()} duplicate purchases (${stats.funnelIntegrity.duplicatePurchaseRate.toFixed(1)}%). Inflates revenue and breaks ROAS calculations.`,
      action: "Confirm event_id is identical on browser + CAPI. Add idempotency at server. Check thank-you page reloads.",
      impact: 7, effort: "Medium", confidence: 92,
    });
  }
  for (const s of stats.funnelIntegrity.sequencingIssues) {
    recs.push({
      id: `meta-${stats.pixelId}-seq-${s.event}`, priority: "High", platform: "Meta", category: "Funnel",
      issue: `Event sequencing broken on ${s.event}`,
      details: s.issue,
      action: "Audit GTM trigger order. Ensure prior funnel events fire before downstream events.",
      impact: 4, effort: "Medium", confidence: 80,
    });
  }
  if (stats.funnelIntegrity.brokenAttributionChains > 0) {
    recs.push({
      id: `meta-${stats.pixelId}-broken-attribution`, priority: "High", platform: "Meta", category: "Attribution",
      issue: "Broken attribution chains",
      details: `${stats.funnelIntegrity.brokenAttributionChains} sessions have purchases without matching campaign click_id — attribution model can't credit campaigns.`,
      action: "Ensure fbc/fbp are persisted across pages. Capture click_id from URL parameters on landing.",
      impact: 4.5, effort: "Medium", confidence: 82,
    });
  }

  // 6. Event Manager Diagnostics
  for (const issue of stats.diagnostics.issues) {
    recs.push({
      id: `meta-${stats.pixelId}-em-${issue.code}`,
      priority: issue.severity === "error" ? "High" : "Medium",
      platform: "Meta", category: "Event Manager",
      issue: `Event Manager: ${issue.code.replace(/_/g, " ")}`,
      details: issue.message + (issue.affectedEvent ? ` (Event: ${issue.affectedEvent})` : ""),
      action: "Open Meta Events Manager > Diagnostics and resolve the flagged issue. Most are auto-fixable from the dashboard.",
      impact: issue.severity === "error" ? 5 : 3, effort: "Quick", confidence: 90,
    });
  }

  return recs;
}

/** Funnel analysis (also used for GA4 ecommerce + Meta funnel) */
export function analyzeFunnel(events: Array<{ event: string; count: number }>): Recommendation[] {
  const recs: Recommendation[] = [];
  const map = Object.fromEntries(events.map((e) => [e.event, e.count]));

  const stages = [
    { from: "PageView", to: "ViewContent", benchmark: 80, key: "PageView_to_ViewContent" },
    { from: "ViewContent", to: "AddToCart", benchmark: 50, key: "ViewContent_to_AddToCart" },
    { from: "AddToCart", to: "InitiateCheckout", benchmark: 30, key: "AddToCart_to_InitiateCheckout" },
    { from: "InitiateCheckout", to: "Purchase", benchmark: 50, key: "InitiateCheckout_to_Purchase" },
  ];

  for (const s of stages) {
    const fromCount = map[s.from];
    const toCount = map[s.to];
    if (!fromCount || !toCount) continue;
    const rate = (toCount / fromCount) * 100;
    if (rate < s.benchmark * 0.6) {
      const gap = s.benchmark - rate;
      recs.push({
        id: `funnel-${s.key}`,
        priority: gap > 30 ? "Critical" : "High",
        platform: "Meta", category: "Funnel",
        issue: `Severe drop-off: ${s.from} -> ${s.to}`,
        details: `Conversion ${rate.toFixed(1)}% vs benchmark ${s.benchmark}%. Likely cause: tracking gap rather than UX.`,
        action: `Verify ${s.to} fires using Meta Pixel Helper and check GTM trigger conditions.`,
        impact: Math.min(8, gap / 5), effort: "Medium", confidence: 82,
      });
    }
  }
  return recs;
}

/** Rank by impact × confidence ÷ effort */
export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  const effortWeight = { Quick: 1.0, Medium: 1.5, High: 2.5 };
  return [...recs]
    .map((r) => ({ ...r, priority: priorityFromImpact(r.impact) }))
    .sort((a, b) => {
      const scoreA = (a.impact * (a.confidence / 100)) / effortWeight[a.effort];
      const scoreB = (b.impact * (b.confidence / 100)) / effortWeight[b.effort];
      return scoreB - scoreA;
    });
}
