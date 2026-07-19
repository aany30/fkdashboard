/**
 * POST /api/ai/generate-report
 *
 * Generates a structured business report from campaign data using Claude Haiku.
 * Two report types:
 *   - awareness: reach, frequency, CPM, CTR, views/VTR focus
 *   - sales:     ROAS, CPA, conversions, revenue, ROI focus
 *
 * Returns markdown that the client renders.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

export interface ReportRequest {
  reportType: "awareness" | "sales";
  platform: "meta" | "dv360" | "both";
  brandName?: string;
  dateRange: string;
  currency: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    videoViews: number;
    conversions: number;
    conversionValue: number;
  };
  campaigns: Array<{
    name: string;
    platform?: string;
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    videoViews: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpm: number;
    frequency: number;
    vtr: number;
    roas: number;
    cpa: number;
  }>;
  publishers?: Array<{ name: string; impressions: number; clicks: number; spend: number }>;
  ageRows?: Array<{ age: string; impressions: number; clicks: number; spend: number }>;
  genderRows?: Array<{ gender: string; impressions: number; clicks: number }>;
  isDemo?: boolean;
}

export interface ReportResponse {
  report: string;
  source: "ai" | "fallback";
  creditsUsedUsd: number;
}

const AWARENESS_SYSTEM = `You are a senior media analyst writing a professional brand-awareness campaign report for a marketing team or agency client.

Your report must be structured, data-driven, and written in clear business English. Use the data provided — never invent numbers.

Report structure (use these exact markdown headings):
## Executive Summary
2-3 sentences: overall reach, engagement efficiency, and the single biggest insight.

## Reach & Frequency
Analyse total reach, average frequency, and what that means for brand recall. Flag if frequency is too high (>5) or too low (<1.5).

## Impressions & CPM Efficiency
Which campaigns delivered the most impressions per rupee/dollar spent. Rank top 3.

## Engagement (CTR & Views)
CTR benchmarks, VTR performance, which formats drove the most views.

## Top Performing Campaigns
A brief ranked list of top 5 campaigns by reach, with key metrics.

## Publisher & Placement Insights
If publisher data is available, which platforms drove the best awareness metrics.

## Audience Insights
If age/gender data is available, highlight the best-performing segments.

## Recommendations
3-5 concrete, actionable recommendations to improve awareness KPIs in the next period. Be specific.

Rules:
- Quote actual numbers from the data (e.g. "reached 2.3M unique users").
- Use the correct currency symbol (₹ for INR, $ for USD).
- No bullet-point walls — use tables for comparisons, prose for analysis.
- Keep each section concise (3-6 sentences or a compact table).
- Do not mention ROAS, ROI, or conversion revenue — this is an awareness report.`;

const SALES_SYSTEM = `You are a senior performance marketing analyst writing a professional sales & ROI campaign report for a business or agency client.

Your report must be structured, data-driven, and written in clear business English. Use the data provided — never invent numbers.

Report structure (use these exact markdown headings):
## Executive Summary
2-3 sentences: total revenue driven, blended ROAS, and the single biggest performance insight.

## Revenue & ROAS Performance
Total revenue, blended ROAS, best and worst ROAS campaigns. Flag campaigns below 1x ROAS.

## Conversion Analysis
Total conversions, CPA, conversion rate (conversions/clicks). Which campaigns had the lowest CPA.

## Spend Efficiency
Cost-per-click (CPC), cost-per-conversion (CPA) ranked by campaign. Identify budget concentration risk.

## Top Performing Campaigns
Ranked list of top 5 campaigns by ROAS, with spend, conversions, and revenue.

## Underperforming Campaigns
Campaigns with ROAS < 1 or zero conversions that consumed budget. Be factual, not judgmental.

## Audience & Placement Performance
If demographic or publisher data is available, which segments drove the most conversions.

## Recommendations
3-5 concrete, actionable recommendations to improve ROAS and reduce CPA. Be specific — name campaigns or tactics.

Rules:
- Quote actual numbers (e.g. "₹4.2 ROAS on the Honer Premium campaign").
- Use the correct currency symbol.
- No made-up benchmarks — only compare metrics within the provided data.
- If revenue/conversion data is sparse, acknowledge it honestly rather than fabricating insights.
- Keep each section concise (3-6 sentences or a compact table).`;

function fallbackReport(body: ReportRequest): ReportResponse {
  const t = body.totals;
  const cur = body.currency === "INR" ? "₹" : "$";
  const fmt = (n: number) => cur + Math.round(n).toLocaleString("en-IN");
  const isAwareness = body.reportType === "awareness";

  const lines: string[] = [
    `## Executive Summary`,
    isAwareness
      ? `${body.brandName ? body.brandName + " " : ""}delivered ${Math.round(t.impressions).toLocaleString("en-IN")} impressions reaching ${Math.round(t.reach).toLocaleString("en-IN")} unique users over the reporting period, at a blended CPM of ${t.impressions > 0 ? fmt((t.spend / t.impressions) * 1000) : "—"}. Set ANTHROPIC_API_KEY for a full AI-written analysis.`
      : `${body.brandName ? body.brandName + " " : ""}drove ${Math.round(t.conversions).toLocaleString("en-IN")} conversions from ${fmt(t.spend)} spend, with a blended ROAS of ${t.spend > 0 ? (t.conversionValue / t.spend).toFixed(2) + "x" : "—"} and CPA of ${t.conversions > 0 ? fmt(t.spend / t.conversions) : "—"}. Set ANTHROPIC_API_KEY for a full AI-written analysis.`,
    ``,
    `## Campaign Summary`,
    `| Campaign | Spend | ${isAwareness ? "Reach | Impressions | CPM" : "Conversions | Revenue | ROAS | CPA"} |`,
    `|---|---|${isAwareness ? "---|---|---" : "---|---|---|---"}|`,
    ...body.campaigns.slice(0, 10).map(c =>
      isAwareness
        ? `| ${c.name} | ${fmt(c.spend)} | ${Math.round(c.reach).toLocaleString()} | ${Math.round(c.impressions).toLocaleString()} | ${fmt(c.cpm)} |`
        : `| ${c.name} | ${fmt(c.spend)} | ${Math.round(c.conversions).toLocaleString()} | ${fmt(c.conversionValue)} | ${c.roas > 0 ? c.roas.toFixed(2) + "x" : "—"} | ${c.cpa > 0 ? fmt(c.cpa) : "—"} |`
    ),
  ];

  return { report: lines.join("\n"), source: "fallback", creditsUsedUsd: 0 };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReportResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body as ReportRequest;
  if (!body.reportType || !body.campaigns) return res.status(400).json({ error: "Missing required fields" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json(fallbackReport(body));

  const cur = body.currency === "INR" ? "₹" : "$";
  const fmt = (n: number) => cur + Math.round(n).toLocaleString("en-IN");
  const t = body.totals;

  const platformLabel = body.platform === "both" ? "Meta + DV360" : body.platform === "dv360" ? "DV360" : "Meta";

  const userPayload = `Generate a ${body.reportType === "awareness" ? "brand awareness" : "sales & performance"} business report for the following campaign data.

**Brand / Account:** ${body.brandName || "Not specified"}
**Platform:** ${platformLabel}
**Period:** ${body.dateRange}
**Currency:** ${body.currency} (use ${cur} symbol)

**Overall Totals:**
- Spend: ${fmt(t.spend)}
- Impressions: ${Math.round(t.impressions).toLocaleString("en-IN")}
- Clicks: ${Math.round(t.clicks).toLocaleString("en-IN")}
- Reach: ${Math.round(t.reach).toLocaleString("en-IN")}
- Video Views: ${Math.round(t.videoViews).toLocaleString("en-IN")}
- Conversions: ${Math.round(t.conversions).toLocaleString("en-IN")}
- Conversion Revenue: ${fmt(t.conversionValue)}
- Blended ROAS: ${t.spend > 0 && t.conversionValue > 0 ? (t.conversionValue / t.spend).toFixed(2) + "x" : "—"}
- Blended CPA: ${t.conversions > 0 ? fmt(t.spend / t.conversions) : "—"}
- Blended CPM: ${t.impressions > 0 ? fmt((t.spend / t.impressions) * 1000) : "—"}
- Blended CTR: ${t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(3) + "%" : "—"}
- Avg Frequency: ${t.reach > 0 ? (t.impressions / t.reach).toFixed(2) : "—"}
- VTR: ${t.impressions > 0 ? ((t.videoViews / t.impressions) * 100).toFixed(2) + "%" : "—"}

**Campaigns (${body.campaigns.length}):**
${body.campaigns.map(c => `- ${c.name}${c.platform ? ` [${c.platform}]` : ""}: spend=${fmt(c.spend)}, impressions=${Math.round(c.impressions).toLocaleString()}, clicks=${Math.round(c.clicks).toLocaleString()}, reach=${Math.round(c.reach).toLocaleString()}, conversions=${Math.round(c.conversions)}, revenue=${fmt(c.conversionValue)}, ROAS=${c.roas > 0 ? c.roas.toFixed(2) + "x" : "—"}, CPA=${c.cpa > 0 ? fmt(c.cpa) : "—"}, CPM=${fmt(c.cpm)}, CTR=${c.ctr.toFixed(3)}%, frequency=${c.frequency.toFixed(2)}, VTR=${c.vtr.toFixed(2)}%, views=${Math.round(c.videoViews).toLocaleString()}`).join("\n")}

${body.publishers && body.publishers.length > 0 ? `**Publisher Breakdown:**\n${body.publishers.map(p => `- ${p.name}: impressions=${Math.round(p.impressions).toLocaleString()}, clicks=${Math.round(p.clicks).toLocaleString()}, spend=${fmt(p.spend)}`).join("\n")}` : ""}

${body.ageRows && body.ageRows.length > 0 ? `**Age Breakdown:**\n${body.ageRows.map(a => `- ${a.age}: impressions=${Math.round(a.impressions).toLocaleString()}, clicks=${Math.round(a.clicks).toLocaleString()}, spend=${fmt(a.spend)}`).join("\n")}` : ""}

${body.genderRows && body.genderRows.length > 0 ? `**Gender Breakdown:**\n${body.genderRows.map(g => `- ${g.gender}: impressions=${Math.round(g.impressions).toLocaleString()}, clicks=${Math.round(g.clicks).toLocaleString()}`).join("\n")}` : ""}`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: [{ type: "text", text: body.reportType === "awareness" ? AWARENESS_SYSTEM : SALES_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPayload }],
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block in response");

    return res.status(200).json({
      report: textBlock.text.trim(),
      source: "ai",
      creditsUsedUsd: calcCost(response.usage),
    });
  } catch (err) {
    if (body.isDemo) return res.status(200).json(fallbackReport(body));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Report generation failed: ${msg}` });
  }
}
