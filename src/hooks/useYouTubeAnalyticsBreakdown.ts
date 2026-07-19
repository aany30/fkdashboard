/**
 * YouTube Analytics demographic breakdown — fetches age or gender rows from
 * /api/reporting/breakdown/youtube-analytics (which calls the YouTube Analytics
 * API v2). Uses the same DV360 credentials (same refresh token) but requires
 * the yt-analytics.readonly scope to have been granted.
 *
 * Returns `missingScope: true` when the scope is absent — the UI can then show
 * a "reconnect to enable YouTube demographics" prompt.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { DV360BreakdownRow } from "./useDV360Breakdown";

export function useYouTubeAnalyticsBreakdown(
  breakdown: "age" | "gender",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled: boolean = true
) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, demoMode } =
    useAuthStore();

  const [rows, setRows] = useState<DV360BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingScope, setMissingScope] = useState(false);
  const [apiDisabled, setApiDisabled] = useState(false);
  const [noChannel, setNoChannel] = useState(false);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setRows([]);
      return;
    }

    let cancelled = false;

    const fetchOnce = async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setMissingScope(false);
      setApiDisabled(false);
      setNoChannel(false);
      try {
        const r = await fetch("/api/reporting/breakdown/youtube-analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
            refreshToken: effectiveRefresh,
            breakdown,
            startDate,
            endDate,
          }),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setRows(body.rows || []);
          setMissingScope(!!body.missingScope);
          setApiDisabled(!!body.apiDisabled);
          setNoChannel(!!body.noChannel);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fetch failed");
          setRows([]);
          setLoading(false);
        }
      }
    };

    fetchOnce();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, startDate, endDate, enabled, demoMode, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId]);

  return { rows, loading, error, missingScope, apiDisabled, noChannel, startDate, endDate };
}
