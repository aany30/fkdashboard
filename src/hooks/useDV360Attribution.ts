/**
 * DV360 attribution health — Floodlight lookback windows + post-click/post-view
 * conversion split, from /api/audit/dv360-attribution. Post-click/view is only
 * available for CM360-hybrid advertisers; third-party configs return totals only
 * (the route sets postClickViewAvailable + notes accordingly).
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface DV360Activity {
  id: string; name: string; clickLookbackDays: number; viewLookbackDays: number; servingStatus: string;
}
export interface DV360ConvSplit {
  campaign: string; campaignId?: string; totalConversions: number; postClick: number; postView: number;
}
export interface DV360AttributionState {
  loading: boolean;
  cm360Linked?: boolean;
  configType?: string;
  floodlightGroupId?: string | null;
  postClickViewAvailable?: boolean;
  activities?: DV360Activity[];
  conversionSplit?: DV360ConvSplit[];
  totals?: { totalConversions: number; postClick: number; postView: number };
  notes?: string[];
  error?: string;
}

export function useDV360Attribution(enabled: boolean) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } = useAuthStore();
  const [state, setState] = useState<DV360AttributionState>({ loading: false });

  useEffect(() => {
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!enabled || (!demoMode && (!dv360RefreshToken || !dv360AdvertiserId))) { setState({ loading: false }); return; }
    let cancelled = false;
    setState({ loading: true });
    fetch("/api/audit/dv360-attribution", {
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
      .then((data) => {
        if (cancelled) return;
        if (data.error) setState({ loading: false, error: data.error });
        else setState({ loading: false, ...data });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, error: "Network error" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, demoMode, dv360RefreshToken, dv360AdvertiserId]);

  return state;
}
