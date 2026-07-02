/**
 * AIExecutiveSummary — AI-powered tab analysis with two rendering modes:
 *
 * Default (no `inline` prop): full-width gradient panel (legacy bottom position).
 * `inline` mode: compact button placed next to the tab title. When clicked,
 * a dropdown panel appears below the button.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, BookOpen, Lightbulb, X } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import { toDisplayCredits } from "@/lib/ai-cost";
import { AI_SUMMARY_CACHE, summaryKey, type SummaryResponse } from "@/lib/ai-summary-cache";

interface Props {
  tabName: string;
  /** Serialisable snapshot of the tab's current data — passed verbatim to Claude. */
  context: Record<string, unknown>;
  platform?: "meta" | "google" | "both";
  dateRange?: string;
  /** Render as a compact inline button next to the tab title. Panel drops below on click. */
  inline?: boolean;
}

// ~1500 input tokens + 800 output ≈ $0.0044 raw → displayed at toDisplayCredits
const SUMMARY_ESTIMATE_DISPLAY = `~${toDisplayCredits(0.0044).toFixed(2)}`;

export default function AIExecutiveSummary({ tabName, context, platform, dateRange, inline }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { metaAccessToken, googleAccessToken, addAiCredits } = useAuthStore();
  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!googleAccessToken || isDemoCredential(googleAccessToken)),
    [metaAccessToken, googleAccessToken]
  );

  const cacheKey = useMemo(
    () => summaryKey(tabName, platform ?? "any", dateRange),
    [tabName, platform, dateRange]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!inline || !open) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [inline, open]);

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
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
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

  // ── Shared panel content ────────────────────────────────────────────────────
  const PanelContent = () => (
    <>
      {loading && (
        <div className="flex items-center gap-3 text-sm text-gray-600 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-violet-600 shrink-0" />
          <span>Generating executive summary — analysing your {tabName} data…</span>
        </div>
      )}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          Couldn&apos;t generate summary: {error}. Please try again.
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
    </>
  );

  // ── Inline mode: compact button + dropdown panel ────────────────────────────
  if (inline) {
    return (
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={handleToggle}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 transition whitespace-nowrap shadow-sm"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Sparkles className="w-4 h-4" />}
          AI Summary
          {!data && !loading && (
            <span className="text-xs opacity-60">{SUMMARY_ESTIMATE_DISPLAY}</span>
          )}
          {open ? <ChevronUp className="w-4 h-4 opacity-60" /> : <ChevronDown className="w-4 h-4 opacity-60" />}
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-2 w-[min(560px,90vw)] z-50 rounded-xl border border-violet-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-bold text-gray-900">AI Executive Summary — {tabName}</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
              <PanelContent />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Default mode: full-width panel (legacy) ─────────────────────────────────
  return (
    <div className="mt-8 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 overflow-hidden shadow-sm">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-violet-100/50 transition text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm">View AI Executive Summary</div>
            <div className="text-xs text-gray-500 mt-0.5">
              AI-powered analysis of your {tabName} data with actionable recommendations
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!data && !loading && (
            <span className="text-xs font-semibold text-violet-600 bg-violet-100 border border-violet-200 px-2 py-0.5 rounded-full">
              {SUMMARY_ESTIMATE_DISPLAY}
            </span>
          )}
          {open ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-violet-200 px-6 py-5 bg-white">
          <PanelContent />
        </div>
      )}
    </div>
  );
}
