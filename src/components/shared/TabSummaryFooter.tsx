/**
 * TabSummaryFooter — shown at the bottom of every major tab.
 *
 * - `lines` (2-3 strings): rule-based static summary, zero API cost.
 * - "Detailed AI Summary" button: calls the API immediately on click and
 *   renders the full summary inline — no second click required.
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Sparkles, Loader2, BookOpen, Lightbulb } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import { toDisplayCredits, calcCost } from "@/lib/ai-cost";
import { AI_SUMMARY_CACHE, summaryKey, type SummaryResponse } from "@/lib/ai-summary-cache";

const CREDIT_ESTIMATE = toDisplayCredits(0.0044).toFixed(2);

interface Props {
  lines: string[];
  tabName: string;
  context: Record<string, unknown>;
  platform: "meta" | "google";
  dateRange?: string;
}

export default function TabSummaryFooter({ lines, tabName, context, platform, dateRange }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { metaAccessToken, googleAccessToken, addAiCredits } = useAuthStore();
  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!googleAccessToken || isDemoCredential(googleAccessToken)),
    [metaAccessToken, googleAccessToken]
  );

  const cacheKey = summaryKey(tabName, platform, dateRange);

  const fetchSummary = useCallback(async () => {
    const cached = AI_SUMMARY_CACHE.get(cacheKey);
    if (cached) { setData(cached); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/executive-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabName, context, platform, dateRange, isDemo }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SummaryResponse;
      AI_SUMMARY_CACHE.set(cacheKey, json);
      setData(json);
      if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, tabName, context, platform, dateRange, isDemo, addAiCredits]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) fetchSummary();
  };

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50">
      {/* Static free summary */}
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2.5">
              Summary
            </div>
            <ul className="space-y-1.5">
              {lines.map((line, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <button
            onClick={handleToggle}
            className="shrink-0 inline-flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-xl border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {open ? "Hide AI Summary" : "Detailed AI Summary"}
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
            {!open && (
              <span className="text-[10px] font-medium text-blue-400">~{CREDIT_ESTIMATE} credits</span>
            )}
          </button>
        </div>
      </div>

      {/* AI summary — fetches immediately on open, renders inline */}
      {open && (
        <div className="border-t border-gray-200 px-6 py-5 bg-white rounded-b-xl">
          {loading && (
            <div className="flex items-center gap-3 text-sm text-gray-600 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-violet-600 shrink-0" />
              <span>Generating AI summary — analysing your {tabName} data…</span>
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              Couldn&apos;t generate summary: {error}.{" "}
              <button onClick={fetchSummary} className="underline font-semibold">Try again</button>
            </div>
          )}
          {data && !loading && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-bold text-gray-900">{data.headline}</h3>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">{data.overview}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4 text-gray-600" />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Key Findings</span>
                  </div>
                  <ul className="space-y-2">
                    {data.keyFindings.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-violet-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-4 h-4 text-violet-600" />
                    <span className="text-xs font-bold text-violet-700 uppercase tracking-wide">Recommendations</span>
                  </div>
                  <ul className="space-y-2">
                    {data.recommendations.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <Sparkles className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="text-[10px] text-gray-400 italic flex items-center gap-1 pt-2 border-t border-gray-100">
                {data.source === "ai"
                  ? <><Sparkles className="w-3 h-3" />AI-generated from your {tabName} data</>
                  : <><BookOpen className="w-3 h-3" />Sample analysis — connect AI for real insights</>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
