/**
 * Shared hook for fetching the campaign list from Meta + DV360 for a given
 * date range. Used by Reporting tabs that need spend / impressions / clicks /
 * conversions per campaign — same data AccountStructureTab loads internally.
 *
 * Returns { campaigns, loading, error, platformErrors }. Empty array when no
 * credentials. When one platform fails and the other succeeds, `campaigns`
 * holds the successful platform's rows and `platformErrors.<platform>` carries
 * the failure so tabs can show a "partial data" banner instead of failing silently.
 */

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import type { DateRange } from "@/components/shared/DateRangePicker";

// 5-minute client-side SWR cache for DV360 campaigns (localStorage).
// Keyed by advertiserId + date range so different windows never cross-pollinate.
const DV360_SWR_TTL_MS = 5 * 60 * 1000;

function swrKey(advertiserId: string, start: string, end: string) {
  return `dv360_campaigns:${advertiserId}:${start}:${end}`;
}

function swrRead(key: string): CampaignData[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { rows, ts } = JSON.parse(raw) as { rows: CampaignData[]; ts: number };
    if (Date.now() - ts > DV360_SWR_TTL_MS) { localStorage.removeItem(key); return null; }
    return rows;
  } catch { return null; }
}

function swrWrite(key: string, rows: CampaignData[]) {
  try { localStorage.setItem(key, JSON.stringify({ rows, ts: Date.now() })); } catch { /* quota */ }
}

function rangeToDates(
  range: DateRange,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd)
    return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

export function useCampaigns(
  platform: "meta" | "dv360" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const {
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
    demoMode,
    metaCurrency: storedMetaCurrency,
    dv360Currency: storedDv360Currency,
    setMetaCurrency,
    setDv360Currency,
  } = useAuthStore();

  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformErrors, setPlatformErrors] = useState<{ meta?: string; dv360?: string }>({});
  // Track whether we seeded from the SWR cache so we don't flash a spinner.
  const swrSeeded = useRef(false);
  // DV360 delivery arrives via an async Bid Manager report that is often still
  // generating on the first request (the route returns campaigns with zeroed
  // metrics and resumes on the next call). Re-poll — like the breakdown hooks —
  // so the Delivered numbers fill in on their own instead of staying at zero.
  const dvRetries = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);
  const MAX_DV360_RETRIES = 12; // slow DV360 accounts: keep resuming the async reach/delivery reports across more cycles

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  // On first render (and when the key params change) pre-populate from the
  // DV360 SWR cache so the UI renders immediately without waiting for the API.
  const effectiveAdvertiserId = demoMode ? "demo-advertiser-1" : dv360AdvertiserId;
  useEffect(() => {
    swrSeeded.current = false;
    dvRetries.current = 0; // fresh account/date window — restart the DV360 poll budget
    if (!effectiveAdvertiserId || !(platform === "dv360" || platform === "both")) return;
    const key = swrKey(effectiveAdvertiserId, startDate, endDate);
    const cached = swrRead(key);
    if (cached && cached.length > 0) {
      setCampaigns(cached);
      // Only skip the spinner for DV360-only mode. In "both" mode the DV360
      // cache doesn't include Meta, so clearing loading here would briefly show
      // a misleading "no Meta data" state until the Meta fetch lands — keep
      // loading true so Meta-dependent views show a loading state, not "empty".
      if (platform === "dv360") {
        swrSeeded.current = true;
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, effectiveAdvertiserId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const fetchCampaigns = async () => {
      // If we already have stale data from localStorage, don't flash a spinner.
      // On re-poll ticks keep the (named) campaigns on screen — only the delivery
      // numbers are still filling in — rather than flashing a spinner each poll.
      setLoading(reloadTick === 0 && !swrSeeded.current);
      setError(null);
      setPlatformErrors({});
      const errs: { meta?: string; dv360?: string } = {};
      const all: CampaignData[] = [];
      try {
        const effectiveMetaToken = demoMode ? "demo-meta-token" : metaAccessToken;
        const effectiveMetaBiz = demoMode ? "demo-business-123" : metaBusinessId;
        if ((platform === "meta" || platform === "both") && effectiveMetaToken && effectiveMetaBiz) {
          const r = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: effectiveMetaToken,
              businessId: effectiveMetaBiz,
              startDate,
              endDate,
            }),
          });
          if (r.ok) {
            all.push(...(await r.json()));
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            errs.meta = body.error || `Meta API error (HTTP ${r.status})`;
          }
        }
        const effectiveDv360Refresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
        if (
          (platform === "dv360" || platform === "both") &&
          effectiveDv360Refresh &&
          (demoMode || (dv360ClientId && dv360ClientSecret && dv360AdvertiserId))
        ) {
          const r = await fetch("/api/naming/campaigns/dv360", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: demoMode ? "demo-client" : dv360ClientId,
              clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
              refreshToken: effectiveDv360Refresh,
              advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
              partnerId: dv360PartnerId || undefined,
              startDate,
              endDate,
            }),
          });
          if (r.ok) {
            const rows: CampaignData[] = await r.json();
            all.push(...rows);
            // Write fresh rows to the SWR cache so the next page load is instant.
            if (effectiveAdvertiserId && rows.length > 0) {
              swrWrite(swrKey(effectiveAdvertiserId, startDate, endDate), rows);
            }
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            errs.dv360 = body.error || `DV360 API error (HTTP ${r.status})`;
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        if (!cancelled) {
          setCampaigns(all);
          setPlatformErrors(errs);
          // Keep legacy `error` populated for existing consumers.
          const first = errs.meta || errs.dv360;
          if (first) setError(first);
          setLoading(false);
          // Cache each platform's detected currency (sticky) so a later
          // rate-limited fetch that drops a platform still renders the right
          // symbol. Done here (not in a separate effect) to keep hook count fixed.
          const m = all.find((c) => c.platform === "meta" && c.currency)?.currency;
          const d = all.find((c) => c.platform === "dv360" && c.currency)?.currency;
          if (m) setMetaCurrency(m);
          if (d) setDv360Currency(d);

          // DV360 re-poll: DV360 delivery comes from async Bid Manager reports that
          // are often still generating on the first call — and unique reach lives in
          // a SEPARATE, slower REACH report. Keep asking every 5s until both the
          // delivery metrics AND reach have landed (or the poll budget runs out).
          // Genuine zero-delivery / no-reach accounts simply exhaust the retries.
          if (!errs.dv360 && (platform === "dv360" || platform === "both") && !demoMode) {
            const dv = all.filter((c) => c.platform === "dv360");
            const dvDelivered = dv.reduce((s, c) => s + (c.spend || 0) + (c.impressions || 0), 0);
            const dvReach = dv.reduce((s, c) => s + (c.reach || 0), 0);
            const pending = dv.length > 0 && (dvDelivered === 0 || dvReach === 0);
            if (pending && dvRetries.current < MAX_DV360_RETRIES) {
              dvRetries.current += 1;
              retryTimer = setTimeout(() => { if (!cancelled) setReloadTick((t) => t + 1); }, 5000);
            }
          }
        }
      }
    };
    fetchCampaigns();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    platform,
    startDate,
    endDate,
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    demoMode,
    reloadTick,
  ]);

  // Per-platform account currencies. Detect strictly from each platform's own
  // campaigns (never cross-fall-back, so DV360's USD can't mislabel Meta's INR).
  // Cache the detected value in the store so a later rate-limited fetch that
  // returns no campaigns for a platform still renders the right symbol.
  const detectedMeta = campaigns.find((c) => c.platform === "meta" && c.currency)?.currency;
  const detectedDv360 = campaigns.find((c) => c.platform === "dv360" && c.currency)?.currency;

  const metaCurrency = detectedMeta || storedMetaCurrency || "USD";
  const dv360Currency = detectedDv360 || storedDv360Currency || "USD";

  return { campaigns, loading, error, platformErrors, startDate, endDate, metaCurrency, dv360Currency };
}
