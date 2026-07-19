import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/store/auth";
import type { MetaAuditResponse } from "@/pages/api/audit/meta";
import type { DateRange } from "@/components/shared/DateRangePicker";

// Meta pixel/CAPI audit state. DV360's tracking equivalent (Floodlight) has its
// own hook (useFloodlight) — the concepts don't overlap enough to share a shape.
export interface AuditState {
  meta: MetaAuditResponse | null;
  loading: boolean;
  error: string | null;
  source: "live" | "demo" | "mixed" | null;
}

function dateRangeToParams(range: DateRange, customStart?: string, customEnd?: string) {
  if (range === "custom" && customStart && customEnd) {
    return { startDate: customStart, endDate: customEnd };
  }
  const today = new Date();
  const start = new Date(today);
  if (range === "7d") start.setDate(today.getDate() - 7);
  else if (range === "30d") start.setDate(today.getDate() - 30);
  else if (range === "90d") start.setDate(today.getDate() - 90);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

export function useAudit(
  platform: "meta" | "dv360" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
): AuditState & { refresh: () => void } {
  const {
    metaAccessToken,
    metaPixelIds,
    isMetaConnected,
    demoMode,
  } = useAuthStore();
  // In demo mode, send demo-prefixed placeholders so the API endpoints take
  // their isDemoCredential() branch and return demo data — without ever
  // writing those placeholders into localStorage.
  const effectiveMetaToken = demoMode ? "demo-meta-token" : metaAccessToken;
  const effectiveMetaConnected = demoMode ? true : isMetaConnected();

  const [state, setState] = useState<AuditState>({
    meta: null,
    loading: true,
    error: null,
    source: null,
  });

  const fetchAudit = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const { startDate, endDate } = dateRangeToParams(dateRange, customStart, customEnd);
    let metaData: MetaAuditResponse | null = null;
    let fetchError: string | null = null;

    if ((platform === "meta" || platform === "both") && effectiveMetaConnected && effectiveMetaToken) {
      try {
        const r = await fetch("/api/audit/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: effectiveMetaToken,
            pixelIds: demoMode ? ["demo-pixel-001", "demo-pixel-002"] : metaPixelIds,
            businessId: demoMode ? "demo-business-123" : useAuthStore.getState().metaBusinessId,
            startDate,
            endDate,
          }),
        });
        const d = await r.json();
        if (!r.ok) fetchError = d.error || `Meta API error (HTTP ${r.status})`;
        else metaData = d;
      } catch (e) {
        fetchError = e instanceof Error ? e.message : "Meta fetch failed";
      }
    }

    const source: AuditState["source"] = metaData
      ? ((metaData as MetaAuditResponse & { source?: string }).source === "demo" ? "demo" : "live")
      : null;

    setState({ meta: metaData, loading: false, error: fetchError, source });
  }, [
    platform,
    dateRange,
    customStart,
    customEnd,
    demoMode,
    metaAccessToken,
    metaPixelIds,
    isMetaConnected,
  ]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  return { ...state, refresh: fetchAudit };
}
