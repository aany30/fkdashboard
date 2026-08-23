import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface LifetimeMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
}

export function useMetaCampaignLifetime(
  campaignIds: string[],
  enabled: boolean
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [data, setData] = useState<Record<string, LifetimeMetrics>>({});
  const [loading, setLoading] = useState(false);

  const key = campaignIds.slice().sort().join(",");

  useEffect(() => {
    if (!enabled || campaignIds.length === 0) { setData({}); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setData({}); return; }

    let cancelled = false;
    setLoading(true);
    fetch("/api/reporting/campaign-lifetime/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, campaignIds }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.data) setData(d.data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, metaAccessToken, metaBusinessId, demoMode, enabled]);

  return { data, loading };
}
