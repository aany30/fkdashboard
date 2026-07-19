/**
 * Cross-campaign frequency burden + monthly exposure intensity for DV360.
 * Backed by real Bid Manager REACH reports (async), so this polls every 5s
 * while either section is still generating server-side.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface DV360FrequencyBurden {
  crossCampaign: { reach: number; frequency: number } | null;
  crossCampaignPending: boolean;
  monthly: Array<{ month: string; partial?: boolean; reach: number; frequency: number }>;
  monthlyPending: boolean;
  notes: string[];
}

const EMPTY: DV360FrequencyBurden = { crossCampaign: null, crossCampaignPending: false, monthly: [], monthlyPending: false, notes: [] };

export function useDV360FrequencyBurden(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled: boolean = true
) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } =
    useAuthStore();

  const [data, setData] = useState<DV360FrequencyBurden>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setData(EMPTY); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setData(EMPTY);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async (attempt: number) => {
      if (cancelled) return;
      if (attempt === 0) { setLoading(true); setError(null); }
      try {
        const r = await fetch("/api/audit/dv360-frequency-burden", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
            refreshToken: effectiveRefresh,
            advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
            partnerId: dv360PartnerId || undefined,
            startDate, endDate,
          }),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        if (cancelled) return;
        setData({
          crossCampaign: body.crossCampaign ?? null,
          crossCampaignPending: !!body.crossCampaignPending,
          monthly: body.monthly ?? [],
          monthlyPending: !!body.monthlyPending,
          notes: body.notes ?? [],
        });
        setLoading(false);
        if ((body.crossCampaignPending || body.monthlyPending) && attempt < 12) {
          retryTimer = setTimeout(() => fetchOnce(attempt + 1), 5_000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fetch failed");
          setData(EMPTY);
          setLoading(false);
        }
      }
    };

    fetchOnce(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, enabled, demoMode, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId]);

  return { ...data, loading, error };
}
