/**
 * DV360 per-creative delivery hook. The underlying Bid Manager report is async
 * (Google generates it server-side), so the route 202s while pending and this
 * hook polls every 5s until done — proper loading state, never stuck.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { DV360CreativeRow } from "@/pages/api/reporting/creatives/dv360";

export function useDV360Creatives(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled: boolean = true
) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } =
    useAuthStore();

  const [creatives, setCreatives] = useState<DV360CreativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setCreatives([]); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setCreatives([]);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async (attempt: number) => {
      if (cancelled) return;
      if (attempt === 0) { setLoading(true); setError(null); setPending(false); }
      try {
        const r = await fetch("/api/reporting/creatives/dv360", {
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
        if (r.status === 202 && attempt < 20) {
          setPending(true);
          retryTimer = setTimeout(() => fetchOnce(attempt + 1), 5_000);
          return;
        }
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setCreatives(body.creatives || []);
          setPending(false);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fetch failed");
          setCreatives([]);
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

  return { creatives, loading, pending, error };
}
