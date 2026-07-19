/**
 * AI-powered "How to fix this" recommendations.
 *
 * Behavior:
 * - If ANTHROPIC_API_KEY is set, calls Claude Haiku 4.5 with a cached system
 *   prompt and the full campaign/account/sibling-metric context. Returns
 *   structured step-by-step fix instructions.
 * - If ANTHROPIC_API_KEY is missing OR the API call fails, falls back to the
 *   static recipe library in src/lib/fix-recipes.ts. Falls through silently;
 *   the UI never sees an error.
 *
 * Model: claude-haiku-4-5 (fast + cheap; the dashboard needs sub-2s responses).
 * Caching: the system prompt is wrapped in cache_control:ephemeral so repeat
 * calls within 5 minutes only pay ~0.1× on the prefix.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { getStaticRecipe, type FixRecipe } from "@/lib/fix-recipes";
import { calcCost } from "@/lib/ai-cost";

interface FixRequest {
  metric: string;
  value: string | number;
  status: "bad" | "warn" | "critical" | "moderate";
  platform?: "meta" | "dv360" | "both";
  threshold?: string;
  campaignContext?: Record<string, unknown>;
  accountContext?: Record<string, unknown>;
  auditContext: {
    module: string;
    siblingMetrics?: Record<string, string | number>;
  };
  /**
   * True when the client has only demo credentials. Real-data connections
   * must NOT fall back to the static recipe library — if AI is unavailable
   * for a real-data request, return an error rather than a generic recipe.
   */
  isDemo?: boolean;
}

interface FixResponse extends FixRecipe { creditsUsedUsd?: number; // already added
  source: "ai" | "fallback";
}

const SYSTEM_PROMPT = `You are an expert paid-media auditor at a top performance-marketing agency. You receive a JSON payload with a FAILING metric and full account context, including a "platform" field. Your job: produce 4-8 concrete, click-by-click fix steps for the RIGHT platform's UI — Meta Ads Manager when platform is "meta", Display & Video 360 (DV360) when platform is "dv360". For DV360, use DV360's real hierarchy and labels (Insertion Orders, Line Items, budget segments, flight dates, Audience Lists, Bid Strategy) — never Meta terms like "ad set" or "Advantage+", and never generic "Google Ads" (DV360 is a separate product from Google Ads). When platform is "both", give steps for whichever platform each finding belongs to and label them.

HARD RULES — every rule is mandatory:
1. Title MUST name the campaign (if campaignContext.name exists) AND state the exact failing number. E.g. "Fix ROAS for 'Summer_Sale_Promo' — currently 0.8× vs account avg 3.2×". Generic titles like "Improve ROAS" are forbidden.
2. Every step MUST cite at least one number from campaignContext or accountContext. A step with no number from the data is forbidden.
3. Compare against accountContext when present. E.g. "This campaign's CPA ₹850 is 2.4× your account average ₹350 — scale back spend until creative is refreshed."
4. Cross-check siblingMetrics. If multiple KPIs are bad, fix the root cause, not the symptom. E.g. low CTR + low CVR = likely audience-creative mismatch, not a bidding issue.
5. If campaignContext is absent, use accountContext totals to make steps volume-specific (e.g. "Your ₹2.4L/month spend split across 14 campaigns means each campaign averages ₹17k — any campaign below ₹5k needs to be paused or merged").
6. UI labels must be exact as they appear in the target platform's UI (Meta Ads Manager or DV360). No paraphrasing button names, and never mix Meta and DV360 terminology.
7. Skip all preamble. Start steps immediately. No "I understand your concern" or "Great question".
8. WINDOW-STABLE RECOMMENDATIONS: if campaignContext.fullHistory is present, base your assessment and fix steps PRIMARILY on that full-history (all-time) performance — it is independent of the user's selected date range. Treat campaignContext.window as merely "the currently-displayed slice". The recommendation for a given campaign must be essentially the SAME regardless of whether the user picked 7/30/90 days. Never advise action solely because the current window shows zero (e.g. "no spend — investigate") when fullHistory shows the campaign did deliver; instead reason about the campaign's real all-time performance and flight dates.

Output ONLY valid JSON matching the provided schema.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    title: {
      type: "string" as const,
      description:
        "Short headline (under 80 chars) that names the campaign by name if campaignContext was provided, and states what to fix.",
    },
    steps: {
      type: "array" as const,
      description:
        "3 to 8 click-by-click steps, ordered. Keep it within that range.",
      items: {
        type: "object" as const,
        properties: {
          action: {
            type: "string" as const,
            description:
              "One specific click-by-click instruction citing real UI labels and the actual numbers from the campaign data when relevant.",
          },
          links: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                label: { type: "string" as const },
                url: { type: "string" as const },
              },
              required: ["label", "url"],
              additionalProperties: false,
            },
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    platform: {
      type: "string" as const,
      enum: ["meta", "dv360", "both"],
    },
  },
  required: ["title", "steps", "platform"],
  additionalProperties: false,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FixResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as FixRequest;
  if (!body || !body.metric || !body.auditContext) {
    res.status(400).json({ error: "Missing required fields: metric, auditContext" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isDemo = body.isDemo === true;

  // ---- No API key path ----
  // - Demo mode → static fallback (so the dashboard still works in dev without an API key)
  // - Real data → return an error rather than fake recipes. Real campaigns deserve real, data-aware answers.
  if (!apiKey) {
    if (isDemo) {
      const recipe = getStaticRecipe(body.metric);
      res.status(200).json({ ...recipe, source: "fallback", creditsUsedUsd: 0 });
      return;
    }
    res.status(503).json({
      error:
        "AI recommendations require ANTHROPIC_API_KEY to be set. Real-data dashboards do not use the static recipe library — connect AI to see context-aware fix steps.",
    });
    return;
  }

  // ---- AI path → Claude Haiku 4.5 ----
  try {
    const client = new Anthropic({ apiKey });

    // User message is the full context payload — every field flows through
    // so the AI can give a specific, non-generic answer.
    const userPayload = {
      metric: body.metric,
      value: body.value,
      status: body.status,
      platform: body.platform,
      threshold: body.threshold,
      campaignContext: body.campaignContext,
      accountContext: body.accountContext,
      auditContext: body.auditContext,
    };

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // 5-minute ephemeral cache — system prompt is identical across all
          // requests, so the prefix stays cached and warm-cache cost is ~0.1×.
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: OUTPUT_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `Failing metric and full context:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    // Extract the JSON content from the response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    const parsed = JSON.parse(textBlock.text) as FixRecipe;

    // Sanity check the response shape
    if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("AI response missing required fields");
    }

    const creditsUsedUsd = calcCost(response.usage);
    res.status(200).json({ ...parsed, source: "ai", creditsUsedUsd });
  } catch (error) {
    console.error("Fix-recommendation AI call failed:", error);
    // Demo mode → graceful static fallback so the dashboard still demos something.
    // Real data → surface the error. Users connected real campaigns; don't show
    // them generic recipes that ignore their actual data.
    if (isDemo) {
      const recipe = getStaticRecipe(body.metric);
      res.status(200).json({ ...recipe, source: "fallback", creditsUsedUsd: 0 });
      return;
    }
    const message = error instanceof Error ? error.message : "AI call failed";
    res.status(502).json({
      error: `Could not generate AI fix steps: ${message}. Please try again in a moment.`,
    });
  }
}
