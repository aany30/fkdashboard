/**
 * POST /api/ai/chat
 *
 * Conversational AI for ad-account questions.
 * Body: { question, context, platform, dateRange, history, isDemo }
 * Response: { answer, creditsUsedUsd, source }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  question: string;
  context?: Record<string, unknown>;
  platform?: string;
  dateRange?: string;
  history?: ChatMessage[];
  isDemo?: boolean;
}

interface ChatResponse {
  answer: string;
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are a senior paid-media analyst. The user is asking about their Meta or Google ad account. You have a live JSON snapshot of their account.

HARD RULES:
- Every answer MUST reference specific numbers from the data snapshot (campaign names, spend, ROAS, CTR, CPA, etc.). Responses with no account-specific numbers are forbidden.
- When comparing campaigns, name them explicitly: "Your 'Summer Sale' campaign has ROAS 4.2× vs 'Brand Awareness' at 0.9×."
- Never give generic best-practice advice that ignores the data (e.g. "consider testing new creatives" with no reference to which campaign or metric).
- If a metric the user asks about isn't in the snapshot, say so clearly and tell them exactly where to find it in Ads Manager.
- Never hallucinate numbers. If it's not in the data, say it's not available.
- Format: **bold** key numbers, bullet points for lists, keep under 300 words unless depth is genuinely needed.
- Be direct — no preambles, no filler.`;

function staticFallback(question: string): ChatResponse {
  return {
    answer: `I can see you're asking: "${question}"\n\nTo get AI-powered answers about your ad account, an **Anthropic API key** needs to be configured on the server.\n\nIn the meantime, here's what you can check:\n- **Performance**: Review the Reporting → Overview tab for KPI summaries\n- **Tracking issues**: Check Audit → Pixel Health and Event Quality tabs\n- **Budget**: See the Account Structure tab for campaign-level spend\n- **Recommendations**: The AI Recommendations tab has prioritized action items`,
    source: "fallback",
    creditsUsedUsd: 0,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChatResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { question, context, platform, dateRange, history = [], isDemo } =
    (req.body || {}) as ChatRequest;

  if (!question?.trim()) return res.status(400).json({ error: "Missing question" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json(staticFallback(question));

  try {
    const client = new Anthropic({ apiKey });

    const contextBlock = context
      ? `\n\nAccount data snapshot:\n\`\`\`json\n${JSON.stringify(context, null, 2).slice(0, 8000)}\n\`\`\``
      : "";

    const systemWithContext = `${SYSTEM_PROMPT}\n\nPlatform: ${platform ?? "meta"}\nDate range: ${dateRange ?? "last 30 days"}${contextBlock}`;

    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: question },
    ];

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [{ type: "text", text: systemWithContext, cache_control: { type: "ephemeral" } }],
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block");

    return res.status(200).json({
      answer: textBlock.text,
      source: "ai",
      creditsUsedUsd: calcCost(response.usage),
    });
  } catch (err) {
    if (isDemo) return res.status(200).json(staticFallback(question));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `AI chat failed: ${msg}` });
  }
}
