/**
 * AI-generated industry funnel benchmarks.
 *
 * Takes an industry name + list of funnel stages, returns benchmark conversion
 * rates as percentages. Uses Claude Haiku 4.5 for low-latency / cheap calls
 * with prompt caching on the system prompt.
 *
 * When ANTHROPIC_API_KEY is missing, returns a 503 — these are real-data
 * dashboards and we don't want users seeing made-up generic numbers.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface BenchmarkRequest {
  industry: string;
  /** Funnel stage names, e.g. ["PageView", "ViewContent", "AddToCart", "Purchase"]. */
  stages: string[];
  /** Platform context, helps the model pick the right benchmark profile. */
  platform?: "meta" | "dv360" | "both";
}

interface BenchmarkResponse {
  industry: string;
  values: Record<string, number>;
  source: "ai"; creditsUsedUsd?: number;
  rationale?: string;
}

const SYSTEM_PROMPT = `You are an expert performance-marketing analyst with deep knowledge of conversion-funnel benchmarks across industries. The user is auditing their ad campaigns and wants the most realistic current funnel-stage benchmark rates for their specific industry.

For each stage they provide, output a benchmark conversion rate as a percentage of the TOP of funnel (PageView = 100). Use the most recent industry data you know — Shopify Benchmarks, Meta Industry Reports, Wordstream/Google data, Triple Whale, Northbeam, and similar published sources.

Rules:
- PageView (or view_item) is always 100% — it's the baseline.
- Each subsequent stage drops. Stage N value is a % of the original PageView, not of the previous stage.
- Be conservative — use medians, not best-in-class.
- Output ONLY valid JSON matching the provided schema. No prose outside the JSON.

Example for "E-commerce — Apparel":
{
  "industry": "E-commerce — Apparel",
  "values": {"PageView": 100, "ViewContent": 78, "AddToCart": 22, "InitiateCheckout": 9, "AddPaymentInfo": 6, "Purchase": 2.5},
  "rationale": "Apparel ecom typically sees 78% product page view rate, sharp cart drop to 22% from outfit hesitation, and 2-3% purchase conversion is the median."
}`;

/**
 * Build the structured-output schema for the requested stages.
 * Anthropic's json_schema mode does NOT support `additionalProperties` as a
 * schema (dynamic keys), so we turn each requested stage into a fixed numeric
 * property and lock `additionalProperties: false`.
 */
function buildOutputSchema(stages: string[]) {
  const stageProps: Record<string, { type: "number"; description: string }> = {};
  for (const stage of stages) {
    stageProps[stage] = {
      type: "number",
      description: `Benchmark % for ${stage} (0-100, where PageView = 100).`,
    };
  }
  return {
    type: "object" as const,
    properties: {
      industry: { type: "string" as const },
      values: {
        type: "object" as const,
        description: "Stage name → benchmark percentage (0-100, where PageView = 100).",
        properties: stageProps,
        required: stages,
        additionalProperties: false,
      },
      rationale: {
        type: "string" as const,
        description: "One-sentence explanation of the industry pattern.",
      },
    },
    required: ["industry", "values"],
    additionalProperties: false,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BenchmarkResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as BenchmarkRequest;
  if (!body?.industry || !Array.isArray(body.stages) || body.stages.length === 0) {
    res.status(400).json({ error: "Missing industry or stages[]" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        "Industry benchmarks require ANTHROPIC_API_KEY. Set it in .env.local and restart the dev server.",
    });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });

    const userPayload = {
      industry: body.industry,
      stages: body.stages,
      platform: body.platform || "both",
    };

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
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
          schema: buildOutputSchema(body.stages),
        },
      },
      messages: [
        {
          role: "user",
          content: `Industry benchmark request:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    const parsed = JSON.parse(textBlock.text) as { industry: string; values: Record<string, number>; rationale?: string };

    if (!parsed.values || Object.keys(parsed.values).length === 0) {
      throw new Error("AI response missing benchmark values");
    }

    const creditsUsedUsd = calcCost(response.usage);
    res.status(200).json({
      industry: parsed.industry,
      values: parsed.values,
      source: "ai",
      rationale: parsed.rationale,
      creditsUsedUsd,
    });
  } catch (error) {
    console.error("Industry-benchmark AI call failed:", error);
    const message = error instanceof Error ? error.message : "AI call failed";
    res.status(502).json({
      error: `Could not generate industry benchmarks: ${message}. Please try again.`,
    });
  }
}
