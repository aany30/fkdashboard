/**
 * AI assessment of a user's TOF/MOF/BOF funnel split for their specific industry.
 *
 * Input: industry + current campaign counts + spend share + impression share
 * per funnel stage. Output: overall verdict (healthy/warn/critical), per-stage
 * diagnosis, and a prioritized "what to focus on" recommendation.
 *
 * Uses Claude Haiku 4.5 with a cached system prompt + JSON-schema structured
 * output. Returns 503 if ANTHROPIC_API_KEY is unset.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface StageStats {
  campaignCount: number;
  /** % of total campaigns (0-100, integer). */
  campaignPct: number;
  /** % of total spend in this stage (0-100, integer). May be 0 if no spend. */
  spendPct: number;
  /** % of total impressions in this stage (0-100, integer). May be 0 if no impressions. */
  impressionPct: number;
}

interface FunnelMixRequest {
  industry: string;
  totalCampaigns: number;
  tof: StageStats;
  mof: StageStats;
  bof: StageStats;
  /** % of campaigns we couldn't classify by objective. */
  unclassifiedPct?: number;
}

interface FunnelMixResponse {
  industry: string;
  /** Overall mix verdict for this niche. */
  verdict: "healthy" | "warn" | "critical";
  /** One-line summary explaining the verdict. */
  summary: string;
  /** Recommended ideal split for THIS industry (target percentages). */
  idealMix: { tof: number; mof: number; bof: number };
  /** Per-stage diagnosis: what's right / wrong for the industry. */
  stages: {
    tof: { status: "healthy" | "warn" | "critical"; note: string };
    mof: { status: "healthy" | "warn" | "critical"; note: string };
    bof: { status: "healthy" | "warn" | "critical"; note: string };
  };
  /** Ranked actions — what to do first to fix the mix. */
  focusActions: Array<{ priority: number; action: string }>;
  source: "ai"; creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are an expert performance-marketing strategist with deep knowledge of paid-media funnel structures across industries (DTC e-commerce, B2B SaaS, lead-gen, finance, beauty, apparel, consumer electronics, edtech, healthtech, marketplaces, real estate, travel, mobile apps, etc.).

You will receive a user's current TOF/MOF/BOF (Top/Middle/Bottom of Funnel) campaign mix data — campaign counts, % of total campaigns, % of total spend, % of total impressions per stage — along with their stated industry. Your job:

1. Judge whether this mix is healthy for the industry's typical buying cycle and Meta/Google performance norms.
2. Compare against the industry's idealised target split (e.g. fast-cycle DTC apparel = TOF-heavy ~50/30/20; B2B SaaS = BOF-light ~30/45/25 with strong nurture; lead-gen finance ~25/35/40 with high-intent push).
3. Per stage, classify status as healthy / warn / critical and explain WHY relative to the industry.
4. List 3-5 prioritized actions for what to focus on first.

Be specific to the industry. Don't give generic advice — cite industry-typical patterns. Use plain English. Output ONLY JSON matching the schema.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: { type: "string" as const, enum: ["healthy", "warn", "critical"] },
    summary: { type: "string" as const, description: "One-line overall judgment (under 140 chars)" },
    idealMix: {
      type: "object" as const,
      properties: {
        tof: { type: "number" as const },
        mof: { type: "number" as const },
        bof: { type: "number" as const },
      },
      required: ["tof", "mof", "bof"],
      additionalProperties: false,
    },
    stages: {
      type: "object" as const,
      properties: {
        tof: {
          type: "object" as const,
          properties: {
            status: { type: "string" as const, enum: ["healthy", "warn", "critical"] },
            note: { type: "string" as const, description: "Why this stage is in that state, industry-grounded." },
          },
          required: ["status", "note"],
          additionalProperties: false,
        },
        mof: {
          type: "object" as const,
          properties: {
            status: { type: "string" as const, enum: ["healthy", "warn", "critical"] },
            note: { type: "string" as const, description: "Why this stage is in that state, industry-grounded." },
          },
          required: ["status", "note"],
          additionalProperties: false,
        },
        bof: {
          type: "object" as const,
          properties: {
            status: { type: "string" as const, enum: ["healthy", "warn", "critical"] },
            note: { type: "string" as const, description: "Why this stage is in that state, industry-grounded." },
          },
          required: ["status", "note"],
          additionalProperties: false,
        },
      },
      required: ["tof", "mof", "bof"],
      additionalProperties: false,
    },
    focusActions: {
      type: "array" as const,
      description: "3 to 5 ranked actions — most-impactful first.",
      items: {
        type: "object" as const,
        properties: {
          priority: { type: "number" as const },
          action: { type: "string" as const, description: "Concrete, industry-specific next step." },
        },
        required: ["priority", "action"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "idealMix", "stages", "focusActions"],
  additionalProperties: false,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FunnelMixResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const body = req.body as FunnelMixRequest;
  if (!body?.industry || !body.tof || !body.mof || !body.bof) {
    res.status(400).json({ error: "Missing industry or stage stats (tof/mof/bof)" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        "AI funnel-mix analysis requires ANTHROPIC_API_KEY. Set it in .env.local and restart the dev server.",
    });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
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
          content: `Assess this TOF/MOF/BOF mix for the industry "${body.industry}":\n\n${JSON.stringify(
            {
              industry: body.industry,
              totalCampaigns: body.totalCampaigns,
              unclassifiedPct: body.unclassifiedPct ?? 0,
              tof: body.tof,
              mof: body.mof,
              bof: body.bof,
            },
            null,
            2
          )}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    const parsed = JSON.parse(textBlock.text) as Omit<FunnelMixResponse, "industry" | "source">;
    const creditsUsedUsd = calcCost(response.usage);
    res.status(200).json({
      industry: body.industry,
      verdict: parsed.verdict,
      summary: parsed.summary,
      idealMix: parsed.idealMix,
      stages: parsed.stages,
      focusActions: parsed.focusActions,
      source: "ai",
      creditsUsedUsd,
    });
  } catch (error) {
    console.error("Funnel-mix AI call failed:", error);
    const message = error instanceof Error ? error.message : "AI call failed";
    res.status(502).json({
      error: `Could not generate funnel-mix analysis: ${message}. Please try again.`,
    });
  }
}
