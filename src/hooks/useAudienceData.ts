/**
 * Hook for fetching audience-level data (Meta ad sets + DV360 line items)
 * with targeting info and delivery metrics.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface MetaAdSetRow {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  targeting: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversionValue: number;
  cpm: number;
  ctr: number;
  videoViews: number;
}

export interface DV360LineItemRow {
  id: string;
  name: string;
  insertionOrderId: string;
  insertionOrderName: string;
  audienceType: string;
  targeting: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpm: number;
  ctr: number;
  videoViews: number;
}

export function useMetaAdSets(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled = true
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [rows, setRows] = useState<MetaAdSetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setRows([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/reporting/adsets/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setRows(d.rows || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [startDate, endDate, metaAccessToken, metaBusinessId, demoMode, enabled]);

  return { rows, loading, error };
}

export function useDV360LineItems(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled = true
) {
  const { dv360RefreshToken, dv360AdvertiserId, demoMode } = useAuthStore();
  const [rows, setRows] = useState<DV360LineItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const token = demoMode ? "demo-google-refresh" : dv360RefreshToken;
    const adv = demoMode ? "demo-advertiser-456" : dv360AdvertiserId;
    if (!token || !adv) { setRows([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/reporting/adsets/dv360", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token, advertiserId: adv, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setRows(d.rows || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [startDate, endDate, dv360RefreshToken, dv360AdvertiserId, demoMode, enabled]);

  return { rows, loading, error };
}
