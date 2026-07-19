/**
 * POST /api/ai/report-narrative
 *
 * Structured narrative for the customizable Generate-Report PDF. Unlike
 * /api/ai/generate-report (which returns a markdown blob for ExportReport), this
 * returns a STRUCTURED object so the visual deck (PdfReportPages) can place the
 * text into KPI callouts, an executive summary, and a recommendations list —
 * while all numbers/charts stay from real API data.
 *
 * Objective-aware (awareness | sales | traffic | lead) and length-aware
 * (concise | standard | detailed). Uses Claude Haiku with ANTHROPIC_API_KEY;
 * falls back to a deterministic narrative when the key is unset (demo-safe).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

export type ReportObjective = "awareness" | "sales" | "traffic" | "lead";
export type ReportLength = "concise" | "standard" | "detailed";

export interface ReportNarrativeRequest {
  objective: ReportObjective;
  length: ReportLength;
  customInstructions?: string;
  /** Sidebar areas the user chose to focus the report on (reporting/audit/tracking). */
  focusAreas?: string[];
  brandName?: string;
  platform: "meta" | "dv360" | "both";
  dateRange: string;
  currency: string;
  totals: {
    spend: number; impressions: number; clicks: number; reach: number;
    videoViews: number; conversions: number; conversionValue: number;
  };
  campaigns: Array<{
    name: string; platform?: string; spend: number; impressions: number;
    clicks: number; reach: number; videoViews: number; conversions: number;
    conversionValue: number; ctr: number; cpm: number; frequency: number;
    vtr: number; roas: number; cpa: number;
  }>;
  publishers?: Array<{ name: string; impressions: number; clicks: number; spend: number }>;
  ageRows?: Array<{ age: string; impressions: number; clicks: number; spend: number }>;
  genderRows?: Array<{ gender: string; impressions: number; clicks: number }>;
  countryRows?: Array<{ country: string; impressions: number; clicks: number; spend: number }>;
  /** Optional Audit/Tracking snapshot (pixel health, EMQ, funnel, attribution). */
  tracking?: {
    activePixels?: string;      // e.g. "2/2"
    capiSharePct?: number;      // server-event share
    emqScore?: number;          // event match quality score
    totalEvents?: number;
    avgFrequency?: number;
    accountStructure?: { campaigns: number; adSets: number };
    attribution?: Array<{ name: string; clickLookbackDays: number; viewLookbackDays: number }>;
    funnel?: Array<{ stage: string; value: number }>;
  };
  isDemo?: boolean;
}

export interface SectionInsight { section: string; text: string }
export interface ReportNarrative {
  execSummary: string;
  highlights: string[];
  sectionInsights: SectionInsight[];
  recommendations: string[];
}
export interface ReportNarrativeResponse extends ReportNarrative {
  source: "ai" | "fallback";
  creditsUsedUsd: number;
}

// ─── Objective system prompts ────────────────────────────────────────────────
const BASE_RULES = `
Rules:
- Use ONLY the numbers provided. NEVER invent metrics, benchmarks, or campaigns.
- Quote actual figures with the correct currency symbol (₹ for INR, $ for USD).
- Be specific — name real campaigns from the data.
- "section" values in sectionInsights MUST be chosen from: "kpis", "campaigns", "funnel", "audience", "creative", "placement", "tracking", "attribution". Only include sections you have data for.
- If a metric family is sparse or missing, say so honestly instead of fabricating.
- Return ONLY the JSON object matching the schema.`;

const OBJECTIVE_SYSTEM: Record<ReportObjective, string> = {
  awareness: `You are a senior media analyst writing a brand-AWARENESS campaign narrative. Focus on reach, frequency, impressions, CPM efficiency, CTR and view-through (VTR). Do NOT emphasise ROAS/revenue — this is an awareness report.${BASE_RULES}`,
  sales: `You are a senior performance-marketing analyst writing a SALES & ROI narrative. Focus on revenue, blended ROAS, conversions, CPA, CVR and spend efficiency. Flag campaigns below 1x ROAS or with zero conversions that spent budget.${BASE_RULES}`,
  traffic: `You are a senior media analyst writing a TRAFFIC & ENGAGEMENT narrative. Focus on clicks, CTR, CPC, and which campaigns/placements drove the most efficient traffic. Treat conversions as secondary.${BASE_RULES}`,
  lead: `You are a senior performance-marketing analyst writing a LEAD-GENERATION narrative. Focus on leads (conversions), cost-per-lead (CPA), conversion rate (CVR), and lead quality signals available in the data.${BASE_RULES}`,
};

const LENGTH_TOKENS: Record<ReportLength, number> = { concise: 1024, standard: 2048, detailed: 3072 };
const LENGTH_GUIDE: Record<ReportLength, string> = {
  concise: "Keep it tight: 1-2 highlights, exec summary of 2 sentences, at most 3 sectionInsights, 3 recommendations.",
  standard: "Balanced depth: 3-4 highlights, exec summary of 3-4 sentences, 4-6 sectionInsights, 4-5 recommendations.",
  detailed: "Thorough: 4-6 highlights, exec summary of 4-6 sentences, one insight per available section, 5-7 recommendations.",
};

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    execSummary: { type: "string" as const, description: "2-6 sentence executive summary tuned to the objective; leads with the single biggest, real insight." },
    highlights: { type: "array" as const, items: { type: "string" as const }, description: "Short punchy highlight strings (each under 90 chars) citing a real number." },
    sectionInsights: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          section: { type: "string" as const, enum: ["kpis", "campaigns", "funnel", "audience", "creative", "placement", "tracking", "attribution"] },
          text: { type: "string" as const, description: "2-4 sentence analysis for this section, citing real numbers." },
        },
        required: ["section", "text"],
        additionalProperties: false,
      },
    },
    recommendations: { type: "array" as const, items: { type: "string" as const }, description: "Concrete, actionable next-period recommendations naming real campaigns/tactics." },
  },
  required: ["execSummary", "highlights", "sectionInsights", "recommendations"],
  additionalProperties: false,
};

function fallback(body: ReportNarrativeRequest): ReportNarrativeResponse {
  const t = body.totals;
  const cur = body.currency === "INR" ? "₹" : "$";
  const fmt = (n: number) => cur + Math.round(n).toLocaleString("en-IN");
  const int = (n: number) => Math.round(n).toLocaleString("en-IN");
  const roas = t.spend > 0 && t.conversionValue > 0 ? (t.conversionValue / t.spend).toFixed(2) + "x" : "—";
  const cpm = t.impressions > 0 ? fmt((t.spend / t.impressions) * 1000) : "—";
  const cpa = t.conversions > 0 ? fmt(t.spend / t.conversions) : "—";
  const top = [...body.campaigns].sort((a, b) => b.spend - a.spend)[0];

  const execByObj: Record<ReportObjective, string> = {
    awareness: `${body.brandName ? body.brandName + " " : ""}delivered ${int(t.impressions)} impressions reaching ${int(t.reach)} users at a blended CPM of ${cpm} over ${body.dateRange}.`,
    sales: `${body.brandName ? body.brandName + " " : ""}drove ${int(t.conversions)} conversions from ${fmt(t.spend)} spend — blended ROAS ${roas}, CPA ${cpa}.`,
    traffic: `${body.brandName ? body.brandName + " " : ""}generated ${int(t.clicks)} clicks from ${int(t.impressions)} impressions (CTR ${t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(2) + "%" : "—"}) at ${fmt(t.spend)} spend.`,
    lead: `${body.brandName ? body.brandName + " " : ""}captured ${int(t.conversions)} leads at a cost-per-lead of ${cpa} from ${fmt(t.spend)} spend.`,
  };

  return {
    source: "fallback",
    creditsUsedUsd: 0,
    execSummary: execByObj[body.objective] + " (Set ANTHROPIC_API_KEY for a full AI-written analysis.)",
    highlights: [
      `Spend ${fmt(t.spend)}`,
      body.objective === "sales" || body.objective === "lead" ? `Conversions ${int(t.conversions)}` : `Impressions ${int(t.impressions)}`,
      body.objective === "sales" ? `ROAS ${roas}` : `CPM ${cpm}`,
    ],
    sectionInsights: [
      { section: "campaigns", text: top ? `${top.name} led on spend at ${fmt(top.spend)}.` : "No campaign data available for this window." },
    ],
    recommendations: [
      "Connect ANTHROPIC_API_KEY to unlock AI-written, objective-specific recommendations.",
      "Reallocate budget from the lowest-efficiency campaigns to the top performers.",
    ],
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReportNarrativeResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body as ReportNarrativeRequest;
  if (!body?.objective || !Array.isArray(body?.campaigns)) return res.status(400).json({ error: "Missing required fields" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json(fallback(body));

  const cur = body.currency === "INR" ? "₹" : "$";
  const fmt = (n: number) => cur + Math.round(n).toLocaleString("en-IN");
  const int = (n: number) => Math.round(n).toLocaleString("en-IN");
  const t = body.totals;
  const platformLabel = body.platform === "both" ? "Meta + DV360" : body.platform === "dv360" ? "DV360" : "Meta";

  const areaFocus = body.focusAreas?.length
    ? `\nFOCUS AREAS: concentrate the analysis on ${body.focusAreas.join(", ")}. ${body.focusAreas.includes("reporting") ? "Reporting = performance/audience/creative/placement. " : ""}${body.focusAreas.includes("audit") ? "Audit = pixel health, event match quality, funnel, attribution. " : ""}${body.focusAreas.includes("tracking") ? "Tracking = CAPI, account structure, frequency/saturation, conversion monitoring. " : ""}Only produce sectionInsights for the chosen areas.\n`
    : "";
  const userPayload = `Write a ${body.objective} report narrative for this real campaign data. ${LENGTH_GUIDE[body.length]}
${areaFocus}${body.customInstructions ? `\nUSER'S SPECIFIC REQUEST (honour this): ${body.customInstructions}\n` : ""}
**Brand / Account:** ${body.brandName || "Not specified"}
**Platform:** ${platformLabel} · **Period:** ${body.dateRange} · **Currency:** ${body.currency} (${cur})

**Totals:** spend ${fmt(t.spend)}, impressions ${int(t.impressions)}, clicks ${int(t.clicks)}, reach ${int(t.reach)}, video views ${int(t.videoViews)}, conversions ${int(t.conversions)}, revenue ${fmt(t.conversionValue)}, ROAS ${t.spend > 0 && t.conversionValue > 0 ? (t.conversionValue / t.spend).toFixed(2) + "x" : "—"}, CPA ${t.conversions > 0 ? fmt(t.spend / t.conversions) : "—"}, CPM ${t.impressions > 0 ? fmt((t.spend / t.impressions) * 1000) : "—"}, CTR ${t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(3) + "%" : "—"}, frequency ${t.reach > 0 ? (t.impressions / t.reach).toFixed(2) : "—"}, VTR ${t.impressions > 0 ? ((t.videoViews / t.impressions) * 100).toFixed(2) + "%" : "—"}.

**Campaigns (${body.campaigns.length}):**
${body.campaigns.slice(0, 40).map(c => `- ${c.name}${c.platform ? ` [${c.platform}]` : ""}: spend=${fmt(c.spend)}, impr=${int(c.impressions)}, clicks=${int(c.clicks)}, conv=${Math.round(c.conversions)}, revenue=${fmt(c.conversionValue)}, ROAS=${c.roas > 0 ? c.roas.toFixed(2) + "x" : "—"}, CPA=${c.cpa > 0 ? fmt(c.cpa) : "—"}, CPM=${fmt(c.cpm)}, CTR=${c.ctr.toFixed(3)}%, freq=${c.frequency.toFixed(2)}, VTR=${c.vtr.toFixed(2)}%`).join("\n")}
${body.publishers?.length ? `\n**Placements:**\n${body.publishers.map(p => `- ${p.name}: impr=${int(p.impressions)}, clicks=${int(p.clicks)}, spend=${fmt(p.spend)}`).join("\n")}` : ""}
${body.ageRows?.length ? `\n**Age:**\n${body.ageRows.map(a => `- ${a.age}: impr=${int(a.impressions)}, clicks=${int(a.clicks)}, spend=${fmt(a.spend)}`).join("\n")}` : ""}
${body.genderRows?.length ? `\n**Gender:**\n${body.genderRows.map(g => `- ${g.gender}: impr=${int(g.impressions)}, clicks=${int(g.clicks)}`).join("\n")}` : ""}
${body.countryRows?.length ? `\n**Country:**\n${body.countryRows.slice(0, 8).map(c => `- ${c.country}: impr=${int(c.impressions)}, spend=${fmt(c.spend)}`).join("\n")}` : ""}
${body.tracking ? `\n**Tracking / Data Quality / Audit:** active pixels ${body.tracking.activePixels ?? "—"}, CAPI share ${body.tracking.capiSharePct != null ? body.tracking.capiSharePct + "%" : "—"}, EMQ match score ${body.tracking.emqScore ?? "—"}, avg frequency ${body.tracking.avgFrequency != null ? body.tracking.avgFrequency + "x" : "—"}${body.tracking.accountStructure ? `, ${body.tracking.accountStructure.campaigns} campaigns / ${body.tracking.accountStructure.adSets} ad sets` : ""}${body.tracking.funnel?.length ? `, funnel ${body.tracking.funnel.map(f => `${f.stage}=${int(f.value)}`).join(" → ")}` : ""}${body.tracking.attribution?.length ? `, DV360 Floodlight windows: ${body.tracking.attribution.map(a => `${a.name} (${a.clickLookbackDays}d click / ${a.viewLookbackDays}d view)`).join("; ")}` : ""}` : ""}`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: LENGTH_TOKENS[body.length] ?? 2048,
      system: [{ type: "text", text: OBJECTIVE_SYSTEM[body.objective], cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: userPayload }],
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block in response");
    const parsed = JSON.parse(textBlock.text) as ReportNarrative;
    if (!parsed.execSummary || !Array.isArray(parsed.recommendations)) throw new Error("AI response missing required fields");

    return res.status(200).json({
      execSummary: parsed.execSummary,
      highlights: parsed.highlights ?? [],
      sectionInsights: parsed.sectionInsights ?? [],
      recommendations: parsed.recommendations ?? [],
      source: "ai",
      creditsUsedUsd: calcCost(response.usage),
    });
  } catch (err) {
    if (body.isDemo) return res.status(200).json(fallback(body));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Report narrative failed: ${msg}` });
  }
}
