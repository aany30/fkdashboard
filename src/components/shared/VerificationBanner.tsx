/**
 * Passive verification banner — runs in the background after Account Structure
 * loads. Calls /api/verify/auto with the campaigns' spend snapshot, gets
 * back a match/drift report, and surfaces a small status chip at the top
 * of the audit. Polls every 60s.
 *
 * Three states:
 *   ✓ Verified   — campaign-level sum matches Meta account-level total exactly
 *   ⚠ Drift      — N campaigns diverge from Meta (clickable to see details)
 *   ⊘ Error      — couldn't reach Meta (rate limit, token expired, etc.)
 */

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import { currencyFor, formatMoney } from "@/lib/currency";

interface CampaignDiff {
  campaignId: string;
  ourSpend: number;
  metaSpend: number;
  match: boolean;
  deltaPct: number;
}

interface VerifyResp {
  status: "verified" | "drift" | "error";
  message: string;
  ourTotal: number;
  metaAccountTotal: number;
  metaCampaignSumTotal: number;
  campaignsChecked: number;
  driftedCampaigns: CampaignDiff[];
  attributionUsed: string;
  verifiedAt: string;
}

interface Props {
  campaigns: CampaignData[];
  startDate?: string;
  endDate?: string;
}

const POLL_INTERVAL_MS = 60_000;

export default function VerificationBanner({ campaigns, startDate, endDate }: Props) {
  const { metaAccessToken, metaBusinessId } = useAuthStore();
  const [data, setData] = useState<VerifyResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Stable signature: only re-verify when campaign set or window changes meaningfully.
  // Use ids + spend so we don't re-fire on every render.
  const campaignsKey = campaigns
    .filter((c) => c.platform === "meta")
    .map((c) => `${c.id}:${c.spend ?? 0}`)
    .join(",");

  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const metaCampaigns = campaigns.filter((c) => c.platform === "meta");
    if (metaCampaigns.length === 0) return;

    let cancelled = false;
    const runVerify = async () => {
      setLoading(true);
      try {
        const ourCampaignSpend: Record<string, number> = {};
        for (const c of metaCampaigns) ourCampaignSpend[c.id] = c.spend ?? 0;
        // Use the campaign's effectiveAttribution (most common across them) if available.
        // Fall back to the global default by passing undefined.
        const labels = Array.from(new Set(metaCampaigns.map((c) => c.effectiveAttribution).filter(Boolean) as string[]));
        // Convert "1-day click + 1-day view" back to ["1d_click","1d_view"] format
        // for the verify endpoint. Pick the most common label.
        const attributionWindows = labels.length === 1
          ? labels[0].split(" + ").map((s) => {
              const m = /^(\d+)-day\s+(\w+)$/.exec(s.trim());
              return m ? `${m[1]}d_${m[2].toLowerCase()}` : "";
            }).filter(Boolean)
          : undefined;

        const r = await fetch("/api/verify/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: metaAccessToken,
            businessId: metaBusinessId,
            startDate,
            endDate,
            ourCampaignSpend,
            attributionWindows,
          }),
        });
        const json = await r.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) {
          setData({
            status: "error",
            message: "Couldn't reach the verification endpoint.",
            ourTotal: 0,
            metaAccountTotal: 0,
            metaCampaignSumTotal: 0,
            campaignsChecked: 0,
            driftedCampaigns: [],
            attributionUsed: "—",
            verifiedAt: new Date().toISOString(),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    runVerify();
    const id = setInterval(runVerify, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId, startDate, endDate, campaignsKey]);

  if (!metaAccessToken) return null;
  const metaCampaigns = campaigns.filter((c) => c.platform === "meta");
  if (metaCampaigns.length === 0) return null;

  const currency = currencyFor(campaigns, "meta");
  const verifiedAgo = data ? secondsAgo(data.verifiedAt) : 0;

  return (
    <div
      className={`rounded-lg border px-4 py-2.5 text-xs ${
        data?.status === "verified"
          ? "bg-green-50 border-green-200 text-green-800"
          : data?.status === "drift"
          ? "bg-yellow-50 border-yellow-200 text-yellow-900"
          : data?.status === "error"
          ? "bg-red-50 border-red-200 text-red-800"
          : "bg-gray-50 border-gray-200 text-gray-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {loading && !data ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying against Meta…</span>
            </>
          ) : data?.status === "verified" ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <span className="font-semibold">Verified against Meta</span>
              <span className="text-green-700">·</span>
              <span>{data.campaignsChecked} campaigns · total {formatMoney(data.metaAccountTotal, currency)} · attribution: {data.attributionUsed}</span>
            </>
          ) : data?.status === "drift" ? (
            <>
              <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0" />
              <span className="font-semibold">Drift detected vs Meta</span>
              <span className="text-yellow-700">·</span>
              <span>{data.message}</span>
            </>
          ) : data?.status === "error" ? (
            <>
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="font-semibold">Verification error</span>
              <span className="text-red-700">·</span>
              <span className="truncate">{data.message}</span>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Initialising verification…</span>
            </>
          )}
        </div>
        {data && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] opacity-70">Verified {verifiedAgo}s ago</span>
            {data.driftedCampaigns.length > 0 && (
              <button
                onClick={() => setExpanded((s) => !s)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold underline underline-offset-2"
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {expanded ? "Hide" : `Show ${data.driftedCampaigns.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && data && data.driftedCampaigns.length > 0 && (
        <div className="mt-2 pt-2 border-t border-yellow-200">
          <div className="grid grid-cols-1 gap-1">
            {data.driftedCampaigns.map((d) => (
              <div key={d.campaignId} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                <code className="text-yellow-900">{d.campaignId}</code>
                <span>
                  Ours: <span className="font-semibold">{formatMoney(d.ourSpend, currency)}</span>
                  {" · "}
                  Meta: <span className="font-semibold">{formatMoney(d.metaSpend, currency)}</span>
                  {" · "}
                  <span className="text-red-700">Δ {d.deltaPct.toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-yellow-800 italic mt-2">
            Drift typically means a campaign's spend was cached/aggregated while Meta has since updated it.
            Refreshing the page or waiting ~60s will usually reconcile. Persistent drift &gt; 5% suggests a
            real aggregation bug — open the campaign in Ads Manager to compare directly.
          </p>
        </div>
      )}
    </div>
  );
}

function secondsAgo(iso: string): number {
  try {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  } catch {
    return 0;
  }
}
