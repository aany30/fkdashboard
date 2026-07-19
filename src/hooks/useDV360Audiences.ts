import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { DV360AudienceRow, DV360TargetingRow } from "@/pages/api/audience/list/dv360";

export function useDV360Audiences(enabled: boolean = true) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } =
    useAuthStore();

  const [audiences, setAudiences] = useState<DV360AudienceRow[]>([]);
  const [targeting, setTargeting] = useState<DV360TargetingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setAudiences([]); setTargeting([]); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
      setAudiences([]);
      setTargeting([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    fetch("/api/audience/list/dv360", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        clientId: demoMode ? "demo-client" : dv360ClientId,
        clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
        refreshToken: effectiveRefresh,
        advertiserId: demoMode ? "demo-advertiser" : dv360AdvertiserId,
        partnerId: dv360PartnerId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        clearTimeout(timeout);
        if (cancelled) return;
        if (data.error) { setError(data.error); setAudiences([]); setTargeting([]); }
        else {
          setAudiences(data.audiences || []);
          setTargeting(data.targeting || []);
        }
        setLoading(false);
      })
      .catch((e) => {
        clearTimeout(timeout);
        if (!cancelled) {
          setError(e instanceof Error && e.name === "AbortError" ? "Request timed out — try again" : e instanceof Error ? e.message : "Fetch failed");
          setAudiences([]);
          setTargeting([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [enabled, demoMode, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId]);

  return { audiences, targeting, loading, error };
}
