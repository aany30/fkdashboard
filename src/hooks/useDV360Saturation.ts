/**
 * DV360 saturation/expansion hook — per-line-item spend, frequency, reach, CTR,
 * CPM, CPA, ROAS from the Bid Manager saturation route. Handles the async 202
 * pending retry like useDV360Breakdown. Exposes reachAvailable / revenueAvailable
 * so the UI only shows metrics that are genuinely present (no proxies).
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { DV360SaturationRow } from "@/pages/api/audience/dv360-saturation";

export function useDV360Saturation(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled: boolean = true
) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } =
    useAuthStore();

  const [rows, setRows] = useState<DV360SaturationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reachAvailable, setReachAvailable] = useState(false);
  const [revenueAvailable, setRevenueAvailable] = useState(false);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setRows([]);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async (attempt: number) => {
      if (cancelled) return;
      if (attempt === 0) { setLoading(true); setError(null); setPending(false); }
      try {
        const r = await fetch("/api/audience/dv360-saturation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
            refreshToken: effectiveRefresh,
            advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
            partnerId: dv360PartnerId || undefined,
            startDate,
            endDate,
          }),
        });
        if (r.status === 202 && attempt < 12) {
          setPending(true);
          retryTimer = setTimeout(() => fetchOnce(attempt + 1), 5_000);
          return;
        }
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setRows(body.rows || []);
          setReachAvailable(!!body.reachAvailable);
          setRevenueAvailable(!!body.revenueAvailable);
          setPending(false);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fetch failed");
          setRows([]);
          setPending(false);
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

  return { rows, loading, pending, error, reachAvailable, revenueAvailable };
}
