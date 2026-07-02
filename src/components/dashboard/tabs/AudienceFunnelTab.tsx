/**
 * Campaign → Audience Funnel
 * Doc sections 1 (Audience Intent), 2 (New vs Existing vs Engaged), 3 (Funnel Stage)
 *
 * All three sub-tabs use ad-set level data from /api/audience/adset-insights/meta
 * and classify each ad set by parsing its name for funnel-stage keywords.
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { Filter, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useColPicker, ColumnPickerButton, ColHeader } from "@/components/shared/ColumnPicker";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

const ChevronDownIcon = () => <ChevronDown className="w-4 h-4" />;
const ChevronRightIcon = () => <ChevronRight className="w-4 h-4" />;
import { useAdSetInsights, type AdSetRow } from "@/hooks/useAdSetInsights";
import { usePersistentColumns } from "@/hooks/useColumnPrefs";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

// ─── Name parsing ──────────────────────────────────────────────────────────

type FunnelStage = "TOF" | "MOF" | "BOF" | "Loyalty";
type IntentBucket = "Discovery" | "Consideration" | "Purchase Intent" | "Loyalty";
type AudienceType = "New" | "Engaged" | "Existing";

function parseFunnelStage(name: string): FunnelStage {
  const n = name.toLowerCase();
  if (/loyal|exist|customer|repeat|vip|\bloy\b/.test(n)) return "Loyalty";
  if (/\batc\b|add.to.cart|checkout|buyer|purchas|\bbof\b/.test(n)) return "BOF";
  if (/visitor|website|video|engaged|retarget|remarketing|\bmof\b/.test(n)) return "MOF";
  return "TOF";
}

function parseIntentBucket(name: string): IntentBucket {
  const stage = parseFunnelStage(name);
  if (stage === "Loyalty") return "Loyalty";
  if (stage === "BOF") return "Purchase Intent";
  if (stage === "MOF") return "Consideration";
  const n = name.toLowerCase();
  if (/interest|lal|lookalike/.test(n)) return "Consideration";
  return "Discovery";
}

function parseAudienceType(name: string): AudienceType {
  const stage = parseFunnelStage(name);
  if (stage === "Loyalty" || stage === "BOF") return "Existing";
  if (stage === "MOF") return "Engaged";
  return "New";
}

function parseAudienceLabel(name: string): string {
  const n = name.toLowerCase();
  // Standard audience types
  if (/\blal\b|lookalike/.test(n)) return "LAL";
  if (/interest/.test(n)) return "Interest";
  if (/\bbroad\b|gw_all|gw-all|_all_/.test(n)) return "Broad";
  if (/video/.test(n)) return "Video Viewers";
  if (/\batc\b|add.to.cart/.test(n)) return "ATC";
  if (/checkout|abandon/.test(n)) return "Checkout";
  if (/\bbuyer/.test(n)) return "Buyers";
  if (/ig\b|instagram|engaged/.test(n)) return "IG Engaged";
  if (/visitor|website|\bweb\b|app visitor/.test(n)) return "Web Visitors";
  if (/customer|loyal|existing/.test(n)) return "Customers";
  if (/prosp|cold/.test(n)) return "Prospecting";
  // Extended patterns for real-account naming conventions
  if (/catalog|dpa|dynamic.product/.test(n)) return "Catalog/DPA";
  if (/\basc\b|advantage.shopping/.test(n)) return "ASC";
  if (/retarget|remark/.test(n)) return "Retargeting";
  if (/\bsales\b/.test(n)) return "Sales";
  if (/\btest\b/.test(n)) return "Test";
  if (/skinca|plenaire|brand/.test(n)) return "Brand";
  if (/premium|vip|high.value/.test(n)) return "High Value";
  if (/creative|cci/.test(n)) return "Creative Test";
  // Date-only or date-tagged names — not classifiable
  if (/^\d{2}[\/\-]\d{2}$/.test(name.trim())) return "—";
  // Try splitting by underscore, dash, pipe, or space to find a meaningful segment
  const parts = name.split(/[\s\-|–_/]+/).filter(p => p.length > 1 && !/^\d+$/.test(p));
  // Discard date-like segments: month names, ordinal dates (24th), years, quarter/week codes
  const meaningfulParts = parts.filter(p =>
    !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|w\d+)\d*/i.test(p) &&
    !/^\d{4}$/.test(p) &&
    !/^\d+(st|nd|rd|th)$/i.test(p) &&
    !/^\d{1,2}[\/\-]\d{2}$/.test(p)
  );
  const last = meaningfulParts[meaningfulParts.length - 1];
  return last ? last.slice(0, 22) : "—";
}

// ─── Sub-tab helpers ────────────────────────────────────────────────────────

function fmtMoney(n: number, cur: string) { return formatMoney(n, cur, 0); }
function fmtInt(n: number) { return Math.round(n).toLocaleString("en-IN"); }

const STAGE_COLORS: Record<FunnelStage, string> = {
  TOF:     "bg-blue-100 text-blue-800",
  MOF:     "bg-yellow-100 text-yellow-800",
  BOF:     "bg-orange-100 text-orange-800",
  Loyalty: "bg-green-100 text-green-800",
};
const INTENT_COLORS: Record<IntentBucket, string> = {
  Discovery:        "bg-blue-100 text-blue-800",
  Consideration:    "bg-purple-100 text-purple-800",
  "Purchase Intent":"bg-orange-100 text-orange-800",
  Loyalty:          "bg-green-100 text-green-800",
};
const TYPE_COLORS: Record<AudienceType, string> = {
  New:      "bg-blue-100 text-blue-800",
  Engaged:  "bg-yellow-100 text-yellow-800",
  Existing: "bg-green-100 text-green-800",
};
const AUDIENCE_COLORS: Record<string, string> = {
  // TOF
  Broad:          "bg-sky-100 text-sky-800",
  Interest:       "bg-blue-100 text-blue-800",
  LAL:            "bg-indigo-100 text-indigo-800",
  Prospecting:    "bg-cyan-100 text-cyan-800",
  ASC:            "bg-sky-100 text-sky-800",
  // MOF
  "Web Visitors": "bg-violet-100 text-violet-800",
  "Video Viewers":"bg-purple-100 text-purple-800",
  "IG Engaged":   "bg-fuchsia-100 text-fuchsia-800",
  // BOF
  ATC:            "bg-orange-100 text-orange-800",
  Checkout:       "bg-red-100 text-red-800",
  Retargeting:    "bg-rose-100 text-rose-800",
  // Loyalty / retention
  Customers:      "bg-green-100 text-green-800",
  Buyers:         "bg-emerald-100 text-emerald-800",
  "High Value":   "bg-teal-100 text-teal-800",
  // Other
  "Catalog/DPA":  "bg-gray-100 text-gray-700",
  "Creative Test":"bg-pink-100 text-pink-800",
  Brand:          "bg-yellow-100 text-yellow-800",
  Sales:          "bg-lime-100 text-lime-800",
  Test:           "bg-gray-100 text-gray-500",
};
function audienceBadge(label: string) {
  const cls = AUDIENCE_COLORS[label] ?? "bg-gray-100 text-gray-600";
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{label}</span>;
}

// ─── Grouped-row table (reused across sub-tabs) ─────────────────────────────

interface GroupRow {
  group: string;
  audienceLabel: string;
  adSetNames: string[];
  campaignNames: string[];
  spend: number;
  conversions: number;
  conversionValue: number;
  impressions: number;
  clicks: number;
  reach: number;
}

function groupBy<K extends string>(
  adsets: AdSetRow[],
  keyFn: (a: AdSetRow) => K
): Map<K, AdSetRow[]> {
  const map = new Map<K, AdSetRow[]>();
  for (const a of adsets) {
    const k = keyFn(a);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  return map;
}

/** Build rows grouped by (stageFn, audienceLabel) — one row per unique pair. */
function buildPairRows<K extends string>(
  adsets: AdSetRow[],
  stageFn: (a: AdSetRow) => K,
  stageOrder: K[]
): GroupRow[] {
  const map = new Map<string, AdSetRow[]>();
  for (const a of adsets) {
    const key = `${stageFn(a)}|||${parseAudienceLabel(a.name)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }

  const rows: GroupRow[] = [];
  for (const stage of stageOrder) {
    const stageEntries = [...map.entries()].filter(([k]) => k.startsWith(`${stage}|||`));
    stageEntries.sort(([, a], [, b]) =>
      b.reduce((s, r) => s + r.spend, 0) - a.reduce((s, r) => s + r.spend, 0)
    );
    for (const [key, adsets] of stageEntries) {
      const audienceLabel = key.split("|||")[1];
      const uniqueCampaigns = [...new Set(adsets.map((r) => r.campaignName).filter(Boolean) as string[])];
      rows.push({
        group: stage,
        audienceLabel,
        adSetNames: adsets.map((r) => r.name),
        campaignNames: uniqueCampaigns,
        spend: adsets.reduce((s, r) => s + r.spend, 0),
        conversions: adsets.reduce((s, r) => s + r.conversions, 0),
        conversionValue: adsets.reduce((s, r) => s + r.conversionValue, 0),
        impressions: adsets.reduce((s, r) => s + r.impressions, 0),
        clicks: adsets.reduce((s, r) => s + r.clicks, 0),
        reach: adsets.reduce((s, r) => s + r.reach, 0),
      });
    }
  }
  return rows;
}

// ─── KPI picker config ──────────────────────────────────────────────────────

type KpiId =
  | "spend" | "revenue" | "orders" | "roas" | "cpa" | "cvr" | "aov"
  | "impressions" | "reach" | "cpm" | "frequency" | "views" | "cpv"
  | "vtr" | "ctr"
  | "clicks" | "cpc" | "engagements" | "engagementRate" | "cpe"
  | "leads" | "convRate" | "cpl" | "traffic" | "addToCart" | "atcConvRate" | "install" | "cpi"
  | "sales" | "saleConvRate" | "cps" | "acos";

interface KpiDef {
  id: KpiId;
  label: string;
  group: string;
  defaultOn?: boolean;
  fmt: (a: AdSetRow, currency: string) => string;
}

const ALL_KPIS: KpiDef[] = [
  // Core (default on)
  { id: "spend",          label: "Spend",           group: "Core",             defaultOn: true, fmt: (a, c) => fmtMoney(a.spend, c) },
  { id: "revenue",        label: "Revenue",         group: "Core",             defaultOn: true, fmt: (a, c) => fmtMoney(a.conversionValue, c) },
  { id: "orders",         label: "Orders",          group: "Core",             defaultOn: true, fmt: (a) => fmtInt(a.conversions) },
  { id: "roas",           label: "ROAS",            group: "Core",             defaultOn: true, fmt: (a) => a.spend > 0 ? `${(a.conversionValue / a.spend).toFixed(2)}×` : "—" },
  { id: "cpa",            label: "CPA",             group: "Core",             defaultOn: true, fmt: (a, c) => a.conversions > 0 ? fmtMoney(a.spend / a.conversions, c) : "—" },
  { id: "cvr",            label: "CVR",             group: "Core",             defaultOn: true, fmt: (a) => a.clicks > 0 ? `${((a.conversions / a.clicks) * 100).toFixed(2)}%` : "—" },
  { id: "aov",            label: "AOV",             group: "Core",             defaultOn: true, fmt: (a, c) => a.conversions > 0 ? fmtMoney(a.conversionValue / a.conversions, c) : "—" },
  // Awareness
  { id: "impressions",    label: "Impressions",     group: "Awareness",        fmt: (a) => fmtInt(a.impressions) },
  { id: "reach",          label: "Reach",           group: "Awareness",        fmt: (a) => fmtInt(a.reach) },
  { id: "cpm",            label: "CPM",             group: "Awareness",        fmt: (a, c) => a.impressions > 0 ? fmtMoney((a.spend / a.impressions) * 1000, c) : "—" },
  { id: "frequency",      label: "Frequency",       group: "Awareness",        fmt: (a) => a.frequency > 0 ? `${a.frequency.toFixed(1)}×` : "—" },
  { id: "views",          label: "Views",           group: "Awareness",        fmt: () => "—" },
  { id: "cpv",            label: "CPV",             group: "Awareness",        fmt: () => "—" },
  // Creative Quality
  { id: "vtr",            label: "VTR",             group: "Creative Quality", fmt: () => "—" },
  { id: "ctr",            label: "CTR",             group: "Creative Quality", fmt: (a) => a.impressions > 0 ? `${((a.clicks / a.impressions) * 100).toFixed(2)}%` : "—" },
  // Consideration
  { id: "clicks",         label: "Clicks",          group: "Consideration",    fmt: (a) => fmtInt(a.clicks) },
  { id: "cpc",            label: "CPC",             group: "Consideration",    fmt: (a, c) => a.clicks > 0 ? fmtMoney(a.spend / a.clicks, c) : "—" },
  { id: "engagements",    label: "Engagements",     group: "Consideration",    fmt: () => "—" },
  { id: "engagementRate", label: "Engagement Rate", group: "Consideration",    fmt: () => "—" },
  { id: "cpe",            label: "CPE",             group: "Consideration",    fmt: () => "—" },
  // Preference
  { id: "leads",          label: "Leads",           group: "Preference",       fmt: () => "—" },
  { id: "convRate",       label: "Conv. Rate",      group: "Preference",       fmt: (a) => a.clicks > 0 ? `${((a.conversions / a.clicks) * 100).toFixed(2)}%` : "—" },
  { id: "cpl",            label: "CPL",             group: "Preference",       fmt: () => "—" },
  { id: "traffic",        label: "Traffic",         group: "Preference",       fmt: () => "—" },
  { id: "addToCart",      label: "Add to Cart",     group: "Preference",       fmt: () => "—" },
  { id: "atcConvRate",    label: "ATC Conv. Rate",  group: "Preference",       fmt: () => "—" },
  { id: "install",        label: "Install",         group: "Preference",       fmt: () => "—" },
  { id: "cpi",            label: "CPI",             group: "Preference",       fmt: () => "—" },
  // Purchase
  { id: "sales",          label: "Sales",           group: "Purchase",         fmt: (a) => fmtInt(a.conversions) },
  { id: "saleConvRate",   label: "Sale Conv. Rate", group: "Purchase",         fmt: (a) => a.clicks > 0 ? `${((a.conversions / a.clicks) * 100).toFixed(2)}%` : "—" },
  { id: "cps",            label: "CPS",             group: "Purchase",         fmt: (a, c) => a.conversions > 0 ? fmtMoney(a.spend / a.conversions, c) : "—" },
  { id: "acos",           label: "ACOS",            group: "Purchase",         fmt: (a) => a.conversionValue > 0 ? `${((a.spend / a.conversionValue) * 100).toFixed(1)}%` : "—" },
];

// Only KPIs this table can populate — probe each fmt with a full row; anything
// still "—" (Views, CPV, VTR, Leads, …) is dropped from the column picker.
const FUNNEL_SAMPLE = { spend: 5000, impressions: 100000, clicks: 1500, reach: 40000, frequency: 2.5, conversions: 80, conversionValue: 120000 } as AdSetRow;
const FUNNEL_FETCHABLE: KpiDef[] = ALL_KPIS.filter((k) => k.fmt(FUNNEL_SAMPLE, "USD") !== "—");

const DEFAULT_KPI_ORDER: KpiId[] = ALL_KPIS.filter((k) => k.defaultOn).map((k) => k.id);
const KPI_GROUPS = Array.from(new Set(ALL_KPIS.map((k) => k.group)));
const KPI_MAP = new Map(ALL_KPIS.map((k) => [k.id, k]));

// Defaults for the two aggregated tables
const NVE_DEFAULTS: KpiId[] = ["spend", "revenue", "orders", "roas", "cpa", "aov"];
const FSA_DEFAULTS: KpiId[] = ["reach", "spend", "orders", "revenue", "roas", "cpa"];

// Shared formatter for aggregated rows (spend/impressions/clicks/reach/conversions/conversionValue)
type AggMetricRow = { spend: number; impressions: number; clicks: number; reach: number; conversions: number; conversionValue: number };

function fmtAggKpi(id: KpiId, r: AggMetricRow, currency: string): string {
  const roas  = r.spend > 0 ? r.conversionValue / r.spend : 0;
  const cpa   = r.conversions > 0 ? r.spend / r.conversions : 0;
  const cvr   = r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0;
  const aov   = r.conversions > 0 ? r.conversionValue / r.conversions : 0;
  const cpm   = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0;
  const ctr   = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
  const cpc   = r.clicks > 0 ? r.spend / r.clicks : 0;
  const acos  = r.conversionValue > 0 ? (r.spend / r.conversionValue) * 100 : 0;
  switch (id) {
    case "spend":        return fmtMoney(r.spend, currency);
    case "revenue":      return fmtMoney(r.conversionValue, currency);
    case "orders":       return fmtInt(r.conversions);
    case "roas":         return roas > 0 ? `${roas.toFixed(2)}×` : "—";
    case "cpa":          return cpa > 0 ? fmtMoney(cpa, currency) : "—";
    case "cvr":          return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "aov":          return aov > 0 ? fmtMoney(aov, currency) : "—";
    case "impressions":  return fmtInt(r.impressions);
    case "reach":        return fmtInt(r.reach);
    case "cpm":          return cpm > 0 ? fmtMoney(cpm, currency) : "—";
    case "ctr":          return ctr > 0 ? `${ctr.toFixed(2)}%` : "—";
    case "clicks":       return fmtInt(r.clicks);
    case "cpc":          return cpc > 0 ? fmtMoney(cpc, currency) : "—";
    case "sales":        return fmtInt(r.conversions);
    case "saleConvRate": return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "cps":          return cpa > 0 ? fmtMoney(cpa, currency) : "—";
    case "acos":         return acos > 0 ? `${acos.toFixed(1)}%` : "—";
    case "convRate":     return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    default:             return "—";
  }
}

// ─── Sub-tab: Intent Analysis (§1) ─────────────────────────────────────────

function IntentAnalysis({ adsets, loading, currency }: { adsets: AdSetRow[]; loading: boolean; currency: string }) {
  const enrichedAdsets = useMemo(() =>
    adsets.map((a) => ({
      ...a,
      intentBucket: parseIntentBucket(a.name),
      audienceLabel: parseAudienceLabel(a.name),
    })),
    [adsets]
  );
  const { sorted: rows, sort: intentSort, toggle: intentToggle } = useSort(enrichedAdsets, "spend", "desc");

  // Ordered array so we can swap by position
  const [colOrder, setColOrder] = usePersistentColumns<KpiId>("funnel-intent", DEFAULT_KPI_ORDER);

  // Top-right picker open state
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Per-column swap dropdown: index of the column being swapped, or null
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const swapRef = useRef<HTMLDivElement>(null);

  // Close top-right picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function h(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  // Close swap dropdown on outside click
  useEffect(() => {
    if (swapIdx === null) return;
    function h(e: MouseEvent) {
      if (swapRef.current && !swapRef.current.contains(e.target as Node)) setSwapIdx(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  // Top-right picker: toggle add/remove
  const toggleKpi = (id: KpiId) => {
    setColOrder((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  // Per-column swap: replace position idx with newId (swap if newId already exists)
  const swapKpi = (idx: number, newId: KpiId) => {
    setColOrder((prev) => {
      const next = [...prev];
      const existingIdx = next.indexOf(newId);
      if (existingIdx !== -1) {
        // Swap the two columns
        [next[existingIdx], next[idx]] = [next[idx], next[existingIdx]];
      } else {
        next[idx] = newId;
      }
      return next;
    });
    setSwapIdx(null);
  };

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      {/* Top-right column picker */}
      <div className="flex justify-end" ref={pickerRef}>
        <div className="relative">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
            Columns
            <span className="ml-0.5 bg-gray-200 text-gray-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">{colOrder.length}</span>
          </button>

          {pickerOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-60 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden border border-gray-700">
              <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-300">Columns</span>
                <button onClick={() => setColOrder([...DEFAULT_KPI_ORDER])} className="text-[10px] text-gray-400 hover:text-white transition">
                  Reset defaults
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto py-1">
                {KPI_GROUPS.map((group) => (
                  <div key={group}>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{group}</div>
                    {ALL_KPIS.filter((k) => k.group === group).map((k) => {
                      const on = colOrder.includes(k.id);
                      return (
                        <button
                          key={k.id}
                          onClick={() => toggleKpi(k.id)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-600/20 text-blue-300" : "text-gray-200 hover:bg-gray-800"}`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-600"}`}>
                            {on && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                          </span>
                          {k.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-gray-700 text-[10px] text-gray-500">{colOrder.length} selected</div>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={swapRef}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <SortTh col="name" sort={intentSort} onToggle={intentToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Campaign / Ad Set</SortTh>
              <SortTh col="intentBucket" sort={intentSort} onToggle={intentToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Intent Bucket</SortTh>
              <SortTh col="audienceLabel" sort={intentSort} onToggle={intentToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Audience</SortTh>
              {colOrder.map((id, colIdx) => {
                const k = KPI_MAP.get(id)!;
                return (
                  <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <div className="relative flex items-center justify-end gap-1">
                      <span className="whitespace-nowrap">{k.label}</span>
                      <button
                        onClick={() => setSwapIdx(swapIdx === colIdx ? null : colIdx)}
                        className="text-gray-400 hover:text-gray-700 transition shrink-0"
                        title="Change column"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5 2v6M2 5l3 3 3-3" />
                        </svg>
                      </button>
                      {swapIdx === colIdx && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden border border-gray-700">
                          <div className="px-3 py-2 border-b border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Change column
                          </div>
                          <div className="max-h-[500px] overflow-y-auto py-1">
                            {KPI_GROUPS.map((group) => (
                              <div key={group}>
                                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">{group}</div>
                                {ALL_KPIS.filter((kk) => kk.group === group).map((kk) => {
                                  const isCurrent = kk.id === id;
                                  return (
                                    <button
                                      key={kk.id}
                                      onClick={() => !isCurrent && swapKpi(colIdx, kk.id)}
                                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${isCurrent ? "text-blue-400 font-semibold bg-blue-600/10 cursor-default" : "text-gray-200 hover:bg-gray-800"}`}
                                    >
                                      {isCurrent && <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                                      {kk.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
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
            {rows.map((a) => {
              const intent = a.intentBucket;
              const audience = a.audienceLabel;
              return (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[220px]" title={a.name}>
                    <div className="font-mono text-gray-900 truncate text-xs">{a.name}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${INTENT_COLORS[intent]}`}>{intent}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{audienceBadge(audience)}</td>
                  {colOrder.map((id) => {
                    const k = KPI_MAP.get(id)!;
                    return (
                      <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                        {k.fmt(a, currency)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-tab: New vs Existing vs Engaged (§2) ───────────────────────────────

function NewVsExisting({ adsets, loading, currency }: { adsets: AdSetRow[]; loading: boolean; currency: string }) {
  const rawRows = useMemo(() => {
    const grouped = groupBy(adsets, (a) => parseAudienceType(a.name));
    return (["New", "Engaged", "Existing"] as AudienceType[])
      .filter((k) => grouped.has(k))
      .map((k) => {
        const g = grouped.get(k)!;
        return {
          group: k,
          adSetNames: g.map((r) => r.name),
          spend: g.reduce((s, r) => s + r.spend, 0),
          conversions: g.reduce((s, r) => s + r.conversions, 0),
          conversionValue: g.reduce((s, r) => s + r.conversionValue, 0),
          impressions: g.reduce((s, r) => s + r.impressions, 0),
          clicks: g.reduce((s, r) => s + r.clicks, 0),
          reach: g.reduce((s, r) => s + r.reach, 0),
        };
      });
  }, [adsets]);
  const { sorted: rows, sort: nveSort, toggle: nveToggle } = useSort(rawRows, "spend", "desc");

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(NVE_DEFAULTS, "funnel-nve");

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      <ColumnPickerButton
        cols={cols} allDefs={FUNNEL_FETCHABLE} defaultIds={NVE_DEFAULTS}
        pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
        toggleCol={toggleCol} resetCols={resetCols}
      />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <SortTh col="group" sort={nveSort} onToggle={nveToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Audience Type</SortTh>
              {(cols as KpiId[]).map((id, colIdx) => {
                const k = KPI_MAP.get(id)!;
                return (
                  <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <ColHeader colIdx={colIdx} currentId={id} label={k.label} allDefs={FUNNEL_FETCHABLE} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${TYPE_COLORS[r.group as AudienceType]}`}>{r.group}</span>
                  <span className="ml-2 text-xs text-gray-500">{r.adSetNames.length} ad set{r.adSetNames.length !== 1 ? "s" : ""}</span>
                </td>
                {(cols as KpiId[]).map((id) => (
                  <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {fmtAggKpi(id, r, currency)}
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

// ─── Sub-tab: Funnel Stage Analysis (§3) ────────────────────────────────────

interface FunnelGroupRow {
  stage: FunnelStage;
  audienceLabel: string;
  adSetNames: string[];
  campaignNames: string[];
  spend: number; conversions: number; conversionValue: number;
  impressions: number; clicks: number; reach: number;
}

interface FunnelStageGroup {
  stage: FunnelStage;
  children: FunnelGroupRow[];
  spend: number; conversions: number; conversionValue: number;
  impressions: number; clicks: number; reach: number;
}

function buildFunnelGroups(adsets: AdSetRow[]): FunnelStageGroup[] {
  const pairRows = buildPairRows(adsets, (a) => parseFunnelStage(a.name), ["TOF", "MOF", "BOF", "Loyalty"]);
  const stageMap = new Map<FunnelStage, FunnelGroupRow[]>();
  for (const r of pairRows) {
    const stage = r.group as FunnelStage;
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage)!.push({ stage, audienceLabel: r.audienceLabel, adSetNames: r.adSetNames, campaignNames: r.campaignNames, spend: r.spend, conversions: r.conversions, conversionValue: r.conversionValue, impressions: r.impressions, clicks: r.clicks, reach: r.reach });
  }
  return (["TOF", "MOF", "BOF", "Loyalty"] as FunnelStage[]).filter(s => stageMap.has(s)).map(stage => {
    const children = stageMap.get(stage)!;
    return {
      stage,
      children,
      spend: children.reduce((s, r) => s + r.spend, 0),
      conversions: children.reduce((s, r) => s + r.conversions, 0),
      conversionValue: children.reduce((s, r) => s + r.conversionValue, 0),
      impressions: children.reduce((s, r) => s + r.impressions, 0),
      clicks: children.reduce((s, r) => s + r.clicks, 0),
      reach: children.reduce((s, r) => s + r.reach, 0),
    };
  });
}

function FunnelStageAnalysis({ adsets, loading, currency }: { adsets: AdSetRow[]; loading: boolean; currency: string }) {
  const rawGroups = useMemo(() => buildFunnelGroups(adsets), [adsets]);
  const { sorted: groups, sort: fsaSort, toggle: fsaToggle } = useSort(rawGroups, "spend", "desc");
  const [expanded, setExpanded] = useState<Set<FunnelStage>>(new Set());

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(FSA_DEFAULTS, "funnel-fsa");

  const toggle = (stage: FunnelStage) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    return next;
  });

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      <ColumnPickerButton
        cols={cols} allDefs={FUNNEL_FETCHABLE} defaultIds={FSA_DEFAULTS}
        pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
        toggleCol={toggleCol} resetCols={resetCols}
      />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <th className="px-4 py-2.5 w-8" />
              <SortTh col="stage" sort={fsaSort} onToggle={fsaToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Funnel Stage</SortTh>
              {(cols as KpiId[]).map((id, colIdx) => {
                const k = KPI_MAP.get(id)!;
                return (
                  <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <ColHeader colIdx={colIdx} currentId={id} label={k.label} allDefs={FUNNEL_FETCHABLE} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = expanded.has(g.stage);
              return (
                <>
                  <tr key={g.stage} onClick={() => toggle(g.stage)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 text-gray-400">
                      {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STAGE_COLORS[g.stage]}`}>{g.stage}</span>
                      <span className="ml-2 text-xs text-gray-400">{g.children.length} audience{g.children.length !== 1 ? "s" : ""}</span>
                    </td>
                    {(cols as KpiId[]).map((id) => (
                      <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                        {fmtAggKpi(id, g, currency)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && g.children.map((r, i) => (
                    <tr key={`${g.stage}-${i}`} className="border-b border-blue-50 bg-blue-50/30 hover:bg-blue-50">
                      <td className="px-4 py-2" />
                      <td className="px-6 py-2">
                        <div>{audienceBadge(r.audienceLabel)}</div>
                        {r.campaignNames.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[200px]" title={r.campaignNames.join(", ")}>
                            {r.campaignNames[0]}{r.campaignNames.length > 1 ? ` +${r.campaignNames.length - 1}` : ""}
                          </div>
                        )}
                        {r.adSetNames.length > 1 && <div className="text-[10px] text-gray-400">{r.adSetNames.length} ad sets</div>}
                      </td>
                      {(cols as KpiId[]).map((id) => (
                        <td key={id} className="px-3 py-2 text-right text-gray-600 text-xs whitespace-nowrap">
                          {fmtAggKpi(id, r, currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
        <div className="px-5 py-2.5 bg-gray-50 rounded-b-lg text-[11px] text-gray-500">
          Click a stage row to expand individual audience types.
        </div>
      </div>
    </div>
  );
}

// ─── Drill-down: per-ad-set rows within each group ──────────────────────────

function AdSetDetail<K extends string>({
  adsets, keyFn, colorMap, currency,
}: {
  adsets: AdSetRow[];
  keyFn: (a: AdSetRow) => K;
  colorMap: Record<K, string>;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const enrichedAdsetRows = useMemo(() =>
    adsets.map((a) => ({ ...a, roas: a.spend > 0 ? a.conversionValue / a.spend : 0 })),
    [adsets]
  );
  const { sorted, sort: detailSort, toggle: detailToggle } = useSort(enrichedAdsetRows, "spend", "desc");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:underline font-semibold">
        Show individual ad sets ({adsets.length}) ▾
      </button>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">All ad sets ({adsets.length})</span>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:underline">Hide ▴</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="name" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600">Ad Set</SortTh>
              <SortTh col="name" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600">Group</SortTh>
              <SortTh col="spend" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600" align="right">Spend</SortTh>
              <SortTh col="conversionValue" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600" align="right">Revenue</SortTh>
              <SortTh col="conversions" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600" align="right">Orders</SortTh>
              <SortTh col="roas" sort={detailSort} onToggle={detailToggle} className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-600" align="right">ROAS</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const k = keyFn(a);
              return (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-800 truncate max-w-[260px]" title={a.name}>{a.name}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${colorMap[k]}`}>{k}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtMoney(a.spend, currency)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{fmtMoney(a.conversionValue, currency)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{fmtInt(a.conversions)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.roas > 0 ? `${a.roas.toFixed(2)}×` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data found. Connect a Meta account or widen the date range.
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "intent",    label: "Audience Intent",      desc: "Group ad sets by intent bucket (§1)" },
  { id: "new-exist", label: "New vs Existing",       desc: "Prospecting vs retargeting split (§2)" },
  { id: "funnel",    label: "Funnel Stage",           desc: "TOF / MOF / BOF / Loyalty breakdown (§3)" },
];

export default function AudienceFunnelTab({ platform, dateRange, customStart, customEnd }: Props) {
  const [active, setActive] = useState("intent");
  const { adsets, loading, error, currency } = useAdSetInsights(platform, dateRange, customStart, customEnd);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Filter className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Funnel</h1>
            <p className="text-gray-600 mt-1">Intent buckets, prospecting vs retargeting split, and TOF/MOF/BOF stage breakdown — derived from ad-set names via Meta Insights API.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Audience Funnel"
          context={{
            adSetCount: adsets.length,
            totalSpend: adsets.reduce((s, a) => s + a.spend, 0),
            totalRevenue: adsets.reduce((s, a) => s + a.conversionValue, 0),
            totalOrders: adsets.reduce((s, a) => s + a.conversions, 0),
            activeSubTab: active,
            topAdSets: adsets.slice(0, 8).map(a => ({ name: a.name, spend: a.spend, roas: a.spend > 0 ? +(a.conversionValue / a.spend).toFixed(2) : 0 })),
          }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={String(dateRange)}
          inline
        />
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Google Ads selected — this section uses Meta ad-set data. Switch to Meta or Both to see results.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
          </button>
        ))}
      </div>

      {active === "intent"    && <IntentAnalysis adsets={adsets} loading={loading} currency={currency} />}
      {active === "new-exist" && <NewVsExisting adsets={adsets} loading={loading} currency={currency} />}
      {active === "funnel"    && <FunnelStageAnalysis adsets={adsets} loading={loading} currency={currency} />}

      <p className="text-[11px] text-gray-400">
        Stage classification uses ad-set name parsing (keywords: broad/interest/lal = TOF; visitor/video/engaged = MOF; atc/checkout = BOF; customer/loyal = Loyalty). Rename ad sets to match naming conventions for accurate grouping.
      </p>

      <TabSummaryFooter
        tabName="Audience Funnel"
        lines={[
          `${adsets.length} ad set${adsets.length !== 1 ? "s" : ""} analysed across audience funnel stages.`,
          `Total spend: ${adsets.reduce((s, a) => s + a.spend, 0).toLocaleString("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 })} · ${adsets.reduce((s, a) => s + a.conversions, 0).toLocaleString()} conversions.`,
          `Average ROAS: ${adsets.length > 0 ? (adsets.reduce((s, a) => s + (a.spend > 0 ? a.conversionValue / a.spend : 0), 0) / adsets.length).toFixed(2) : "—"}×.`,
        ]}
        context={{
          adSetCount: adsets.length,
          totalSpend: adsets.reduce((s, a) => s + a.spend, 0),
          adSets: adsets.map(a => ({
            name: a.name,
            spend: a.spend,
            impressions: a.impressions,
            clicks: a.clicks,
            conversions: a.conversions,
            conversionValue: a.conversionValue,
            roas: a.spend > 0 ? +(a.conversionValue / a.spend).toFixed(4) : 0,
            cpa: a.conversions > 0 ? +(a.spend / a.conversions).toFixed(4) : 0,
          })),
        }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
