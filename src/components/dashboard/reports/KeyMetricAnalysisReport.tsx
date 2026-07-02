/**
 * Reporting → Key Metric Analysis
 *
 * Mirrors the dv360-intel KMA layout:
 *   - FilterBar (Objective · Granularity · Group by · Campaigns)
 *   - Highlights: 4 objective-driven KPI cards with vs-prev deltas
 *   - Performance Reports: 3 dual-axis charts (Impressions vs CPM,
 *     Impressions vs Spend, Reach vs Frequency by default), each with a
 *     dropdown to switch the metric pairing, headline leader, and chart by
 *     the active Group By dimension.
 *
 * Data: useCampaigns + useAdSetInsights (current + prev period). Reach +
 * frequency are aggregated from ad sets — Meta doesn't expose them at the
 * campaign-insights edge.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Target, Clock, LayoutGrid, ChevronDown, Plus, ListChecks, TrendingUp, TrendingDown, Check, X, Search } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import {
  Bar, ComposedChart, Line, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAuthStore } from "@/store/auth";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { useMetaDailyVsPrev } from "@/hooks/useMetaDailyVsPrev";
import { usePersistentColumns, usePersistentValue } from "@/hooks/useColumnPrefs";
import CampaignMultiPicker from "@/components/shared/CampaignMultiPicker";
import { formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { CampaignData } from "@/types";
import type { AdSetRow } from "@/hooks/useAdSetInsights";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";
import { ChevronRight as ChevronRightIcon, MoreHorizontal, GitCompare, Layers as LayersIcon } from "lucide-react";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

// ─── Metric definitions ─────────────────────────────────────────────────────

type MetricId =
  | "spend" | "impressions" | "reach" | "frequency"
  | "clicks" | "conversions" | "conversionValue"
  | "ctr" | "cpc" | "cpm" | "cpa" | "roas" | "cvr" | "aov";

const METRICS: { id: MetricId; label: string; fmt: "money" | "int" | "pct" | "x" | "decimal"; lowerIsBetter?: boolean }[] = [
  { id: "impressions",     label: "Impressions",     fmt: "int" },
  { id: "reach",           label: "Reach",           fmt: "int" },
  { id: "frequency",       label: "Frequency",       fmt: "decimal", lowerIsBetter: true },
  { id: "cpm",             label: "CPM",             fmt: "money", lowerIsBetter: true },
  { id: "spend",           label: "Spend",           fmt: "money" },
  { id: "clicks",          label: "Clicks",          fmt: "int" },
  { id: "ctr",             label: "CTR",             fmt: "pct" },
  { id: "cpc",             label: "CPC",             fmt: "money", lowerIsBetter: true },
  { id: "conversions",     label: "Conversions",     fmt: "int" },
  { id: "conversionValue", label: "Revenue",         fmt: "money" },
  { id: "roas",            label: "ROAS",            fmt: "x" },
  { id: "cpa",             label: "CPA",             fmt: "money", lowerIsBetter: true },
  { id: "cvr",             label: "CVR",             fmt: "pct" },
  { id: "aov",             label: "AOV",             fmt: "money" },
];
const METRIC_BY_ID = new Map(METRICS.map(m => [m.id, m] as const));

const METRIC_LABEL = (id: MetricId) => METRIC_BY_ID.get(id)?.label ?? id;

// Objective → Family · Cost-per metric. Mirrors dv360-intel KMA exactly.
type ObjectiveId =
  | "awareness_cpm" | "awareness_cpv" | "engagement_cpe"
  | "traffic_cpc" | "lead_cpl" | "install_cpi" | "sales_cps";

interface ObjectiveDef {
  id: ObjectiveId;
  family: string;
  cost: string;
  highlights: MetricId[]; // 4 KPI cards
  templates: GraphTemplate[]; // 3 chart templates
}

interface GraphTemplate { primary: MetricId; secondary: MetricId; }

const OBJECTIVES: ObjectiveDef[] = [
  { id: "awareness_cpm",  family: "Awareness",  cost: "CPM",
    highlights: ["impressions", "reach", "frequency", "cpm"],
    templates: [{ primary: "impressions", secondary: "cpm" }, { primary: "impressions", secondary: "spend" }, { primary: "reach", secondary: "frequency" }] },
  { id: "awareness_cpv",  family: "Awareness",  cost: "CPV",
    highlights: ["impressions", "reach", "frequency", "cpm"],
    templates: [{ primary: "impressions", secondary: "spend" }, { primary: "reach", secondary: "frequency" }, { primary: "impressions", secondary: "cpm" }] },
  { id: "engagement_cpe", family: "Engagement", cost: "CPE",
    highlights: ["clicks", "ctr", "cpc", "impressions"],
    templates: [{ primary: "clicks", secondary: "ctr" }, { primary: "clicks", secondary: "cpc" }, { primary: "impressions", secondary: "clicks" }] },
  { id: "traffic_cpc",    family: "Traffic",    cost: "CPC",
    highlights: ["clicks", "ctr", "cpc", "cpm"],
    templates: [{ primary: "clicks", secondary: "cpc" }, { primary: "clicks", secondary: "ctr" }, { primary: "impressions", secondary: "clicks" }] },
  { id: "lead_cpl",       family: "Lead",       cost: "CPL",
    highlights: ["conversions", "cpa", "cvr", "ctr"],
    templates: [{ primary: "conversions", secondary: "cpa" }, { primary: "conversions", secondary: "cvr" }, { primary: "spend", secondary: "conversions" }] },
  { id: "install_cpi",    family: "Install",    cost: "CPI",
    highlights: ["conversions", "cpa", "cvr", "ctr"],
    templates: [{ primary: "conversions", secondary: "cpa" }, { primary: "conversions", secondary: "cvr" }, { primary: "spend", secondary: "conversions" }] },
  { id: "sales_cps",      family: "Sales",      cost: "CPS",
    highlights: ["conversionValue", "roas", "cpa", "aov"],
    templates: [{ primary: "conversionValue", secondary: "roas" }, { primary: "conversions", secondary: "aov" }, { primary: "spend", secondary: "conversionValue" }] },
];
const OBJECTIVE_BY_ID = new Map(OBJECTIVES.map(o => [o.id, o] as const));

// ─── Group By (Analysis Type) — mirrors dv360 labels ────────────────────────
type GroupBy = "campaigns" | "insertion_orders" | "line_items" | "placements" | "ads";
const GROUPBY_LABEL: Record<GroupBy, string> = {
  campaigns:        "Campaigns",
  insertion_orders: "Insertion Orders",
  line_items:       "Line Items",
  placements:       "Placements",
  ads:              "Ads",
};
// Meta has no IO concept — IO maps to Campaign rollup, Line Items map to Ad Sets,
// Placements to publisher_platform, Ads to ad-level.
const GROUPBY_NOTE: Partial<Record<GroupBy, string>> = {
  insertion_orders: "Meta — uses Campaign rollup",
  line_items:       "Meta — uses Ad Sets",
};

// ─── Granularity ────────────────────────────────────────────────────────────
type Granularity = "hour" | "day" | "week" | "month" | "quarter" | "year";
const GRAN_LABEL: Record<Granularity, string> = {
  hour:    "Hour Wise",
  day:     "Day Wise",
  week:    "Week Wise",
  month:   "Month Wise",
  quarter: "Quarter Wise",
  year:    "Year Wise",
};

// ─── Format helpers ─────────────────────────────────────────────────────────
function fmt(v: number, kind: "money" | "int" | "pct" | "x" | "decimal", currency: string): string {
  if (!Number.isFinite(v)) return "—";
  if (kind === "money") {
    if (Math.abs(v) >= 1_000_000) return formatMoney(v / 1_000_000, currency, 2) + "M";
    if (Math.abs(v) >= 10_000)    return formatMoney(v / 1_000, currency, 1) + "k";
    return formatMoney(v, currency, v < 100 ? 2 : 0);
  }
  if (kind === "pct") return `${v.toFixed(2)}%`;
  if (kind === "x")   return `${v.toFixed(2)}×`;
  if (kind === "decimal") return v.toFixed(2);
  // int with compact for big numbers
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000)    return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toLocaleString("en-IN");
}

function pctDelta(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

// ─── Aggregation: ad sets → campaign-level rows with reach/frequency ────────
interface GroupRow {
  id: string;
  label: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number; cpc: number; cpm: number; cpa: number; roas: number; cvr: number; aov: number;
}

function derive(base: { spend: number; impressions: number; reach: number; clicks: number; conversions: number; conversionValue: number }): Omit<GroupRow, "id" | "label"> {
  return {
    spend: base.spend, impressions: base.impressions, reach: base.reach,
    frequency: base.reach > 0 ? base.impressions / base.reach : 0,
    clicks: base.clicks, conversions: base.conversions, conversionValue: base.conversionValue,
    ctr:  base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0,
    cpc:  base.clicks > 0 ? base.spend / base.clicks : 0,
    cpm:  base.impressions > 0 ? (base.spend / base.impressions) * 1000 : 0,
    cpa:  base.conversions > 0 ? base.spend / base.conversions : 0,
    roas: base.spend > 0 ? base.conversionValue / base.spend : 0,
    cvr:  base.clicks > 0 ? (base.conversions / base.clicks) * 100 : 0,
    aov:  base.conversions > 0 ? base.conversionValue / base.conversions : 0,
  };
}

function buildGroupRows(adsets: AdSetRow[], campaigns: CampaignData[], groupBy: GroupBy): GroupRow[] {
  if (groupBy === "line_items") {
    // Meta Line Item ≈ Ad Set
    return adsets.map(a => ({
      id: a.id, label: a.name,
      ...derive({ spend: a.spend, impressions: a.impressions, reach: a.reach, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue }),
    }));
  }
  if (groupBy === "ads") {
    // Ad-level data not in this fetch — surface ad sets as a graceful fallback
    return adsets.slice(0, 50).map(a => ({
      id: a.id, label: a.name,
      ...derive({ spend: a.spend, impressions: a.impressions, reach: a.reach, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue }),
    }));
  }
  if (groupBy === "placements") {
    // Aggregate by campaign here — full placement breakdown requires a separate
    // fetch that we haven't wired yet. Stays valid for the dropdown selection.
  }
  // Campaign rollup (and IO fallback): use campaigns hook for canonical names,
  // hydrate reach + frequency by summing ad sets matched by campaign name.
  const reachByCamp = new Map<string, { reach: number; impressions: number }>();
  for (const a of adsets) {
    const k = a.campaignName ?? "Unknown";
    const cur = reachByCamp.get(k) ?? { reach: 0, impressions: 0 };
    cur.reach += a.reach || 0; cur.impressions += a.impressions || 0;
    reachByCamp.set(k, cur);
  }
  return campaigns
    .filter(c => c.platform === "meta")
    .map(c => {
      const r = reachByCamp.get(c.name);
      const reach = r?.reach ?? 0;
      return {
        id: c.id, label: c.name,
        ...derive({
          spend: c.spend || 0, impressions: c.impressions || 0, reach,
          clicks: c.clicks || 0, conversions: c.conversions || 0, conversionValue: c.conversionValue || 0,
        }),
      };
    });
}

function totalsOf(rows: GroupRow[]): GroupRow {
  const totals = rows.reduce(
    (s, r) => ({
      spend: s.spend + r.spend, impressions: s.impressions + r.impressions,
      reach: s.reach + r.reach, clicks: s.clicks + r.clicks,
      conversions: s.conversions + r.conversions, conversionValue: s.conversionValue + r.conversionValue,
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  );
  return { id: "__total", label: "Account", ...derive(totals) };
}

// ─── UI components ──────────────────────────────────────────────────────────

// Single-select dropdown with check-mark indicator (Granularity / Group By)
function SelectDropdown<T extends string>({
  value, options, onChange, icon: Icon, label, groupTitle,
}: {
  value: T;
  options: { value: T; label: string; note?: string }[];
  onChange: (v: T) => void;
  icon?: React.ComponentType<{ className?: string }>;
  label?: string;
  groupTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-500" />}
        {label && <span className="text-gray-500">{label}:</span>}
        <span>{current?.label ?? value}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[210px] bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden py-1">
            {groupTitle && <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">{groupTitle}</div>}
            {options.map(o => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 ${o.value === value ? "bg-blue-50 text-blue-700 font-semibold" : ""}`}
              >
                <span className="w-3.5 flex justify-center">
                  {o.value === value && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </span>
                <span className="flex-1">{o.label}</span>
                {o.note && <span className="text-[9px] text-gray-400 italic">{o.note}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Multi-select with rounded checkbox squares (Objective)
function MultiCheckboxDropdown<T extends string>({
  values, options, onChange, icon: Icon, label,
}: {
  values: T[];
  options: { value: T; family: string; cost: string }[];
  onChange: (next: T[]) => void;
  icon?: React.ComponentType<{ className?: string }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const first = options.find(o => o.value === values[0]);
  const display = values.length === 0
    ? "Select…"
    : values.length === 1 && first
      ? `${first.family} · ${first.cost}`
      : `${first?.family ?? ""} · ${first?.cost ?? ""} +${values.length - 1}`;

  const toggle = (v: T) => {
    const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v];
    if (next.length > 0) onChange(next); // keep at least one selected
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-500" />}
        {label && <span className="text-gray-500">{label}:</span>}
        <span>{display}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[240px] bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden py-1">
            {options.map(o => {
              const selected = values.includes(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => toggle(o.value)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2.5 ${selected ? "bg-blue-50/60" : ""}`}
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center transition ${selected ? "bg-blue-600 border border-blue-600" : "border border-gray-300 bg-white"}`}>
                    {selected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="font-medium">{o.family} · {o.cost}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number | null; lowerIsBetter?: boolean }) {
  if (delta === null) return <span className="text-[10px] text-gray-500">—</span>;
  const positive = delta > 0;
  const good = lowerIsBetter ? !positive : positive;
  const color = good ? "text-green-600" : "text-red-600";
  const Arrow = positive ? TrendingUp : TrendingDown;
  const sign = positive ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Arrow className="w-3 h-3" />
      {sign}{delta.toFixed(1)}%
    </span>
  );
}

const KPI_SWAP_GROUPS: { label: string; ids: MetricId[] }[] = [
  { label: "Display",    ids: ["impressions", "reach", "frequency", "cpm"] },
  { label: "Engagement", ids: ["clicks", "ctr", "cpc", "spend"] },
  { label: "Conversion", ids: ["conversions", "conversionValue", "roas", "cpa", "cvr", "aov"] },
];

function PlainEnglishSummary({
  spend, leads, cpl, prevSpend, prevLeads, prevCpl, currency, startDate, endDate,
}: {
  spend: number; leads: number; cpl: number;
  prevSpend: number; prevLeads: number; prevCpl: number;
  currency: string; startDate?: string; endDate?: string;
}) {
  const spendDelta = pctDelta(spend, prevSpend);
  const leadsDelta = pctDelta(leads, prevLeads);
  const cplDelta   = pctDelta(cpl, prevCpl);
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  const rangeLabel = startDate && endDate ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : "the selected period";

  const cplGood = cplDelta !== null && cplDelta < 0;
  const cplBad  = cplDelta !== null && cplDelta > 0;

  const sentence = leads > 0
    ? `You spent ${fmt(spend, "money", currency)} and got ${fmt(leads, "int", currency)} results back. That works out to ${fmt(cpl, "money", currency)} for every result your ads delivered.`
    : `You spent ${fmt(spend, "money", currency)} in this period, but the pixel didn't record any tracked results (purchases, leads, signups). Either tracking isn't firing or the campaigns aren't optimised for a conversion event.`;

  const verdict = leads === 0
    ? null
    : cplDelta === null
      ? "No prior period to compare against yet."
      : cplGood
        ? `Each result is costing ${Math.abs(cplDelta).toFixed(0)}% less than last period — your ads are getting more efficient.`
        : cplBad
          ? `Each result is costing ${Math.abs(cplDelta).toFixed(0)}% more than last period — efficiency has dropped.`
          : "Cost per result is roughly the same as last period.";

  return (
    <div className="bg-gradient-to-br from-blue-50 via-white to-purple-50 rounded-xl border border-blue-100 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">In simpler terms</h3>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Money spent</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(spend, "money", currency)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Total ad budget Meta charged you.
            {spendDelta !== null && (
              <span className={`ml-1 font-semibold ${spendDelta > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                {spendDelta > 0 ? "↑" : "↓"} {Math.abs(spendDelta).toFixed(0)}% vs last period
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Results you got</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(leads, "int", currency)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Purchases, leads, signups & installs your pixel tracked.
            {leadsDelta !== null && (
              <span className={`ml-1 font-semibold ${leadsDelta >= 0 ? "text-emerald-600" : "text-orange-600"}`}>
                {leadsDelta >= 0 ? "↑" : "↓"} {Math.abs(leadsDelta).toFixed(0)}% vs last period
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Cost per result</div>
          <div className={`text-2xl font-bold mt-1 ${cplGood ? "text-emerald-700" : cplBad ? "text-orange-700" : "text-gray-900"}`}>
            {leads > 0 ? fmt(cpl, "money", currency) : "—"}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            What each tracked result effectively cost you.
            {cplDelta !== null && leads > 0 && (
              <span className={`ml-1 font-semibold ${cplGood ? "text-emerald-600" : "text-orange-600"}`}>
                {cplGood ? "↓" : "↑"} {Math.abs(cplDelta).toFixed(0)}% vs last period
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-sm text-gray-700 leading-relaxed bg-white/60 rounded-lg p-3 border border-gray-100">
        <span>{sentence}</span>
        {verdict && <span className="ml-1 text-gray-600">{verdict}</span>}
      </div>
    </div>
  );
}

function KpiCard({ metric, totals, prevTotals, currency }: { metric: MetricId; totals: GroupRow; prevTotals: GroupRow; currency: string }) {
  const def = METRIC_BY_ID.get(metric)!;
  const val = totals[metric];
  const prev = prevTotals[metric];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-1.5">{def.label}</div>
      <div className="text-3xl font-bold text-gray-900 tabular-nums">{fmt(val, def.fmt, currency)}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <DeltaBadge delta={pctDelta(val, prev)} lowerIsBetter={def.lowerIsBetter} />
        <span className="text-[10px] text-gray-500">vs prev.</span>
      </div>
    </div>
  );
}

function KpiSlotPicker({ metrics, onChange }: { metrics: MetricId[]; onChange: (idx: number, m: MetricId) => void }) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSlot === null) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenSlot(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openSlot]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap" ref={ref}>
      {metrics.map((m, i) => {
        const def = METRIC_BY_ID.get(m)!;
        return (
          <div key={i} className="relative">
            <button
              onClick={() => setOpenSlot(openSlot === i ? null : i)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${openSlot === i ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"}`}>
              {def.label}
              <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3.5l3 3 3-3"/></svg>
            </button>
            {openSlot === i && (
              <div className="absolute right-0 top-full mt-1 z-[200] bg-white rounded-xl shadow-xl border border-gray-100 w-48 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wide text-gray-500">Slot {i + 1}</div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {KPI_SWAP_GROUPS.map(g => (
                    <div key={g.label}>
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{g.label}</div>
                      {g.ids.map(id => {
                        const md = METRIC_BY_ID.get(id)!;
                        return (
                          <button key={id} onClick={() => { onChange(i, id); setOpenSlot(null); }}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 transition ${id === m ? "text-blue-600 font-semibold" : "text-gray-700"}`}>
                            {id === m && <svg className="w-3 h-3 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 5l2.5 2.5L8 3"/></svg>}
                            {md.label}
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
      })}
    </div>
  );
}

function GraphCard({
  template, onChangeTemplate, rows, groupBy, currency, loading,
}: {
  template: GraphTemplate;
  onChangeTemplate: (t: GraphTemplate) => void;
  rows: GroupRow[];
  groupBy: GroupBy;
  currency: string;
  loading: boolean;
}) {
  const primary = METRIC_BY_ID.get(template.primary)!;
  const secondary = METRIC_BY_ID.get(template.secondary)!;
  const top10 = useMemo(() => [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, 10), [rows]);
  const leader = useMemo(() => [...top10].sort((a, b) => b[template.primary] - a[template.primary])[0], [top10, template.primary]);

  const headline = leader
    ? `${leader.label.length > 40 ? leader.label.slice(0, 38) + "…" : leader.label} leads — ${fmt(leader[template.primary], primary.fmt, currency)}.`
    : `${primary.label} vs ${secondary.label}`;

  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-bold">{primary.label} vs {secondary.label}</div>
        <div className="relative">
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-700"
          >
            {primary.label} vs {secondary.label}
            <ChevronDown className="w-3 h-3" />
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 z-50 w-[460px] bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-blue-600">Bars (primary) × Line (secondary)</div>
                <div className="grid grid-cols-2 gap-0 max-h-[320px] overflow-y-auto">
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase border-b">Primary</div>
                    {METRICS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => onChangeTemplate({ ...template, primary: m.id })}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${m.id === template.primary ? "bg-blue-50 text-blue-700 font-semibold" : ""}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="border-l">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase border-b">Secondary</div>
                    {METRICS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => { onChangeTemplate({ ...template, secondary: m.id }); setPickerOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${m.id === template.secondary ? "bg-blue-50 text-blue-700 font-semibold" : ""}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="px-4 pb-1">
        <h4 className="text-sm font-bold text-gray-900 leading-snug truncate" title={leader?.label}>{headline}</h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          By {GROUPBY_LABEL[groupBy]} · bars = {primary.label} · line = {secondary.label}
        </p>
      </div>
      <div className="h-[240px] px-2 pb-3 chart-enter">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">Loading…</div>
        ) : top10.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={top10} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="label" stroke="#6b7280" fontSize={9} interval={0}
                axisLine={false} tickLine={false}
                tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)}
              />
              <YAxis yAxisId="left"  stroke="#6366f1" fontSize={10} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => fmt(v, primary.fmt, currency)} />
              <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={10} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => fmt(v, secondary.fmt, currency)} />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, _name: string, item: { dataKey?: string | number }) => {
                  const k = typeof item?.dataKey === "string" ? item.dataKey : "";
                  if (k === template.primary)   return [fmt(value, primary.fmt,   currency), primary.label]   as [string, string];
                  if (k === template.secondary) return [fmt(value, secondary.fmt, currency), secondary.label] as [string, string];
                  return [String(value), k] as [string, string];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              <Bar yAxisId="left" dataKey={template.primary} name={primary.label} fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey={template.secondary} name={secondary.label} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Prev-period ad-set fetch (for reach delta) ─────────────────────────────
function usePrevAdSets(platform: "meta" | "both", dateRange: DateRange, customStart?: string, customEnd?: string) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [adsets, setAdsets] = useState<AdSetRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
  // Calculate prev window
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate   + "T00:00:00Z");
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const prevEnd   = new Date(s.getTime() - 86_400_000).toISOString().slice(0, 10);
  const prevStart = new Date(new Date(prevEnd).getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  useEffect(() => {
    if (platform === "google" as string) return;
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/audience/adset-insights/meta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, businessId: biz, startDate: prevStart, endDate: prevEnd }),
      }).then(r => r.json()).then(d => d.adsets || []),
      fetch("/api/naming/campaigns/meta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, businessId: biz, startDate: prevStart, endDate: prevEnd }),
      }).then(r => r.ok ? r.json() : []),
    ])
      .then(([a, c]) => { if (!cancelled) { setAdsets(a); setCampaigns(c); } })
      .catch(() => { if (!cancelled) { setAdsets([]); setCampaigns([]); } });
    return () => { cancelled = true; };
  }, [platform, prevStart, prevEnd, metaAccessToken, metaBusinessId, demoMode]);

  return { adsets, campaigns, prevStart, prevEnd };
}

// ─── Granularity bucketing ─────────────────────────────────────────────────

function isoWeek(d: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diffDays = (target.getTime() - firstThursday.getTime()) / 86_400_000;
  const week = 1 + Math.round((diffDays - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

function bucketLabel(dateIso: string, gran: Granularity): string {
  const d = new Date(dateIso + "T00:00:00Z");
  if (gran === "hour" || gran === "day") return dateIso;
  if (gran === "week") {
    const { year, week } = isoWeek(d);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (gran === "month")   return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (gran === "quarter") return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${d.getUTCFullYear()}`;
}

interface PerfRow {
  date: string;
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; conversions: number; conversionValue: number;
  ctr: number; cpc: number; cpm: number; cpa: number; roas: number; cvr: number; aov: number;
}

function bucketDaily(
  daily: { label: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }[],
  gran: Granularity,
  adSetsForReach: AdSetRow[],
): PerfRow[] {
  const totalImpressions = daily.reduce((s, r) => s + r.impressions, 0);
  const totalReach = adSetsForReach.reduce((s, a) => s + (a.reach || 0), 0);
  const reachShare = totalImpressions > 0 ? totalReach / totalImpressions : 0;

  const map = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
  for (const d of daily) {
    const key = bucketLabel(d.label, gran);
    const cur = map.get(key) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
    cur.spend += d.spend; cur.impressions += d.impressions; cur.clicks += d.clicks;
    cur.conversions += d.conversions; cur.conversionValue += d.conversionValue;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, base]) => {
      const reach = base.impressions * reachShare;
      return {
        date,
        ...derive({
          spend: base.spend, impressions: base.impressions, reach,
          clicks: base.clicks, conversions: base.conversions, conversionValue: base.conversionValue,
        }),
      };
    });
}

// ─── Performance table ─────────────────────────────────────────────────────

type PerfCol = "impressions" | "reach" | "frequency" | "cpm" | "spend" | "clicks" | "ctr" | "cpc" | "conversions" | "roas" | "cpa" | "cvr" | "aov" | "conversionValue";
const PERF_COLS_BY_OBJECTIVE = (o: ObjectiveDef): PerfCol[] => o.highlights as PerfCol[];

const METRIC_GROUPS: { label: string; ids: PerfCol[] }[] = [
  { label: "Display",    ids: ["impressions", "reach", "frequency", "cpm"] },
  { label: "Engagement", ids: ["clicks", "ctr", "cpc", "spend"] },
  { label: "Conversion", ids: ["conversions", "conversionValue", "roas", "cpa", "cvr", "aov"] },
];

function PerformanceTable({
  rows, prevRows, granularity, currency, columns, onColumnsChange,
}: {
  rows: PerfRow[];
  prevRows?: PerfRow[];
  granularity: Granularity;
  currency: string;
  columns: PerfCol[];
  onColumnsChange: (next: PerfCol[]) => void;
}) {
  const [compareMode, setCompareMode] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const swapRef = useRef<HTMLDivElement>(null);
  const { sorted, sort: perfSort, toggle: perfToggle } = useSort(rows, "date", "asc");

  useEffect(() => {
    if (swapIdx === null) return;
    function h(e: MouseEvent) {
      if (swapRef.current && !swapRef.current.contains(e.target as Node)) setSwapIdx(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const swapCol = (idx: number, newId: PerfCol) => {
    onColumnsChange(columns.map((c, i) => i === idx ? newId : c));
    setSwapIdx(null);
  };

  // Match prev rows to current by position (prev period dates differ from current)
  const sortedWithPrev = useMemo(() => {
    if (!compareMode || !prevRows || prevRows.length === 0) return sorted.map(r => ({ r, prev: null as PerfRow | null }));
    const sortedPrev = [...prevRows].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      return perfSort.dir === "asc" ? cmp : -cmp;
    });
    return sorted.map((r, i) => ({ r, prev: sortedPrev[i] ?? null }));
  }, [sorted, prevRows, compareMode, perfSort.dir]);

  const totals = useMemo(() => {
    if (rows.length === 0) return null;
    const sum = rows.reduce(
      (s, r) => ({ spend: s.spend + r.spend, impressions: s.impressions + r.impressions, reach: s.reach + r.reach, clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions, conversionValue: s.conversionValue + r.conversionValue }),
      { spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0 }
    );
    return derive(sum);
  }, [rows]);

  const prevTotals = useMemo(() => {
    if (!compareMode || !prevRows || prevRows.length === 0) return null;
    const sum = prevRows.reduce(
      (s, r) => ({ spend: s.spend + r.spend, impressions: s.impressions + r.impressions, reach: s.reach + r.reach, clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions, conversionValue: s.conversionValue + r.conversionValue }),
      { spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0 }
    );
    return derive(sum);
  }, [prevRows, compareMode]);

  const granLabel = granularity === "day" ? "day" : granularity === "week" ? "week" : granularity === "month" ? "month" : granularity === "quarter" ? "quarter" : "year";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm" ref={swapRef}>
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold text-gray-900">
          Performance <span className="font-normal text-gray-400 text-xs">({granLabel} buckets · {rows.length} row{rows.length !== 1 ? "s" : ""})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompareMode(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border shadow-sm transition ${compareMode ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
          >
            <GitCompare className="w-3.5 h-3.5" /> Compare {compareMode && <span className="text-[10px] bg-blue-100 rounded px-1">on</span>}
          </button>
          <div className="relative">
            <button
              onClick={() => setColMenuOpen(v => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm"
            >
              <LayersIcon className="w-3.5 h-3.5" /> Columns <span className="ml-0.5 bg-gray-100 text-gray-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">{columns.length}</span>
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Columns</span>
                    <span className="text-[10px] text-gray-500">{columns.length} selected</span>
                  </div>
                  {METRIC_GROUPS.map(g => (
                    <div key={g.label}>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">{g.label}</div>
                      {g.ids.map(id => {
                        const m = METRIC_BY_ID.get(id as MetricId)!;
                        const on = columns.includes(id);
                        return (
                          <button key={id} onClick={() => { const next = on ? columns.filter(c => c !== id) : [...columns, id]; if (next.length > 0) onColumnsChange(next); }}
                            className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-300"}`}>
                              {on && <Check className="w-2.5 h-2.5 text-white" />}
                            </span>
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-[90px] z-20 shadow-sm">
            <tr>
              <SortTh col="date" sort={perfSort} onToggle={perfToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Date</SortTh>
              {columns.map((c, colIdx) => {
                const def = METRIC_BY_ID.get(c as MetricId)!;
                return (
                  <th key={c} className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">
                    <div className="relative inline-flex items-center gap-1 justify-end">
                      <SortTh col={c} sort={perfSort} onToggle={perfToggle} className="text-[11px] uppercase font-semibold text-gray-600" align="right">{def.label}</SortTh>
                      <button onClick={() => setSwapIdx(swapIdx === colIdx ? null : colIdx)}
                        className="text-gray-400 hover:text-gray-700 transition shrink-0 ml-0.5" title="Change column">
                        <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3 3 3-3"/></svg>
                      </button>
                      {swapIdx === colIdx && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white text-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-200">
                          <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-blue-600">Change column</div>
                          <div className="max-h-[500px] overflow-y-auto py-1">
                            {METRIC_GROUPS.map(g => (
                              <div key={g.label}>
                                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">{g.label}</div>
                                {g.ids.map(id => {
                                  const m = METRIC_BY_ID.get(id as MetricId)!;
                                  const isCur = id === c;
                                  return (
                                    <button key={id} onClick={() => !isCur && swapCol(colIdx, id)}
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
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedWithPrev.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">No data for this window.</td></tr>
            ) : sortedWithPrev.map(({ r, prev }) => (
              <tr key={r.date} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-900">
                  {r.date}
                  {compareMode && prev && <div className="text-[10px] text-gray-500 mt-0.5">{prev.date}</div>}
                </td>
                {columns.map(c => {
                  const def = METRIC_BY_ID.get(c as MetricId)!;
                  const delta = compareMode && prev ? pctDelta(r[c], prev[c]) : null;
                  return (
                    <td key={c} className="px-4 py-2.5 text-right tabular-nums">
                      <div className="text-gray-900">{fmt(r[c], def.fmt, currency)}</div>
                      {compareMode && prev && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[10px] text-gray-500">{fmt(prev[c], def.fmt, currency)}</span>
                          {delta !== null && (
                            <span className={`text-[10px] font-semibold ${delta > 0 ? (def.lowerIsBetter ? "text-red-500" : "text-green-600") : delta < 0 ? (def.lowerIsBetter ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {totals && (
              <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                <td className="px-4 py-2.5 text-gray-900">Total / Avg</td>
                {columns.map(c => {
                  const def = METRIC_BY_ID.get(c as MetricId)!;
                  const v = totals[c as keyof typeof totals] as number;
                  const pv = prevTotals ? prevTotals[c as keyof typeof prevTotals] as number : null;
                  const delta = compareMode && pv !== null ? pctDelta(v, pv) : null;
                  return (
                    <td key={c} className="px-4 py-2.5 text-right tabular-nums">
                      <div className="text-gray-900">{fmt(v, def.fmt, currency)}</div>
                      {compareMode && pv !== null && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[10px] text-gray-500">{fmt(pv, def.fmt, currency)}</span>
                          {delta !== null && (
                            <span className={`text-[10px] font-semibold ${delta > 0 ? (def.lowerIsBetter ? "text-red-500" : "text-green-600") : delta < 0 ? (def.lowerIsBetter ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Drill Down — hierarchical Campaign → Ad Set → Ad ──────────────────────

interface DrillNode {
  id: string;
  label: string;
  level: "camp" | "as" | "ad";
  spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
  reach: number; frequency: number;
  ctr: number; cpc: number; cpm: number; cpa: number; roas: number; cvr: number; aov: number;
  children?: DrillNode[];
}

function deriveSimple(r: { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; reach?: number; frequency?: number }) {
  const reach = r.reach ?? 0;
  const frequency = r.frequency ?? (reach > 0 ? r.impressions / reach : 0);
  return {
    ...r,
    reach,
    frequency,
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
  };
}

function buildDrillTree(
  campaigns: CampaignData[],
  adsets: AdSetRow[],
  ads: AdInsightRow[],
  opts: { hideZero: boolean }
): DrillNode[] {
  const adsByAdSet = new Map<string, AdInsightRow[]>();
  for (const ad of ads) {
    const key = (ad.adSetName ?? "").trim().toLowerCase();
    if (!adsByAdSet.has(key)) adsByAdSet.set(key, []);
    adsByAdSet.get(key)!.push(ad);
  }
  const adsetsByCampaign = new Map<string, AdSetRow[]>();
  for (const a of adsets) {
    const key = (a.campaignName ?? "").trim().toLowerCase();
    if (!adsetsByCampaign.has(key)) adsetsByCampaign.set(key, []);
    adsetsByCampaign.get(key)!.push(a);
  }
  const built = campaigns
    .filter(c => c.platform === "meta")
    .map<DrillNode>(c => {
      const campaignAdSets = adsetsByCampaign.get(c.name.trim().toLowerCase()) || [];
      const adsetChildren = campaignAdSets.map<DrillNode>(a => {
        const adChildren = (adsByAdSet.get(a.name.trim().toLowerCase()) || []).map<DrillNode>(ad => ({
          id: ad.id, label: ad.name, level: "ad",
          ...deriveSimple({
            spend: ad.spend, impressions: ad.impressions, clicks: ad.clicks,
            conversions: ad.conversions, conversionValue: ad.conversionValue,
          }),
        }));
        return {
          id: a.id, label: a.name, level: "as",
          ...deriveSimple({
            spend: a.spend, impressions: a.impressions, clicks: a.clicks,
            conversions: a.conversions, conversionValue: a.conversionValue,
            reach: a.reach, frequency: a.frequency,
          }),
          children: adChildren.length ? adChildren : undefined,
        };
      });
      const campReach = campaignAdSets.reduce((s, a) => s + (a.reach || 0), 0);
      return {
        id: c.id, label: c.name, level: "camp",
        ...deriveSimple({
          spend: c.spend || 0, impressions: c.impressions || 0, clicks: c.clicks || 0,
          conversions: c.conversions || 0, conversionValue: c.conversionValue || 0,
          reach: campReach,
        }),
        children: adsetChildren.length ? adsetChildren : undefined,
      };
    });
  return opts.hideZero
    ? built.filter(n => (n.impressions || 0) > 0 || (n.spend || 0) > 0)
    : built;
}

const LEVEL_BADGE: Record<DrillNode["level"], { label: string; bg: string }> = {
  camp: { label: "CAMP", bg: "bg-gray-200 text-gray-700" },
  as:   { label: "AS",   bg: "bg-blue-100 text-blue-700" },
  ad:   { label: "AD",   bg: "bg-emerald-100 text-emerald-700" },
};

type DrillCol = "impressions" | "reach" | "frequency" | "clicks" | "ctr" | "cpm" | "cpc" | "spend" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov";
const DRILL_COL_DEFS: { id: DrillCol; label: string; fmt: "money" | "int" | "pct" | "x" | "decimal" }[] = [
  { id: "impressions",     label: "Impressions", fmt: "int" },
  { id: "reach",           label: "Reach",       fmt: "int" },
  { id: "frequency",       label: "Frequency",   fmt: "decimal" },
  { id: "clicks",          label: "Clicks",      fmt: "int" },
  { id: "ctr",             label: "CTR",         fmt: "pct" },
  { id: "cpm",             label: "CPM",         fmt: "money" },
  { id: "cpc",             label: "CPC",         fmt: "money" },
  { id: "spend",           label: "Spend",       fmt: "money" },
  { id: "conversions",     label: "Conversions", fmt: "int" },
  { id: "conversionValue", label: "Revenue",     fmt: "money" },
  { id: "roas",            label: "ROAS",        fmt: "x" },
  { id: "cpa",             label: "CPA",         fmt: "money" },
  { id: "cvr",             label: "CVR",         fmt: "pct" },
  { id: "aov",             label: "AOV",         fmt: "money" },
];
const DRILL_DEFAULT_COLS: DrillCol[] = ["impressions", "clicks", "ctr", "cpm", "cpc", "spend"];

const DRILL_METRIC_GROUPS: { label: string; ids: DrillCol[] }[] = [
  { label: "Display",    ids: ["impressions", "reach", "frequency", "cpm"] },
  { label: "Engagement", ids: ["clicks", "ctr", "cpc", "spend"] },
  { label: "Conversion", ids: ["conversions", "conversionValue", "roas", "cpa", "cvr", "aov"] },
];

const DRILL_LOWER_IS_BETTER = new Set<DrillCol>(["cpm", "cpc", "cpa", "frequency"]);

function DrillRow({
  node, depth, expanded, toggle, currency, columns, prevNodeMap, compareMode,
}: {
  node: DrillNode; depth: number; expanded: Set<string>; toggle: (id: string) => void; currency: string; columns: DrillCol[];
  prevNodeMap?: Map<string, DrillNode>; compareMode?: boolean;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = !!node.children && node.children.length > 0;
  const badge = LEVEL_BADGE[node.level];
  const prev = (compareMode && prevNodeMap) ? (prevNodeMap.get(node.id) ?? null) : null;
  return (
    <>
      <tr className={`border-b border-gray-100 hover:bg-gray-50 ${depth === 0 ? "" : "bg-gray-50/30"}`}>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
            <button
              onClick={() => hasChildren && toggle(node.id)}
              className={`w-5 h-5 flex items-center justify-center rounded ${hasChildren ? "hover:bg-gray-200 text-gray-500" : "text-transparent cursor-default"}`}
            >
              {hasChildren && (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />)}
            </button>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge.bg}`}>{badge.label}</span>
            <span className="text-xs font-medium text-gray-900 truncate max-w-[320px]" title={node.label}>{node.label}</span>
          </div>
        </td>
        {columns.map(c => {
          const def = DRILL_COL_DEFS.find(d => d.id === c)!;
          const lib = DRILL_LOWER_IS_BETTER.has(c);
          const delta = prev ? pctDelta(node[c], prev[c]) : null;
          return (
            <td key={c} className={`px-3 py-2.5 text-right text-xs tabular-nums ${c === "spend" ? "font-semibold" : ""} text-gray-900`}>
              <div>{fmt(node[c], def.fmt, currency)}</div>
              {compareMode && prev && (
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className="text-[10px] text-gray-500">{fmt(prev[c], def.fmt, currency)}</span>
                  {delta !== null && (
                    <span className={`text-[10px] font-semibold ${delta > 0 ? (lib ? "text-red-500" : "text-green-600") : delta < 0 ? (lib ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </td>
          );
        })}
      </tr>
      {isOpen && hasChildren && node.children!.map(child => (
        <DrillRow key={child.id} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} currency={currency} columns={columns} prevNodeMap={prevNodeMap} compareMode={compareMode} />
      ))}
    </>
  );
}

function DrillTable({
  nodes, prevNodes, currency, groupBy, hideZero, onToggleHideZero, totalCount,
}: {
  nodes: DrillNode[]; prevNodes?: DrillNode[]; currency: string; groupBy: GroupBy;
  hideZero: boolean; onToggleHideZero: () => void; totalCount: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const [columns, setColumns] = useState<DrillCol[]>(DRILL_DEFAULT_COLS);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const swapRef = useRef<HTMLDivElement>(null);
  const { sorted: sortedNodes, sort: drillSort, toggle: drillToggle } = useSort(nodes, "impressions", "desc");

  useEffect(() => {
    if (swapIdx === null) return;
    function h(e: MouseEvent) {
      if (swapRef.current && !swapRef.current.contains(e.target as Node)) setSwapIdx(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const swapCol = (idx: number, newId: DrillCol) => {
    setColumns(prev => prev.map((c, i) => i === idx ? newId : c));
    setSwapIdx(null);
  };

  // Flat map id→DrillNode (includes all levels) for prev-period lookup
  const prevNodeMap = useMemo(() => {
    const map = new Map<string, DrillNode>();
    function walk(ns: DrillNode[]) {
      for (const n of ns) { map.set(n.id, n); if (n.children) walk(n.children); }
    }
    if (prevNodes) walk(prevNodes);
    return map;
  }, [prevNodes]);

  const hiddenCount = totalCount - nodes.length;

  const toggleCol = (c: DrillCol) =>
    setColumns(prev => prev.includes(c) ? (prev.length > 1 ? prev.filter(x => x !== c) : prev) : [...prev, c]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Drill Down</h2>
        <p className="text-xs text-gray-500 mt-0.5">Hierarchical expand: Campaign → Insertion Order → Line Item → Placement → Ad. <span className="italic text-gray-400">(Meta: Campaign → Ad Set → Ad)</span></p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm" ref={swapRef}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <LayersIcon className="w-4 h-4 text-gray-500" />
            Drill — {GROUPBY_LABEL[groupBy]}
            <span className="font-normal text-gray-400 text-xs">
              (click a row to expand · {nodes.length} row{nodes.length !== 1 ? "s" : ""}
              {hideZero && hiddenCount > 0 && <> · {hiddenCount} hidden with 0 impr</>})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleHideZero}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border shadow-sm ${hideZero ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              <span className={`w-3 h-3 rounded ${hideZero ? "bg-blue-600" : "border border-gray-400 bg-white"} flex items-center justify-center`}>
                {hideZero && <Check className="w-2.5 h-2.5 text-white" />}
              </span>
              Hide 0-impr
            </button>
            <button
              onClick={() => setCompareMode(v => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border shadow-sm transition ${compareMode ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              <GitCompare className="w-3.5 h-3.5" /> Compare {compareMode && <span className="text-[10px] bg-blue-100 rounded px-1">on</span>}
            </button>
            <div className="relative">
              <button
                onClick={() => setColMenuOpen(v => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm"
              >
                <LayersIcon className="w-3.5 h-3.5" /> Columns <span className="ml-0.5 bg-gray-100 text-gray-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">{columns.length}</span>
              </button>
              {colMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Columns</span>
                      <button onClick={() => setColumns(DRILL_DEFAULT_COLS)} className="text-[10px] text-gray-500 hover:text-white">Reset</button>
                    </div>
                    {DRILL_METRIC_GROUPS.map(g => (
                      <div key={g.label}>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">{g.label}</div>
                        {g.ids.map(id => {
                          const def = DRILL_COL_DEFS.find(d => d.id === id)!;
                          const on = columns.includes(id);
                          return (
                            <button key={id} onClick={() => toggleCol(id)}
                              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-300"}`}>
                                {on && <Check className="w-2.5 h-2.5 text-white" />}
                              </span>
                              {def.label}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-500">{columns.length} selected</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-[90px] z-20 shadow-sm">
              <tr>
                <SortTh col="label" sort={drillSort} onToggle={drillToggle} className="px-3 py-2 text-[11px] uppercase font-semibold text-gray-600">{GROUPBY_LABEL[groupBy]}</SortTh>
                {columns.map((c, colIdx) => {
                  const def = DRILL_COL_DEFS.find(d => d.id === c)!;
                  return (
                    <th key={c} className="px-3 py-2 text-right text-[11px] font-semibold text-gray-600 whitespace-nowrap">
                      <div className="relative inline-flex items-center gap-1 justify-end">
                        <SortTh col={c} sort={drillSort} onToggle={drillToggle} className="text-[11px] uppercase font-semibold text-gray-600" align="right">{def.label}</SortTh>
                        <button onClick={() => setSwapIdx(swapIdx === colIdx ? null : colIdx)}
                          className="text-gray-400 hover:text-gray-700 transition shrink-0 ml-0.5" title="Change column">
                          <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3 3 3-3"/></svg>
                        </button>
                        {swapIdx === colIdx && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white text-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-200">
                            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-blue-600">Change column</div>
                            <div className="max-h-[500px] overflow-y-auto py-1">
                              {DRILL_METRIC_GROUPS.map(g => (
                                <div key={g.label}>
                                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">{g.label}</div>
                                  {g.ids.map(id => {
                                    const m = DRILL_COL_DEFS.find(d => d.id === id)!;
                                    const isCur = id === c;
                                    return (
                                      <button key={id} onClick={() => !isCur && swapCol(colIdx, id)}
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
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedNodes.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-sm text-gray-500">No data.</td></tr>
              ) : sortedNodes.map(n => (
                <DrillRow key={n.id} node={n} depth={0} expanded={expanded} toggle={toggle} currency={currency} columns={columns} prevNodeMap={prevNodeMap} compareMode={compareMode} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Ad insights fetch (for Drill Down's bottom level) ─────────────────────
function useAdInsightsFetch(platform: "meta" | "both", dateRange: DateRange, customStart?: string, customEnd?: string) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [ads, setAds] = useState<AdInsightRow[]>([]);
  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (platform === "google" as string) return;
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) return;
    let cancelled = false;
    fetch("/api/reporting/ad-insights/meta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, startDate, endDate, limit: 100 }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ads) setAds(d.ads); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [platform, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  return ads;
}

// ─── Main component ────────────────────────────────────────────────────────

export default function KeyMetricAnalysisReport({ platform, dateRange, customStart, customEnd }: Props) {
  const effective: "meta" | "both" = platform === "google" ? "meta" : platform;

  const { campaigns: campaignsCur, startDate, endDate } = useCampaigns(effective, dateRange, customStart, customEnd);
  const { adsets: adsetsCur, loading: loadingCur, currency } = useAdSetInsights(effective, dateRange, customStart, customEnd);
  const { adsets: adsetsPrev, campaigns: campaignsPrev, prevStart, prevEnd } = usePrevAdSets(effective, dateRange, customStart, customEnd);
  const { current: daily, previous: dailyPrev } = useMetaDailyVsPrev(effective, dateRange, customStart, customEnd);
  const ads = useAdInsightsFetch(effective, dateRange, customStart, customEnd);

  const [objectiveIds, setObjectiveIds] = useState<ObjectiveId[]>(["awareness_cpm"]);
  const primaryObjective = OBJECTIVE_BY_ID.get(objectiveIds[0])!;
  const [granularity, setGranularity] = usePersistentValue<Granularity>("key-metrics-granularity", "week");
  const [groupBy, setGroupBy] = usePersistentValue<GroupBy>("key-metrics-groupby", "campaigns");
  const [campaignFilter, setCampaignFilter] = useState<string[]>([]); // empty = all

  // Apply campaign filter to ad sets + campaigns lists used downstream.
  const filteredCampaignsCur = useMemo(
    () => campaignFilter.length === 0 ? campaignsCur : campaignsCur.filter(c => campaignFilter.includes(c.id)),
    [campaignsCur, campaignFilter]
  );
  const filteredAdsetsCur = useMemo(() => {
    if (campaignFilter.length === 0) return adsetsCur;
    const allowedNames = new Set(campaignsCur.filter(c => campaignFilter.includes(c.id)).map(c => c.name));
    return adsetsCur.filter(a => a.campaignName && allowedNames.has(a.campaignName));
  }, [adsetsCur, campaignsCur, campaignFilter]);

  const rowsCur  = useMemo(() => buildGroupRows(filteredAdsetsCur, filteredCampaignsCur, groupBy), [filteredAdsetsCur, filteredCampaignsCur, groupBy]);
  const rowsPrev = useMemo(() => buildGroupRows(adsetsPrev, campaignsPrev, groupBy), [adsetsPrev, campaignsPrev, groupBy]);

  const totalsCur  = useMemo(() => totalsOf(rowsCur),  [rowsCur]);
  const totalsPrev = useMemo(() => totalsOf(rowsPrev), [rowsPrev]);

  // Persisted per (account, objective) — switching objective still shows that
  // objective's own saved highlight picks (or its defaults on first visit).
  const [highlightMetrics, setHighlightMetrics] = usePersistentColumns<MetricId>(
    `key-metrics-highlights:${objectiveIds[0]}`,
    primaryObjective.highlights
  );
  const [templates, setTemplates] = useState<GraphTemplate[]>(primaryObjective.templates);

  // Re-sync templates if objective changes (only when user hasn't customised).
  const [customized, setCustomized] = useState<Set<number>>(new Set());
  useEffect(() => {
    const next = OBJECTIVE_BY_ID.get(objectiveIds[0])!.templates;
    setTemplates(prev => prev.map((t, i) => customized.has(i) ? t : next[i]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectiveIds]);

  function setSlot(idx: number, t: GraphTemplate) {
    setTemplates(prev => prev.map((cur, i) => i === idx ? t : cur));
    setCustomized(prev => { const next = new Set(prev); next.add(idx); return next; });
  }

  // Performance table: bucket daily data per granularity, columns follow objective highlights
  const perfRows = useMemo(() => bucketDaily(daily, granularity, filteredAdsetsCur), [daily, granularity, filteredAdsetsCur]);
  const prevPerfRows = useMemo(() => bucketDaily(dailyPrev, granularity, adsetsPrev), [dailyPrev, granularity, adsetsPrev]);
  const [perfCols, setPerfCols] = useState<PerfCol[]>(PERF_COLS_BY_OBJECTIVE(primaryObjective));
  useEffect(() => { setPerfCols(PERF_COLS_BY_OBJECTIVE(OBJECTIVE_BY_ID.get(objectiveIds[0])!)); }, [objectiveIds]);

  // Drill tree — hide-zero filter on by default so the table doesn't drown in inactive campaigns
  const [hideZero, setHideZero] = useState(true);
  const drillTreeFull = useMemo(
    () => buildDrillTree(filteredCampaignsCur, filteredAdsetsCur, ads, { hideZero: false }),
    [filteredCampaignsCur, filteredAdsetsCur, ads]
  );
  const drillTree = useMemo(
    () => hideZero ? drillTreeFull.filter(n => (n.impressions || 0) > 0 || (n.spend || 0) > 0) : drillTreeFull,
    [drillTreeFull, hideZero]
  );

  const prevDrillTree = useMemo(
    () => buildDrillTree(campaignsPrev, adsetsPrev, [], { hideZero: false }),
    [campaignsPrev, adsetsPrev]
  );

  return (
    <div className="space-y-5 section-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Megaphone className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Key Metric Analysis</h1>
            <p className="text-gray-600 mt-1 text-sm">Objective-driven highlights · customizable graphs · drill all the way to ads.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Key Metric Analysis"
          context={{
            window: `${startDate} → ${endDate}`,
            prev: `${prevStart} → ${prevEnd}`,
            objectives: objectiveIds.map(id => `${OBJECTIVE_BY_ID.get(id)!.family} · ${OBJECTIVE_BY_ID.get(id)!.cost}`),
            groupBy: GROUPBY_LABEL[groupBy],
            granularity: GRAN_LABEL[granularity],
            campaignFilterCount: campaignFilter.length,
            totals: { impressions: totalsCur.impressions, reach: totalsCur.reach, spend: totalsCur.spend, cpm: totalsCur.cpm },
          }}
          platform="meta"
          inline
        />
      </div>

      {/* FilterBar */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 border-b border-gray-200 bg-white/90 backdrop-blur space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <MultiCheckboxDropdown<ObjectiveId>
            values={objectiveIds}
            onChange={setObjectiveIds}
            icon={Target}
            label="Objective"
            options={OBJECTIVES.map(o => ({ value: o.id, family: o.family, cost: o.cost }))}
          />
          <SelectDropdown<Granularity>
            value={granularity}
            onChange={setGranularity}
            icon={Clock}
            options={(Object.keys(GRAN_LABEL) as Granularity[]).map(g => ({ value: g, label: GRAN_LABEL[g] }))}
          />
          <SelectDropdown<GroupBy>
            value={groupBy}
            onChange={setGroupBy}
            icon={LayoutGrid}
            groupTitle="Analysis Type"
            options={(Object.keys(GROUPBY_LABEL) as GroupBy[]).map(g => ({
              value: g,
              label: GROUPBY_LABEL[g],
              note: GROUPBY_NOTE[g],
            }))}
          />
        </div>
        <CampaignMultiPicker
          options={campaignsCur.filter(c => c.platform === "meta").map(c => ({ id: c.id, name: c.name }))}
          values={campaignFilter}
          onChange={setCampaignFilter}
        />
      </div>

      {/* Plain-English Summary */}
      <PlainEnglishSummary
        spend={totalsCur.spend}
        leads={totalsCur.conversions}
        cpl={totalsCur.cpa}
        prevSpend={totalsPrev.spend}
        prevLeads={totalsPrev.conversions}
        prevCpl={totalsPrev.cpa}
        currency={currency}
        startDate={startDate}
        endDate={endDate}
      />

      {/* Highlights section */}
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-gray-900">Highlights</h2>
          <p className="text-xs text-gray-500 mt-0.5">Key metrics for the chosen objective. Pick objectives in the filter bar above.</p>
        </div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Highlights</h3>
          <KpiSlotPicker
            metrics={highlightMetrics}
            onChange={(idx, next) => setHighlightMetrics(prev => prev.map((x, j) => j === idx ? next : x))}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {highlightMetrics.map((m, i) => (
            <div key={`${m}-${i}`} className={`animate-fade-in-up stagger-${Math.min(i + 1, 9)}`}>
              <KpiCard
                metric={m}
                totals={totalsCur}
                prevTotals={totalsPrev}
                currency={currency}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Performance Reports section */}
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-gray-900">Performance Reports</h2>
          <p className="text-xs text-gray-500 mt-0.5">Top performers per analysis type — change any chart from the dropdown on its card.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {templates.map((t, idx) => (
            <GraphCard
              key={idx}
              template={t}
              onChangeTemplate={(next) => setSlot(idx, next)}
              rows={rowsCur}
              groupBy={groupBy}
              currency={currency}
              loading={loadingCur}
            />
          ))}
        </div>
      </div>

      {/* Performance bucketed table */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-gray-900">Performance</h2>
        <PerformanceTable
          rows={perfRows}
          prevRows={prevPerfRows}
          granularity={granularity}
          currency={currency}
          columns={perfCols}
          onColumnsChange={setPerfCols}
        />
      </div>

      {/* Drill down */}
      <DrillTable
        nodes={drillTree}
        prevNodes={prevDrillTree}
        currency={currency}
        groupBy={groupBy}
        hideZero={hideZero}
        onToggleHideZero={() => setHideZero(v => !v)}
        totalCount={drillTreeFull.length}
      />

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Key Metric Analysis uses Meta insights — switch Platform to Meta or Both for data.
        </div>
      )}

      <TabSummaryFooter
        tabName="Key Metric Analysis"
        lines={[
          `${filteredCampaignsCur.length} campaign${filteredCampaignsCur.length !== 1 ? "s" : ""} analysed (${campaignFilter.length > 0 ? `${campaignFilter.length} filtered` : "all campaigns"}) · ${GROUPBY_LABEL[groupBy]} grouping.`,
          `Total impressions: ${fmt(totalsCur.impressions, "int", currency)} · Spend: ${fmt(totalsCur.spend, "money", currency)} · CPM: ${fmt(totalsCur.cpm, "money", currency)}.`,
          `Date window: ${startDate} → ${endDate}.`,
        ]}
        context={{
          campaignCount: filteredCampaignsCur.length,
          totalSpend: totalsCur.spend,
          totalImpressions: totalsCur.impressions,
          groupBy,
          startDate,
          endDate,
          campaigns: filteredCampaignsCur.map(c => ({
            name: c.name,
            status: c.status,
            spend: c.spend ?? 0,
            impressions: c.impressions ?? 0,
            clicks: c.clicks ?? 0,
            conversions: c.conversions ?? 0,
            conversionValue: c.conversionValue ?? 0,
            roas: (c.spend ?? 0) > 0 ? +((c.conversionValue ?? 0) / (c.spend ?? 1)).toFixed(4) : 0,
          })),
        }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
