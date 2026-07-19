/**
 * Fetches Floodlight health data for DV360. Returns group info, activity
 * list with 14-day conversion trends, and health status per activity.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface FloodlightActivity {
  id: string;
  name: string;
  type: string;
  countingMethod: string;
  clickLookbackDays: number;
  viewLookbackDays: number;
  servingStatus: string;
  sslRequired?: boolean;
  lineItemCount?: number;
  activeLineItemCount?: number;
  conversions14d: number[];
  revenue14d: number[];
}

export interface FloodlightData {
  group: { id: string; name: string } | null;
  windowStart: string | null;
  windowEnd: string | null;
  activities: FloodlightActivity[];
  note?: string;
}

export type ActivityHealth = "healthy" | "declining" | "zero" | "disabled";

export function activityHealth(a: FloodlightActivity): ActivityHealth {
  if (a.servingStatus !== "ENABLED") return "disabled";
  const total = a.conversions14d.reduce((s, v) => s + v, 0);
  if (total === 0) return "zero";
  const first7 = a.conversions14d.slice(0, 7).reduce((s, v) => s + v, 0);
  const last7 = a.conversions14d.slice(7).reduce((s, v) => s + v, 0);
  if (first7 > 0 && last7 < first7 * 0.5) return "declining";
  return "healthy";
}

export function useFloodlight() {
  const {
    dv360ClientId, dv360ClientSecret, dv360RefreshToken,
    dv360AdvertiserId, dv360PartnerId, demoMode,
  } = useAuthStore();

  const [data, setData] = useState<FloodlightData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/audit/floodlight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: demoMode ? "demo-client" : dv360ClientId,
        clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
        refreshToken: effectiveRefresh,
        advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
        partnerId: dv360PartnerId || undefined,
      }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) { setError(body.error); setData(null); }
        else setData(body);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId]);

  return { data, loading, error };
}
