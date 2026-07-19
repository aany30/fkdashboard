/**
 * Reporting → Overview
 *
 * KPI cards (Reach, Frequency, Impressions, Spend, CPM) showing current vs
 * previous-period deltas + sparklines, plus a Performance Trend chart with
 * locked X (date) and user-picked Primary/Secondary Y metrics.
 *
 * Data sources:
 *  - Daily series + prev-period series → /api/reporting/breakdown/meta (daily)
 *  - Reach + frequency → useAdSetInsights (Meta does not expose period reach
 *    via the daily breakdown — we sum ad-set reach for a reasonable estimate).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Area, AreaChart,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import LoadingState from "@/components/shared/LoadingState";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { useMetaDailyVsPrev, type DailyPoint } from "@/hooks/useMetaDailyVsPrev";
import { usePersistentColumns, usePersistentValue } from "@/hooks/useColumnPrefs";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab: (id: string) => void;
}

type MetricId =
  | "spend" | "impressions" | "reach" | "frequency" | "clicks" | "conversions" | "conversionValue"
  | "ctr" | "cpc" | "cpm" | "cpa" | "roas" | "cvr" | "aov";

const METRICS: { id: MetricId; label: string; fmt: "money" | "int" | "pct" | "x" | "decimal"; lowerIsBetter?: boolean }[] = [
  { id: "spend",           label: "Spend",           fmt: "money" },
  { id: "impressions",     label: "Impressions",     fmt: "int"   },
  { id: "reach",           label: "Reach",           fmt: "int"   },
  { id: "frequency",       label: "Frequency",       fmt: "decimal", lowerIsBetter: true },
  { id: "clicks",          label: "Clicks",          fmt: "int"   },
  { id: "conversions",     label: "Conversions",     fmt: "int"   },
  { id: "conversionValue", label: "Revenue",         fmt: "money" },
  { id: "ctr",             label: "CTR",             fmt: "pct"   },
  { id: "cpc",             label: "CPC",             fmt: "money", lowerIsBetter: true },
  { id: "cpm",             label: "CPM",             fmt: "money", lowerIsBetter: true },
  { id: "cpa",             label: "CPA",             fmt: "money", lowerIsBetter: true },
  { id: "roas",            label: "ROAS",            fmt: "x"     },
  { id: "cvr",             label: "CVR",             fmt: "pct"   },
  { id: "aov",             label: "AOV",             fmt: "money" },
];

const KPI_SWAP_GROUPS: { label: string; ids: MetricId[] }[] = [
  { label: "Display",    ids: ["impressions", "reach", "frequency", "cpm"] },
  { label: "Engagement", ids: ["clicks", "ctr", "cpc", "spend"] },
  { label: "Conversion", ids: ["conversions", "conversionValue", "roas", "cpa", "cvr", "aov"] },
];

function deriveRow(r: { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }) {
  return {
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue,
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
  };
}

function fmt(v: number, kind: "money" | "int" | "pct" | "x" | "k" | "decimal", currency: string): string {
  if (!Number.isFinite(v)) return "—";
  if (kind === "money") {
    if (Math.abs(v) >= 1_000_000) return formatMoney(v / 1_000_000, currency, 2).replace(/(\.\d+)?$/, m => m) + "M";
    if (Math.abs(v) >= 10_000)    return formatMoney(v / 1_000,     currency, 1) + "k";
    return formatMoney(v, currency, 0);
  }
  if (kind === "pct") return `${v.toFixed(2)}%`;
  if (kind === "x")   return `${v.toFixed(2)}×`;
  if (kind === "decimal") return v.toFixed(2);
  if (kind === "int") {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 10_000)    return `${(v / 1_000).toFixed(1)}k`;
    return Math.round(v).toLocaleString("en-IN");
  }
  if (kind === "k") {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
    return Math.round(v).toLocaleString("en-IN");
  }
  return Math.round(v).toLocaleString("en-IN");
}

function pctDelta(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number | null; lowerIsBetter?: boolean }) {
  if (delta === null) return <span className="text-[10px] text-gray-500">—</span>;
  const positive = delta > 0;
  const good = lowerIsBetter ? !positive : positive;
  const color = good ? "text-green-600" : "text-red-600";
  const Arrow = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Arrow className="w-3 h-3" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  metric, value, delta, spark, onSwap,
}: {
  metric: MetricId;
  value: string;
  delta: number | null;
  spark: number[];
  onSwap?: (next: MetricId) => void;
}) {
  const def = METRICS.find(m => m.id === metric)!;
  const sparkData = spark.map((v, i) => ({ i, v }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative ${open ? "z-[200]" : ""}`} ref={ref}>
      <div className="flex items-start justify-between gap-1">
        <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide truncate">{def.label}</div>
        {onSwap && (
          <button onClick={() => setOpen(v => !v)} className="text-gray-400 hover:text-gray-700 transition shrink-0" title="Change metric">
            <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3 3 3-3"/></svg>
          </button>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 mt-1.5 truncate" title={value}>{value}</div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <DeltaBadge delta={delta} lowerIsBetter={def.lowerIsBetter} />
        <span className="text-[10px] text-gray-400">vs prev period</span>
      </div>
      <div className="h-9 mt-1 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData}>
            <defs>
              <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke="#6366f1" strokeWidth={1.5} fill={`url(#grad-${metric})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {open && onSwap && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white text-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-200 z-[210]">
          <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500">Change metric</div>
          <div className="max-h-[500px] overflow-y-auto py-1">
            {KPI_SWAP_GROUPS.map(g => (
              <div key={g.label}>
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">{g.label}</div>
                {g.ids.map(id => {
                  const m = METRICS.find(x => x.id === id)!;
                  const isCur = id === metric;
                  return (
                    <button key={id}
                      onClick={() => { if (!isCur) { onSwap(id); setOpen(false); } }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${isCur ? "text-blue-700 font-semibold bg-blue-50 cursor-default" : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                      {isCur && <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                      {m.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricPicker({ value, onChange, label }: { value: MetricId; onChange: (v: MetricId) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const current = METRICS.find(m => m.id === value)!;
  const pickable = METRICS.filter(m => m.id !== "reach" && m.id !== "frequency");
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-50 w-44 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
            {pickable.map(m => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${m.id === value ? "bg-blue-50 text-blue-700 font-semibold" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function totalsOf(rows: DailyPoint[]) {
  return rows.reduce(
    (s, r) => ({
      spend: s.spend + r.spend, impressions: s.impressions + r.impressions,
      clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions,
      conversionValue: s.conversionValue + r.conversionValue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  );
}

/** Combined chart shown at the top of "both" mode: 4 aggregate KPIs + dual-line Meta vs DV360. */
function CombinedOverview({ meta, dv360, metaCurrency }: {
  meta:  { current: DailyPoint[]; previous: DailyPoint[] };
  dv360: { current: DailyPoint[]; previous: DailyPoint[] };
  metaCurrency: string;
}) {
  const metaT = totalsOf(meta.current);
  const dvT   = totalsOf(dv360.current);
  const combined = {
    spend:       metaT.spend       + dvT.spend,
    impressions: metaT.impressions + dvT.impressions,
    clicks:      metaT.clicks      + dvT.clicks,
    conversions: metaT.conversions + dvT.conversions,
  };

  const chartData = useMemo(() => {
    const metaByDate = new Map(meta.current.map(r => [r.label, r]));
    const dvByDate   = new Map(dv360.current.map(r => [r.label, r]));
    const zero = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
    const allDates = Array.from(new Set([...metaByDate.keys(), ...dvByDate.keys()])).sort();
    return allDates.map(d => {
      const m  = metaByDate.get(d) ?? zero;
      const dv = dvByDate.get(d)   ?? zero;
      return {
        date:           d.slice(5),
        metaSpend:      m.spend,
        dvSpend:        dv.spend,
        metaImpr:       m.impressions,
        dvImpr:         dv.impressions,
      };
    });
  }, [meta.current, dv360.current]);

  const kpis = [
    { label: "Total Spend",        value: fmt(combined.spend,       "money", metaCurrency) },
    { label: "Total Impressions",  value: fmt(combined.impressions,  "k",    metaCurrency) },
    { label: "Total Clicks",       value: fmt(combined.clicks,       "k",    metaCurrency) },
    { label: "Total Conversions",  value: fmt(combined.conversions,  "k",    metaCurrency) },
  ];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
        <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">Combined Overview</span>
        <span className="text-xs text-gray-400">Meta + DV360</span>
      </div>

      <div className="bg-white p-5 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{k.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1.5">{k.value}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Meta + DV360</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Spend comparison */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Daily Spend</h3>
              <p className="text-xs text-gray-500 mt-0.5">Meta vs DV360</p>
            </div>
            <div className="px-3 py-4">
              {chartData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={10} tickLine={false} interval="preserveStartEnd" />
                    <YAxis yAxisId="meta"  stroke="#6366f1" fontSize={10} tickLine={false} tickFormatter={v => fmt(v, "money", metaCurrency)} />
                    <YAxis yAxisId="dv360" orientation="right" stroke="#10b981" fontSize={10} tickLine={false} tickFormatter={v => fmt(v, "money", metaCurrency)} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, name: string) => [fmt(v, "money", metaCurrency), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar  yAxisId="meta"  dataKey="metaSpend" name="Meta"  fill="#6366f1" radius={[2,2,0,0]} animationDuration={600} />
                    <Line yAxisId="dv360" dataKey="dvSpend"   name="DV360" stroke="#10b981" strokeWidth={2} dot={false} animationDuration={700} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Impressions comparison */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Daily Impressions</h3>
              <p className="text-xs text-gray-500 mt-0.5">Meta vs DV360</p>
            </div>
            <div className="px-3 py-4">
              {chartData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={10} tickLine={false} interval="preserveStartEnd" />
                    <YAxis yAxisId="meta"  stroke="#6366f1" fontSize={10} tickLine={false} tickFormatter={v => fmt(v, "k", metaCurrency)} />
                    <YAxis yAxisId="dv360" orientation="right" stroke="#10b981" fontSize={10} tickLine={false} tickFormatter={v => fmt(v, "k", metaCurrency)} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, name: string) => [fmt(v, "k", metaCurrency), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar  yAxisId="meta"  dataKey="metaImpr" name="Meta"  fill="#6366f1" radius={[2,2,0,0]} animationDuration={600} />
                    <Line yAxisId="dv360" dataKey="dvImpr"   name="DV360" stroke="#10b981" strokeWidth={2} dot={false} animationDuration={700} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Full platform block: header + swappable KPI cards + configurable trend chart. Used in "both" mode. */
function PlatformBlock({ name, accent, cur, prev, currency, reach = 0 }: {
  name: string;
  accent: "blue" | "emerald";
  cur: DailyPoint[];
  prev: DailyPoint[];
  currency: string;
  reach?: number;
}) {
  const platformKey = name.toLowerCase();
  const t = totalsOf(cur);
  const p = totalsOf(prev);
  const sorted = [...cur].sort((a, b) => a.label.localeCompare(b.label));
  const chartData = sorted.map(r => ({ date: r.label.slice(5), ...deriveRow(r) }));

  const headerBorder = accent === "blue" ? "border-blue-300" : "border-emerald-300";
  const chip = accent === "blue" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800";
  const barColor = accent === "blue" ? "#6366f1" : "#10b981";
  const lineColor = accent === "blue" ? "#10b981" : "#6366f1";

  // Per-platform persistent KPI slot selection
  const defaultSlots: MetricId[] = name === "Meta"
    ? ["spend", "impressions", "clicks", "conversions", "reach"]
    : ["spend", "impressions", "clicks", "cpm", "ctr"];
  const [slotMetrics, setSlotMetrics] = usePersistentColumns<MetricId>(
    `overview-kpi-slots-${platformKey}`,
    defaultSlots
  );

  // Per-platform persistent trend metric pickers
  const [primary, setPrimary]     = usePersistentValue<MetricId>(`overview-trend-primary-${platformKey}`, "impressions");
  const [secondary, setSecondary] = usePersistentValue<MetricId>(`overview-trend-secondary-${platformKey}`, "spend");

  const reachPeriod = reach;
  const frequencyCur = reachPeriod > 0 ? t.impressions / reachPeriod : 0;
  const cpmCur  = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
  const cpmPrev = p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0;

  const curMap: Record<MetricId, number> = {
    spend: t.spend, impressions: t.impressions, reach: reachPeriod, frequency: frequencyCur,
    clicks: t.clicks, conversions: t.conversions, conversionValue: t.conversionValue,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
    cpm: cpmCur,
    cpa: t.conversions > 0 ? t.spend / t.conversions : 0,
    roas: t.spend > 0 ? t.conversionValue / t.spend : 0,
    cvr: t.clicks > 0 ? (t.conversions / t.clicks) * 100 : 0,
    aov: t.conversions > 0 ? t.conversionValue / t.conversions : 0,
  };
  const prevMap: Record<MetricId, number> = {
    spend: p.spend, impressions: p.impressions, reach: 0, frequency: 0,
    clicks: p.clicks, conversions: p.conversions, conversionValue: p.conversionValue,
    ctr: p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0,
    cpc: p.clicks > 0 ? p.spend / p.clicks : 0,
    cpm: cpmPrev,
    cpa: p.conversions > 0 ? p.spend / p.conversions : 0,
    roas: p.spend > 0 ? p.conversionValue / p.spend : 0,
    cvr: p.clicks > 0 ? (p.conversions / p.clicks) * 100 : 0,
    aov: p.conversions > 0 ? p.conversionValue / p.conversions : 0,
  };

  const sparkSeriesBlock: Record<MetricId, number[]> = {
    spend:           sorted.map(d => d.spend),
    impressions:     sorted.map(d => d.impressions),
    reach:           sorted.map(d => d.impressions),
    frequency:       sorted.map(d => d.impressions),
    clicks:          sorted.map(d => d.clicks),
    conversions:     sorted.map(d => d.conversions),
    conversionValue: sorted.map(d => d.conversionValue),
    ctr:             sorted.map(d => d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0),
    cpc:             sorted.map(d => d.clicks > 0 ? d.spend / d.clicks : 0),
    cpm:             sorted.map(d => d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0),
    cpa:             sorted.map(d => d.conversions > 0 ? d.spend / d.conversions : 0),
    roas:            sorted.map(d => d.spend > 0 ? d.conversionValue / d.spend : 0),
    cvr:             sorted.map(d => d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0),
    aov:             sorted.map(d => d.conversions > 0 ? d.conversionValue / d.conversions : 0),
  };

  function valueForBlock(id: MetricId): string {
    const def = METRICS.find(m => m.id === id)!;
    const v = curMap[id];
    if (id === "frequency") return v > 0 ? v.toFixed(2) : "—";
    if (id === "cpm")       return v > 0 ? formatMoney(v, currency, 2) : "—";
    if (def.fmt === "money") return fmt(v, "money", currency);
    if (def.fmt === "int")   return fmt(v, "k", currency);
    return fmt(v, def.fmt, currency);
  }

  const primaryDef   = METRICS.find(m => m.id === primary)!;
  const secondaryDef = METRICS.find(m => m.id === secondary)!;

  return (
    <div className={`border ${headerBorder} rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className={`px-5 py-3 border-b ${headerBorder} flex items-center gap-2 ${accent === "blue" ? "bg-blue-50" : "bg-emerald-50"}`}>
        <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${chip}`}>{name}</span>
        {cur.length === 0 && <span className="text-xs text-gray-400 ml-1">no data in window</span>}
      </div>

      <div className="bg-white p-5 space-y-5">
        {/* Swappable KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {slotMetrics.map((m, i) => (
            <KpiCard
              key={`${name}-${m}-${i}`}
              metric={m}
              value={valueForBlock(m)}
              delta={pctDelta(curMap[m], prevMap[m])}
              spark={sparkSeriesBlock[m]}
              onSwap={(next) => setSlotMetrics(prev => prev.map((x, j) => j === i ? next : x))}
            />
          ))}
        </div>

        {/* Trend chart with metric pickers */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Performance Trend</h3>
            <p className="text-xs text-gray-500 mt-0.5">Date locked on X. Pick metrics for Y axes.</p>
          </div>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">X axis:</span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600">Date (frozen)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Primary Y:</span>
              <MetricPicker value={primary}   onChange={setPrimary}   label="Primary metric" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Secondary Y:</span>
              <MetricPicker value={secondary} onChange={setSecondary} label="Secondary metric" />
            </div>
          </div>
          <div className="px-3 py-4">
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-gray-400">No daily data for this window.</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" stroke="#6b7280" fontSize={11} tickLine={false} />
                  <YAxis yAxisId="left"  stroke={barColor}  fontSize={11} tickLine={false}
                    tickFormatter={(v) => fmt(v, primaryDef.fmt === "int" ? "k" : primaryDef.fmt, currency)} />
                  <YAxis yAxisId="right" orientation="right" stroke={lineColor} fontSize={11} tickLine={false}
                    tickFormatter={(v) => fmt(v, secondaryDef.fmt === "int" ? "k" : secondaryDef.fmt, currency)} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, _name: string, item: { dataKey?: string | number }) => {
                      const k = typeof item?.dataKey === "string" ? item.dataKey : "";
                      if (k === primary)   return [fmt(value, primaryDef.fmt,   currency), primaryDef.label] as [string, string];
                      if (k === secondary) return [fmt(value, secondaryDef.fmt, currency), secondaryDef.label] as [string, string];
                      return [String(value), k] as [string, string];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar  yAxisId="left"  dataKey={primary}   name={primaryDef.label}   fill={barColor}  radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                  <Line yAxisId="right" dataKey={secondary} name={secondaryDef.label} stroke={lineColor} strokeWidth={2} dot={false} animationDuration={700} animationEasing="ease-out" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportingOverview({ platform, dateRange, customStart, customEnd }: Props) {
  const { platformErrors, startDate, endDate, metaCurrency, dv360Currency } = useCampaigns(platform, dateRange, customStart, customEnd);
  // Single-platform views format in that platform's currency; the "both" view
  // formats each PlatformBlock in its own currency (passed explicitly below).
  const currency = platform === "dv360" ? dv360Currency : metaCurrency;
  const { current, previous, byPlatform, loading, prevStartDate, prevEndDate } = useMetaDailyVsPrev(platform, dateRange, customStart, customEnd);
  const { adsets } = useAdSetInsights(platform, dateRange, customStart, customEnd);

  const reachPeriod = useMemo(() => adsets.reduce((s, a) => s + (a.reach || 0), 0), [adsets]);
  const totalsCur = useMemo(() => totalsOf(current), [current]);
  const totalsPrev = useMemo(() => totalsOf(previous), [previous]);
  const frequencyCur = reachPeriod > 0 ? totalsCur.impressions / reachPeriod : 0;

  // Prev-period reach: use the AdSet shared shape isn't available for prev period
  // without a second fetch. Approximate prev-reach as a proportional share of
  // current reach scaled by impressions ratio so the delta still moves with
  // traffic. This is a reasonable display heuristic — exact prev-reach would
  // require a second ad-set insights fetch.
  const reachPrev = totalsCur.impressions > 0
    ? reachPeriod * (totalsPrev.impressions / totalsCur.impressions)
    : 0;
  const freqPrev = reachPrev > 0 ? totalsPrev.impressions / reachPrev : 0;

  const cpmCur  = totalsCur.impressions > 0  ? (totalsCur.spend  / totalsCur.impressions)  * 1000 : 0;
  const cpmPrev = totalsPrev.impressions > 0 ? (totalsPrev.spend / totalsPrev.impressions) * 1000 : 0;

  const sortedCur = useMemo(() => [...current].sort((a, b) => a.label.localeCompare(b.label)), [current]);

  const sparkSeries: Record<MetricId, number[]> = useMemo(() => ({
    spend:           sortedCur.map(d => d.spend),
    impressions:     sortedCur.map(d => d.impressions),
    reach:           sortedCur.map(d => d.impressions),    // daily reach not in payload — proxy
    frequency:       sortedCur.map(d => d.impressions),    // derived — proxy
    clicks:          sortedCur.map(d => d.clicks),
    conversions:     sortedCur.map(d => d.conversions),
    conversionValue: sortedCur.map(d => d.conversionValue),
    ctr:             sortedCur.map(d => d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0),
    cpc:             sortedCur.map(d => d.clicks > 0 ? d.spend / d.clicks : 0),
    cpm:             sortedCur.map(d => d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0),
    cpa:             sortedCur.map(d => d.conversions > 0 ? d.spend / d.conversions : 0),
    roas:            sortedCur.map(d => d.spend > 0 ? d.conversionValue / d.spend : 0),
    cvr:             sortedCur.map(d => d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0),
    aov:             sortedCur.map(d => d.conversions > 0 ? d.conversionValue / d.conversions : 0),
  }), [sortedCur]);

  const totalsCurMap: Record<MetricId, number> = useMemo(() => ({
    spend: totalsCur.spend,
    impressions: totalsCur.impressions,
    reach: reachPeriod,
    frequency: frequencyCur,
    clicks: totalsCur.clicks,
    conversions: totalsCur.conversions,
    conversionValue: totalsCur.conversionValue,
    ctr:  totalsCur.impressions > 0 ? (totalsCur.clicks / totalsCur.impressions) * 100 : 0,
    cpc:  totalsCur.clicks > 0 ? totalsCur.spend / totalsCur.clicks : 0,
    cpm:  cpmCur,
    cpa:  totalsCur.conversions > 0 ? totalsCur.spend / totalsCur.conversions : 0,
    roas: totalsCur.spend > 0 ? totalsCur.conversionValue / totalsCur.spend : 0,
    cvr:  totalsCur.clicks > 0 ? (totalsCur.conversions / totalsCur.clicks) * 100 : 0,
    aov:  totalsCur.conversions > 0 ? totalsCur.conversionValue / totalsCur.conversions : 0,
  }), [totalsCur, reachPeriod, frequencyCur, cpmCur]);

  const totalsPrevMap: Record<MetricId, number> = useMemo(() => ({
    spend: totalsPrev.spend,
    impressions: totalsPrev.impressions,
    reach: reachPrev,
    frequency: freqPrev,
    clicks: totalsPrev.clicks,
    conversions: totalsPrev.conversions,
    conversionValue: totalsPrev.conversionValue,
    ctr:  totalsPrev.impressions > 0 ? (totalsPrev.clicks / totalsPrev.impressions) * 100 : 0,
    cpc:  totalsPrev.clicks > 0 ? totalsPrev.spend / totalsPrev.clicks : 0,
    cpm:  cpmPrev,
    cpa:  totalsPrev.conversions > 0 ? totalsPrev.spend / totalsPrev.conversions : 0,
    roas: totalsPrev.spend > 0 ? totalsPrev.conversionValue / totalsPrev.spend : 0,
    cvr:  totalsPrev.clicks > 0 ? (totalsPrev.conversions / totalsPrev.clicks) * 100 : 0,
    aov:  totalsPrev.conversions > 0 ? totalsPrev.conversionValue / totalsPrev.conversions : 0,
  }), [totalsPrev, reachPrev, freqPrev, cpmPrev]);

  const [slotMetrics, setSlotMetrics] = usePersistentColumns<MetricId>(
    "overview-kpi-slots",
    ["reach", "frequency", "impressions", "spend", "cpm"]
  );

  function valueFor(id: MetricId): string {
    const def = METRICS.find(m => m.id === id)!;
    const v = totalsCurMap[id];
    if (id === "frequency") return v > 0 ? v.toFixed(2) : "—";
    if (id === "cpm")       return v > 0 ? formatMoney(v, currency, 2) : "—";
    if (def.fmt === "money") return fmt(v, "money", currency);
    if (def.fmt === "int")   return fmt(v, "k", currency);
    return fmt(v, def.fmt, currency);
  }

  const chartData = useMemo(() => sortedCur.map(r => ({ date: r.label.slice(5), ...deriveRow(r) })), [sortedCur]);

  const [primary, setPrimary]   = usePersistentValue<MetricId>("overview-trend-primary", "impressions");
  const [secondary, setSecondary] = usePersistentValue<MetricId>("overview-trend-secondary", "ctr");
  const primaryDef   = METRICS.find(m => m.id === primary)!;
  const secondaryDef = METRICS.find(m => m.id === secondary)!;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Overview</h1>
            <p className="text-gray-600 mt-1 text-sm">
              <span className="font-mono">{startDate}</span> → <span className="font-mono">{endDate}</span>
              <span className="text-gray-400"> · prev: {prevStartDate} → {prevEndDate}</span>
            </p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Reporting Overview"
          context={{
            window: `${startDate} → ${endDate}`,
            currency,
            combined: {
              spend: Math.round(totalsCur.spend), impressions: totalsCur.impressions, reach: reachPeriod,
              frequency: +frequencyCur.toFixed(2), cpm: +cpmCur.toFixed(2),
            },
            previous: { spend: Math.round(totalsPrev.spend), impressions: totalsPrev.impressions, cpm: +cpmPrev.toFixed(2) },
            // Per-platform split so the LLM never blends Meta + DV360 into one number.
            ...(platform === "meta" || platform === "both" ? { meta: { spend: Math.round(totalsOf(byPlatform.meta.current).spend), impressions: totalsOf(byPlatform.meta.current).impressions } } : {}),
            ...(platform === "dv360" || platform === "both" ? { dv360: { spend: Math.round(totalsOf(byPlatform.dv360.current).spend), impressions: totalsOf(byPlatform.dv360.current).impressions } } : {}),
          }}
          platform={platform}
          inline
        />
      </div>

      {platformErrors.dv360 && platform !== "meta" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <span className="font-semibold">DV360 data unavailable:</span> {platformErrors.dv360}
        </div>
      )}
      {platformErrors.meta && platform !== "dv360" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <span className="font-semibold">Meta data unavailable:</span> {platformErrors.meta}
        </div>
      )}

      {/* ── Both mode: combined overview + two separate platform blocks ── */}
      {platform === "both" ? (
        <div className="space-y-6">
          {loading ? (
            <LoadingState message="Loading reporting data…" height="h-40" />
          ) : (
            <>
              <CombinedOverview
                meta={byPlatform.meta}
                dv360={byPlatform.dv360}
                metaCurrency={metaCurrency}
              />
              <PlatformBlock
                name="Meta"
                accent="blue"
                cur={byPlatform.meta.current}
                prev={byPlatform.meta.previous}
                currency={metaCurrency}
                reach={reachPeriod}
              />
              <PlatformBlock
                name="DV360"
                accent="emerald"
                cur={byPlatform.dv360.current}
                prev={byPlatform.dv360.previous}
                currency={dv360Currency}
              />
            </>
          )}
        </div>
      ) : (
        <>
          {/* Single-platform: blended KPI cards + trend */}
          {platform === "dv360" && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
              Reach and frequency are not available for DV360 — those cards show 0.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {slotMetrics.map((m, i) => (
              <KpiCard
                key={`${m}-${i}`}
                metric={m}
                value={valueFor(m)}
                delta={pctDelta(totalsCurMap[m], totalsPrevMap[m])}
                spark={sparkSeries[m]}
                onSwap={(next) => setSlotMetrics(prev => prev.map((x, j) => j === i ? next : x))}
              />
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Performance Trend</h3>
              <p className="text-xs text-gray-500 mt-0.5">Date is locked on X. Pick any metric for Y primary + secondary.</p>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">X axis:</span>
                <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600">Date (frozen)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Primary Y:</span>
                <MetricPicker value={primary}   onChange={setPrimary}   label="Primary metric" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Secondary Y:</span>
                <MetricPicker value={secondary} onChange={setSecondary} label="Secondary metric" />
              </div>
            </div>
            <div className="px-3 py-4">
              {loading ? (
                <div className="h-80 flex items-center justify-center text-sm text-gray-500">Loading daily data…</div>
              ) : chartData.length === 0 ? (
                <div className="h-80 flex items-center justify-center text-sm text-gray-500">No daily data for this window.</div>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={11} tickLine={false} />
                    <YAxis yAxisId="left"  stroke="#6366f1" fontSize={11} tickLine={false}
                      tickFormatter={(v) => fmt(v, primaryDef.fmt === "int" ? "k" : primaryDef.fmt, currency)} />
                    <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} tickLine={false}
                      tickFormatter={(v) => fmt(v, secondaryDef.fmt === "int" ? "k" : secondaryDef.fmt, currency)} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, _name: string, item: { dataKey?: string | number }) => {
                        const k = typeof item?.dataKey === "string" ? item.dataKey : "";
                        if (k === primary)   return [fmt(value, primaryDef.fmt,   currency), primaryDef.label] as [string, string];
                        if (k === secondary) return [fmt(value, secondaryDef.fmt, currency), secondaryDef.label] as [string, string];
                        return [String(value), k] as [string, string];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar  yAxisId="left"  dataKey={primary}   name={primaryDef.label}   fill="#6366f1" radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                    <Line yAxisId="right" dataKey={secondary} name={secondaryDef.label} stroke="#10b981" strokeWidth={2} dot={false} animationDuration={700} animationEasing="ease-out" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}

      <TabSummaryFooter
        lines={(() => {
          const showMeta  = platform === "meta"  || platform === "both";
          const showDV360 = platform === "dv360" || platform === "both";
          const dv360T = totalsOf(byPlatform.dv360.current);
          const metaT  = totalsOf(byPlatform.meta.current);
          const dv360Cpm = dv360T.impressions > 0 ? (dv360T.spend / dv360T.impressions) * 1000 : 0;
          const metaCpm  = metaT.impressions  > 0 ? (metaT.spend  / metaT.impressions)  * 1000 : 0;
          const lines: string[] = [
            `Period: ${startDate} → ${endDate}.`,
          ];
          if (showMeta) {
            lines.push(
              `Meta — ${metaT.impressions.toLocaleString("en-IN")} impressions · ${reachPeriod > 0 ? reachPeriod.toLocaleString("en-IN") + " reach" : "reach loading"} · ${frequencyCur > 0 ? frequencyCur.toFixed(2) + "× freq" : "—"} · CPM: ${metaCpm > 0 ? formatMoney(metaCpm, currency, 2) : "—"} · Spend: ${formatMoney(metaT.spend, currency, 0)}.`
            );
          }
          if (showDV360) {
            lines.push(
              `DV360 — ${dv360T.impressions.toLocaleString("en-IN")} impressions · CPM: ${dv360Cpm > 0 ? formatMoney(dv360Cpm, currency, 2) : "—"} · Spend: ${formatMoney(dv360T.spend, currency, 0)}.`
            );
          }
          if (showMeta && showDV360) {
            lines.push(
              `Combined — ${totalsCur.impressions.toLocaleString("en-IN")} impressions · Spend: ${formatMoney(totalsCur.spend, currency, 0)}.`
            );
          }
          return lines;
        })()}
        tabName="Reporting Overview"
        context={{
          startDate,
          endDate,
          totalSpend: totalsCur.spend,
          totalImpressions: totalsCur.impressions,
          reach: reachPeriod,
          frequency: frequencyCur,
          cpm: cpmCur,
          platform,
          dateRange,
        }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
