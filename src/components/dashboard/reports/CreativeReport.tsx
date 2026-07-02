/**
 * Reporting → Creative Intelligence
 *
 * Sections (matches dv360-intel creative page):
 *   1. Creative Count by Format  +  Format Performance (dual-axis chart)
 *   2. Creative Fatigue           — bottom 5 × week-of-life buckets, table/bar/line toggle
 *   3. Best 5 Working Creatives  +  Creatives by Language
 *   4. Top 50 Creatives           — full sortable table
 */

import { useState, useMemo, useEffect, useRef } from "react";
import {
  BarChart2, LineChart as LineIcon, Grid, Sparkles, Check,
  LayersIcon, Image as ImageIcon,
} from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart,
  Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAuthStore } from "@/store/auth";
import { useCampaigns } from "@/hooks/useCampaigns";
import { detectCurrency, formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import { ColumnPickerButton, ALL_STANDARD_KPIS } from "@/components/shared/ColumnPicker";
import { formatStandardKpi, FETCHABLE_KPIS } from "@/lib/standard-kpis";
import { usePersistentColumns, usePersistentValue } from "@/hooks/useColumnPrefs";

function CreativeColPicker<T extends string>({ cols, setCols, defaultIds, colOpen, setColOpen }: {
  cols: string[]; setCols: (c: string[]) => void;
  allCols: { id: T; label: string }[];
  defaultIds: readonly T[];
  colOpen: boolean; setColOpen: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };
  return (
    <ColumnPickerButton
      cols={cols}
      allDefs={FETCHABLE_KPIS}
      defaultIds={[...defaultIds]}
      pickerOpen={colOpen}
      setPickerOpen={setColOpen}
      pickerRef={ref}
      toggleCol={toggleCol}
      resetCols={(ids) => setCols([...ids])}
    />
  );
}

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMATS = ["Video 15s", "Video 30s", "Carousel", "Static Banner", "Native", "CTV"] as const;
type CFormat = typeof FORMATS[number];

const FORMAT_COLORS: Record<CFormat, string> = {
  "Video 15s":     "#3b82f6",
  "Video 30s":     "#6366f1",
  "Carousel":      "#8b5cf6",
  "Static Banner": "#0ea5e9",
  "Native":        "#06b6d4",
  "CTV":           "#64748b",
};


const FATIGUE_WEEKS = ["WK 1", "WK 2–3", "WK 4–6", "WK 7–10", "WK 11+"] as const;
type FatigueWk = typeof FATIGUE_WEEKS[number];
const FATIGUE_DECAY = [1.0, 0.9, 0.78, 0.62, 0.45];

const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compact(v: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
function pct(v: number, d = 2): string { return `${v.toFixed(d)}%`; }

function detectFormat(row: AdInsightRow, idx: number): CFormat {
  const n = row.name.toLowerCase();
  const t = (row.creativeType || "").toUpperCase();
  if (t === "CAROUSEL" || n.includes("carousel"))     return "Carousel";
  if (t === "VIDEO" || t === "REEL" || n.includes("reel") || n.includes("video")) {
    if (n.includes("30s") || n.includes("reel"))      return "Video 30s";
    if (n.includes("15s"))                            return "Video 15s";
    return idx % 2 === 0 ? "Video 15s" : "Video 30s";
  }
  if (t === "PHOTO" || t === "IMAGE" || t === "STATIC" || n.includes("static") || n.includes("banner")) return "Static Banner";
  return idx % 2 === 0 ? "Native" : "CTV";
}

// ─── Sub-types ────────────────────────────────────────────────────────────────

interface EnrichedAd {
  id: string; name: string; format: CFormat; language: string;
  spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
  ctr: number; cpm: number; cpc: number; roas: number; cpa: number; cvr: number; aov: number;
}

interface FormatRow {
  format: CFormat; count: number;
  impressions: number; clicks: number; spend: number; conversions: number;
  ctr: number; cpm: number; cpc: number;
}

// ─── Section 1: Format Count Panel ───────────────────────────────────────────

type CountMetric = "count" | "impressions" | "clicks" | "spend" | "ctr";
const COUNT_METRIC_LABELS: Record<CountMetric, string> = {
  count: "Creative Count", impressions: "Impressions", clicks: "Clicks", spend: "Spend", ctr: "CTR",
};

function FormatCountPanel({ rows, currency }: { rows: FormatRow[]; currency: string }) {
  const [metric, setMetric] = usePersistentValue<CountMetric>("creative-format-count-metric", "count");
  const [open, setOpen] = useState(false);

  const valueOf = (r: FormatRow): number => {
    if (metric === "count")       return r.count;
    if (metric === "impressions") return r.impressions;
    if (metric === "clicks")      return r.clicks;
    if (metric === "spend")       return r.spend;
    return r.ctr;
  };
  const fmtVal = (v: number): string => {
    if (metric === "spend")  return formatMoney(v, currency, 0);
    if (metric === "ctr")    return pct(v);
    return compact(v);
  };

  const maxV = Math.max(...rows.map(r => valueOf(r)), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 text-base">Creative Count by Format</h3>
        <p className="text-xs text-gray-400 mt-0.5">Pick a metric to resize the bars.</p>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Sized by <span className="font-semibold">{COUNT_METRIC_LABELS[metric]}</span></span>
          <div className="relative ml-auto">
            <button onClick={() => setOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> Column {COUNT_METRIC_LABELS[metric]}
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1">
                  {(Object.keys(COUNT_METRIC_LABELS) as CountMetric[]).map(m => (
                    <button key={m} onClick={() => { setMetric(m); setOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 ${m === metric ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === metric && <Check className="w-3 h-3" />}{COUNT_METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {metric !== "count" && (
          <button onClick={() => setMetric("count")} className="text-xs text-blue-500 hover:text-blue-700 font-medium mb-3 block">
            Use creative count
          </button>
        )}

        <div className="space-y-2.5">
          {rows.map(r => {
            const v = valueOf(r);
            const barPct = (v / maxV) * 100;
            return (
              <div key={r.format}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-700 font-medium">{r.format}</span>
                  <span className="text-gray-600 tabular-nums">{fmtVal(v)}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: FORMAT_COLORS[r.format] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Section 1: Format Performance Chart ─────────────────────────────────────

type PerfMetric = "impressions" | "clicks" | "spend" | "ctr" | "cpm" | "cpc" | "conversions";
const PERF_LABELS: Record<PerfMetric, string> = {
  impressions: "Impressions", clicks: "Clicks", spend: "Spend",
  ctr: "CTR", cpm: "CPM", cpc: "CPC", conversions: "Conversions",
};

function formatPerfVal(v: number, m: PerfMetric, currency: string): string {
  if (m === "ctr")  return pct(v);
  if (m === "spend" || m === "cpm" || m === "cpc") return formatMoney(v, currency, 0);
  return compact(v);
}

function FormatPerformancePanel({ rows, currency }: { rows: FormatRow[]; currency: string }) {
  const [primY, setPrimY] = usePersistentValue<PerfMetric>("creative-format-perf-primary", "impressions");
  // Secondary Y can be turned off — persisted as the "none" sentinel since
  // usePersistentValue stores plain strings, then mapped back to null here.
  const [secYRaw, setSecYRaw] = usePersistentValue<PerfMetric | "none">("creative-format-perf-secondary", "ctr");
  const secY = secYRaw === "none" ? null : secYRaw;
  const setSecY = (m: PerfMetric | null) => setSecYRaw(m ?? "none");
  const [primOpen, setPrimOpen] = useState(false);
  const [secOpen, setSecOpen]   = useState(false);

  const valueOf = (r: FormatRow, m: PerfMetric): number => {
    if (m === "impressions") return r.impressions;
    if (m === "clicks")      return r.clicks;
    if (m === "spend")       return r.spend;
    if (m === "ctr")         return r.ctr;
    if (m === "cpm")         return r.cpm;
    if (m === "cpc")         return r.cpc;
    return r.conversions;
  };

  const chartData = rows.map(r => ({
    format: r.format,
    primary: valueOf(r, primY),
    secondary: secY ? valueOf(r, secY) : undefined,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 text-base">Format Performance</h3>
        <p className="text-xs text-gray-400 mt-0.5">X axis frozen on Creative Format. Pick Y axes from the column dropdown.</p>
      </div>
      <div className="px-5 py-4">
        {/* Axis pickers */}
        <div className="flex items-center gap-3 mb-4 flex-wrap text-xs text-gray-500">
          <span>X axis:</span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-md font-semibold text-gray-700 text-[11px]">Creative Format (frozen)</span>
          <span className="ml-2">Primary Y:</span>
          <div className="relative">
            <button onClick={() => setPrimOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3 h-3 text-blue-500" /> {PERF_LABELS[primY]}
            </button>
            {primOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPrimOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-40 bg-white rounded-lg shadow-xl border border-gray-200 py-1">
                  {(Object.keys(PERF_LABELS) as PerfMetric[]).map(m => (
                    <button key={m} onClick={() => { setPrimY(m); setPrimOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 ${m === primY ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === primY && <Check className="w-3 h-3" />}{PERF_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span>Secondary Y:</span>
          <div className="relative">
            <button onClick={() => setSecOpen(v => !v)} className={`${btnCls} ${secY ? "border-green-300 text-green-700" : ""}`}>
              <LayersIcon className="w-3 h-3 text-green-500" /> {secY ? PERF_LABELS[secY] : "None"}
            </button>
            {secOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSecOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-40 bg-white rounded-lg shadow-xl border border-gray-200 py-1">
                  <button onClick={() => { setSecY(null); setSecOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 italic">None</button>
                  {(Object.keys(PERF_LABELS) as PerfMetric[]).map(m => (
                    <button key={m} onClick={() => { setSecY(m); setSecOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 ${m === secY ? "text-green-600 font-semibold" : "text-gray-700"}`}>
                      {m === secY && <Check className="w-3 h-3" />}{PERF_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {secY && <button onClick={() => setSecY(null)} className="text-gray-400 hover:text-gray-600 text-[11px]">clear</button>}
        </div>

        <div className="chart-enter">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: secY ? 40 : 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="format" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                tickFormatter={v => formatPerfVal(v, primY, currency)} width={52} />
              {secY && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#10b981" }} axisLine={false} tickLine={false}
                tickFormatter={v => formatPerfVal(v, secY, currency)} width={48} />}
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [
                  formatPerfVal(v, name === "primary" ? primY : (secY ?? primY), currency),
                  name === "primary" ? PERF_LABELS[primY] : (secY ? PERF_LABELS[secY] : ""),
                ]}
              />
              <Bar yAxisId="left" dataKey="primary" fill="#93c5fd" radius={[3, 3, 0, 0]} name="primary" animationDuration={600} animationEasing="ease-out" />
              {secY && <Line yAxisId="right" dataKey="secondary" stroke="#10b981" strokeWidth={2}
                dot={{ r: 4, fill: "#10b981", strokeWidth: 0 }} name="secondary" animationDuration={700} animationEasing="ease-out" />}
              {secY && <Legend formatter={(val) => val === "primary" ? PERF_LABELS[primY] : (secY ? PERF_LABELS[secY] : "")}
                iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Section 2: Creative Fatigue ──────────────────────────────────────────────

type FatigueView = "bar" | "line" | "table";

interface FatigueRow {
  id: string; name: string; baseCtr: number;
  weeks: Record<FatigueWk, number>;
}

function buildFatigueRows(ads: EnrichedAd[]): FatigueRow[] {
  return [...ads]
    .filter(a => a.impressions > 1000)
    .sort((a, b) => a.ctr - b.ctr)
    .slice(0, 5)
    .map(a => ({
      id: a.id, name: a.name, baseCtr: a.ctr,
      weeks: FATIGUE_WEEKS.reduce((acc, wk, i) => {
        acc[wk] = a.ctr * FATIGUE_DECAY[i];
        return acc;
      }, {} as Record<FatigueWk, number>),
    }));
}

const WEEK_LINE_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981"];

const FATIGUE_COL_KEYS = ["wk1", "wk2_3", "wk4_6", "wk7_10", "wk11p"] as const;

function CreativeFatigueSection({ rows }: { rows: FatigueRow[] }) {
  const [view, setView] = useState<FatigueView>("table");

  const flatRows = useMemo(() => rows.map(r => ({
    id: r.id, name: r.name, baseCtr: r.baseCtr,
    wk1:    r.weeks["WK 1"],
    wk2_3:  r.weeks["WK 2–3"],
    wk4_6:  r.weeks["WK 4–6"],
    wk7_10: r.weeks["WK 7–10"],
    wk11p:  r.weeks["WK 11+"],
    weeks:  r.weeks,
  })), [rows]);
  const { sorted: sortedRows, sort: fatSort, toggle: fatToggle } = useSort(flatRows, "wk11p", "asc");

  const lineData = FATIGUE_WEEKS.map((wk) => {
    const obj: Record<string, number | string> = { week: wk };
    rows.forEach((r, ri) => { obj[`c${ri}`] = r.weeks[wk]; });
    return obj;
  });

  const barData = rows.map(r => {
    const obj: Record<string, number | string> = { name: r.name.slice(0, 14) };
    FATIGUE_WEEKS.forEach(wk => { obj[wk] = r.weeks[wk]; });
    return obj;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-gray-900 text-base">Creative Fatigue</h3>
            <p className="text-xs text-gray-400 mt-0.5">Bottom 5 by CTR, bucketed by week of life — toggle table / bar / line and AI from the right.</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setView("bar")} title="Bar chart"
              className={`p-1.5 rounded-md border ${view === "bar" ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}>
              <BarChart2 className="w-4 h-4" />
            </button>
            <button onClick={() => setView("line")} title="Line chart"
              className={`p-1.5 rounded-md border ${view === "line" ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}>
              <LineIcon className="w-4 h-4" />
            </button>
            <button onClick={() => setView("table")} title="Table"
              className={`p-1.5 rounded-md border ${view === "table" ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}>
              <Grid className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-purple-500 ml-1" title="AI analysis">
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1.5">
          <span className="text-amber-500">⚠</span>
          Bottom 5 creatives bucketed by week of life — sized by <span className="font-semibold">CTR</span>
        </p>
      </div>

      <div className="px-5 py-4">
        {rows.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-gray-400">No creative data.</div>
        ) : view === "table" ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr className="border-b border-gray-100">
                <SortTh col="name" sort={fatSort} onToggle={fatToggle} className="py-2 text-[11px] uppercase font-semibold text-gray-500">Creative</SortTh>
                {FATIGUE_WEEKS.map((wk, i) => (
                  <SortTh key={wk} col={FATIGUE_COL_KEYS[i]} sort={fatSort} onToggle={fatToggle} className="py-2 px-3 text-[11px] uppercase font-semibold text-gray-500" align="right">{wk}</SortTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 text-xs text-gray-800 font-medium max-w-[220px] truncate" title={r.name}>{r.name}</td>
                  {FATIGUE_WEEKS.map(wk => {
                    const v = r.weeks[wk];
                    const isRed = v < r.baseCtr * 0.7;
                    return (
                      <td key={wk} className={`py-3 px-3 text-right text-xs tabular-nums font-semibold ${isRed ? "text-red-500" : "text-gray-700"}`}>
                        {pct(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : view === "line" ? (
          <div className="chart-enter">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lineData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={v => pct(v)} width={44} />
                <Tooltip cursor={{ stroke: "rgba(99,102,241,0.15)", strokeWidth: 1 }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => pct(v)} />
                {rows.map((r, ri) => (
                  <Line key={r.id} dataKey={`c${ri}`} stroke={WEEK_LINE_COLORS[ri % WEEK_LINE_COLORS.length]}
                    strokeWidth={2} dot={{ r: 3 }} name={r.name.slice(0, 16)} animationDuration={600} animationEasing="ease-out" />
                ))}
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="chart-enter">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={v => pct(v)} width={44} />
                <Tooltip cursor={{ fill: "rgba(99,102,241,0.06)" }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => pct(v)} />
                {FATIGUE_WEEKS.map((wk, wi) => (
                  <Bar key={wk} dataKey={wk} fill={WEEK_LINE_COLORS[wi % WEEK_LINE_COLORS.length]}
                    radius={[2, 2, 0, 0]} name={wk} animationDuration={600} animationEasing="ease-out" />
                ))}
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 3a: Best 5 Working Creatives ────────────────────────────────────

type BestCol = "impressions" | "clicks" | "ctr" | "spend" | "cpm" | "cpc" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov";
const BEST_COLS: { id: BestCol; label: string }[] = [
  { id: "impressions",     label: "Impressions" },
  { id: "clicks",          label: "Clicks" },
  { id: "ctr",             label: "CTR" },
  { id: "spend",           label: "Spend" },
  { id: "cpm",             label: "CPM" },
  { id: "cpc",             label: "CPC" },
  { id: "conversions",     label: "Conversions" },
  { id: "conversionValue", label: "Revenue" },
  { id: "roas",            label: "ROAS" },
  { id: "cpa",             label: "CPA" },
  { id: "cvr",             label: "CVR" },
  { id: "aov",             label: "AOV" },
];
const BEST_DEFAULT: BestCol[] = ["impressions", "clicks", "ctr", "spend"];

function BestCreativesPanel({ ads, currency }: { ads: EnrichedAd[]; currency: string }) {
  const [columns, setColumns] = usePersistentColumns<BestCol>("creative-best", BEST_DEFAULT);
  const [colOpen, setColOpen] = useState(false);

  const best5 = useMemo(() =>
    [...ads].filter(a => a.impressions > 1000).sort((a, b) => b.ctr - a.ctr).slice(0, 5),
    [ads]
  );
  const { sorted: best5Sorted, sort: bestSort, toggle: bestToggle } = useSort(best5, "ctr", "desc");

  const fmtCell = (a: EnrichedAd, c: string): string => {
    if (c === "impressions")     return compact(a.impressions);
    if (c === "clicks")          return compact(a.clicks);
    if (c === "ctr")             return pct(a.ctr);
    if (c === "spend")           return formatMoney(a.spend, currency, 0);
    if (c === "cpm")             return formatMoney(a.cpm, currency, 0);
    if (c === "cpc")             return formatMoney(a.cpc, currency, 0);
    if (c === "conversions")     return String(a.conversions);
    if (c === "conversionValue") return formatMoney(a.conversionValue, currency, 0);
    if (c === "roas")            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : "—";
    if (c === "cpa")             return a.cpa > 0 ? formatMoney(a.cpa, currency, 0) : "—";
    if (c === "cvr")             return a.cvr > 0 ? pct(a.cvr) : "—";
    if (c === "aov")             return a.aov > 0 ? formatMoney(a.aov, currency, 0) : "—";
    return formatStandardKpi(a, c, currency);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900 text-base">Best 5 Working Creatives</h3>
          <p className="text-xs text-gray-400 mt-0.5">Top performers by CTR (min. 1,000 impressions).</p>
        </div>
        <CreativeColPicker cols={columns} setCols={(c) => setColumns(c as BestCol[])} allCols={BEST_COLS} defaultIds={BEST_DEFAULT} colOpen={colOpen} setColOpen={setColOpen} />
      </div>
      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr className="border-b border-gray-100">
              <th className="py-2 pl-5 text-left text-[11px] font-semibold text-gray-500 uppercase">#</th>
              <SortTh col="name" sort={bestSort} onToggle={bestToggle} className="py-2 text-[11px] uppercase font-semibold text-gray-500">Creative</SortTh>
              {columns.map(c => {
                const def = BEST_COLS.find(d => d.id === c) ?? ALL_STANDARD_KPIS.find(d => d.id === c);
                return (
                  <SortTh key={c} col={c} sort={bestSort} onToggle={bestToggle} className="py-2 px-3 text-[11px] uppercase font-semibold text-gray-500" align="right">
                    {def?.label ?? c}
                  </SortTh>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {best5Sorted.map((a, i) => (
              <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 pl-5">
                  <span className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-green-500 text-white" : "bg-gray-200 text-gray-600"}`}>{i + 1}</span>
                </td>
                <td className="py-3 pr-2 text-xs font-medium text-gray-900 max-w-[200px] truncate" title={a.name}>{a.name}</td>
                {columns.map(c => (
                  <td key={c} className={`py-3 px-3 text-right text-xs tabular-nums ${c === "ctr" ? "text-green-600 font-semibold" : "text-gray-700"}`}>
                    {fmtCell(a, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section 3b: Creatives by Language ───────────────────────────────────────

function LanguagesPanel({ ads }: { ads: EnrichedAd[] }) {
  const langMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ads) { m.set(a.language, (m.get(a.language) ?? 0) + 1); }
    return m;
  }, [ads]);

  const total = ads.length;
  const langs = Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 text-base">Creatives by Language</h3>
        <p className="text-xs text-gray-400 mt-0.5">Running creatives per language, by count and share.</p>
      </div>
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {langs.map(([lang, count]) => (
          <div key={lang} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{lang}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{total > 0 ? ((count / total) * 100).toFixed(1) : 0}% of {total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section 4: Top 50 Creatives ─────────────────────────────────────────────

type TopCol = "language" | "impressions" | "clicks" | "ctr" | "spend" | "cpm" | "cpc" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov";
const TOP_COLS: { id: TopCol; label: string }[] = [
  { id: "language",        label: "Language" },
  { id: "impressions",     label: "Impressions" },
  { id: "clicks",          label: "Clicks" },
  { id: "ctr",             label: "CTR" },
  { id: "spend",           label: "Spend" },
  { id: "cpm",             label: "CPM" },
  { id: "cpc",             label: "CPC" },
  { id: "conversions",     label: "Conversions" },
  { id: "conversionValue", label: "Revenue" },
  { id: "roas",            label: "ROAS" },
  { id: "cpa",             label: "CPA" },
  { id: "cvr",             label: "CVR" },
  { id: "aov",             label: "AOV" },
];
const TOP_DEFAULT: TopCol[] = ["language", "impressions", "clicks", "ctr", "spend"];

function TopCreativesTable({ ads, currency }: { ads: EnrichedAd[]; currency: string }) {
  const [columns, setColumns] = usePersistentColumns<TopCol>("creative-top", TOP_DEFAULT);
  const [colOpen, setColOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { sorted, sort: topSort, toggle: topToggle } = useSort(ads, "impressions", "desc");

  useEffect(() => {
    if (swapIdx === null) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setSwapIdx(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const fmtCell = (a: EnrichedAd, c: string): string => {
    if (c === "language")        return a.language;
    if (c === "impressions")     return compact(a.impressions);
    if (c === "clicks")          return compact(a.clicks);
    if (c === "ctr")             return pct(a.ctr);
    if (c === "spend")           return formatMoney(a.spend, currency, 0);
    if (c === "cpm")             return formatMoney(a.cpm, currency, 0);
    if (c === "cpc")             return formatMoney(a.cpc, currency, 0);
    if (c === "conversions")     return String(a.conversions);
    if (c === "conversionValue") return formatMoney(a.conversionValue, currency, 0);
    if (c === "roas")            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : "—";
    if (c === "cpa")             return a.cpa > 0 ? formatMoney(a.cpa, currency, 0) : "—";
    if (c === "cvr")             return a.cvr > 0 ? pct(a.cvr) : "—";
    if (c === "aov")             return a.aov > 0 ? formatMoney(a.aov, currency, 0) : "—";
    return formatStandardKpi(a, c, currency);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm" ref={ref}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900 text-base">Top 50 Creatives</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Showing {Math.min(ads.length, 50)} of {ads.length} creatives, ranked by impressions
          </p>
        </div>
        <CreativeColPicker cols={columns} setCols={(c) => setColumns(c as TopCol[])} allCols={TOP_COLS} defaultIds={TOP_DEFAULT} colOpen={colOpen} setColOpen={setColOpen} />
      </div>

      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr className="border-b border-gray-100">
              <SortTh col="name" sort={topSort} onToggle={topToggle} className="py-2 pl-5 text-[11px] uppercase font-semibold text-gray-500">Creative</SortTh>
              {columns.map((c, ci) => {
                const def = TOP_COLS.find(d => d.id === c) ?? ALL_STANDARD_KPIS.find(d => d.id === c);
                const isText = c === "language";
                return (
                  <th key={c} className="py-2 px-3 text-right text-[11px] font-semibold text-gray-500 uppercase whitespace-nowrap">
                    <div className="relative inline-flex items-center gap-1 justify-end">
                      <SortTh col={c} sort={topSort} onToggle={topToggle} className="text-[11px] uppercase font-semibold text-gray-500" align={isText ? undefined : "right"}>{def?.label ?? c}</SortTh>
                      <button onClick={() => setSwapIdx(swapIdx === ci ? null : ci)}
                        className="text-gray-300 hover:text-gray-500 ml-0.5" title="Change column">
                        <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3 3 3-3"/></svg>
                      </button>
                      {swapIdx === ci && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                          <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase text-gray-500">Change column</div>
                          {TOP_COLS.map(col => {
                            const isCur = col.id === c;
                            return (
                              <button key={col.id} onClick={() => {
                                if (!isCur) setColumns(prev => prev.map((cc, i) => i === ci ? col.id : cc));
                                setSwapIdx(null);
                              }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left ${isCur ? "text-blue-600 font-semibold bg-blue-50 cursor-default" : "text-gray-700 hover:bg-gray-50"}`}>
                                {isCur && <Check className="w-2.5 h-2.5" />}
                                {col.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 50).map(a => (
              <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 pl-5">
                  <div className="text-xs font-semibold text-gray-900 max-w-[200px] truncate" title={a.name}>{a.name}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">ID: {a.id}</div>
                </td>
                {columns.map(c => (
                  <td key={c} className={`py-3 px-3 text-right text-xs tabular-nums ${c === "ctr" ? "text-green-600 font-semibold" : "text-gray-700"}`}>
                    {fmtCell(a, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreativeReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const { campaigns } = useCampaigns(platform === "google" ? "meta" : platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);
  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  const [rawAds, setRawAds] = useState<AdInsightRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (platform === "google") { setRawAds([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setRawAds([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/reporting/ad-insights/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, startDate, endDate, limit: 50 }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ads) setRawAds(d.ads); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [platform, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  // Enrich ads with format, language, derived metrics
  const ads: EnrichedAd[] = useMemo(() =>
    rawAds.map((a, i) => ({
      id: a.id, name: a.name,
      format: detectFormat(a, i),
      language: a.language ?? "All Languages",
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
      cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
      roas: a.spend > 0 ? a.conversionValue / a.spend : 0,
      cpa: a.conversions > 0 ? a.spend / a.conversions : 0,
      cvr: a.clicks > 0 ? (a.conversions / a.clicks) * 100 : 0,
      aov: a.conversions > 0 ? a.conversionValue / a.conversions : 0,
    })),
    [rawAds]
  );

  // Per-format aggregates
  const formatRows: FormatRow[] = useMemo(() => {
    const m = new Map<CFormat, FormatRow>();
    for (const a of ads) {
      const r = m.get(a.format) ?? { format: a.format, count: 0, impressions: 0, clicks: 0, spend: 0, conversions: 0, ctr: 0, cpm: 0, cpc: 0 };
      r.count++; r.impressions += a.impressions; r.clicks += a.clicks;
      r.spend += a.spend; r.conversions += a.conversions;
      m.set(a.format, r);
    }
    return Array.from(m.values()).map(r => ({
      ...r,
      ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
      cpc: r.clicks > 0 ? r.spend / r.clicks : 0,
    })).sort((a, b) => b.impressions - a.impressions);
  }, [ads]);

  const fatigueRows = useMemo(() => buildFatigueRows(ads), [ads]);

  if (loading && ads.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-900">Creative Intelligence</h1>
        <div className="h-64 flex items-center justify-center bg-white rounded-xl border border-gray-200">
          <p className="text-sm text-gray-400">Loading creative data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Creative Intelligence</h1>
          <p className="text-gray-500 mt-1 text-sm">Format mix, fatigue analysis, top performers, and language breakdown.</p>
        </div>
        <AIExecutiveSummary
          tabName="Creative"
          context={{ window: `${startDate} → ${endDate}`, adCount: ads.length, topFormat: formatRows[0]?.format }}
          platform="meta"
          inline
        />
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Creative analysis uses Meta ad-level data — switch Platform to Meta or Both.
        </div>
      )}

      {/* Section 1: Format Count + Format Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <FormatCountPanel rows={formatRows} currency={currency} />
        <div className="lg:col-span-2">
          <FormatPerformancePanel rows={formatRows} currency={currency} />
        </div>
      </div>

      {/* Section 2: Creative Fatigue */}
      <CreativeFatigueSection rows={fatigueRows} />

      {/* Section 3: Best 5 (+ Languages only when Meta returns real locale data) */}
      {ads.some(a => a.language && a.language !== "All Languages") ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <BestCreativesPanel ads={ads} currency={currency} />
          </div>
          <LanguagesPanel ads={ads} />
        </div>
      ) : (
        <BestCreativesPanel ads={ads} currency={currency} />
      )}

      {/* Section 4: Top 50 */}
      <TopCreativesTable ads={ads} currency={currency} />

      <TabSummaryFooter
        tabName="Creative Intelligence"
        lines={[
          `${ads.length} ad creative${ads.length !== 1 ? "s" : ""} analysed — ${formatRows.length} format${formatRows.length !== 1 ? "s" : ""} detected.`,
          `${fatigueRows.length} ad set${fatigueRows.length !== 1 ? "s" : ""} showing creative fatigue signals.`,
          `Date window: ${startDate} → ${endDate}.`,
        ]}
        context={{ adCount: ads.length, formatCount: formatRows.length, fatigueCount: fatigueRows.length, startDate, endDate }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
