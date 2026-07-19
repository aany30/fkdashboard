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

const SYSTEM_PROMPT = `You are a paid-media analyst. You are given ONE campaign's PLANNED vs DELIVERED numbers (spend, reach, impressions, frequency, CPM) plus pacing percentages.

Write 2-3 plain-English sentences (no bullet points, no headers, no markdown) that explain the gap between planned and delivered. Rules:
- Lead with the single biggest gap and quote the actual numbers (e.g. "delivered ₹46,998 vs ₹20,000 planned").
- Say clearly whether the campaign is over- or under-delivering, and on which metric.
- If spend is over/under but a delivery metric (reach/impressions) is on plan, call that out — it's the real story for awareness.
- Be concrete and neutral. Do not give a to-do list; just explain what happened. Maximum 3 sentences.`;

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
  const summary = parts.length
    ? parts.join(" ") + " (Set ANTHROPIC_API_KEY for a fuller AI read.)"
    : `Enter planned numbers for ${body.campaign} to see how delivery compares. (Set ANTHROPIC_API_KEY for AI analysis.)`;
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
      max_tokens: 300,
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
