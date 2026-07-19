/**
 * Fetches daily breakdown for the current window AND the immediately prior
 * window of the same length. Used by the Overview's KPI cards (current vs
 * previous period deltas + sparklines).
 *
 * Meta: synchronous fetch from /api/reporting/breakdown/meta
 * DV360: async fetch from /api/reporting/breakdown/dv360 with 202-retry
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface DailyPoint {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  reach?: number;
  frequency?: number;
}

function prevWindow(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate   + "T00:00:00Z");
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const prevEnd   = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate:   prevEnd.toISOString().slice(0, 10),
  };
}

/** Sum two daily series by date label — used for the "All" trend line. */
function mergeDaily(a: DailyPoint[], b: DailyPoint[]): DailyPoint[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const byLabel = new Map<string, DailyPoint>();
  for (const rows of [a, b]) {
    for (const p of rows) {
      const cur = byLabel.get(p.label);
      if (!cur) {
        byLabel.set(p.label, { ...p });
      } else {
        cur.spend += p.spend;
        cur.impressions += p.impressions;
        cur.clicks += p.clicks;
        cur.conversions += p.conversions;
        cur.conversionValue += p.conversionValue;
        if (p.reach != null) cur.reach = (cur.reach ?? 0) + p.reach;
      }
    }
  }
  return [...byLabel.values()].sort((x, y) => x.label.localeCompare(y.label));
}

export interface PlatformDaily {
  current: DailyPoint[];
  previous: DailyPoint[];
}

export function useMetaDailyVsPrev(
  platform: "meta" | "dv360" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const {
    metaAccessToken, metaBusinessId,
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId,
    demoMode,
  } = useAuthStore();
  const [current, setCurrent] = useState<DailyPoint[]>([]);
  const [previous, setPrevious] = useState<DailyPoint[]>([]);
  // Per-platform split — populated in "both" mode so the Overview can render
  // separated Meta / DV360 subtotal strips (never blended without labels).
  const [byPlatform, setByPlatform] = useState<{ meta: PlatformDaily; dv360: PlatformDaily }>({
    meta: { current: [], previous: [] },
    dv360: { current: [], previous: [] },
  });
  const [loading, setLoading] = useState(true);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
  const prev = prevWindow(startDate, endDate);

  useEffect(() => {
    let cancelled = false;
    let retryTimers: ReturnType<typeof setTimeout>[] = [];

    const fetchMetaDaily = (s: string, e: string) => {
      const token = demoMode ? "demo-meta-token" : metaAccessToken;
      const biz   = demoMode ? "demo-business-123" : metaBusinessId;
      if (!token || !biz) return Promise.resolve([] as DailyPoint[]);
      return fetch("/api/reporting/breakdown/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, businessId: biz, breakdown: "daily", startDate: s, endDate: e }),
      })
        .then(r => r.json())
        .then(d => (d.rows || []) as DailyPoint[]);
    };

    const fetchDv360Daily = (s: string, e: string): Promise<DailyPoint[]> => {
      const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
      if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId)))
        return Promise.resolve([]);

      return new Promise((resolve) => {
        const attempt = (n: number) => {
          if (cancelled) { resolve([]); return; }
          fetch("/api/reporting/breakdown/dv360", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: demoMode ? "demo-client" : dv360ClientId,
              clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
              refreshToken: effectiveRefresh,
              advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
              partnerId: dv360PartnerId || undefined,
              breakdown: "daily", startDate: s, endDate: e,
            }),
          })
            .then(async (r) => {
              if (cancelled) { resolve([]); return; }
              if (r.status === 202 && n < 12) {
                const t = setTimeout(() => attempt(n + 1), 5_000);
                retryTimers.push(t);
                return;
              }
              const data = await r.json();
              resolve((data.rows || []) as DailyPoint[]);
            })
            .catch(() => resolve([]));
        };
        attempt(0);
      });
    };

    if (platform === "dv360") {
      setLoading(true);
      Promise.all([
        fetchDv360Daily(startDate, endDate),
        fetchDv360Daily(prev.startDate, prev.endDate),
      ])
        .then(([cur, pr]) => {
          if (cancelled) return;
          setCurrent(cur); setPrevious(pr);
          setByPlatform({ meta: { current: [], previous: [] }, dv360: { current: cur, previous: pr } });
        })
        .catch(() => { if (!cancelled) { setCurrent([]); setPrevious([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else if (platform === "both") {
      // Fetch both platforms in parallel; trend = summed by date, and the
      // per-platform split is kept for separated subtotal strips.
      setLoading(true);
      Promise.all([
        fetchMetaDaily(startDate, endDate),
        fetchMetaDaily(prev.startDate, prev.endDate),
        fetchDv360Daily(startDate, endDate),
        fetchDv360Daily(prev.startDate, prev.endDate),
      ])
        .then(([mCur, mPrev, dCur, dPrev]) => {
          if (cancelled) return;
          setCurrent(mergeDaily(mCur, dCur));
          setPrevious(mergeDaily(mPrev, dPrev));
          setByPlatform({ meta: { current: mCur, previous: mPrev }, dv360: { current: dCur, previous: dPrev } });
        })
        .catch(() => { if (!cancelled) { setCurrent([]); setPrevious([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const token = demoMode ? "demo-meta-token" : metaAccessToken;
      const biz   = demoMode ? "demo-business-123" : metaBusinessId;
      if (!token || !biz) { setCurrent([]); setPrevious([]); return; }

      setLoading(true);
      Promise.all([fetchMetaDaily(startDate, endDate), fetchMetaDaily(prev.startDate, prev.endDate)])
        .then(([cur, pr]) => {
          if (cancelled) return;
          setCurrent(cur); setPrevious(pr);
          setByPlatform({ meta: { current: cur, previous: pr }, dv360: { current: [], previous: [] } });
        })
        .catch(() => { if (!cancelled) { setCurrent([]); setPrevious([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; retryTimers.forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, prev.startDate, prev.endDate, metaAccessToken, metaBusinessId, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, demoMode]);

  return { current, previous, byPlatform, loading, startDate, endDate, prevStartDate: prev.startDate, prevEndDate: prev.endDate };
}
