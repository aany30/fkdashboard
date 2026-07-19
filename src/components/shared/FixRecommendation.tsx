import { useState, useCallback, useMemo } from "react";
import { Sparkles, BookOpen, ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react";
import type { CampaignData } from "@/types";
import type { AccountContext } from "@/components/dashboard/audits/types";
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
  source: "ai" | "fallback"; creditsUsedUsd?: number;
}

interface Props {
  metric: string;
  value: string | number;
  status: "bad" | "warn" | "critical" | "moderate";
  platform?: "meta" | "dv360" | "both";
  threshold?: string;
  /** When the failure is per-campaign, the full campaign object. */
  campaignContext?: CampaignData;
  /** Account-level snapshot. */
  accountContext?: AccountContext;
  /** Required: which audit module + what other metrics are on the page. */
  auditContext: {
    module: string;
    siblingMetrics?: Record<string, string | number>;
  };
}

/**
 * Bucket numeric values into ranges so two identical-tone cards hit the same
 * cache entry within a session (e.g. 62% and 64% both → "60-70%").
 */
function bucket(value: string | number): string {
  if (typeof value === "string") return value;
  if (isNaN(value)) return "unknown";
  if (value < 0) return `<0`;
  if (value < 1) return `0-1`;
  if (value < 10) return `${Math.floor(value)}-${Math.floor(value) + 1}`;
  // For 0-100% type values, bucket every 10
  if (value <= 100) return `${Math.floor(value / 10) * 10}-${Math.floor(value / 10) * 10 + 10}`;
  // Larger — log bucket
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  return `${Math.floor(value / mag) * mag}-${(Math.floor(value / mag) + 1) * mag}`;
}

// Session-level cache — survives re-renders, not page reloads
const SESSION_CACHE = new Map<string, FixApiResponse>();

export default function FixRecommendation({
  metric,
  value,
  status,
  platform,
  threshold,
  campaignContext,
  accountContext,
  auditContext,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FixApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Determine whether the user is in demo mode (no real credentials).
  // Real-data connections must NOT fall back to static recipes per user
  // direction — AI is mandatory for real data.
  const { metaAccessToken, dv360RefreshToken, addAiCredits } = useAuthStore();
  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!dv360RefreshToken || isDemoCredential(dv360RefreshToken)),
    [metaAccessToken, dv360RefreshToken]
  );

  const cacheKey = useMemo(
    () =>
      `${metric}-${campaignContext?.id ?? "account"}-${bucket(value)}-${platform ?? "any"}`,
    [metric, campaignContext?.id, value, platform]
  );

  const fetchFix = useCallback(async () => {
    // Try cache first
    const cached = SESSION_CACHE.get(cacheKey);
    if (cached) {
      setData(cached);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric,
          value,
          status,
          platform,
          threshold,
          campaignContext,
          accountContext,
          auditContext,
          isDemo,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as FixApiResponse;
      SESSION_CACHE.set(cacheKey, json);
      setData(json); if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fix");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, metric, value, status, platform, threshold, campaignContext, accountContext, auditContext, isDemo]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) fetchFix();
  };

  return (
    <div className="mt-2">
      <button
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-1 transition"
      >
        <Sparkles className="w-3 h-3" />
        {open ? "Hide fix" : "How to fix this"}
        {!open && !data && <span className="text-[10px] text-blue-400 ml-1">~$0.02</span>}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-2 bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>Analysing your campaign data…</span>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              Couldn't load fix steps ({error}). Try again later or check the
              connection.
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
                          <a
                            key={j}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded border border-gray-200 transition"
                          >
                            {link.label}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="text-[10px] text-gray-400 italic flex items-center gap-1 pt-2 border-t border-gray-100">
                {data.source === "ai" ? (
                  <>
                    <Sparkles className="w-3 h-3" />
                    AI-generated from your campaign data
                  </>
                ) : (
                  <>
                    <BookOpen className="w-3 h-3" />
                    From recipe library
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
