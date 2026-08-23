/**
 * Dedicated DV360 unique-reach hook — per-line-item reach from a
 * FILTER_LINE_ITEM REACH report (same dimension the Saturation tab uses).
 *
 * Returns raw per-LI reach and also computes per-campaign reach by summing
 * LIs that belong to each campaign (mapped via adSets → ads hierarchy from
 * the campaign data, or via the campaignId field in the reach report row).
 */

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { CampaignData } from "@/types";

type LIReachMap = Record<string, { reach: number; frequency: number; campaignId?: string; name: string }>;
type ReachMap = Record<string, { reach: number; frequency: number }>;

export function useDV360Reach(
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled: boolean = true,
  campaigns?: CampaignData[]
) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId, demoMode } =
    useAuthStore();

  const [reachByLineItem, setReachByLineItem] = useState<LIReachMap>({});
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
  const MAX_ATTEMPTS = 12;

  // Compute earliest flight start / latest flight end across all DV360 campaigns
  // so the REACH window covers ended flights (not just "last 92 days").
  const flightBounds = useMemo(() => {
    if (!campaigns) return { flightStart: undefined as string | undefined, flightEnd: undefined as string | undefined };
    let earliest: string | undefined;
    let latest: string | undefined;
    for (const c of campaigns) {
      if (c.platform !== "dv360") continue;
      if (c.flightStart && (!earliest || c.flightStart < earliest)) earliest = c.flightStart;
      if (c.flightEnd && (!latest || c.flightEnd > latest)) latest = c.flightEnd;
    }
    return { flightStart: earliest, flightEnd: latest };
  }, [campaigns]);

  useEffect(() => {
    if (!enabled) { setReachByLineItem({}); return; }
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!effectiveRefresh || !(demoMode || (dv360ClientId && dv360ClientSecret && dv360AdvertiserId))) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async (attempt: number) => {
      setLoading(true);
      try {
        const r = await fetch("/api/reporting/dv360-reach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
            refreshToken: effectiveRefresh,
            advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
            partnerId: dv360PartnerId || undefined,
            startDate, endDate,
            flightStart: flightBounds.flightStart,
            flightEnd: flightBounds.flightEnd,
          }),
        });
        const j = await r.json();
        if (cancelled) return;
        if (j.available === false) { setAvailable(false); setLoading(false); return; }
        if (j.reachByLineItem && Object.keys(j.reachByLineItem).length > 0) {
          setReachByLineItem(j.reachByLineItem);
        }
        if (j.pending && attempt < MAX_ATTEMPTS) {
          timer = setTimeout(() => fetchOnce(attempt + 1), 5000);
        } else {
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOnce(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, startDate, endDate, enabled, demoMode, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, flightBounds.flightStart, flightBounds.flightEnd]);

  // Build LI→campaign and LI→name maps from campaign hierarchy (adSets.ads).
  const { liToCampaign, liToName } = useMemo(() => {
    const campMap = new Map<string, string>();
    const nameMap = new Map<string, string>();
    if (!campaigns) return { liToCampaign: campMap, liToName: nameMap };
    for (const c of campaigns) {
      if (c.platform !== "dv360") continue;
      for (const io of c.adSets ?? []) {
        for (const li of io.ads ?? []) {
          campMap.set(li.id, c.id);
          if (li.name) nameMap.set(li.id, li.name);
        }
      }
    }
    return { liToCampaign: campMap, liToName: nameMap };
  }, [campaigns]);

  // Sum LI reach per campaign.
  const reachByCampaign = useMemo<ReachMap>(() => {
    const accum: Record<string, { reach: number; imprProxy: number }> = {};
    for (const [liId, li] of Object.entries(reachByLineItem)) {
      const cid = li.campaignId || liToCampaign.get(liId) || "unknown";
      if (!accum[cid]) accum[cid] = { reach: 0, imprProxy: 0 };
      accum[cid].reach += li.reach;
      accum[cid].imprProxy += li.reach * li.frequency;
    }
    const out: ReachMap = {};
    for (const [cid, a] of Object.entries(accum)) {
      out[cid] = { reach: a.reach, frequency: a.reach > 0 ? a.imprProxy / a.reach : 0 };
    }
    return out;
  }, [reachByLineItem, liToCampaign]);

  // Enrich LI reach with campaignId from the hierarchy map (FILTER_LINE_ITEM
  // alone doesn't include campaign IDs, so the PlanningReport LI drill-down
  // needs this to filter LIs by campaign).
  const enrichedLIReach = useMemo<LIReachMap>(() => {
    const out: LIReachMap = {};
    for (const [liId, li] of Object.entries(reachByLineItem)) {
      out[liId] = {
        ...li,
        campaignId: li.campaignId || liToCampaign.get(liId),
        name: liToName.get(liId) || li.name || liId,
      };
    }
    return out;
  }, [reachByLineItem, liToCampaign, liToName]);

  // Account-level total (sum of all LI reach).
  const advertiserReach = useMemo(() => Object.values(reachByLineItem).reduce((s, v) => s + v.reach, 0), [reachByLineItem]);
  const advertiserFrequency = useMemo(() => {
    const totalImpr = Object.values(reachByLineItem).reduce((s, v) => s + v.reach * v.frequency, 0);
    return advertiserReach > 0 ? totalImpr / advertiserReach : 0;
  }, [reachByLineItem, advertiserReach]);

  return { reachByLineItem: enrichedLIReach, reachByCampaign, advertiserReach, advertiserFrequency, loading, available };
}
