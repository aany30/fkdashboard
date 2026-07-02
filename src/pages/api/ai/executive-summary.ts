/**
 * POST /api/ai/executive-summary
 *
 * Generates an AI executive summary for a dashboard tab.
 * Used by the AIExecutiveSummary component on tabs that don't have
 * per-row status badges (Pixel Health, Audience tabs, Reporting, etc.).
 *
 * Body: { tabName, context, platform, dateRange, isDemo }
 * Response: { headline, overview, keyFindings, recommendations, creditsUsedUsd, source }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface SummaryRequest {
  tabName: string;
  context: Record<string, unknown>;
  platform?: string;
  dateRange?: string;
  isDemo?: boolean;
}

interface SummaryResponse {
  headline: string;
  overview: string;
  keyFindings: string[];
  recommendations: string[];
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are a senior paid-media analyst writing an executive summary for a marketing dashboard tab. You receive the tab name, platform, date range, and a JSON snapshot of the current tab's live data. Your job: produce a data-grounded executive summary that tells the user EXACTLY what is happening in their account right now.

HARD RULES — violating any of these makes the output useless:
1. Every keyFinding bullet MUST quote at least one specific number from the data (e.g. "ROAS: 2.4×", "CPM ₹31.2", "CTR 1.8%"). A finding that contains no number is forbidden.
2. Every recommendation MUST name a specific metric, campaign, audience type, or platform UI step. Never write "review your campaigns", "optimize your budget", or any advice that could apply to ANY account.
3. If a campaign name, audience label, or ad set name is present in the data, use it explicitly in the finding or recommendation.
4. If the context data is sparse or empty, state what IS visible and what's missing — do not invent generic filler.
5. The headline must state the single most important number or trend visible in THIS data snapshot.
6. Recommendations must cite the current state (e.g. "Your Interest audience has CPA ₹420 vs Broad's ₹280 — pause Interest and reallocate budget") not abstract best-practices.

Format:
- Headline: under 90 chars, names the biggest takeaway with a number.
- Overview: 2-3 sentences, big picture with actual totals.
- Key Findings: 3-5 bullets, each with specific metric + value from the data.
- Recommendations: 3-5 bullets, each naming what to do, where, and why based on THIS account's numbers.
- Output ONLY valid JSON. No prose outside JSON.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    headline: { type: "string" as const },
    overview: { type: "string" as const },
    keyFindings: { type: "array" as const, items: { type: "string" as const } },
    recommendations: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["headline", "overview", "keyFindings", "recommendations"],
  additionalProperties: false,
};

// Static fallback when no API key is set (demo mode)
function staticFallback(tabName: string, context: Record<string, unknown>): SummaryResponse {
  // Derive real findings from context data rather than generic filler
  const findings: string[] = [];
  const recs: string[] = [];

  const extract = (obj: Record<string, unknown>, depth = 0): void => {
    if (depth > 2) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number" && v > 0) {
        const label = k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();
        const fmt = v > 1000 ? v.toLocaleString("en-IN") : v % 1 !== 0 ? v.toFixed(2) : String(v);
        if (findings.length < 4) findings.push(`${label}: ${fmt}`);
      } else if (typeof v === "object" && v !== null && !Array.isArray(v) && findings.length < 4) {
        extract(v as Record<string, unknown>, depth + 1);
      }
    }
  };
  extract(context);

  const hasData = findings.length > 0;
  return {
    headline: hasData
      ? `${tabName} — AI key needed for full analysis (${findings.length} metrics detected)`
      : `${tabName} — set ANTHROPIC_API_KEY for AI-powered analysis`,
    overview: hasData
      ? `Data is loading for the ${tabName} tab — ${findings.length} metrics detected. Set ANTHROPIC_API_KEY to unlock AI analysis that cites these exact numbers.`
      : `No data detected for the ${tabName} tab yet. Connect a Meta or Google account and set ANTHROPIC_API_KEY to generate a personalised executive summary.`,
    keyFindings: hasData ? findings : ["No numeric data detected in this tab's current snapshot."],
    recommendations: hasData
      ? [
          "Set ANTHROPIC_API_KEY in .env.local and restart the dev server to unlock AI analysis.",
          "The analysis will reference the exact metrics visible in this tab — no generic advice.",
        ]
      : recs.concat(["Set ANTHROPIC_API_KEY in .env.local to enable personalised AI analysis."]),
    source: "fallback",
    creditsUsedUsd: 0,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SummaryResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { tabName, context, platform, dateRange, isDemo } = (req.body || {}) as SummaryRequest;
  if (!tabName) return res.status(400).json({ error: "Missing tabName" });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(200).json(staticFallback(tabName, context ?? {}));
  }

  try {
    const client = new Anthropic({ apiKey });

    const userPayload = {
      tabName,
      platform: platform ?? "meta",
      dateRange: dateRange ?? "last 30 days",
      data: context,
    };

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Generate an executive summary for this tab data:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block");

    // Strip markdown code fences if the model wrapped the JSON (e.g. ```json ... ```)
    const rawText = textBlock.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(rawText) as Omit<SummaryResponse, "source" | "creditsUsedUsd">;
    const creditsUsedUsd = calcCost(response.usage);

    return res.status(200).json({ ...parsed, source: "ai", creditsUsedUsd });
  } catch (err) {
    if (isDemo) return res.status(200).json(staticFallback(tabName, context ?? {}));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `AI summary failed: ${msg}` });
  }
}
