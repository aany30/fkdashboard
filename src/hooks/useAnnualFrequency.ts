/**
 * useAnnualFrequency — account-level reach + average frequency + impressions
 * over the trailing 365 days (Meta only). Always a full-year window, regardless
 * of the dashboard date range. Used by the annual frequency-distribution chart.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { AnnualFrequencyResponse, MonthlyReachFrequency } from "@/pages/api/audience/frequency/meta";

interface AnnualFrequency {
  reach: number;
  frequency: number;
  impressions: number;
  monthly: MonthlyReachFrequency[];
  currency: string;
  loading: boolean;
}

const EMPTY: AnnualFrequency = { reach: 0, frequency: 0, impressions: 0, monthly: [], currency: "USD", loading: false };

export function useAnnualFrequency(platform: "meta" | "dv360" | "both"): AnnualFrequency {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [state, setState] = useState<AnnualFrequency>(EMPTY);

  useEffect(() => {
    if (platform === "dv360") { setState(EMPTY); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setState(EMPTY); return; }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/audience/frequency/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz }),
    })
      .then((r) => r.json())
      .then((d: AnnualFrequencyResponse & { error?: string }) => {
        if (cancelled) return;
        if (d.error || d.reach === undefined) { setState(EMPTY); return; }
        setState({
          reach: d.reach, frequency: d.frequency, impressions: d.impressions,
          monthly: d.monthly || [],
          currency: d.currency || "USD", loading: false,
        });
      })
      .catch(() => { if (!cancelled) setState(EMPTY); });
    return () => { cancelled = true; };
  }, [platform, metaAccessToken, metaBusinessId, demoMode]);

  return state;
}
