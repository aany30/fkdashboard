/**
 * Shared hook for fetching Meta breakdown data (daily, age, gender, country,
 * publisher_platform, platform_position, impression_device, etc.) from
 * /api/reporting/breakdown/meta.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface BreakdownRow {
  label: string;
  breakdownValues: Record<string, string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  reach?: number;
  frequency?: number;
  videoViews?: number;
}

export function useMetaBreakdown(
  breakdown: string,
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled = true
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setRows([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/reporting/breakdown/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, breakdown, startDate, endDate }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setRows(d.rows || []);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, startDate, endDate, metaAccessToken, metaBusinessId, demoMode, enabled]);

  return { rows, loading, error, startDate, endDate };
}
