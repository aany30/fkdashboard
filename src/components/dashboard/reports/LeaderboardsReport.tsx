/**
 * Reporting → Leaderboards.
 *
 * Top 10 + Bottom 10 campaigns side-by-side. User picks the metric (Spend /
 * ROAS / CTR / Conversions / CPA). Cost metrics auto-flip so "best" means
 * lowest. Pure client-side sort of campaigns already loaded.
 */

import { useMemo, useState } from "react";
import { Trophy, ChevronUp, ChevronDown } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentValue } from "@/hooks/useColumnPrefs";
import LoadingState from "@/components/shared/LoadingState";
import { currencyFor, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { CampaignData } from "@/types";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab: (id: string) => void;
}

type MetricId = "spend" | "roas" | "ctr" | "conversions" | "cpa" | "cpc";

interface MetricSpec {
  id: MetricId;
  label: string;
  cost: boolean; // if true, lowest is best
  format: (v: number, currency: string) => string;
  get: (c: CampaignData) => number;
}

const METRICS: MetricSpec[] = [
  { id: "spend",       label: "Spend",       cost: false, format: (v, c) => formatMoney(v, c, 0),               get: (c) => c.spend || 0 },
  { id: "roas",        label: "ROAS",        cost: false, format: (v) => v > 0 ? `${v.toFixed(2)}×` : "—",        get: (c) => (c.spend || 0) > 0 ? (c.conversionValue || 0) / (c.spend || 1) : 0 },
  { id: "ctr",         label: "CTR",         cost: false, format: (v) => v > 0 ? `${v.toFixed(2)}%` : "—",        get: (c) => (c.impressions || 0) > 0 ? ((c.clicks || 0) / (c.impressions || 1)) * 100 : 0 },
  { id: "conversions", label: "Conversions", cost: false, format: (v) => Math.round(v).toLocaleString("en-IN"),  get: (c) => c.conversions || 0 },
  { id: "cpa",         label: "CPA",         cost: true,  format: (v, c) => v > 0 ? formatMoney(v, c, 0) : "—",  get: (c) => (c.conversions || 0) > 0 ? (c.spend || 0) / (c.conversions || 1) : 0 },
  { id: "cpc",         label: "CPC",         cost: true,  format: (v, c) => v > 0 ? formatMoney(v, c, 2) : "—",  get: (c) => (c.clicks || 0) > 0 ? (c.spend || 0) / (c.clicks || 1) : 0 },
];

export default function LeaderboardsReport({ platform, dateRange, customStart, customEnd, setActiveTab: _setActiveTab }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const currency = currencyFor(campaigns, platform === "dv360" ? "dv360" : "meta");
  const [metricId, setMetricId] = usePersistentValue<MetricId>("leaderboards-metric", "spend");
  const [activeOnly, setActiveOnly] = useState(false);

  const metric = METRICS.find((m) => m.id === metricId)!;

  const { top10Raw, bottom10Raw, totalEligible } = useMemo(() => {
    const isActive = (c: CampaignData) => ["ACTIVE", "ENABLED"].includes((c.status || "").toUpperCase());
    let pool = campaigns;
    if (activeOnly) pool = pool.filter(isActive);
    // Cost metrics need a non-zero value to be ranked (otherwise zero CPA wins absurdly).
    const eligible = pool
      .map((c) => ({ c, v: metric.get(c) }))
      .filter((x) => metric.cost ? x.v > 0 : true);
    // Sort: lowest-first for cost metrics ("best CPA" = lowest), highest-first for the rest
    const sorted = [...eligible].sort((a, b) => metric.cost ? a.v - b.v : b.v - a.v);
    return {
      top10Raw: sorted.slice(0, 10).map((x) => ({ id: `top-${x.c.platform}-${x.c.id}`, name: x.c.name, v: x.v, c: x.c })),
      bottom10Raw: sorted.slice(-10).reverse().map((x) => ({ id: `bot-${x.c.platform}-${x.c.id}`, name: x.c.name, v: x.v, c: x.c })),
      totalEligible: eligible.length,
    };
  }, [campaigns, metric, activeOnly]);

  const { sorted: top10, sort: topSort, toggle: topToggle } = useSort(top10Raw, "v", "desc");
  const { sorted: bottom10, sort: botSort, toggle: botToggle } = useSort(bottom10Raw, "v", "asc");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Leaderboards</h1>
            <p className="text-gray-600 mt-1">Top 10 + Bottom 10 campaigns by the metric you pick.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">
            <span className="font-mono text-gray-700">{startDate}</span> → <span className="font-mono text-gray-700">{endDate}</span>
          </div>
          <AIExecutiveSummary
            tabName="Leaderboards Report"
            context={{
              metric: metricId,
              campaignCount: campaigns.length,
              topCampaigns: campaigns.slice(0, 5).map(c => ({ name: c.name, spend: c.spend ?? 0, roas: (c.spend ?? 0) > 0 ? +((c.conversionValue ?? 0) / (c.spend ?? 1)).toFixed(2) : 0 })),
            }}
            platform={platform}
            dateRange={String(dateRange)}
            inline
          />
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-700">Metric:</label>
          <select
            value={metricId}
            onChange={(e) => setMetricId(e.target.value as MetricId)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white"
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}{m.cost ? " (lowest = best)" : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="text-xs font-semibold text-gray-700 inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Active campaigns only
        </label>
        <span className="text-[11px] text-gray-500 ml-auto">{totalEligible} eligible campaign{totalEligible === 1 ? "" : "s"}</span>
      </div>

      {loading && <LoadingState message="Loading campaign data…" />}

      {!loading && campaigns.length === 0 && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
          <p className="text-gray-600">No campaigns in this window. Connect an account or widen the date range.</p>
        </div>
      )}

      {!loading && campaigns.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Top 10 */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-200 bg-green-50 flex items-center gap-2">
              <ChevronUp className="w-4 h-4 text-green-700" />
              <h3 className="text-sm font-bold text-green-900">Top 10 — {metric.label}</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase w-8">#</th>
                  <SortTh col="name" sort={topSort} onToggle={topToggle} className="px-4 py-2 text-[11px] uppercase font-semibold text-gray-600">Campaign</SortTh>
                  <SortTh col="v" sort={topSort} onToggle={topToggle} className="px-4 py-2 text-[11px] uppercase font-semibold text-gray-600" align="right">{metric.label}</SortTh>
                </tr>
              </thead>
              <tbody>
                {top10.map((x, idx) => (
                  <tr key={x.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500 font-mono">{idx + 1}</td>
                    <td className="px-4 py-2 font-mono text-gray-900 truncate max-w-[260px]" title={x.name}>{x.name}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{metric.format(x.v, currency)}</td>
                  </tr>
                ))}
                {top10.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500 text-xs">No campaigns ranked for this metric.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom 10 */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-200 bg-red-50 flex items-center gap-2">
              <ChevronDown className="w-4 h-4 text-red-700" />
              <h3 className="text-sm font-bold text-red-900">Bottom 10 — {metric.label}</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase w-8">#</th>
                  <SortTh col="name" sort={botSort} onToggle={botToggle} className="px-4 py-2 text-[11px] uppercase font-semibold text-gray-600">Campaign</SortTh>
                  <SortTh col="v" sort={botSort} onToggle={botToggle} className="px-4 py-2 text-[11px] uppercase font-semibold text-gray-600" align="right">{metric.label}</SortTh>
                </tr>
              </thead>
              <tbody>
                {bottom10.map((x, idx) => (
                  <tr key={x.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500 font-mono">{idx + 1}</td>
                    <td className="px-4 py-2 font-mono text-gray-900 truncate max-w-[260px]" title={x.name}>{x.name}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{metric.format(x.v, currency)}</td>
                  </tr>
                ))}
                {bottom10.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500 text-xs">No campaigns ranked for this metric.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Tip: for cost metrics (CPA, CPC) the lowest value is best. The leaderboard auto-flips the order so winners are always at the top.
      </p>

      <TabSummaryFooter
        tabName="Leaderboards Report"
        lines={[
          `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""} loaded — ${totalEligible} eligible for the selected metric (${metric.label}).`,
          `Top performer: ${top10[0]?.name ? top10[0].name.slice(0, 60) + (top10[0].name.length > 60 ? "…" : "") : "—"} · ${metric.format(top10[0]?.v ?? 0, currency)}.`,
          `Date window: ${startDate} → ${endDate}.`,
        ]}
        context={{
          campaignCount: campaigns.length,
          totalEligible,
          metric: metricId,
          startDate,
          endDate,
          campaigns: campaigns.map(c => ({
            name: c.name,
            status: c.status,
            spend: c.spend ?? 0,
            impressions: c.impressions ?? 0,
            clicks: c.clicks ?? 0,
            conversions: c.conversions ?? 0,
            conversionValue: c.conversionValue ?? 0,
            roas: (c.spend ?? 0) > 0 ? +((c.conversionValue ?? 0) / (c.spend ?? 1)).toFixed(4) : 0,
            ctr: (c.impressions ?? 0) > 0 ? +((c.clicks ?? 0) / (c.impressions ?? 1) * 100).toFixed(4) : 0,
            cpa: (c.conversions ?? 0) > 0 ? +((c.spend ?? 0) / (c.conversions ?? 1)).toFixed(4) : 0,
            cpc: (c.clicks ?? 0) > 0 ? +((c.spend ?? 0) / (c.clicks ?? 1)).toFixed(4) : 0,
          })),
        }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
