/**
 * AI recommendations for Event Match Quality (EMQ) and Match-Key Coverage gaps.
 *
 * Returns TWO structured layers:
 *   1. technicalFixes  — settings/code changes the dev team can implement today
 *   2. businessActions — UX, process, or GTM changes to improve data collection
 *
 * Why two layers? A gap can be caused by either a misconfiguration (fixable in
 * an afternoon by a developer) OR by a business problem (e.g. the site never
 * asks for phone numbers so the `ph` key is always empty). The audience and
 * urgency differ — technical team vs growth/product team.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

export interface EMQFixRequest {
  /** "emq" or "match_key" */
  type: "emq" | "match_key";
  /** Event name (for EMQ) or match-key label (for coverage) */
  subject: string;
  /** Current measured value */
  currentValue: number;
  /** Benchmark / target */
  benchmark: number;
  /** Variance = current - benchmark */
  variance: number;
  /** Extra context: all other values in the same table */
  tableContext?: Record<string, string | number>;
}

export interface EMQFixResponse {
  /** Steps the developer/tech team can take immediately (settings, code, CAPI config) */
  technicalFixes: Array<{ step: string; impact: "high" | "medium" | "low" }>;
  /** Steps the business/growth/product team should take (UX, forms, consent, CRM) */
  businessActions: Array<{ step: string; impact: "high" | "medium" | "low" }>;
  /** One-line overall verdict */
  summary: string;
  source: "ai" | "fallback"; creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are an expert Meta Ads tracking consultant specialising in Event Match Quality (EMQ), Conversions API (CAPI), and match-key data quality. You advise both technical developers and growth/marketing managers.

When given a gap between current EMQ score or match-key coverage and its benchmark, you produce TWO distinct recommendation layers:

1. TECHNICAL FIXES — things the developer or tracking engineer can implement immediately:
   - Meta Events Manager settings (automatic matching, CAPI setup, event_id, etc.)
   - Pixel code changes, GTM configuration
   - CAPI server-side data enrichment
   - Specific parameter additions to event payloads
   - deduplication, hashing, data normalisation

2. BUSINESS ACTIONS — things the product, growth, or marketing team needs to drive:
   - Form design (asking for email/phone, reducing friction)
   - Checkout flow changes
   - CRM data enrichment
   - Consent management (GDPR/CCPA)
   - Customer data strategy

Rules:
- Be SPECIFIC. Name exact Meta UI screens, settings, or code snippets where relevant.
- PRIORITISE by impact. Most impactful fix first.
- If a gap is small (≤ 0.5 for EMQ, ≤ 5% for coverage) say so — minor optimisation only.
- If technically everything is correct and the gap is purely a business data-capture problem, say so clearly.
- Max 4 items per layer. Plain English. No jargon-defining-jargon.
- Output ONLY JSON matching the schema.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string" as const,
      description: "One-sentence overall verdict (under 120 chars)",
    },
    technicalFixes: {
      type: "array" as const,
      description: "Up to 4 technical fixes — code/settings/CAPI changes",
      items: {
        type: "object" as const,
        properties: {
          step: { type: "string" as const },
          impact: { type: "string" as const, enum: ["high", "medium", "low"] },
        },
        required: ["step", "impact"],
        additionalProperties: false,
      },
    },
    businessActions: {
      type: "array" as const,
      description: "Up to 4 business/UX/process actions",
      items: {
        type: "object" as const,
        properties: {
          step: { type: "string" as const },
          impact: { type: "string" as const, enum: ["high", "medium", "low"] },
        },
        required: ["step", "impact"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "technicalFixes", "businessActions"],
  additionalProperties: false,
};

// Static fallbacks when no API key is set
const FALLBACKS: Record<string, Omit<EMQFixResponse, "source">> = {
  em: {
    summary: "Email coverage is below benchmark — likely a data-capture gap rather than a technical issue.",
    technicalFixes: [
      { step: "Enable automatic email matching in Meta Events Manager → Pixel → Settings → Automatic Advanced Matching → toggle Email.", impact: "high" },
      { step: "Pass hashed email (SHA-256, lowercase) in CAPI server events via the `em` parameter.", impact: "high" },
    ],
    businessActions: [
      { step: "Add email field to checkout and account-creation forms. Even optional email fields improve coverage.", impact: "high" },
      { step: "Offer incentive (discount code, newsletter) to capture email before purchase.", impact: "medium" },
    ],
  },
  ph: {
    summary: "Phone coverage is low — phone is rarely collected on e-commerce sites by default.",
    technicalFixes: [
      { step: "Enable phone matching in Events Manager → Pixel → Settings → Automatic Advanced Matching.", impact: "high" },
      { step: "Pass hashed phone in CAPI `ph` parameter. Accept E.164 format (+917XXXXXXXX) before hashing.", impact: "high" },
    ],
    businessActions: [
      { step: "Add optional phone field to checkout. Frame it as 'for order updates' to reduce friction.", impact: "high" },
      { step: "Collect phone at account sign-up or loyalty programme enrolment.", impact: "medium" },
    ],
  },
  fbc: {
    summary: "FB Click ID (fbc) coverage is below benchmark — landing page isn't capturing the URL parameter.",
    technicalFixes: [
      { step: "Read the `fbclid` query parameter from landing-page URLs and store it as a first-party cookie named `_fbc`.", impact: "high" },
      { step: "Pass the `_fbc` cookie value in CAPI events via the `fbc` parameter.", impact: "high" },
      { step: "Ensure Meta Pixel's `fbq('init', ...)` call fires before page redirect strips URL params.", impact: "medium" },
    ],
    businessActions: [
      { step: "Preserve URL parameters across redirects (e.g. checkout pages). Work with dev to avoid stripping fbclid.", impact: "high" },
    ],
  },
  emq_low: {
    summary: "EMQ score is below benchmark — multiple signals are either missing or misconfigured.",
    technicalFixes: [
      { step: "Enable Automatic Advanced Matching in Events Manager for all available fields (email, phone, name).", impact: "high" },
      { step: "Add event_id to every browser and CAPI event for deduplication — this alone can raise EMQ by 1–2 points.", impact: "high" },
      { step: "Send hashed customer PII (em, ph, fn, ln) in CAPI payloads alongside browser pixel events.", impact: "high" },
    ],
    businessActions: [
      { step: "Ensure checkout collects email and phone — these are the two highest-weight EMQ signals.", impact: "high" },
      { step: "Implement a CRM sync to enrich CAPI events with known-customer data (email, phone, external_id).", impact: "medium" },
    ],
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EMQFixResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as EMQFixRequest;
  if (!body?.subject || body.currentValue === undefined || body.benchmark === undefined) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Pick the best static fallback
    const fbKey = body.subject.toLowerCase().replace(/\s/g, "_");
    const fallback =
      FALLBACKS[fbKey] ||
      (body.type === "emq" ? FALLBACKS.emq_low : FALLBACKS.em);
    res.status(200).json({ ...fallback, source: "fallback", creditsUsedUsd: 0 });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Provide recommendations for this ${body.type === "emq" ? "EMQ" : "match-key coverage"} gap:\n\n${JSON.stringify(
            {
              subject: body.subject,
              type: body.type,
              currentValue: body.currentValue,
              benchmark: body.benchmark,
              variance: body.variance,
              tableContext: body.tableContext || {},
            },
            null,
            2
          )}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block");
    const parsed = JSON.parse(textBlock.text) as Omit<EMQFixResponse, "source">;
    const creditsUsedUsd = calcCost(response.usage);
    res.status(200).json({ ...parsed, source: "ai", creditsUsedUsd });
  } catch (error) {
    console.error("EMQ fix AI call failed:", error);
    const fallback = body.type === "emq" ? FALLBACKS.emq_low : FALLBACKS.em;
    res.status(200).json({ ...fallback, source: "fallback", creditsUsedUsd: 0 });
  }
}
