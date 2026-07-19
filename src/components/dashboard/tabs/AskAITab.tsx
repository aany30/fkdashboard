/**
 * Insights → Ask AI
 *
 * Conversational interface for asking questions about the connected ad account.
 * Sends account data as context with each question so answers are grounded in
 * real numbers.
 */

import { useState, useRef, useEffect } from "react";
import { Bot, Send, Sparkles, RefreshCw, User } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useCampaigns } from "@/hooks/useCampaigns";
import type { DateRange } from "@/components/shared/DateRangePicker";
import ReactMarkdown from "react-markdown";

interface Props {
  platform?: "meta" | "dv360" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  creditsUsedUsd?: number;
  source?: "ai" | "fallback";
}

const SUGGESTED_QUESTIONS = [
  "Which campaigns have the best ROAS?",
  "Where is budget being wasted?",
  "What is my overall CPM and how does it compare across campaigns?",
  "Which audience is driving the most conversions?",
  "Why might my Cost Per Purchase be high?",
  "Which campaigns should I pause or scale?",
  "What does my funnel look like from impression to conversion?",
  "Are there any campaigns with high spend but low conversions?",
];

export default function AskAITab({ platform, dateRange, customStart, customEnd }: Props) {
  const { demoMode } = useAuthStore();
  // Default to "both" so Ask AI sees Meta AND DV360 unless a single platform is
  // explicitly selected.
  const effectivePlatform = platform ?? "both";
  const { campaigns, loading: campsLoading } = useCampaigns(effectivePlatform, dateRange ?? "30d", customStart, customEnd);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [totalCredits, setTotalCredits] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildContext = () => {
    if (!campaigns.length) return undefined;
    // Per-platform summary so the model can answer about Meta and DV360
    // separately (and never blends INR + USD or Meta + DV360 numbers).
    const summarize = (list: typeof campaigns) => {
      const spend = list.reduce((s, c) => s + (c.spend || 0), 0);
      const conv = list.reduce((s, c) => s + (c.conversions || 0), 0);
      const impr = list.reduce((s, c) => s + (c.impressions || 0), 0);
      const clicks = list.reduce((s, c) => s + (c.clicks || 0), 0);
      const rev = list.reduce((s, c) => s + (c.conversionValue || 0), 0);
      return {
        campaignCount: list.length,
        currency: list.find((c) => c.currency)?.currency ?? "USD",
        totalSpend: spend, totalConversions: conv, totalImpressions: impr, totalClicks: clicks,
        overallROAS: spend > 0 ? (rev / spend).toFixed(2) : "0",
        overallCPM: impr > 0 ? ((spend / impr) * 1000).toFixed(2) : "0",
        overallCTR: impr > 0 ? ((clicks / impr) * 100).toFixed(2) + "%" : "0%",
        overallCPA: conv > 0 ? (spend / conv).toFixed(2) : "0",
      };
    };
    const metaCampaigns = campaigns.filter((c) => c.platform === "meta");
    const dv360Campaigns = campaigns.filter((c) => c.platform === "dv360");
    const mapRow = (c: typeof campaigns[number]) => {
      const sp = c.spend || 0, im = c.impressions || 0, cl = c.clicks || 0, cv = c.conversions || 0;
      return {
        platform: c.platform ?? "meta",
        name: c.name,
        objective: c.objective,
        status: c.status,
        currency: c.currency,
        spend: sp, impressions: im, clicks: cl, conversions: cv,
        reach: c.reach, frequency: c.frequency,
        roas: sp > 0 ? ((c.conversionValue || 0) / sp).toFixed(2) : "0",
        cpm: im > 0 ? ((sp / im) * 1000).toFixed(2) : "0",
        ctr: im > 0 ? ((cl / im) * 100).toFixed(2) + "%" : "0%",
        cpa: cv > 0 ? (sp / cv).toFixed(2) : "0",
      };
    };
    return {
      platform: effectivePlatform,
      byPlatform: {
        ...(metaCampaigns.length ? { meta: summarize(metaCampaigns) } : {}),
        ...(dv360Campaigns.length ? { dv360: summarize(dv360Campaigns) } : {}),
      },
      // Cap per platform so both are represented even with many campaigns.
      campaigns: [...metaCampaigns.slice(0, 20), ...dv360Campaigns.slice(0, 20)].map(mapRow),
    };
  };

  const sendMessage = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;

    const userMsg: Message = { role: "user", content: q };
    const history = messages.slice(-8);
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          context: buildContext(),
          platform: effectivePlatform,
          dateRange: typeof dateRange === "string" ? dateRange : "custom",
          history: history.map((m) => ({ role: m.role, content: m.content })),
          isDemo: demoMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const botMsg: Message = {
        role: "assistant",
        content: data.answer,
        creditsUsedUsd: data.creditsUsedUsd,
        source: data.source,
      };
      setMessages((prev) => [...prev, botMsg]);
      if (data.creditsUsedUsd) setTotalCredits((t) => t + data.creditsUsedUsd);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I couldn't process that: ${err instanceof Error ? err.message : "unknown error"}`,
          source: "fallback",
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setTotalCredits(0);
    setInput("");
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] max-h-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-600" />
            Ask AI
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Ask anything about your ad account — powered by real campaign data
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalCredits > 0 && (
            <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg font-semibold">
              ✦ ${totalCredits.toFixed(4)} used
            </span>
          )}
          {!isEmpty && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 border border-gray-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              New chat
            </button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-white">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-indigo-500" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">Ask anything about your account</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm">
              {campsLoading
                ? "Loading your account data…"
                : `${campaigns.length} campaigns loaded. Ask a question or choose a suggestion below.`}
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading || campsLoading}
                  className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : "bg-gray-50 border border-gray-200 text-gray-800 rounded-tl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-gray-900">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                  {msg.role === "assistant" && msg.creditsUsedUsd && msg.creditsUsedUsd > 0 && (
                    <p className="text-[10px] text-gray-400 mt-1.5">
                      ✦ ${msg.creditsUsedUsd.toFixed(4)}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-gray-600" />
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2 items-end">
        <div className="flex-1 border border-gray-300 rounded-xl bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your campaigns, spend, ROAS, audiences…"
            rows={1}
            className="w-full px-4 py-3 text-sm text-gray-900 placeholder-gray-400 bg-transparent resize-none focus:outline-none rounded-xl"
            style={{ maxHeight: 120, overflowY: "auto" }}
            disabled={loading}
          />
        </div>
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Suggestions strip (shown after first message) */}
      {!isEmpty && !loading && (
        <div className="mt-2 flex gap-2 flex-wrap">
          {SUGGESTED_QUESTIONS.slice(0, 4).map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
