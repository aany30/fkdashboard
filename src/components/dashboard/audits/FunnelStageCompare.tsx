/**
 * Funnel Stage — Period A vs Period B comparison.
 *
 * Independent of the global date picker: the user chooses two arbitrary date
 * ranges, and each is fetched separately from Meta's reliable campaign-insights
 * path (`/api/naming/campaigns/meta`, which returns objective + window-scoped
 * spend via the dedicated /insights edge). Campaigns are bucketed into
 * TOF / MOF / BOF by objective (same taxonomy as the single-period chart) and
 * the chosen metric is compared side-by-side with a % delta per stage.
 *
 * Spend is attribution-independent, so the per-stage spend matches Ads Manager
 * exactly for each chosen window.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { CampaignData } from "@/types";
import { formatMoney } from "@/lib/currency";
import { usePersistentValue } from "@/hooks/useColumnPrefs";

type Stage = "TOF" | "MOF" | "BOF";

// Same objective taxonomy as FunnelStagePerformance / FunnelSeparationAudit.
function bucket(objective?: string): Stage | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video") || o.includes("store")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration")) return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog") || o.includes("app")) return "BOF";
  return "Unknown";
}

// Metrics we can compute purely from real, window-scoped Meta fields.
const COMPARE_METRICS = [
  { id: "spend", label: "Spend", unit: "$" },
  { id: "impressions", label: "Impressions", unit: "" },
  { id: "clicks", label: "Clicks", unit: "" },
  { id: "conversions", label: "Conversions", unit: "" },
  { id: "cpm", label: "CPM", unit: "$" },
  { id: "cpc", label: "CPC", unit: "$" },
  { id: "ctr", label: "CTR", unit: "%" },
  { id: "cps", label: "Cost / Conversion", unit: "$" },
] as const;
type MetricId = (typeof COMPARE_METRICS)[number]["id"];

interface StageAgg {
  spend: number; impressions: number; clicks: number; conversions: number;
}
type StageMap = Record<Stage, StageAgg>;

function emptyStageMap(): StageMap {
  return {
    TOF: { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
    MOF: { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
    BOF: { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
  };
}

function aggregate(campaigns: CampaignData[]): StageMap {
  const m = emptyStageMap();
  for (const c of campaigns) {
    const s = bucket(c.objective);
    if (s === "Unknown") continue;
    m[s].spend += c.spend || 0;
    m[s].impressions += c.impressions || 0;
    m[s].clicks += c.clicks || 0;
    m[s].conversions += c.conversions || 0;
  }
  return m;
}

function metricValue(a: StageAgg, metric: MetricId): number {
  switch (metric) {
    case "spend": return a.spend;
    case "impressions": return a.impressions;
    case "clicks": return a.clicks;
    case "conversions": return a.conversions;
    case "cpm": return a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
    case "cpc": return a.clicks > 0 ? a.spend / a.clicks : 0;
    case "ctr": return a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
    case "cps": return a.conversions > 0 ? a.spend / a.conversions : 0;
    default: return 0;
  }
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface Props {
  metaAccessToken: string;
  metaBusinessId: string;
  currency: string;
}

export default function FunnelStageCompare({ metaAccessToken, metaBusinessId, currency }: Props) {
  // Defaults: A = last 7 days, B = the 7 days before that.
  const [aStart, setAStart] = useState(todayMinus(6));
  const [aEnd, setAEnd] = useState(todayMinus(0));
  const [bStart, setBStart] = useState(todayMinus(13));
  const [bEnd, setBEnd] = useState(todayMinus(7));
  const [metric, setMetric] = usePersistentValue<MetricId>("funnel-stage-compare-metric", "spend");

  const [campA, setCampA] = useState<CampaignData[] | null>(null);
  const [campB, setCampB] = useState<CampaignData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPeriod = useCallback(
    async (start: string, end: string): Promise<CampaignData[]> => {
      const r = await fetch("/api/naming/campaigns/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: start, endDate: end }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    [metaAccessToken, metaBusinessId]
  );

  const run = useCallback(async () => {
    if (!metaAccessToken || !metaBusinessId) return;
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([fetchPeriod(aStart, aEnd), fetchPeriod(bStart, bEnd)]);
      setCampA(a);
      setCampB(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [metaAccessToken, metaBusinessId, fetchPeriod, aStart, aEnd, bStart, bEnd]);

  // Fetch on mount only; subsequent fetches are via the "Compare" button so
  // editing 4 date inputs doesn't fire 4 round-trips.
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const aggA = useMemo(() => (campA ? aggregate(campA) : null), [campA]);
  const aggB = useMemo(() => (campB ? aggregate(campB) : null), [campB]);

  const metricMeta = COMPARE_METRICS.find((m) => m.id === metric)!;
  const fmt = (v: number) => {
    if (metricMeta.unit === "$") return formatMoney(v, currency, 2);
    if (metricMeta.unit === "%") return `${v.toFixed(2)}%`;
    return Math.round(v).toLocaleString();
  };

  const stages: Stage[] = ["TOF", "MOF", "BOF"];
  const chartData = (aggA && aggB)
    ? stages.map((s) => ({
        stage: s,
        "Period A": +metricValue(aggA[s], metric).toFixed(2),
        "Period B": +metricValue(aggB[s], metric).toFixed(2),
      }))
    : [];

  const dateInput = "border border-gray-300 rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h3 className="text-sm font-bold text-gray-900">Stage Performance — Period A vs B</h3>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600">Metric:</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricId)}
            className="text-xs border border-gray-200 rounded px-2 py-1 font-semibold text-gray-700 bg-white"
          >
            {COMPARE_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Two custom windows, fetched independently from Meta&apos;s campaign Insights. Bucketed TOF/MOF/BOF by objective. Spend matches Ads Manager for each window.
      </p>

      {/* Date pickers for A and B */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-indigo-700">Period A</span>
          <div className="flex items-center gap-1">
            <input type="date" value={aStart} max={aEnd} onChange={(e) => setAStart(e.target.value)} className={dateInput} />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={aEnd} min={aStart} onChange={(e) => setAEnd(e.target.value)} className={dateInput} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-emerald-700">Period B</span>
          <div className="flex items-center gap-1">
            <input type="date" value={bStart} max={bEnd} onChange={(e) => setBStart(e.target.value)} className={dateInput} />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={bEnd} min={bStart} onChange={(e) => setBEnd(e.target.value)} className={dateInput} />
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Compare"}
        </button>
      </div>

      {error && <div className="text-xs text-red-600 mb-3">Couldn&apos;t fetch: {error}</div>}

      {chartData.length > 0 && (
        <>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => metricMeta.unit === "$" ? formatMoney(v, currency, 0) : v.toLocaleString()} />
                <Tooltip cursor={{ fill: "rgba(99,102,241,0.06)" }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmt(v)} />
                <Legend />
                <Bar dataKey="Period A" fill="#6366f1" radius={[4, 4, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                <Bar dataKey="Period B" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={700} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Delta table */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Stage</th>
                  <th className="px-3 py-2 text-right font-semibold text-indigo-700">Period A<div className="text-[10px] font-normal text-gray-400">{aStart} → {aEnd}</div></th>
                  <th className="px-3 py-2 text-right font-semibold text-emerald-700">Period B<div className="text-[10px] font-normal text-gray-400">{bStart} → {bEnd}</div></th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Δ Change</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => {
                  const va = aggA ? metricValue(aggA[s], metric) : 0;
                  const vb = aggB ? metricValue(aggB[s], metric) : 0;
                  const delta = vb > 0 ? ((va - vb) / vb) * 100 : (va > 0 ? 100 : 0);
                  const deltaColor = delta > 0 ? "text-green-700" : delta < 0 ? "text-red-600" : "text-gray-400";
                  return (
                    <tr key={s} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-900">{s}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-900">{fmt(va)}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">{fmt(vb)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${deltaColor}`}>
                        {delta >= 0 ? "+" : ""}{Math.round(delta)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && chartData.length === 0 && !error && (
        <div className="text-xs text-gray-500 py-8 text-center">Pick two date ranges and click Compare.</div>
      )}
    </div>
  );
}
