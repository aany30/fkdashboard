/**
 * POST /api/ai/plan-gap
 *
 * Explains the gap between PLANNED and DELIVERED for one campaign in 2-3 plain
 * English sentences. Used by the Planning report's per-campaign deep-dive.
 *
 * Body: { campaign, planned, delivered, pacing, dateRange, isDemo }
 * Response: { summary, source, creditsUsedUsd }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface GapRequest {
  campaign: string;
  planned: Record<string, number>;
  delivered: Record<string, number>;
  pacing?: Record<string, number | null>;
  dateRange?: string;
  platform?: "meta" | "dv360";
  isDemo?: boolean;
}

interface GapResponse {
  summary: string;
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are a senior paid-media strategist. You are given a campaign's (or an aggregated view's) PLANNED vs DELIVERED numbers (spend, reach, impressions, frequency, CPM, CTR, VTR, views, clicks) plus pacing percentages.

Respond in PLAIN TEXT (no markdown headers, no ** ** bold) in exactly this shape:

<2-3 sentence INSIGHT explaining the biggest gaps, quoting the actual numbers (e.g. "delivered ₹1.7cr vs ₹40L planned — 426% pacing") and WHY it matters (e.g. spend blew past plan but reach fell short → bought cheap volume, not unique audience).>

Recommendations:
• <a concrete, actionable fix tied to a specific gap and number>
• <another practical lever>
• <optional third>

Rules:
- Ground every claim AND every recommendation in the provided numbers — no generic platitudes.
- Give 2-4 recommendations, each a real lever (reallocate budget, cap frequency, shift to reach-priced inventory, fix creative for CTR, pause an over-pacing line, etc.), not vague advice.
- If planned is 0/missing for a metric, don't invent a target — say that metric's gap can't be assessed.
- For DV360, reach/frequency come from Bid Manager and conversion revenue may be missing; don't assume Meta-style optimisation levers.
- Keep it tight: insight ≤3 sentences, ≤4 recommendation lines.`;

// Compute a decent 2-3 sentence summary without the API (no key / demo).
function fallback(body: GapRequest): GapResponse {
  const p = body.planned || {}, d = body.delivered || {};
  const pct = (a?: number, b?: number) => (a && a > 0 && b != null ? Math.round((b / a) * 100) : null);
  const spendPct = pct(p.spend, d.spend);
  const imprPct = pct(p.impressions, d.impressions);
  const reachPct = pct(p.reach, d.reach);
  const money = (n?: number) => (n ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—");
  const num = (n?: number) => (n ? Math.round(n).toLocaleString("en-IN") : "—");

  const parts: string[] = [];
  if (spendPct != null) {
    const dir = spendPct > 110 ? "over-spent" : spendPct < 90 ? "under-spent" : "spent on plan";
    parts.push(`${body.campaign} ${dir}: delivered ${money(d.spend)} against a planned ${money(p.spend)} (${spendPct}% pacing).`);
  }
  if (imprPct != null) {
    const dir = imprPct >= 90 ? "on/ahead of" : "behind";
    parts.push(`Impressions came in ${dir} plan at ${num(d.impressions)} vs ${num(p.impressions)} planned (${imprPct}%)${reachPct != null ? `, with reach at ${reachPct}% of plan` : ""}.`);
  }
  const recos: string[] = [];
  if (spendPct != null && spendPct > 110) recos.push("• Spend is over plan — pause or cap the fastest-pacing lines and reallocate to under-delivering ones.");
  if (reachPct != null && reachPct < 90) recos.push("• Reach is short — shift budget from cheap high-frequency placements to reach-priced inventory.");
  if (imprPct != null && imprPct > 150 && (reachPct == null || reachPct < 90)) recos.push("• Impressions ran well ahead of reach — tighten frequency caps to buy unique audience, not repeats.");
  if (!recos.length) recos.push("• Enter planned targets for each metric to get specific reallocation and pacing fixes.");

  const insight = parts.length ? parts.join(" ") : `Enter planned numbers for ${body.campaign} to see how delivery compares.`;
  const summary = `${insight}\n\nRecommendations:\n${recos.join("\n")}\n\n(Set ANTHROPIC_API_KEY for a fuller AI read.)`;
  return { summary, source: "fallback", creditsUsedUsd: 0 };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GapResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body || {}) as GapRequest;
  if (!body.campaign) return res.status(400).json({ error: "Missing campaign" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json(fallback(body));

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Explain the planned vs delivered gap for this ${body.platform === "dv360" ? "DV360" : "Meta"} campaign (${body.dateRange ?? "selected period"}). ${body.platform === "dv360" ? "This is a DV360 campaign — reach/frequency come from Floodlight/Bid Manager and conversion revenue may be unavailable; don't assume Meta-style optimisation levers." : ""}\n\n${JSON.stringify(
            { campaign: body.campaign, platform: body.platform ?? "meta", planned: body.planned, delivered: body.delivered, pacing: body.pacing },
            null, 2
          )}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block");
    const summary = textBlock.text.trim();
    return res.status(200).json({ summary, source: "ai", creditsUsedUsd: calcCost(response.usage) });
  } catch (err) {
    if (body.isDemo) return res.status(200).json(fallback(body));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Gap analysis failed: ${msg}` });
  }
}
