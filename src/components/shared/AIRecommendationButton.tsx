/**
 * AIRecommendationButton — inline button placed next to Critical/Medium/High
 * status badges. Calls the same /api/recommendations/fix endpoint as
 * FixRecommendation but carries consistent "AI Recommendation" branding.
 */

import { useState, useCallback, useMemo } from "react";
import { Sparkles, ChevronDown, ChevronUp, ExternalLink, Loader2, BookOpen } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";

interface FixStep {
  action: string;
  links?: Array<{ label: string; url: string }>;
}

interface FixApiResponse {
  title: string;
  platform: "meta" | "dv360" | "both";
  steps: FixStep[];
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

export interface AIRecommendationButtonProps {
  metric: string;
  value: string | number;
  status: "bad" | "warn" | "critical" | "moderate";
  platform?: "meta" | "dv360" | "both";
  threshold?: string;
  auditContext: {
    module: string;
    siblingMetrics?: Record<string, string | number>;
  };
  campaignContext?: Record<string, unknown>;
  accountContext?: Record<string, unknown>;
  /** Compact inline mode — smaller button, no outer margin. Default false. */
  compact?: boolean;
}

const SESSION_CACHE = new Map<string, FixApiResponse>();

export default function AIRecommendationButton({
  metric, value, status, platform, threshold,
  auditContext, campaignContext, accountContext, compact = false,
}: AIRecommendationButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FixApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { metaAccessToken, dv360RefreshToken, addAiCredits } = useAuthStore();
  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!dv360RefreshToken || isDemoCredential(dv360RefreshToken)),
    [metaAccessToken, dv360RefreshToken]
  );

  // Cache key includes campaign name + exact value so each campaign gets its own
  // personalised response rather than sharing a cached generic one.
  const cacheKey = useMemo(() => {
    const campaignId = (campaignContext as Record<string, unknown> | undefined)?.name
      ?? (campaignContext as Record<string, unknown> | undefined)?.id
      ?? "account";
    return `airec-${metric}-${String(value)}-${platform ?? "any"}-${campaignId}`;
  }, [metric, value, platform, campaignContext]);

  const fetchFix = useCallback(async () => {
    const cached = SESSION_CACHE.get(cacheKey);
    if (cached) { setData(cached); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric, value, status, platform, threshold,
          campaignContext, accountContext, auditContext, isDemo,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as FixApiResponse;
      SESSION_CACHE.set(cacheKey, json);
      setData(json);
      if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, metric, value, status, platform, threshold, campaignContext, accountContext, auditContext, isDemo, addAiCredits]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) fetchFix();
  };

  return (
    <div className={compact ? "inline-block" : "mt-2"}>
      <button
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-md px-2 py-1 transition whitespace-nowrap"
      >
        <Sparkles className="w-3 h-3" />
        AI Recommendation
        {!open && !data && <span className="text-[10px] text-violet-400 ml-0.5">~$0.02</span>}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className={`${compact ? "absolute z-30 left-0 w-80" : ""} mt-2 bg-white border border-violet-200 rounded-lg p-3 shadow-sm`}>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
              <span>Analysing your data…</span>
            </div>
          )}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              Couldn't load steps ({error}). Try again.
            </div>
          )}
          {data && !loading && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-gray-900">{data.title}</h4>
              <ol className="list-decimal list-outside ml-5 space-y-2 text-sm text-gray-700 leading-relaxed">
                {data.steps.map((step, i) => (
                  <li key={i}>
                    <div>{step.action}</div>
                    {step.links && step.links.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {step.links.map((link, j) => (
                          <a key={j} href={link.url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded border border-gray-200 transition">
                            {link.label}<ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="text-[10px] text-gray-400 italic flex items-center gap-1 pt-2 border-t border-gray-100">
                {data.source === "ai"
                  ? <><Sparkles className="w-3 h-3" />AI-generated from your data</>
                  : <><BookOpen className="w-3 h-3" />From recipe library</>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
