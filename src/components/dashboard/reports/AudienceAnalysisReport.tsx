/**
 * Reporting → Audience Analysis
 *
 * Mirrors dv360-intel visualizations page:
 *   1. Geo Explorer  — bar chart + drillable country table
 *   2. Age Profile   — March of Progress hominid silhouettes
 *   3. Gender Split  — male/female/unknown pictograms
 *   4. Custom Cohorts — cross-tab heatmap (independence approx from two breakdowns)
 *   5. Cohort Detailing — per-audience-segment sortable table
 */

import { useState, useMemo, useRef, useEffect } from "react";
import {
  MapPin, Download, ChevronDown, ChevronRight, LayersIcon, Check, Info,
} from "lucide-react";
import { ColumnPickerButton, ALL_STANDARD_KPIS } from "@/components/shared/ColumnPicker";
import { formatStandardKpi, FETCHABLE_KPIS } from "@/lib/standard-kpis";
import { usePersistentColumns, usePersistentValue } from "@/hooks/useColumnPrefs";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import { useMetaBreakdown, type BreakdownRow } from "@/hooks/useMetaBreakdown";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import { useYouTubeAnalyticsBreakdown } from "@/hooks/useYouTubeAnalyticsBreakdown";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { classifyAdSet, AUDIENCE_COLORS, type AudienceClass } from "@/lib/audience-classifier";
import { formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function compact(v: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
function pct(v: number): string { return `${v.toFixed(1)}%`; }

// ─── Hominid silhouettes (March of Progress) ─────────────────────────────────

const HOMINIDS = [
  {
    id: "australopithecus",
    render: () => (
      <g>
        <ellipse cx={62} cy={62} rx={14} ry={12} />
        <path d="M 50 56 Q 62 50 74 56 L 74 60 L 50 60 Z" />
        <path d="M 38 76 Q 50 74 62 76 L 80 130 L 76 165 L 60 170 L 42 160 L 32 130 Z" />
        <path d="M 70 90 Q 86 110 92 145 L 96 175 L 88 178 L 82 150 L 70 120 Z" />
        <path d="M 38 88 Q 28 110 24 140 L 28 165 L 36 165 L 38 138 L 44 110 Z" />
        <path d="M 62 162 L 76 175 L 84 210 L 76 220 L 68 220 L 64 198 Z" />
        <path d="M 46 162 L 40 178 L 32 215 L 24 220 L 22 218 L 28 195 L 36 175 Z" />
        <ellipse cx={78} cy={216} rx={10} ry={4} /><ellipse cx={26} cy={218} rx={9} ry={3.5} />
      </g>
    ),
  },
  {
    id: "habilis",
    render: () => (
      <g>
        <ellipse cx={56} cy={48} rx={14} ry={13} />
        <path d="M 44 42 Q 56 38 68 42 L 68 47 L 44 47 Z" />
        <path d="M 38 62 Q 52 60 64 62 L 76 130 L 72 168 L 58 170 L 44 162 L 32 130 Z" />
        <path d="M 66 78 Q 80 100 84 140 L 86 175 L 78 178 L 74 145 L 68 110 Z" />
        <path d="M 38 78 Q 28 100 26 140 L 30 170 L 36 170 L 38 140 L 42 105 Z" />
        <path d="M 58 165 L 72 178 L 78 212 L 72 220 L 66 220 L 62 198 Z" />
        <path d="M 44 165 L 38 178 L 30 215 L 24 220 L 22 218 L 28 195 L 34 178 Z" />
        <ellipse cx={73} cy={216} rx={9} ry={4} /><ellipse cx={26} cy={218} rx={8} ry={3.5} />
      </g>
    ),
  },
  {
    id: "erectus",
    render: () => (
      <g>
        <ellipse cx={50} cy={38} rx={14} ry={14} />
        <path d="M 38 32 Q 50 27 62 32 L 62 36 L 38 36 Z" />
        <rect x={46} y={50} width={10} height={8} />
        <path d="M 36 58 Q 50 56 64 58 L 72 130 L 70 170 L 60 175 L 40 172 L 30 130 Z" />
        <path d="M 64 72 Q 76 92 82 130 L 80 160 L 74 162 L 72 130 L 66 102 Z" />
        <path d="M 72 158 L 86 158 L 90 168 L 86 174 L 74 174 Z" />
        <path d="M 36 72 Q 26 92 24 130 L 28 160 L 34 160 L 36 130 L 40 100 Z" />
        <path d="M 56 168 L 70 180 L 74 210 L 68 220 L 60 220 L 58 198 Z" />
        <path d="M 44 168 L 38 180 L 30 215 L 24 220 L 22 218 L 28 195 L 34 180 Z" />
        <ellipse cx={70} cy={216} rx={9} ry={4} /><ellipse cx={26} cy={218} rx={8} ry={3.5} />
      </g>
    ),
  },
  {
    id: "neanderthal",
    render: () => (
      <g>
        <ellipse cx={50} cy={32} rx={16} ry={14} />
        <path d="M 36 26 Q 50 20 64 26 L 64 32 L 36 32 Z" />
        <rect x={44} y={44} width={14} height={8} />
        <path d="M 30 52 Q 50 50 70 52 L 80 130 L 76 170 L 60 175 L 40 175 L 24 170 L 20 130 Z" />
        <path d="M 70 64 Q 82 90 88 130 L 86 165 L 78 168 L 78 130 L 72 96 Z" />
        <rect x={82} y={62} width={6} height={120} rx={2} />
        <ellipse cx={85} cy={60} rx={12} ry={8} />
        <path d="M 30 64 Q 18 90 14 130 L 18 162 L 26 162 L 28 130 L 34 95 Z" />
        <path d="M 58 172 L 70 185 L 76 212 L 68 220 L 58 220 L 56 198 Z" />
        <path d="M 42 172 L 34 185 L 26 215 L 18 220 L 16 218 L 22 195 L 30 185 Z" />
        <ellipse cx={70} cy={216} rx={11} ry={4} /><ellipse cx={20} cy={218} rx={10} ry={3.5} />
      </g>
    ),
  },
  {
    id: "cromagnon",
    render: () => (
      <g>
        <ellipse cx={50} cy={28} rx={13} ry={13} />
        <path d="M 40 24 Q 50 21 60 24 L 60 28 L 40 28 Z" />
        <rect x={46} y={40} width={10} height={8} />
        <path d="M 36 48 Q 50 46 64 48 L 70 130 L 68 172 L 58 178 L 42 175 L 32 130 Z" />
        <path d="M 66 60 Q 76 78 78 110 L 76 138 L 70 138 L 70 110 L 64 84 Z" />
        <rect x={68} y={20} width={3} height={130} />
        <path d="M 69.5 18 L 65 8 L 74 8 Z" />
        <path d="M 36 62 Q 28 84 28 122 L 32 158 L 38 158 L 38 122 L 42 88 Z" />
        <path d="M 56 172 L 68 186 L 72 212 L 66 220 L 58 220 L 56 198 Z" />
        <path d="M 44 172 L 38 186 L 32 215 L 26 220 L 24 218 L 28 195 L 34 186 Z" />
        <ellipse cx={67} cy={216} rx={8} ry={3.5} /><ellipse cx={27} cy={218} rx={7.5} ry={3} />
      </g>
    ),
  },
  {
    id: "modern",
    render: () => (
      <g>
        <circle cx={50} cy={24} r={13} />
        <rect x={46} y={36} width={10} height={8} />
        <path d="M 38 44 Q 50 42 62 44 L 66 130 L 64 174 L 56 180 L 44 178 L 34 130 Z" />
        <path d="M 62 56 Q 70 76 70 110 L 66 142 L 62 142 L 62 110 L 58 80 Z" />
        <path d="M 38 56 Q 30 76 30 110 L 34 144 L 38 144 L 38 110 L 42 80 Z" />
        <path d="M 54 174 L 64 188 L 66 212 L 60 220 L 54 220 L 52 198 Z" />
        <path d="M 46 174 L 40 188 L 36 215 L 30 220 L 28 218 L 32 195 L 38 188 Z" />
        <ellipse cx={61} cy={216} rx={7} ry={3} /><ellipse cx={31} cy={218} rx={6.5} ry={3} />
      </g>
    ),
  },
];

// ─── Gender silhouettes ───────────────────────────────────────────────────────

function FemaleSVG({ h, highlight }: { h: number; highlight: boolean }) {
  const w = h * 0.5;
  return (
    <svg width={w} height={h} viewBox="0 0 100 200" className={`transition-all ${highlight ? "fill-blue-500" : "fill-blue-200"}`}>
      <circle cx={50} cy={26} r={20} />
      <path d="M 35 48 L 65 48 L 88 170 L 12 170 Z" />
      <rect x={42} y={170} width={6} height={30} rx={2} />
      <rect x={52} y={170} width={6} height={30} rx={2} />
    </svg>
  );
}
function MaleSVG({ h, highlight }: { h: number; highlight: boolean }) {
  const w = h * 0.5;
  return (
    <svg width={w} height={h} viewBox="0 0 100 200" className={`transition-all ${highlight ? "fill-blue-500" : "fill-blue-200"}`}>
      <circle cx={50} cy={26} r={20} />
      <path d="M 28 48 L 72 48 L 78 100 L 64 132 L 64 170 L 36 170 L 36 132 L 22 100 Z" />
      <rect x={42} y={170} width={6} height={30} rx={2} />
      <rect x={52} y={170} width={6} height={30} rx={2} />
    </svg>
  );
}
function UnknownSVG({ h }: { h: number }) {
  const w = h * 0.5;
  return (
    <svg width={w} height={h} viewBox="0 0 100 200" className="fill-gray-300 transition-all">
      <circle cx={50} cy={32} r={18} />
      <rect x={36} y={56} width={28} height={110} rx={6} />
    </svg>
  );
}

// ─── Shared dropdown button style ─────────────────────────────────────────────

const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm";

// ─── Geo Explorer ─────────────────────────────────────────────────────────────

type GeoLevel = "country" | "region" | "zip";
const GEO_LEVEL_LABELS: Record<GeoLevel, string> = { country: "Country", region: "Region", zip: "Postal Code" };

interface GeoColDef { id: string; label: string; group: string; fmt: "money" | "int" | "pct" | "x" | "decimal"; defaultOn: boolean; }
const GEO_ALL_COLS: GeoColDef[] = [
  { id: "impressions",     label: "Impressions", group: "Display",    fmt: "int",     defaultOn: true  },
  { id: "reach",           label: "Reach",       group: "Display",    fmt: "int",     defaultOn: false },
  { id: "frequency",       label: "Frequency",   group: "Display",    fmt: "decimal", defaultOn: false },
  { id: "cpm",             label: "CPM",         group: "Display",    fmt: "money",   defaultOn: true  },
  { id: "clicks",          label: "Clicks",      group: "Engagement", fmt: "int",     defaultOn: true  },
  { id: "ctr",             label: "CTR",         group: "Engagement", fmt: "pct",     defaultOn: true  },
  { id: "cpc",             label: "CPC",         group: "Engagement", fmt: "money",   defaultOn: true  },
  { id: "spend",           label: "Spend",       group: "Engagement", fmt: "money",   defaultOn: true  },
  { id: "conversions",     label: "Conversions", group: "Conversion", fmt: "int",     defaultOn: false },
  { id: "conversionValue", label: "Revenue",     group: "Conversion", fmt: "money",   defaultOn: false },
  { id: "roas",            label: "ROAS",        group: "Conversion", fmt: "x",       defaultOn: false },
  { id: "cpa",             label: "CPA",         group: "Conversion", fmt: "money",   defaultOn: false },
  { id: "cvr",             label: "CVR",         group: "Conversion", fmt: "pct",     defaultOn: false },
  { id: "aov",             label: "AOV",         group: "Conversion", fmt: "money",   defaultOn: false },
];
const GEO_DEFAULT_COLS = GEO_ALL_COLS.filter(c => c.defaultOn).map(c => c.id);

function GeoColPicker({ cols, setCols }: { cols: string[]; setCols: (c: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };
  return (
    <ColumnPickerButton
      cols={cols}
      allDefs={FETCHABLE_KPIS}
      defaultIds={GEO_DEFAULT_COLS}
      pickerOpen={open}
      setPickerOpen={setOpen}
      pickerRef={ref}
      toggleCol={toggleCol}
      resetCols={(ids) => setCols([...ids])}
    />
  );
}

function GeoExplorer({
  countryRows, regionRows, cityRows, zipRows, loadingCountry, loadingRegion, loadingCity, loadingZip, currency,
  providerLabel = "Meta",
}: {
  countryRows: BreakdownRow[];
  regionRows: BreakdownRow[];
  cityRows: BreakdownRow[];
  zipRows?: BreakdownRow[];
  loadingCountry: boolean;
  loadingRegion: boolean;
  loadingCity: boolean;
  loadingZip?: boolean;
  currency: string;
  providerLabel?: string;
}) {
  const [level, setLevel] = useState<GeoLevel>("country");
  const [levelOpen, setLevelOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cols, setCols] = usePersistentColumns("geo", GEO_DEFAULT_COLS);

  // Postal Code is only offered when the caller supplies zip rows (DV360).
  const hasZip = zipRows !== undefined;
  const levels: GeoLevel[] = hasZip ? ["country", "region", "zip"] : ["country", "region"];

  const rows = level === "country" ? countryRows : level === "zip" ? (zipRows ?? []) : regionRows;
  const loading = level === "country" ? loadingCountry : level === "zip" ? !!loadingZip : loadingRegion;

  const enriched = useMemo(() => rows.map(r => ({
    ...r,
    reach: r.reach ?? 0,
    frequency: r.frequency ?? (r.reach && r.reach > 0 ? r.impressions / r.reach : 0),
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
    cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
  })), [rows]);

  const { sorted, sort: geoSort, toggle: geoToggle } = useSort(enriched, "spend", "desc");

  const top10 = useMemo(() => [...enriched].sort((a, b) => b.spend - a.spend).slice(0, 10), [enriched]);

  const downloadCsv = () => {
    const header = "Country,Impressions,Clicks,CTR,CPM,CPC,Spend\n";
    const body = enriched.map(r =>
      `"${r.label}",${r.impressions},${r.clicks},${r.ctr.toFixed(2)}%,${r.cpm.toFixed(2)},${r.cpc.toFixed(2)},${r.spend.toFixed(2)}`
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "geo-breakdown.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-500" />
          <span className="font-semibold text-sm text-gray-800">Geo Explorer</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setLevelOpen(v => !v)} className={btnCls}>
              {GEO_LEVEL_LABELS[level]} <ChevronDown className="w-3 h-3" />
            </button>
            {levelOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLevelOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-hidden py-1">
                  {levels.map(l => (
                    <button key={l} onClick={() => { setLevel(l); setLevelOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${level === l ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {level === l && <Check className="w-3 h-3" />}{GEO_LEVEL_LABELS[l]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <GeoColPicker cols={cols} setCols={setCols} />
          <button onClick={downloadCsv} className={btnCls}>
            <Download className="w-3.5 h-3.5" /> Download
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading geo data…</div>
        ) : enriched.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">No geo data.</div>
        ) : (
          <div className="flex items-start gap-6">
            {/* Left: bar chart */}
            <div className="w-60 shrink-0">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">
                Top {level === "country" ? "countries" : level === "zip" ? "postal codes" : "regions"} by spend
              </p>
              <div className="space-y-1.5">
                {top10.map(r => {
                  const maxSpend = top10[0]?.spend || 1;
                  const barPct = (r.spend / maxSpend) * 100;
                  return (
                    <div key={r.label} className="flex items-center gap-2">
                      <div className="w-24 text-xs text-gray-600 truncate shrink-0" title={r.label}>{r.label}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                      <div className="w-18 text-xs text-gray-600 text-right tabular-nums shrink-0">{formatMoney(r.spend, currency, 0)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: sortable table */}
            <div className="flex-1 min-w-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                  <tr className="border-b border-gray-100">
                    <SortTh col="label" sort={geoSort} onToggle={geoToggle} className="py-2 text-[11px] uppercase font-semibold text-gray-500">Geo</SortTh>
                    {cols.map(id => {
                      const def = GEO_ALL_COLS.find(c => c.id === id) ?? ALL_STANDARD_KPIS.find(c => c.id === id);
                      return <SortTh key={id} col={id} sort={geoSort} onToggle={geoToggle} className="py-2 px-2 text-[11px] uppercase font-semibold text-gray-500 whitespace-nowrap" align="right">{def?.label ?? id}</SortTh>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => {
                    const isOpen = expanded.has(r.label);
                    const expandable = level !== "zip";
                    return (
                      <>
                        <tr key={r.label} className={`border-b border-gray-50 hover:bg-gray-50 ${expandable ? "cursor-pointer" : ""}`}
                          onClick={expandable ? () => setExpanded(prev => { const n = new Set(prev); n.has(r.label) ? n.delete(r.label) : n.add(r.label); return n; }) : undefined}>
                          <td className="py-2.5 text-gray-800 font-medium text-xs">
                            <div className="flex items-center gap-1">
                              {expandable
                                ? (isOpen ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-300" />)
                                : <span className="w-3 h-3 inline-block" />}
                              {r.label}
                            </div>
                          </td>
                          {cols.map(id => {
                            const def = GEO_ALL_COLS.find(c => c.id === id);
                            let cell = "—";
                            if (def) {
                              const v = (r as unknown as Record<string, number>)[id] ?? 0;
                              if (Number.isFinite(v) && v !== 0) {
                                if (def.fmt === "money")   cell = formatMoney(v, currency, 0);
                                else if (def.fmt === "pct") cell = pct(v);
                                else if (def.fmt === "x")   cell = `${v.toFixed(2)}×`;
                                else if (def.fmt === "decimal") cell = v.toFixed(2);
                                else                        cell = compact(v);
                              } else if (v === 0) cell = "0";
                            } else {
                              cell = formatStandardKpi(r, id, currency);
                            }
                            return <td key={id} className="py-2.5 px-2 text-right text-xs text-gray-600 tabular-nums">{cell}</td>;
                          })}
                        </tr>
                        {isOpen && level === "country" && (
                          <tr key={`${r.label}-exp`} className="border-b border-gray-50">
                            <td colSpan={cols.length + 1} className="py-2 px-6 text-[11px] text-gray-400 italic bg-gray-50">
                              Switch to Region view for state/city breakdown.
                            </td>
                          </tr>
                        )}
                        {isOpen && level === "region" && (() => {
                          const childCities = cityRows
                            .filter(cr => (cr.breakdownValues.region ?? "").toLowerCase() === r.label.toLowerCase())
                            .map(cr => ({
                              ...cr,
                              cityLabel: cr.breakdownValues.city || cr.label.split("·").pop()?.trim() || cr.label,
                              reach: cr.reach ?? 0,
                              frequency: cr.frequency ?? (cr.reach && cr.reach > 0 ? cr.impressions / cr.reach : 0),
                              ctr:  cr.impressions > 0 ? (cr.clicks / cr.impressions) * 100 : 0,
                              cpm:  cr.impressions > 0 ? (cr.spend / cr.impressions) * 1000 : 0,
                              cpc:  cr.clicks > 0 ? cr.spend / cr.clicks : 0,
                              cpa:  cr.conversions > 0 ? cr.spend / cr.conversions : 0,
                              roas: cr.spend > 0 ? cr.conversionValue / cr.spend : 0,
                              cvr:  cr.clicks > 0 ? (cr.conversions / cr.clicks) * 100 : 0,
                              aov:  cr.conversions > 0 ? cr.conversionValue / cr.conversions : 0,
                            }))
                            .sort((a, b) => b.spend - a.spend);
                          if (loadingCity) {
                            return (
                              <tr key={`${r.label}-loading`} className="border-b border-gray-50 bg-gray-50">
                                <td colSpan={cols.length + 1} className="py-2 px-12 text-[11px] text-gray-400 italic">Loading cities…</td>
                              </tr>
                            );
                          }
                          if (childCities.length === 0) {
                            return (
                              <tr key={`${r.label}-empty`} className="border-b border-gray-50 bg-gray-50">
                                <td colSpan={cols.length + 1} className="py-2 px-12 text-[11px] text-gray-400 italic">No city-level data reported by {providerLabel} for {r.label} in this window.</td>
                              </tr>
                            );
                          }
                          return childCities.map(city => (
                            <tr key={`${r.label}-${city.cityLabel}`} className="border-b border-gray-50 bg-gray-50/70 hover:bg-gray-100">
                              <td className="py-1.5 pl-10 text-gray-600 text-xs">
                                <span className="text-[10px] text-gray-400 mr-2">↳</span>{city.cityLabel}
                              </td>
                              {cols.map(id => {
                                const def = GEO_ALL_COLS.find(c => c.id === id);
                                let cell = "—";
                                if (def) {
                                  const v = (city as unknown as Record<string, number>)[id] ?? 0;
                                  if (Number.isFinite(v) && v !== 0) {
                                    if (def.fmt === "money")   cell = formatMoney(v, currency, 0);
                                    else if (def.fmt === "pct") cell = pct(v);
                                    else if (def.fmt === "x")   cell = `${v.toFixed(2)}×`;
                                    else if (def.fmt === "decimal") cell = v.toFixed(2);
                                    else                        cell = compact(v);
                                  } else if (v === 0) cell = "0";
                                } else {
                                  cell = formatStandardKpi(city, id, currency);
                                }
                                return <td key={id} className="py-1.5 px-2 text-right text-[11px] text-gray-600 tabular-nums">{cell}</td>;
                              })}
                            </tr>
                          ));
                        })()}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Age Profile (March of Progress) ─────────────────────────────────────────

type ChartMetric =
  | "impressions" | "reach" | "frequency" | "cpm"
  | "clicks" | "ctr" | "cpc" | "spend"
  | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov";
const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  impressions: "Impressions", reach: "Reach", frequency: "Frequency", cpm: "CPM",
  clicks: "Clicks", ctr: "CTR", cpc: "CPC", spend: "Spend",
  conversions: "Conversions", conversionValue: "Revenue", roas: "ROAS", cpa: "CPA", cvr: "CVR", aov: "AOV",
};

function formatChartMetric(v: number, m: ChartMetric, currency: string): string {
  if (!Number.isFinite(v) || v === 0) return v === 0 ? (m === "ctr" || m === "cvr" ? "0%" : m === "roas" ? "0.00×" : "0") : "—";
  if (m === "spend" || m === "conversionValue" || m === "cpm" || m === "cpc" || m === "cpa" || m === "aov") return formatMoney(v, currency, 0);
  if (m === "ctr" || m === "cvr") return `${v.toFixed(2)}%`;
  if (m === "roas") return `${v.toFixed(2)}×`;
  if (m === "frequency") return v.toFixed(2);
  return compact(v);
}

function chartMetricValue(r: BreakdownRow | undefined, m: ChartMetric): number {
  if (!r) return 0;
  const imps = r.impressions || 0;
  const clicks = r.clicks || 0;
  const spend = r.spend || 0;
  const conversions = r.conversions || 0;
  const conversionValue = r.conversionValue || 0;
  const reach = r.reach ?? 0;
  switch (m) {
    case "impressions":     return imps;
    case "reach":           return reach;
    case "frequency":       return reach > 0 ? imps / reach : 0;
    case "cpm":             return imps > 0 ? (spend / imps) * 1000 : 0;
    case "clicks":          return clicks;
    case "ctr":             return imps > 0 ? (clicks / imps) * 100 : 0;
    case "cpc":             return clicks > 0 ? spend / clicks : 0;
    case "spend":           return spend;
    case "conversions":     return conversions;
    case "conversionValue": return conversionValue;
    case "roas":            return spend > 0 ? conversionValue / spend : 0;
    case "cpa":             return conversions > 0 ? spend / conversions : 0;
    case "cvr":             return clicks > 0 ? (conversions / clicks) * 100 : 0;
    case "aov":             return conversions > 0 ? conversionValue / conversions : 0;
  }
}

function AgeProfile({ rows, loading, currency }: { rows: BreakdownRow[]; loading: boolean; currency: string }) {
  const [metric, setMetric] = usePersistentValue<ChartMetric>("audience-age-metric", "impressions");
  const [metricOpen, setMetricOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const valueOf = (r: BreakdownRow): number => chartMetricValue(r, metric);

  const total = useMemo(() => rows.reduce((s, r) => s + valueOf(r), 0), [rows, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => {
    if (rows.length === 0 || total === 0) return [];
    const maxV = Math.max(...rows.map(r => valueOf(r)));
    const MAX_H = 220, MIN_H = 90;
    return rows.map((r, i) => {
      const v = valueOf(r);
      const ratio = maxV > 0 ? Math.sqrt(v / maxV) : 0;
      const height = MIN_H + (MAX_H - MIN_H) * ratio;
      return { row: r, value: v, height, share: total > 0 ? v / total : 0, hominid: HOMINIDS[Math.min(i, HOMINIDS.length - 1)] };
    });
  }, [rows, total, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const topIdx = columns.length > 0 ? columns.reduce((best, c, i) => (c.value > columns[best].value ? i : best), 0) : 0;
  const activeIdx = hoverIdx ?? selectedIdx;
  const topBucket = columns[topIdx];
  const headline = topBucket
    ? `${topBucket.row.label} dominates with ${pct(topBucket.share * 100)} of ${CHART_METRIC_LABELS[metric].toLowerCase()}.`
    : "No age data.";

  void currency;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Age Profile</p>
            <h3 className="text-gray-900 font-bold text-base mt-0.5">{loading ? "Loading…" : headline}</h3>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setMetricOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> {CHART_METRIC_LABELS[metric]}
            </button>
            {metricOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMetricOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-y-auto max-h-64 py-1">
                  {(Object.keys(CHART_METRIC_LABELS) as ChartMetric[]).map(m => (
                    <button key={m} onClick={() => { setMetric(m); setMetricOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${m === metric ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === metric && <Check className="w-3 h-3" />}{CHART_METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 italic mb-4">
          March of Progress — figure height encodes share of {CHART_METRIC_LABELS[metric].toLowerCase()}; ape (left) → modern human (right).
          <span className="ml-2 not-italic text-gray-500">
            {activeIdx !== null && columns[activeIdx]
              ? `${columns[activeIdx].row.label}: ${formatChartMetric(columns[activeIdx].value, metric, currency)} ${CHART_METRIC_LABELS[metric].toLowerCase()} · ${pct(columns[activeIdx].share * 100)}`
              : "Hover or tap any figure to inspect."}
          </span>
        </p>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : columns.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">No age breakdown data.</div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-1 px-2 border-b-2 border-gray-200 overflow-x-auto" style={{ minHeight: 232 }}>
              {columns.map((col, i) => {
                const isLeader = i === topIdx;
                const isActive = i === activeIdx;
                const dimmed = activeIdx !== null && !isActive;
                const w = col.height * (100 / 220);
                return (
                  <button
                    key={col.row.label}
                    type="button"
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(cur => cur === i ? null : cur)}
                    onClick={() => setSelectedIdx(prev => prev === i ? null : i)}
                    className={`shrink-0 transition-opacity cursor-pointer ${dimmed ? "opacity-25" : "opacity-100"}`}
                    style={{ width: w + 6 }}
                  >
                    <svg
                      width={w} height={col.height} viewBox="0 0 100 220"
                      preserveAspectRatio="xMidYMax meet"
                      className={`block mx-auto transition-all ${isLeader || isActive ? "fill-blue-500" : "fill-blue-200"}`}
                    >
                      {col.hominid.render()}
                    </svg>
                  </button>
                );
              })}
            </div>
            <div className="flex items-start justify-between gap-1 px-2 mt-3">
              {columns.map((col, i) => {
                const isLeader = i === topIdx;
                const isActive = i === activeIdx;
                const w = col.height * (100 / 220) + 6;
                return (
                  <div key={col.row.label} className="text-center shrink-0" style={{ width: w }}>
                    <div className={`text-[12px] font-semibold ${isLeader || isActive ? "text-gray-900" : "text-gray-400"}`}>{col.row.label}</div>
                    <div className={`text-[11px] tabular-nums ${isLeader || isActive ? "text-gray-700" : "text-gray-300"}`}>{compact(col.value)}</div>
                    <div className={`text-[10px] tabular-nums ${isLeader || isActive ? "text-gray-500" : "text-gray-300"}`}>{pct(col.share * 100)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Gender Split ─────────────────────────────────────────────────────────────

function GenderSplit({ rows, loading }: { rows: BreakdownRow[]; loading: boolean }) {
  const [metric, setMetric] = usePersistentValue<ChartMetric>("audience-gender-metric", "impressions");
  const [metricOpen, setMetricOpen] = useState(false);

  const valueOf = (r: BreakdownRow | undefined): number => chartMetricValue(r, metric);

  const female = rows.find(r => /^f/i.test(r.label));
  const male   = rows.find(r => /^m/i.test(r.label));
  const unk    = rows.find(r => /^u/i.test(r.label));

  const total = valueOf(female) + valueOf(male) + valueOf(unk);
  const leadIsFemale = valueOf(female) >= valueOf(male);
  const topGender = leadIsFemale ? "Female" : "Male";
  const topShare = total > 0 ? Math.max(valueOf(female), valueOf(male)) / total * 100 : 0;

  const MAX_H = 160, MIN_H = 60;
  const maxV = Math.max(valueOf(female), valueOf(male), valueOf(unk), 1);
  const hOf = (r: BreakdownRow | undefined) => MIN_H + (MAX_H - MIN_H) * (valueOf(r) / maxV);
  const pctOf = (r: BreakdownRow | undefined) => total > 0 ? (valueOf(r) / total) * 100 : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Gender Split</p>
            <h3 className="text-gray-900 font-bold text-base mt-0.5">
              {loading ? "Loading…" : total === 0 ? "No gender data." : `${topGender} audience leads with ${pct(topShare)} share.`}
            </h3>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setMetricOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> {CHART_METRIC_LABELS[metric]}
            </button>
            {metricOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMetricOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-y-auto max-h-64 py-1">
                  {(Object.keys(CHART_METRIC_LABELS) as ChartMetric[]).map(m => (
                    <button key={m} onClick={() => { setMetric(m); setMetricOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${m === metric ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === metric && <Check className="w-3 h-3" />}{CHART_METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : total === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-gray-400">No gender breakdown data.</div>
        ) : (
          <div className="flex items-end justify-center gap-12 pt-4" style={{ minHeight: MAX_H + 64 }}>
            <div className="flex flex-col items-center gap-1">
              <div className="text-[12px] text-gray-500 tabular-nums font-semibold">{pct(pctOf(female))}</div>
              <FemaleSVG h={hOf(female)} highlight={leadIsFemale} />
              <div className={`text-[13px] font-semibold mt-1 ${leadIsFemale ? "text-gray-900" : "text-gray-400"}`}>Female</div>
              <div className="text-[11px] text-gray-500">{compact(valueOf(female))}</div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="text-[12px] text-gray-500 tabular-nums font-semibold">{pct(pctOf(male))}</div>
              <MaleSVG h={hOf(male)} highlight={!leadIsFemale} />
              <div className={`text-[13px] font-semibold mt-1 ${!leadIsFemale ? "text-gray-900" : "text-gray-400"}`}>Male</div>
              <div className="text-[11px] text-gray-500">{compact(valueOf(male))}</div>
            </div>
            {unk && valueOf(unk) > 0 && (
              <div className="flex flex-col items-center gap-1">
                <div className="text-[12px] text-gray-500 tabular-nums font-semibold">{pct(pctOf(unk))}</div>
                <UnknownSVG h={hOf(unk) * 0.7} />
                <div className="text-[13px] text-gray-400 font-semibold mt-1">Unknown</div>
                <div className="text-[11px] text-gray-400">{compact(valueOf(unk))}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Device Breakdown ────────────────────────────────────────────────────────

function DeviceBreakdown({ rows, loading }: { rows: BreakdownRow[]; loading?: boolean }) {
  const [metric, setMetric] = usePersistentValue<ChartMetric>("audience-device-metric", "impressions");
  const [metricOpen, setMetricOpen] = useState(false);

  const valueOf = (r: BreakdownRow): number => chartMetricValue(r, metric);
  const sorted = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, r) => s + valueOf(r), 0);
  const topRow = sorted[0];

  const DEVICE_COLORS: Record<string, string> = {
    desktop: "bg-blue-500", mobile: "bg-indigo-500", tablet: "bg-violet-500",
    "connected tv": "bg-emerald-500", smarttv: "bg-teal-500", "smart tv": "bg-teal-500",
  };
  const colorFor = (label: string) => DEVICE_COLORS[label.toLowerCase()] ?? "bg-gray-400";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Device Breakdown</p>
            <h3 className="text-gray-900 font-bold text-base mt-0.5">
              {loading ? "Loading…" : total === 0 ? "No device data." : topRow ? `${topRow.label} leads with ${pct(total > 0 ? valueOf(topRow) / total * 100 : 0)} of ${CHART_METRIC_LABELS[metric].toLowerCase()}.` : ""}
            </h3>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setMetricOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> {CHART_METRIC_LABELS[metric]}
            </button>
            {metricOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMetricOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-y-auto max-h-64 py-1">
                  {(Object.keys(CHART_METRIC_LABELS) as ChartMetric[]).map(m => (
                    <button key={m} onClick={() => { setMetric(m); setMetricOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${m === metric ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === metric && <Check className="w-3 h-3" />}{CHART_METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-24 flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : total === 0 ? (
          <div className="h-24 flex items-center justify-center text-xs text-gray-400">No device breakdown data.</div>
        ) : (
          <div className="space-y-2.5 pt-1">
            {sorted.map((r) => {
              const share = total > 0 ? valueOf(r) / total : 0;
              return (
                <div key={r.label} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs font-medium text-gray-700 truncate">{r.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full ${colorFor(r.label)}`} style={{ width: `${share * 100}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs text-gray-500 tabular-nums shrink-0">{pct(share * 100)}</div>
                  <div className="w-20 text-right text-xs text-gray-400 tabular-nums shrink-0">{compact(valueOf(r))}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Custom Cohort Heatmap ────────────────────────────────────────────────────

type CohortDim = "age" | "gender" | "country" | "impression_device" | "platform_position";
const DIM_LABELS: Record<CohortDim, string> = {
  age: "Age", gender: "Gender", country: "Country",
  impression_device: "Device", platform_position: "Placement",
};

function HeatmapCell({ value, max, label }: { value: number; max: number; label: string }) {
  const [hover, setHover] = useState(false);
  const ratio = max > 0 ? value / max : 0;
  // Blue-tinted: light blue → deep blue
  const r = Math.round(219 - ratio * 160); // 219 → 59
  const g = Math.round(234 - ratio * 104); // 234 → 130
  const b = Math.round(254 - ratio * 7);   // 254 → 246  (stays blue-ish)
  const textColor = ratio > 0.55 ? "text-white" : "text-blue-900";
  return (
    <div
      className={`relative rounded-lg flex items-center justify-center text-xs font-semibold cursor-default transition-all ${textColor}`}
      style={{ background: `rgb(${r},${g},${b})`, minHeight: 48, minWidth: 76 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {compact(value)}
      {hover && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-50 shadow-lg">
          {label}: {compact(value)}
        </div>
      )}
    </div>
  );
}

function CustomCohorts({
  ageRows, genderRows, countryRows, deviceRows,
}: {
  ageRows: BreakdownRow[];
  genderRows: BreakdownRow[];
  countryRows: BreakdownRow[];
  deviceRows: BreakdownRow[];
}) {
  const [xDim, setXDim] = usePersistentValue<CohortDim>("audience-cohort-xdim", "impression_device");
  const [yDim, setYDim] = usePersistentValue<CohortDim>("audience-cohort-ydim", "age");
  const [metricKey, setMetricKey] = usePersistentValue<ChartMetric>("audience-cohort-metric", "impressions");
  const [xOpen, setXOpen] = useState(false);
  const [yOpen, setYOpen] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);

  const dimRows: Record<CohortDim, BreakdownRow[]> = {
    age: ageRows, gender: genderRows, country: countryRows.slice(0, 8),
    impression_device: deviceRows, platform_position: [],
  };

  const valueOf = (r: BreakdownRow): number =>
    metricKey === "impressions" ? r.impressions : metricKey === "clicks" ? r.clicks : metricKey === "spend" ? r.spend : r.conversions;

  const { xs, ys, cells, maxCell } = useMemo(() => {
    const xData = dimRows[xDim].filter(r => r.label && r.label !== "unknown").slice(0, 8);
    const yData = dimRows[yDim].filter(r => r.label && r.label !== "unknown").slice(0, 8);
    const xTotal = xData.reduce((s, r) => s + valueOf(r), 0) || 1;
    const yTotal = yData.reduce((s, r) => s + valueOf(r), 0) || 1;
    const base = Math.min(xTotal, yTotal);
    const grid: { x: string; y: string; value: number }[] = [];
    let maxCell = 0;
    for (const xr of xData) {
      for (const yr of yData) {
        const v = Math.round(base * (valueOf(xr) / xTotal) * (valueOf(yr) / yTotal));
        grid.push({ x: xr.label, y: yr.label, value: v });
        if (v > maxCell) maxCell = v;
      }
    }
    return { xs: xData.map(r => r.label), ys: yData.map(r => r.label), cells: grid, maxCell };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xDim, yDim, ageRows, genderRows, countryRows, deviceRows, metricKey]);

  const sameAxis = xDim === yDim;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Custom Cohorts</p>
            <h3 className="text-gray-900 font-bold text-base mt-0.5">Cross-tab any two dimensions — Device × Age, Country × Gender.</h3>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setMetricOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> {CHART_METRIC_LABELS[metricKey]}
            </button>
            {metricOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMetricOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-hidden py-1">
                  {(Object.keys(CHART_METRIC_LABELS) as ChartMetric[]).map(m => (
                    <button key={m} onClick={() => { setMetricKey(m); setMetricOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${m === metricKey ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                      {m === metricKey && <Check className="w-3 h-3" />}{CHART_METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Axis pickers */}
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold">X axis:</span>
            <div className="relative">
              <button onClick={() => setXOpen(v => !v)} className={btnCls}>
                {DIM_LABELS[xDim]} <ChevronDown className="w-3 h-3" />
              </button>
              {xOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setXOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-hidden py-1">
                    {(Object.keys(DIM_LABELS) as CohortDim[]).map(d => (
                      <button key={d} onClick={() => { setXDim(d); setXOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${d === xDim ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                        {d === xDim && <Check className="w-3 h-3" />}{DIM_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold">Y axis:</span>
            <div className="relative">
              <button onClick={() => setYOpen(v => !v)} className={btnCls}>
                {DIM_LABELS[yDim]} <ChevronDown className="w-3 h-3" />
              </button>
              {yOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setYOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 overflow-hidden py-1">
                    {(Object.keys(DIM_LABELS) as CohortDim[]).map(d => (
                      <button key={d} onClick={() => { setYDim(d); setYOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${d === yDim ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                        {d === yDim && <Check className="w-3 h-3" />}{DIM_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          {sameAxis && <span className="text-xs text-amber-600 font-medium">Pick different dimensions for X and Y.</span>}
        </div>

        {xs.length === 0 || ys.length === 0 || sameAxis ? (
          <div className="py-8 text-center text-xs text-gray-400">
            {sameAxis ? "Pick different dimensions for X and Y axes." : "No data for selected dimensions."}
          </div>
        ) : (
          <div>
            <table className="w-full text-xs border-separate" style={{ borderSpacing: "3px" }}>
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="pb-1 pr-2 text-left text-[10px] text-gray-500 font-bold uppercase whitespace-nowrap">
                    {DIM_LABELS[yDim]} ↓ / {DIM_LABELS[xDim]} →
                  </th>
                  {xs.map(x => (
                    <th key={x} className="pb-1 px-1 text-center text-[10px] text-gray-500 font-semibold whitespace-nowrap">{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ys.map(y => (
                  <tr key={y}>
                    <td className="py-1 pr-2 text-[11px] text-gray-700 font-semibold whitespace-nowrap">{y}</td>
                    {xs.map(x => {
                      const cell = cells.find(c => c.x === x && c.y === y);
                      return (
                        <td key={x} className="py-0.5 px-0.5">
                          <HeatmapCell value={cell?.value ?? 0} max={maxCell} label={`${y} × ${x}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cohort Detailing ─────────────────────────────────────────────────────────

// AudienceType is now the marketing-meaning AudienceClass from the shared classifier,
// so badges and grouping align with the rest of the app.
type AudienceType = AudienceClass;
const AT_COLORS: Record<AudienceClass, string> = AUDIENCE_COLORS;

type CohortCol = "impressions" | "clicks" | "ctr" | "convRate" | "cpm" | "spend";
interface CohortRow {
  segment: AudienceType;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  convRate: number;
  cpm: number;
}

const COHORT_COLS: { id: CohortCol; label: string }[] = [
  { id: "impressions", label: "Impressions" },
  { id: "clicks",      label: "Clicks" },
  { id: "ctr",         label: "CTR" },
  { id: "convRate",    label: "Conv. Rate" },
  { id: "cpm",         label: "CPM" },
  { id: "spend",       label: "Spend" },
];
const COHORT_DEFAULT_COLS: CohortCol[] = ["impressions", "ctr", "convRate", "spend"];

function CohortDetail({ rows, currency }: { rows: CohortRow[]; currency: string }) {
  const [columns, setColumns] = usePersistentColumns<CohortCol>("audience-cohort-cols", COHORT_DEFAULT_COLS);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const swapRef = useRef<HTMLDivElement>(null);
  const { sorted, sort: cohortSort, toggle: cohortToggle } = useSort(rows, "impressions", "desc");

  useEffect(() => {
    if (swapIdx === null) return;
    const h = (e: MouseEvent) => {
      if (swapRef.current && !swapRef.current.contains(e.target as Node)) setSwapIdx(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const fmtCell = (v: number, col: CohortCol) => {
    if (col === "ctr" || col === "convRate") return pct(v);
    if (col === "spend" || col === "cpm") return formatMoney(v, currency, 0);
    return compact(v);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4" ref={swapRef}>
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Cohort Detailing</p>
            <h3 className="text-gray-900 font-bold text-base mt-0.5">Per-segment performance — sort by any column to surface the most efficient audience.</h3>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setColMenuOpen(v => !v)} className={btnCls}>
              <LayersIcon className="w-3.5 h-3.5 text-blue-500" /> Columns
              <span className="ml-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">{columns.length}</span>
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-48 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-600">Columns</span>
                    <button onClick={() => setColumns(COHORT_DEFAULT_COLS)} className="text-[10px] text-blue-500 hover:text-blue-700 font-medium">Reset</button>
                  </div>
                  {COHORT_COLS.map(col => {
                    const on = columns.includes(col.id);
                    return (
                      <button key={col.id} onClick={() => {
                        const next = on ? columns.filter(c => c !== col.id) : [...columns, col.id];
                        if (next.length > 0) setColumns(next);
                      }} className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-300"}`}>
                          {on && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr className="border-b border-gray-100">
                <SortTh col="segment" sort={cohortSort} onToggle={cohortToggle} className="pb-2 text-[11px] uppercase font-semibold text-gray-500">Segment</SortTh>
                {columns.map((c, colIdx) => {
                  const def = COHORT_COLS.find(d => d.id === c)!;
                  return (
                    <th key={c} className="pb-2 px-2 text-right text-[11px] font-semibold text-gray-500 uppercase whitespace-nowrap">
                      <div className="relative inline-flex items-center gap-1 justify-end">
                        <SortTh col={c} sort={cohortSort} onToggle={cohortToggle} className="text-[11px] uppercase font-semibold text-gray-500" align="right">{def.label}</SortTh>
                        <button onClick={() => setSwapIdx(swapIdx === colIdx ? null : colIdx)}
                          className="text-gray-300 hover:text-gray-500 transition shrink-0 ml-0.5" title="Change column">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3 3 3-3"/></svg>
                        </button>
                        {swapIdx === colIdx && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white text-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-200">
                            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500">Change column</div>
                            <div className="py-1">
                              {COHORT_COLS.map(col => {
                                const isCur = col.id === c;
                                return (
                                  <button key={col.id} onClick={() => {
                                    if (!isCur) setColumns(prev => prev.map((cc, i) => i === colIdx ? col.id : cc));
                                    setSwapIdx(null);
                                  }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${isCur ? "text-blue-600 font-semibold bg-blue-50 cursor-default" : "text-gray-700 hover:bg-gray-50"}`}>
                                    {isCur && <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                                    {col.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="py-8 text-center text-xs text-gray-400">No cohort data.</td></tr>
              ) : sorted.map(r => (
                <tr key={r.segment} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${AT_COLORS[r.segment]}`}>{r.segment}</span>
                  </td>
                  {columns.map(c => (
                    <td key={c} className="py-2.5 px-2 text-right text-xs text-gray-700 tabular-nums">{fmtCell(r[c], c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AudienceAnalysisReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  const showMeta = platform !== "dv360";
  const showDv   = platform === "dv360" || platform === "both";

  // ── Meta breakdowns ──────────────────────────────────────────────────────
  const { rows: metaAge,     loading: metaAgeL     } = useMetaBreakdown("age",               dateRange, customStart, customEnd, showMeta);
  const { rows: metaGender,  loading: metaGenL     } = useMetaBreakdown("gender",            dateRange, customStart, customEnd, showMeta);
  const { rows: metaCountry, loading: metaCountryL } = useMetaBreakdown("country",           dateRange, customStart, customEnd, showMeta);
  const { rows: regionRows,  loading: regionLoading } = useMetaBreakdown("region",           dateRange, customStart, customEnd, showMeta);
  const { rows: cityRows,    loading: cityLoading   } = useMetaBreakdown("region,city",      dateRange, customStart, customEnd, showMeta);
  const { rows: metaDevice                          } = useMetaBreakdown("impression_device", dateRange, customStart, customEnd, showMeta);

  // ── DV360 breakdowns ─────────────────────────────────────────────────────
  // Age & gender come from YouTube Analytics API (BM v2 removed YOUTUBE_AUDIENCE
  // report type). Country/device come from BM v2 STANDARD reports as before.
  // Age/gender — PRIMARY source is DV360 Bid Manager's native FILTER_AGE/
  // FILTER_GENDER (real ad-campaign demographics). If BM reports these as
  // unsupported for this advertiser, fall back to the YouTube Analytics API
  // (only meaningful when the account owns a YouTube channel).
  const { rows: dvAgeBm,    loading: dvAgeBmL,    unsupported: dvAgeBmUnsup,    pending: dvAgeBmPending    } = useDV360Breakdown("age",    dateRange, customStart, customEnd, showDv);
  const { rows: dvGenderBm, loading: dvGenderBmL, unsupported: dvGenderBmUnsup, pending: dvGenderBmPending } = useDV360Breakdown("gender", dateRange, customStart, customEnd, showDv);
  // BM demographics are "unsupported" only when BOTH age and gender say so.
  const bmDemoUnsupported = dvAgeBmUnsup && dvGenderBmUnsup;
  const bmDemoHasData = dvAgeBm.length > 0 || dvGenderBm.length > 0;

  // YouTube Analytics fallback — only fetch when BM demographics are unsupported.
  const ytFallbackEnabled = showDv && bmDemoUnsupported && !bmDemoHasData;
  const { rows: dvAgeYt,    loading: dvAgeYtL,    missingScope: dvAgeMissingScope,    apiDisabled: dvAgeApiDisabled,    noChannel: dvAgeNoChannel    } = useYouTubeAnalyticsBreakdown("age",    dateRange, customStart, customEnd, ytFallbackEnabled);
  const { rows: dvGenderYt, loading: dvGenderYtL, missingScope: dvGenderMissingScope, apiDisabled: dvGenderApiDisabled, noChannel: dvGenderNoChannel } = useYouTubeAnalyticsBreakdown("gender", dateRange, customStart, customEnd, ytFallbackEnabled);

  // Prefer BM rows; fall back to YouTube Analytics rows when BM is unsupported.
  const dvAge    = bmDemoHasData ? dvAgeBm    : dvAgeYt;
  const dvGender = bmDemoHasData ? dvGenderBm : dvGenderYt;
  const dvAgeL    = dvAgeBmL    || dvAgeBmPending    || (ytFallbackEnabled && dvAgeYtL);
  const dvGenderL = dvGenderBmL || dvGenderBmPending || (ytFallbackEnabled && dvGenderYtL);

  const { rows: dvCountry, error: dvCountryErr, loading: dvCountryL, pending: dvCountryPending } = useDV360Breakdown("country", dateRange, customStart, customEnd, showDv);
  // Geo drill-down for DV360 via Bid Manager STANDARD geo dimensions:
  // FILTER_REGION (region), FILTER_REGION×FILTER_CITY (city), FILTER_ZIP_POSTAL_CODE (postal).
  const { rows: dvRegion, loading: dvRegionL, pending: dvRegionPending } = useDV360Breakdown("region",      dateRange, customStart, customEnd, showDv);
  const { rows: dvCity,   loading: dvCityL,   pending: dvCityPending   } = useDV360Breakdown("region,city", dateRange, customStart, customEnd, showDv);
  const { rows: dvZip,    loading: dvZipL,    pending: dvZipPending    } = useDV360Breakdown("zip",         dateRange, customStart, customEnd, showDv);
  const { rows: dvDevice, loading: dvDeviceL, pending: dvDevicePending } = useDV360Breakdown("device",  dateRange, customStart, customEnd, showDv);
  // Country is a plain (non-demographic) BM breakdown — if IT fails, something
  // is wrong with auth/config and we surface a hard error.
  const dv360Error = showDv ? dvCountryErr : null;
  // apiDisabled means the YouTube Data/Analytics API isn't enabled in the Cloud
  // project — a one-time console fix, NOT a reconnect. Checked first.
  const dvDemoApiDisabled = !bmDemoHasData && (dvAgeApiDisabled || dvGenderApiDisabled);
  // missingScope means the refresh token lacks the YouTube scopes — reconnect prompt.
  const dvDemoMissingScope = !bmDemoHasData && !dvDemoApiDisabled && (dvAgeMissingScope || dvGenderMissingScope);
  // noChannel: connected account has no owned YouTube channel — can't auto-detect.
  const dvDemoNoChannel = !bmDemoHasData && !dvDemoApiDisabled && !dvDemoMissingScope && (dvAgeNoChannel || dvGenderNoChannel);
  // "no data": BM has no demographics AND the YouTube fallback also came up empty.
  const dvDemoUnsupported = !bmDemoHasData && !dvDemoApiDisabled && !dvDemoMissingScope && !dvDemoNoChannel && !dvAgeL && !dvGenderL && dvAge.length === 0 && dvGender.length === 0;

  // ── Meta-only cohort detailing ───────────────────────────────────────────
  const { adsets, audienceMap, currency } = useAdSetInsights(
    showMeta ? (platform === "both" ? "both" : "meta") : "meta",
    dateRange, customStart, customEnd
  );

  const cohortRows = useMemo((): CohortRow[] => {
    if (!showMeta) return [];
    const byType = new Map<AudienceType, { impr: number; clk: number; conv: number; spend: number }>();
    for (const a of adsets) {
      const t = classifyAdSet(a.targeting, audienceMap, a.campaignObjective, a.name).cls;
      const cur = byType.get(t) ?? { impr: 0, clk: 0, conv: 0, spend: 0 };
      cur.impr  += a.impressions; cur.clk += a.clicks;
      cur.conv  += a.conversions; cur.spend += a.spend;
      byType.set(t, cur);
    }
    return Array.from(byType.entries()).map(([segment, d]) => ({
      segment,
      impressions: d.impr, clicks: d.clk, spend: d.spend, conversions: d.conv,
      ctr:      d.impr > 0 ? (d.clk  / d.impr) * 100 : 0,
      convRate: d.clk  > 0 ? (d.conv / d.clk)  * 100 : 0,
      cpm:      d.impr > 0 ? (d.spend / d.impr) * 1000 : 0,
    }));
  }, [adsets, audienceMap, showMeta]);

  // ── Platform section header ──────────────────────────────────────────────
  const SectionHeader = ({ label, sub }: { label: string; sub: string }) => (
    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{label}</h2>
      <span className="text-xs text-gray-400 font-medium">{sub}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Audience Analysis</h1>
          <p className="text-gray-500 mt-1 text-sm">Who saw the campaign, where, and how they responded — geo, age, gender, custom cohorts.</p>
        </div>
        <AIExecutiveSummary
          tabName="Audience Analysis"
          context={{
            window: `${startDate} → ${endDate}`,
            ageBreakdown: [...metaAge, ...dvAge].map(r => ({ label: r.label, impressions: r.impressions, clicks: r.clicks, spend: Math.round(r.spend), conversions: r.conversions })),
            genderBreakdown: [...metaGender, ...dvGender].map(r => ({ label: r.label, impressions: r.impressions, spend: Math.round(r.spend), conversions: r.conversions })),
            countryBreakdown: [...metaCountry, ...dvCountry].sort((a, b) => b.spend - a.spend).slice(0, 15).map(r => ({ label: r.label, impressions: r.impressions, spend: Math.round(r.spend), conversions: r.conversions })),
            cohorts: cohortRows.length,
          }}
          platform={platform}
          inline
        />
      </div>

      {/* ── Meta section ── */}
      {showMeta && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="Meta" sub="Meta Ads" />}
          <GeoExplorer
            countryRows={metaCountry}
            regionRows={regionRows}
            cityRows={cityRows}
            loadingCountry={metaCountryL}
            loadingRegion={regionLoading}
            loadingCity={cityLoading}
            currency={currency}
          />
          <AgeProfile rows={metaAge} loading={metaAgeL} currency={currency} />
          <GenderSplit rows={metaGender} loading={metaGenL} />
          <DeviceBreakdown rows={metaDevice} />
          <CustomCohorts ageRows={metaAge} genderRows={metaGender} countryRows={metaCountry} deviceRows={metaDevice} />
          <CohortDetail rows={cohortRows} currency={currency} />
        </div>
      )}

      {/* ── DV360 section ── */}
      {showDv && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="DV360" sub="Display & Video 360" />}

          {dv360Error ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <span className="font-semibold">DV360 breakdowns unavailable:</span> {dv360Error}
            </div>
          ) : (
            <>
              <GeoExplorer
                countryRows={dvCountry}
                regionRows={dvRegion}
                cityRows={dvCity}
                zipRows={dvZip}
                loadingCountry={dvCountryL || dvCountryPending}
                loadingRegion={dvRegionL || dvRegionPending}
                loadingCity={dvCityL || dvCityPending}
                loadingZip={dvZipL || dvZipPending}
                currency={currency}
                providerLabel="DV360"
              />
              <DeviceBreakdown rows={dvDevice} loading={dvDeviceL || dvDevicePending} />
              {dvDemoApiDisabled ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 flex items-start gap-3">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium mb-1">Enable the YouTube APIs in your Google Cloud project</p>
                    <p className="text-xs text-amber-700 mb-2">
                      Age &amp; gender data comes from the YouTube Analytics API. Your OAuth permissions are correct, but the required APIs aren&apos;t turned on in the Cloud project yet. Enable both, then reload (changes take ~1–2 min to propagate):
                    </p>
                    <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside mb-2">
                      <li>
                        <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer" className="underline font-medium">YouTube Data API v3</a> — to identify the YouTube channel
                      </li>
                      <li>
                        <a href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank" rel="noreferrer" className="underline font-medium">YouTube Analytics API</a> — to read demographic reports
                      </li>
                    </ul>
                    <p className="text-xs text-amber-700">
                      Open each link in the same Google Cloud project your OAuth client belongs to, click <strong>Enable</strong>, then reload this page.
                    </p>
                  </div>
                </div>
              ) : dvDemoMissingScope ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 flex items-start gap-3">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium mb-1">Additional Google scopes required for YouTube demographics</p>
                    <p className="text-xs text-amber-700 mb-2">
                      Age &amp; gender data comes from the YouTube Analytics API. Your current DV360 token only has Bid Manager scopes — two more are needed:
                    </p>
                    <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside mb-2">
                      <li><code className="bg-amber-100 px-1 rounded">youtube.readonly</code> — to identify your YouTube channel</li>
                      <li><code className="bg-amber-100 px-1 rounded">yt-analytics.readonly</code> — to read demographic reports</li>
                    </ul>
                    <p className="text-xs text-amber-700">
                      Disconnect and reconnect your DV360 account — on the Google OAuth consent screen, grant both YouTube permissions in addition to the DV360 scopes.
                    </p>
                  </div>
                </div>
              ) : dvDemoNoChannel ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 flex items-start gap-3">
                  <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                  <div>
                    <p className="font-medium mb-1">Age &amp; gender can&apos;t be fetched for DV360</p>
                    <p className="text-xs text-gray-500">
                      DV360&apos;s Bid Manager API doesn&apos;t expose age/gender demographics for this advertiser&apos;s inventory, and the connected Google account doesn&apos;t own a YouTube channel to pull organic-viewer demographics from (YouTube&apos;s API only exposes analytics for channels the authenticated account owns).
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      To see age/gender, connect using the YouTube channel owner&apos;s Google account, or check demographics in the DV360 UI directly.
                    </p>
                  </div>
                </div>
              ) : dvDemoUnsupported ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                  <span>Age &amp; gender demographics are not available for this account. Bid Manager v2 does not support demographic reports for Connected TV inventory, and the connected Google account has no YouTube channel to pull organic viewer data from.</span>
                </div>
              ) : (
                <>
                  <div className="text-xs text-gray-400 font-medium -mb-2">YouTube channel — organic-viewer demographics (not DV360 ad audience)</div>
                  <AgeProfile rows={dvAge} loading={dvAgeL} currency={currency} />
                  <GenderSplit rows={dvGender} loading={dvGenderL} />
                  <CustomCohorts ageRows={dvAge} genderRows={dvGender} countryRows={dvCountry} deviceRows={dvDevice} />
                </>
              )}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Geo drill-down (region → city → postal code) comes from Bid Manager geo reports. Custom-audience cohort detailing remains a Meta-only feature.
              </div>
            </>
          )}
        </div>
      )}

      <TabSummaryFooter
        tabName="Audience Analysis"
        lines={(() => {
          const lines = [];
          if (showMeta) lines.push(`Meta — ${metaAge.length} age groups · ${metaCountry.length} countries · ${metaGender.length} gender segments.`);
          if (showDv && !dv360Error) lines.push(`DV360 — ${dvAge.length} age groups · ${dvCountry.length} countries · ${dvGender.length} gender segments.`);
          lines.push(`Date window: ${startDate} → ${endDate}.`);
          return lines;
        })()}
        context={{
          window: `${startDate} → ${endDate}`,
          ageGroups: metaAge.length + dvAge.length,
          countries: metaCountry.length + dvCountry.length,
          cohorts: cohortRows.length,
          ageBreakdown: [...metaAge, ...dvAge].map(r => ({ label: r.label, impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions })),
          genderBreakdown: [...metaGender, ...dvGender].map(r => ({ label: r.label, impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions })),
          countryBreakdown: [...metaCountry, ...dvCountry].map(r => ({ label: r.label, impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions })),
          cohortBreakdown: cohortRows.map(r => ({ segment: r.segment, impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions, ctr: r.ctr, convRate: r.convRate, cpm: r.cpm })),
        }}
        platform="meta"
        dateRange={String(dateRange)}
      />
    </div>
  );
}
