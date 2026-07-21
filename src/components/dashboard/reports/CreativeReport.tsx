/**
 * Reporting → Creative Intelligence
 *
 * Split into per-platform sections (Meta / DV360). Each shows:
 *   1. Creative Count by Format  +  Format Performance (dual-axis chart)
 *   2. Best 5 Working Creatives  +  Creatives by Language
 *   3. Top 50 Creatives           — full sortable table
 *
 * All values are real (API-sourced). Nothing is synthesized: formats are
 * classified only from real signals, and metrics that aren't fetchable per
 * creative (e.g. conversions/revenue for DV360) render "—", never a fake 0.
 * Creative fatigue over time was removed — no reporting API exposes a real
 * per-creative week-over-week series, so a synthetic decay curve would mislead.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { Check, LayersIcon } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import {
  ResponsiveContainer, ComposedChart,
  Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAuthStore } from "@/store/auth";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useDV360Creatives } from "@/hooks/useDV360Creatives";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import { formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";
import { Term } from "@/components/shared/Term";
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
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Only buckets we can identify from REAL signals (API creativeType or explicit
// name tokens). No duration/format is ever guessed — anything we can't classify
// falls into "Other" rather than being fabricated.
const FORMATS = ["Video 15s", "Video 30s", "Video", "CTV", "Carousel", "Static / Banner", "Native", "Audio", "Other"] as const;
type CFormat = typeof FORMATS[number];

const FORMAT_COLORS: Record<CFormat, string> = {
  "Video 15s":       "#3b82f6",
  "Video 30s":       "#6366f1",
  "Video":           "#818cf8",
  "CTV":             "#64748b",
  "Carousel":        "#8b5cf6",
  "Static / Banner": "#0ea5e9",
  "Native":          "#14b8a6",
  "Audio":           "#f59e0b",
  "Other":           "#94a3b8",
};

const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compact(v: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
function pct(v: number, d = 2): string { return `${v.toFixed(d)}%`; }

/**
 * Classify a creative's format using ONLY real signals — the API's creativeType
 * and explicit tokens in the creative name. Nothing is guessed: a video whose
 * duration isn't stated in the name is "Video" (not fabricated as 15s/30s), and
 * anything unrecognised is "Other".
 */
function detectFormat(row: AdInsightRow): CFormat {
  const n = row.name.toLowerCase();
  // creativeType may be a Meta value (VIDEO/PHOTO/CAROUSEL) or a DV360 Bid
  // Manager "Creative Type" (Display / Video / Native / Audio / …).
  const t = (row.creativeType || "").toUpperCase();
  if (t.includes("CAROUSEL") || n.includes("carousel")) return "Carousel";
  if (t.includes("AUDIO")) return "Audio";
  if (t.includes("NATIVE")) return "Native";
  if (t.includes("CTV") || t.includes("CONNECTED TV") || t.includes("TV") || n.includes("ctv") || n.includes("connected tv")) return "CTV";
  const isVideo = t.includes("VIDEO") || t === "REEL" || n.includes("reel") || n.includes("video");
  if (isVideo) {
    if (/\b(30\s?s|30\s?sec)/.test(n)) return "Video 30s";
    if (/\b(15\s?s|15\s?sec)/.test(n)) return "Video 15s";
    return "Video"; // duration not stated — do not guess
  }
  // Display banners. DV360's Bid Manager reports these as "Standard" (plus
  // Expandable / Lightbox / Rich media / Third-party / Templated / HTML5);
  // Meta reports "Photo"/"Image". A creative size (e.g. 728x90, 300x250) in the
  // name or size field is also a reliable display signal.
  if (t.includes("DISPLAY") || t.includes("STANDARD") || t.includes("IMAGE") || t.includes("PHOTO")
      || t.includes("STATIC") || t.includes("BANNER") || t.includes("HTML") || t.includes("EXPANDABLE")
      || t.includes("LIGHTBOX") || t.includes("RICH") || t.includes("THIRD") || t.includes("TEMPLATED") || t.includes("CUSTOM")
      || n.includes("static") || n.includes("banner") || /\b\d{2,4}\s?x\s?\d{2,4}\b/.test(n)) return "Static / Banner";
  return "Other";
}

// ─── Sub-types ────────────────────────────────────────────────────────────────

interface EnrichedAd {
  id: string; name: string; format: CFormat; language: string; platform: "meta" | "dv360";
  spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
  ctr: number; cpm: number; cpc: number; roas: number; cpa: number; cvr: number; aov: number;
  // Conversions/revenue aren't available per-creative for DV360 (Bid Manager
  // rolls them up to campaign grain only) — flagged so the UI shows "—".
  convAvailable: boolean;
}

// Unknown-value marker shown instead of any placeholder/synthetic value.
const NA = "—";
// Conversion-family columns — unavailable per-creative for DV360.
const CONV_COLS = new Set(["conversions", "conversionValue", "roas", "cpa", "cvr", "aov"]);

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
              <Bar yAxisId="left" dataKey="primary" fill="#93c5fd" radius={[3, 3, 0, 0]} name="primary" maxBarSize={96} animationDuration={600} animationEasing="ease-out" />
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
    // Conversions/revenue aren't fetchable per-creative for DV360 — show "—",
    // never a fabricated 0.
    if (CONV_COLS.has(c) && !a.convAvailable) return NA;
    if (c === "impressions")     return compact(a.impressions);
    if (c === "clicks")          return compact(a.clicks);
    if (c === "ctr")             return pct(a.ctr);
    if (c === "spend")           return formatMoney(a.spend, currency, 0);
    if (c === "cpm")             return formatMoney(a.cpm, currency, 0);
    if (c === "cpc")             return formatMoney(a.cpc, currency, 0);
    if (c === "conversions")     return String(a.conversions);
    if (c === "conversionValue") return formatMoney(a.conversionValue, currency, 0);
    if (c === "roas")            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : NA;
    if (c === "cpa")             return a.cpa > 0 ? formatMoney(a.cpa, currency, 0) : NA;
    if (c === "cvr")             return a.cvr > 0 ? pct(a.cvr) : NA;
    if (c === "aov")             return a.aov > 0 ? formatMoney(a.aov, currency, 0) : NA;
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

// ─── DV360 Delivery by Language (FILTER_SITE_LANGUAGE) ───────────────────────
// Real delivery breakdown — impressions/clicks/spend by the language of the
// site/app/content the ads ran on. DV360 has no per-creative language attribute,
// so this is delivery-level (not per-creative count like the Meta panel).
interface LangRow { label: string; impressions: number; clicks: number; spend: number }
function LanguageDeliveryPanel({
  rows, loading, currency,
}: { rows: LangRow[]; loading: boolean; currency: string }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.spend - a.spend), [rows]);
  const totalSpend = sorted.reduce((s, r) => s + r.spend, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 text-base">Delivery by <Term name="Site Language">Language</Term></h3>
        <p className="text-xs text-gray-400 mt-0.5">Impressions, clicks &amp; spend by the language of the site/app the ads ran on (Bid Manager).</p>
      </div>
      {loading && rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading language data…</div>
      ) : sorted.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center gap-1 text-xs text-gray-400 px-6 text-center">
          <span className="font-medium text-gray-500">Language isn&apos;t available for this advertiser via the API.</span>
          <span>Bid Manager doesn&apos;t expose site language (<code className="bg-gray-100 px-1 rounded">FILTER_SITE_LANGUAGE</code>) for this account&apos;s inventory — it can only be viewed in the DV360 UI. This is a platform limitation, not a load error.</span>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="py-2 pl-5 text-left text-[11px] uppercase font-semibold text-gray-500">Language</th>
              <th className="py-2 px-3 text-right text-[11px] uppercase font-semibold text-gray-500">Impressions</th>
              <th className="py-2 px-3 text-right text-[11px] uppercase font-semibold text-gray-500">Clicks</th>
              <th className="py-2 px-3 text-right text-[11px] uppercase font-semibold text-gray-500">CTR</th>
              <th className="py-2 px-3 text-right text-[11px] uppercase font-semibold text-gray-500">Spend</th>
              <th className="py-2 pr-5 text-right text-[11px] uppercase font-semibold text-gray-500">Share</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
              return (
                <tr key={r.label} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 pl-5 text-xs font-medium text-gray-900">{r.label}</td>
                  <td className="py-2.5 px-3 text-right text-xs text-gray-700 tabular-nums">{compact(r.impressions)}</td>
                  <td className="py-2.5 px-3 text-right text-xs text-gray-700 tabular-nums">{compact(r.clicks)}</td>
                  <td className="py-2.5 px-3 text-right text-xs text-green-600 font-semibold tabular-nums">{pct(ctr)}</td>
                  <td className="py-2.5 px-3 text-right text-xs text-gray-900 font-semibold tabular-nums">{formatMoney(r.spend, currency, 0)}</td>
                  <td className="py-2.5 pr-5 text-right text-xs text-gray-400 tabular-nums">{totalSpend > 0 ? ((r.spend / totalSpend) * 100).toFixed(1) : 0}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Section 4: Top 50 Creatives ─────────────────────────────────────────────

type TopCol = "language" | "impressions" | "clicks" | "ctr" | "spend" | "cpm" | "cpc" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov";
const TOP_COLS: { id: TopCol; label: string }[] = [
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
const TOP_DEFAULT: TopCol[] = ["impressions", "clicks", "ctr", "spend"];

function TopCreativesTable({ ads, currency }: { ads: EnrichedAd[]; currency: string }) {
  const [columns, setColumns] = usePersistentColumns<TopCol>("creative-top", TOP_DEFAULT);
  // "language" was removed from this table; strip it from any persisted layout.
  useEffect(() => {
    if (columns.includes("language" as TopCol)) {
      setColumns(prev => prev.filter(c => c !== "language"));
    }
  }, [columns, setColumns]);
  const [colOpen, setColOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { sorted, sort: topSort, toggle: topToggle } = useSort(ads, "ctr", "desc");

  useEffect(() => {
    if (swapIdx === null) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setSwapIdx(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const fmtCell = (a: EnrichedAd, c: string): string => {
    if (c === "language")        return a.language;
    // Conversions/revenue aren't fetchable per-creative for DV360 — show "—".
    if (CONV_COLS.has(c) && !a.convAvailable) return NA;
    if (c === "impressions")     return compact(a.impressions);
    if (c === "clicks")          return compact(a.clicks);
    if (c === "ctr")             return pct(a.ctr);
    if (c === "spend")           return formatMoney(a.spend, currency, 0);
    if (c === "cpm")             return formatMoney(a.cpm, currency, 0);
    if (c === "cpc")             return formatMoney(a.cpc, currency, 0);
    if (c === "conversions")     return String(a.conversions);
    if (c === "conversionValue") return formatMoney(a.conversionValue, currency, 0);
    if (c === "roas")            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : NA;
    if (c === "cpa")             return a.cpa > 0 ? formatMoney(a.cpa, currency, 0) : NA;
    if (c === "cvr")             return a.cvr > 0 ? pct(a.cvr) : NA;
    if (c === "aov")             return a.aov > 0 ? formatMoney(a.aov, currency, 0) : NA;
    return formatStandardKpi(a, c, currency);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm" ref={ref}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900 text-base">Top 50 Creatives</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Showing {Math.min(ads.length, 50)} of {ads.length} creatives, ranked by CTR
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

// ─── Shared enrichment / aggregation helpers ─────────────────────────────────

/** Turn raw ad-insight rows into enriched ads with format, language, derived KPIs. */
function enrichAds(raw: AdInsightRow[], platform: "meta" | "dv360"): EnrichedAd[] {
  // Conversions/revenue are only real for Meta here; DV360 line items don't
  // carry them at creative grain, so those KPIs are marked unavailable.
  const convAvailable = platform === "meta";
  return raw.map((a) => ({
    id: a.id, name: a.name, platform,
    format: detectFormat(a),
    language: a.language || NA,
    convAvailable,
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue,
    ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    roas: a.spend > 0 ? a.conversionValue / a.spend : 0,
    cpa: a.conversions > 0 ? a.spend / a.conversions : 0,
    cvr: a.clicks > 0 ? (a.conversions / a.clicks) * 100 : 0,
    aov: a.conversions > 0 ? a.conversionValue / a.conversions : 0,
  }));
}

/** Per-format aggregates for the count/performance panels. */
function computeFormatRows(ads: EnrichedAd[]): FormatRow[] {
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
}

// ─── One platform's full set of creative sections ────────────────────────────

/**
 * Renders the complete creative-analysis stack (format mix, best 5,
 * languages, top 50) for a single platform's ad list. `keyNs` namespaces the
 * persisted column/metric prefs so the Meta and DV360 tables don't collide.
 */
function CreativeSections({ ads, currency, loading, loadingHint }: { ads: EnrichedAd[]; currency: string; loading?: boolean; loadingHint?: string | boolean }) {
  const formatRows = useMemo(() => computeFormatRows(ads), [ads]);
  const hasLanguages = ads.some(a => a.language && a.language !== NA);

  // Still fetching and nothing to show yet → loading placeholder, NOT an
  // "empty" panel (which reads as a final/broken result).
  if (loading && ads.length === 0) {
    return <LoadingState message="Loading creative data…" hint={loadingHint} />;
  }
  if (ads.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-32 flex items-center justify-center text-sm text-gray-400">
        No creative data for this platform in the selected period.
      </div>
    );
  }

  return (
    <>
      {/* Section 1: Format Count + Format Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <FormatCountPanel rows={formatRows} currency={currency} />
        <div className="lg:col-span-2">
          <FormatPerformancePanel rows={formatRows} currency={currency} />
        </div>
      </div>

      {/* Section 3: Best 5 (+ Languages only when real locale data is present) */}
      {hasLanguages ? (
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
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreativeReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  // Both-platform: pull the merged campaign list. DV360-only: still pull DV360
  // campaigns so we can synthesize ad-level rows from line items below.
  const { metaCurrency, dv360Currency } = useCampaigns(platform, dateRange, customStart, customEnd);
  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  const [rawAds, setRawAds] = useState<AdInsightRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Meta ad-level fetch — only when Meta is in scope.
  useEffect(() => {
    if (platform === "dv360") { setRawAds([]); return; }
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

  // DV360 real creatives — dedicated per-creative Bid Manager report, polled via
  // its own hook (202 → retry) so it's decoupled from the heavy campaigns route
  // and never gets stuck on the campaigns route's short creative-report cap.
  // Format comes from each creative's real creativeType.
  const {
    creatives: dv360CreativeRows,
    loading: dvCreativesLoading,
    pending: dvCreativesPending,
  } = useDV360Creatives(dateRange, customStart, customEnd, platform !== "meta");

  const dv360Ads: AdInsightRow[] = useMemo(() => {
    if (platform === "meta") return [];
    // Pass the real Bid Manager creative type through (Display / Video / Native /
    // Audio / …) so detectFormat can classify it accurately instead of collapsing
    // everything to a single bucket.
    return dv360CreativeRows.map<AdInsightRow>((cr) => ({
      id: cr.id, name: cr.name,
      spend: cr.spend ?? 0, impressions: cr.impressions ?? 0, clicks: cr.clicks ?? 0,
      conversions: 0, conversionValue: 0,
      creativeType: cr.type || "",
    }));
  }, [dv360CreativeRows, platform]);

  const showMeta = platform !== "dv360";
  const showDv   = platform === "dv360" || platform === "both";

  // DV360 delivery-by-language (FILTER_SITE_LANGUAGE) — real BM breakdown.
  const { rows: dvLangRows, loading: dvLangLoading, pending: dvLangPending } =
    useDV360Breakdown("language", dateRange, customStart, customEnd, showDv);

  // Enrich each platform's rows separately so the Meta and DV360 sections stay
  // fully independent (own tables, own aggregates).
  const metaAds: EnrichedAd[]  = useMemo(() => enrichAds(rawAds, "meta"),    [rawAds]);
  const dv360Enriched: EnrichedAd[] = useMemo(() => enrichAds(dv360Ads, "dv360"), [dv360Ads]);

  // Combined counts for the page header / AI summary / footer only.
  const totalAdCount = metaAds.length + dv360Enriched.length;
  const metaFormatRows = useMemo(() => computeFormatRows(metaAds), [metaAds]);
  const dvFormatRows   = useMemo(() => computeFormatRows(dv360Enriched), [dv360Enriched]);

  if (loading && totalAdCount === 0) {
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
          <p className="text-gray-500 mt-1 text-sm">Format mix, top performers, and language breakdown.</p>
        </div>
        <AIExecutiveSummary
          tabName="Creative"
          context={{
            window: `${startDate} → ${endDate}`,
            adCount: totalAdCount,
            ...(showMeta ? {
              meta: {
                currency: metaCurrency,
                formats: metaFormatRows.map((r) => ({ format: r.format, count: r.count, impressions: r.impressions, spend: Math.round(r.spend), ctr: +r.ctr.toFixed(2) })),
                topCreatives: [...metaAds].sort((a, b) => b.impressions - a.impressions).slice(0, 15).map((a) => ({
                  name: a.name, format: a.format, impressions: a.impressions, clicks: a.clicks,
                  ctr: +a.ctr.toFixed(2), spend: Math.round(a.spend), roas: a.convAvailable ? +a.roas.toFixed(2) : null,
                })),
              },
            } : {}),
            ...(showDv ? {
              dv360: {
                currency: dv360Currency,
                formats: dvFormatRows.map((r) => ({ format: r.format, count: r.count, impressions: r.impressions, spend: Math.round(r.spend), ctr: +r.ctr.toFixed(2) })),
                topCreatives: [...dv360Enriched].sort((a, b) => b.impressions - a.impressions).slice(0, 15).map((a) => ({
                  name: a.name, format: a.format, impressions: a.impressions, clicks: a.clicks, ctr: +a.ctr.toFixed(2), spend: Math.round(a.spend),
                })),
                note: "DV360 conversions/revenue aren't available per-creative via API.",
              },
            } : {}),
          }}
          platform={platform}
          inline
        />
      </div>

      {/* ── Meta section ── */}
      {showMeta && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="Meta" sub="Meta Ads" />}
          <CreativeSections ads={metaAds} currency={metaCurrency} loading={loading} />
        </div>
      )}

      {/* ── DV360 section ── */}
      {showDv && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="DV360" sub="Display & Video 360" />}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            Real per-creative delivery from a Bid Manager creative report (impressions, clicks, CTR, spend). Format comes from each creative&apos;s type. Conversions/revenue aren&apos;t available per-creative via API and show &quot;—&quot;. Creatives may take a moment to load on first open (report generates in the background).
          </div>
          <CreativeSections ads={dv360Enriched} currency={dv360Currency} loading={dvCreativesLoading || dvCreativesPending} loadingHint />
          <LanguageDeliveryPanel rows={dvLangRows} loading={dvLangLoading || dvLangPending} currency={dv360Currency} />
        </div>
      )}

      <TabSummaryFooter
        tabName="Creative Intelligence"
        lines={[
          `${totalAdCount} ad creative${totalAdCount !== 1 ? "s" : ""} analysed${showMeta && showDv ? ` — ${metaAds.length} Meta · ${dv360Enriched.length} DV360` : ""}.`,
          showMeta ? `Meta — ${metaFormatRows.length} format${metaFormatRows.length !== 1 ? "s" : ""} detected.` : "",
          showDv ? `DV360 — ${dvFormatRows.length} format${dvFormatRows.length !== 1 ? "s" : ""} detected.` : "",
          `Date window: ${startDate} → ${endDate}.`,
        ].filter(Boolean)}
        context={{ adCount: totalAdCount, metaCount: metaAds.length, dv360Count: dv360Enriched.length, startDate, endDate }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}

// ─── Platform section header (matches Audience Analysis) ──────────────────────
function SectionHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{label}</h2>
      <span className="text-xs text-gray-400 font-medium">{sub}</span>
    </div>
  );
}
