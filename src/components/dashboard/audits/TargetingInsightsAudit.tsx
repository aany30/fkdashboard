/**
 * Targeting Insights — recommends where to focus Meta ad spend.
 *
 * Pulls Meta `/insights?breakdowns=...` for 4 dimensions (Age, Gender,
 * Country, Device/Placement) and surfaces:
 *   - Top 3 segments by ROAS / CPA  → "FOCUS HERE — your winners"
 *   - Bottom 3 segments → "CONSIDER REDUCING — these are draining spend"
 *   - Honest empty-state when a dimension returns nothing
 *
 * Each dimension is one Meta API call (cheap — ~1–2s) batched in parallel.
 * Conversions use the account's default 7d_click+1d_view attribution so
 * numbers match Ads Manager.
 *
 * Note on Interests: Meta deprecated the standalone Audience Insights API in
 * 2021. We cannot pull "interest performance" the same way. A future v1.1
 * could parse current campaign targeting via /{adset}/targeting and infer
 * interest performance from there — not in v1.
 */

import { useEffect, useMemo, useState } from "react";
import { Target, MapPin, Users as UsersIcon, Smartphone, TrendingUp, TrendingDown, Sparkles, Info } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import type { AuditProps } from "./types";
import { currencyFor, formatMoney } from "@/lib/currency";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

type Dim = "age" | "gender" | "country" | "impression_device" | "publisher_platform" | "age,gender";

interface Row {
  label: string;
  breakdownValues: Record<string, string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  // derived
  roas: number;
  cpa: number;
  ctr: number;
}

const DIMENSIONS: Array<{ id: Dim; label: string; icon: typeof Target; description: string }> = [
  { id: "age",                label: "Age",         icon: UsersIcon,  description: "Which age buckets convert best" },
  { id: "gender",             label: "Gender",      icon: UsersIcon,  description: "Where your spend converts by gender" },
  { id: "country",            label: "Places",      icon: MapPin,     description: "Top countries by ROAS — focus your budget here" },
  { id: "impression_device",  label: "Device",      icon: Smartphone, description: "iPhone vs Android vs Desktop performance" },
  { id: "publisher_platform", label: "Placement",   icon: Target,     description: "Facebook vs Instagram vs Audience Network" },
  { id: "age,gender",         label: "Age × Gender", icon: UsersIcon, description: "Crossed: which age + gender combo is your sweet spot" },
];

function deriveRow(row: Omit<Row, "roas" | "cpa" | "ctr">): Row {
  return {
    ...row,
    roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
    cpa: row.conversions > 0 ? row.spend / row.conversions : 0,
    ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
  };
}

export default function TargetingInsightsAudit({ campaigns: _campaigns, dateRange, customStart, customEnd, platform = "meta" }: AuditProps) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [activeDim, setActiveDim] = useState<Dim>("age");
  const [data, setData] = useState<Record<Dim, Row[] | null>>({
    age: null, gender: null, country: null, impression_device: null, publisher_platform: null, "age,gender": null,
  });
  const [loading, setLoading] = useState<Record<Dim, boolean>>({
    age: false, gender: false, country: false, impression_device: false, publisher_platform: false, "age,gender": false,
  });
  const [error, setError] = useState<string | null>(null);

  const currency = currencyFor(_campaigns, "meta");

  // Derive date range for the API call
  const { startDate, endDate } = useMemo(() => {
    if (dateRange === "custom" && customStart && customEnd) {
      return { startDate: customStart, endDate: customEnd };
    }
    const today = new Date();
    const start = new Date(today);
    const days = dateRange === "7d" ? 7 : dateRange === "90d" ? 90 : 30;
    start.setDate(today.getDate() - days);
    return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
  }, [dateRange, customStart, customEnd]);

  // Fetch the active dimension when it changes (or when the date range changes)
  useEffect(() => {
    if (data[activeDim] !== null) return; // already fetched
    const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
    const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!effectiveToken || !effectiveBiz) {
      setError("Connect a Meta account to see targeting insights.");
      return;
    }
    setLoading((l) => ({ ...l, [activeDim]: true }));
    setError(null);
    fetch("/api/reporting/breakdown/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, breakdown: activeDim, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        const rows = (res.rows || []).map(deriveRow);
        setData((d) => ({ ...d, [activeDim]: rows }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Fetch failed"))
      .finally(() => setLoading((l) => ({ ...l, [activeDim]: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDim, startDate, endDate, demoMode]);

  // Reset cached data when the date range changes
  useEffect(() => {
    setData({ age: null, gender: null, country: null, impression_device: null, publisher_platform: null, "age,gender": null });
  }, [startDate, endDate]);

  const rows = data[activeDim] || [];
  const { sorted: sortedRows, sort, toggle } = useSort(rows, "spend", "desc");

  // Rank: best ROAS at top, but require at least 5% of total spend to avoid
  // tiny-sample winners (e.g. a country with ₹100 spend and 1 conversion).
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const minSpend = totalSpend * 0.02;
  const ranked = useMemo(() => {
    const eligible = rows.filter((r) => r.spend >= minSpend);
    const byRoas = [...eligible].sort((a, b) => b.roas - a.roas);
    const top = byRoas.slice(0, 3);
    const bottom = [...eligible].filter((r) => r.conversions > 0 || r.spend > 0).sort((a, b) => a.roas - b.roas).slice(0, 3);
    return { top, bottom };
  }, [rows, minSpend]);

  const cur = (n: number) => formatMoney(n, currency, 0);
  const isLoading = loading[activeDim];
  const dim = DIMENSIONS.find((d) => d.id === activeDim)!;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Target className="w-7 h-7 text-purple-600 shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Targeting Insights</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            See which demographics and places your Meta ads convert best in — and where to shift spend for more focus.
          </p>
        </div>
      </div>

      {/* Dimension tabs */}
      <div className="flex flex-wrap gap-2">
        {DIMENSIONS.map((d) => {
          const Icon = d.icon;
          const active = activeDim === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDim(d.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 ${
                active
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {d.label}
            </button>
          );
        })}
      </div>

      <div className="text-xs text-gray-500 -mt-2">{dim.description}</div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {isLoading && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Fetching {dim.label.toLowerCase()} breakdown from Meta…
        </div>
      )}

      {!isLoading && rows.length === 0 && !error && (
        <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No {dim.label.toLowerCase()} data returned for this window. Try a wider date range.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Focus + Reduce cards (the recommendation surface) */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* FOCUS HERE */}
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-green-700" />
                <h3 className="text-sm font-bold text-green-900 uppercase tracking-wide">Focus here — your winners</h3>
              </div>
              <p className="text-xs text-green-800 mb-4">
                Top 3 {dim.label.toLowerCase()} segments by ROAS. These are pulling their weight — shift more budget here.
              </p>
              <div className="space-y-2">
                {ranked.top.length === 0 && (
                  <div className="text-xs text-green-700 italic">Not enough conversion data to rank winners yet — wait for the window to accumulate more spend.</div>
                )}
                {ranked.top.map((r, idx) => (
                  <div key={r.label} className="bg-white border border-green-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-gray-900 text-sm">#{idx + 1} · {r.label}</span>
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">
                        <TrendingUp className="w-3 h-3" /> {r.roas > 0 ? `${r.roas.toFixed(2)}× ROAS` : "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-600 mt-2">
                      <div><span className="text-gray-400">Spend:</span> {cur(r.spend)}</div>
                      <div><span className="text-gray-400">Conv:</span> {r.conversions.toLocaleString("en-IN")}</div>
                      <div><span className="text-gray-400">CPA:</span> {r.cpa > 0 ? cur(r.cpa) : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CONSIDER REDUCING */}
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-5 h-5 text-red-700" />
                <h3 className="text-sm font-bold text-red-900 uppercase tracking-wide">Consider reducing</h3>
              </div>
              <p className="text-xs text-red-800 mb-4">
                Bottom 3 {dim.label.toLowerCase()} segments — high spend, low ROAS. Consider excluding or lowering bids here.
              </p>
              <div className="space-y-2">
                {ranked.bottom.length === 0 && (
                  <div className="text-xs text-red-700 italic">No underperforming segments yet — every segment is pulling its weight.</div>
                )}
                {ranked.bottom.map((r, idx) => (
                  <div key={r.label} className="bg-white border border-red-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-gray-900 text-sm">#{idx + 1} · {r.label}</span>
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                        <TrendingDown className="w-3 h-3" /> {r.roas > 0 ? `${r.roas.toFixed(2)}× ROAS` : "0×"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-600 mt-2">
                      <div><span className="text-gray-400">Spend:</span> {cur(r.spend)}</div>
                      <div><span className="text-gray-400">Conv:</span> {r.conversions.toLocaleString("en-IN")}</div>
                      <div><span className="text-gray-400">CPA:</span> {r.cpa > 0 ? cur(r.cpa) : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full ranked table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-900">All {dim.label.toLowerCase()} segments ({rows.length})</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Window: {startDate} → {endDate} · Sorted by spend · Segments below {Math.round(minSpend).toLocaleString("en-IN")} {currency} spend are still shown but skipped from the &quot;Focus here&quot; recommendation.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                  <tr>
                    <SortTh col="label" sort={sort} onToggle={toggle} className="text-[11px] uppercase">{dim.label}</SortTh>
                    <SortTh col="spend" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Spend</SortTh>
                    <SortTh col="impressions" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Impr</SortTh>
                    <SortTh col="clicks" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Clicks</SortTh>
                    <SortTh col="ctr" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">CTR</SortTh>
                    <SortTh col="conversions" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Conv</SortTh>
                    <SortTh col="cpa" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">CPA</SortTh>
                    <SortTh col="roas" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">ROAS</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.label} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-900">{r.label}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.impressions.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.clicks.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.ctr.toFixed(2)}%</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.conversions.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.cpa > 0 ? cur(r.cpa) : "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold">
                        <span className={r.roas >= 2 ? "text-green-700" : r.roas >= 1 ? "text-gray-700" : "text-red-700"}>
                          {r.roas > 0 ? `${r.roas.toFixed(2)}×` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-900 flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>About Interests:</strong> Meta deprecated the standalone Audience Insights API in 2021, so we can&apos;t pull interest performance the same way as demographics. For interest-level recommendations, check the <strong>Audience Audit → Intent Analysis</strong> sub-tab which infers interest signals from your current campaign targeting.
            </span>
          </div>
        </>
      )}

      <TabSummaryFooter
        lines={(() => {
          if (!rows.length) return ["No targeting data loaded for the selected dimension and date range."];
          const topWinner = ranked.top[0];
          const topLoser = ranked.bottom[0];
          return [
            `Analysed ${rows.length} ${dim.label.toLowerCase()} segment${rows.length !== 1 ? "s" : ""} — total spend ${cur(totalSpend)}.`,
            topWinner ? `Best performer: "${topWinner.label}" (${cur(topWinner.spend)} spend, ${topWinner.roas.toFixed(2)}× ROAS).` : `No eligible winner segment found (try a wider date range).`,
            topLoser && topLoser.label !== topWinner?.label
              ? `Lowest ROAS: "${topLoser.label}" at ${topLoser.roas.toFixed(2)}× — consider excluding or reducing budget here.`
              : `Spend is fairly concentrated — monitor for segment fatigue over time.`,
          ];
        })()}
        tabName="Targeting Insights"
        context={{ dimension: activeDim, segmentCount: rows.length, totalSpend }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
