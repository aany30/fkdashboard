/**
 * Shared hook for fetching Meta ad-set level insights.
 * Used by all Audience Analysis tabs (Funnel, Performance, Saturation, etc.).
 */

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { AdSetRow } from "@/pages/api/audience/adset-insights/meta";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { buildAudienceMap, type CustomAudienceDetail } from "@/lib/audience-classifier";

export type { AdSetRow };

export function useAdSetInsights(
  platform: "meta" | "google" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [adsets, setAdsets] = useState<AdSetRow[]>([]);
  const [audiences, setAudiences] = useState<CustomAudienceDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("INR");
  const [accountReach, setAccountReach] = useState(0);
  const [accountFrequency, setAccountFrequency] = useState(0);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (platform === "google") {
      setAdsets([]);
      setAudiences([]);
      return;
    }
    const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
    const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!effectiveToken || !effectiveBiz) { setAdsets([]); setAudiences([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/audience/adset-insights/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, startDate, endDate }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(`API error ${r.status}${text && !text.startsWith("<!") ? ": " + text.substring(0, 200) : ""}`);
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setAdsets(data.adsets || []);
        setAudiences(data.audiences || []);
        setAccountReach(data.accountReach || 0);
        setAccountFrequency(data.accountFrequency || 0);
        if (data.currency) setCurrency(data.currency);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  const audienceMap = useMemo(() => buildAudienceMap(audiences), [audiences]);

  return { adsets, audiences, audienceMap, loading, error, currency, accountReach, accountFrequency, startDate, endDate };
}
