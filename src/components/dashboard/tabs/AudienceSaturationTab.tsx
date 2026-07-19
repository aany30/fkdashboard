/**
 * Campaign → Saturation (doc §7, §8)
 *
 * §7 Audience Saturation  — frequency, CTR, CPM, reach%, fatigue score per ad set.
 * §8 Expansion Opportunity — spend share%, revenue share%, ROAS, opportunity score.
 *
 * Both use ad-set insights (frequency + reach available from Meta Insights API).
 */

import { useMemo, useState, useRef } from "react";
import { Zap, AlertCircle, Info, X } from "lucide-react";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { useDV360Saturation } from "@/hooks/useDV360Saturation";
import type { DV360SaturationRow } from "@/pages/api/audience/dv360-saturation";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import { ColumnPickerButton, ALL_STANDARD_KPIS, type ColDef } from "@/components/shared/ColumnPicker";
import { formatStandardKpi, FETCHABLE_KPIS } from "@/lib/standard-kpis";
import { usePersistentColumns } from "@/hooks/useColumnPrefs";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "saturation", label: "Saturation",          desc: "Frequency, reach%, fatigue score (§7)" },
  { id: "expansion",  label: "Expansion Opportunity", desc: "Spend share vs ROAS opportunity (§8)" },
];

// ─── Fatigue score & status ─────────────────────────────────────────────────

function fatigueLabel(freq: number, ctr: number): { label: string; color: string } {
  if (freq >= 5 || ctr < 0.5)  return { label: "Critical", color: "bg-red-100 text-red-800" };
  if (freq >= 3 || ctr < 1.0)  return { label: "Fatigued",  color: "bg-orange-100 text-orange-800" };
  return { label: "Healthy", color: "bg-green-100 text-green-800" };
}
function fatigueSeverity(freq: number, ctr: number): number {
  if (freq >= 5 || ctr < 0.5) return 2;
  if (freq >= 3 || ctr < 1.0) return 1;
  return 0;
}

// ─── Generic column picker ───────────────────────────────────────────────────

interface LocalColDef { id: string; label: string; group: string; defaultOn: boolean; }

function ColPicker({ cols, setCols, allCols }: {
  cols: string[]; setCols: (c: string[]) => void; allCols: LocalColDef[]; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const defaultIds = allCols.filter(c => c.defaultOn).map(c => c.id);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };
  return (
    <ColumnPickerButton
      cols={cols}
      allDefs={FETCHABLE_KPIS}
      defaultIds={defaultIds}
      pickerOpen={open}
      setPickerOpen={setOpen}
      pickerRef={ref}
      toggleCol={toggleCol}
      resetCols={(ids) => setCols([...ids])}
    />
  );
}

// ─── §7 Saturation ──────────────────────────────────────────────────────────

const SAT_ALL_COLS: LocalColDef[] = [
  { id: "frequency",       label: "Freq.",       group: "Engagement",  defaultOn: true  },
  { id: "ctr",             label: "CTR",         group: "Engagement",  defaultOn: true  },
  { id: "cpc",             label: "CPC",         group: "Engagement",  defaultOn: false },
  { id: "clicks",          label: "Clicks",      group: "Engagement",  defaultOn: false },
  { id: "cpm",             label: "CPM",         group: "Reach",       defaultOn: true  },
  { id: "reach",           label: "Reach",       group: "Reach",       defaultOn: true  },
  { id: "reachPct",        label: "Reach %",     group: "Reach",       defaultOn: true  },
  { id: "impressions",     label: "Impr.",       group: "Reach",       defaultOn: false },
  { id: "spend",           label: "Spend",       group: "Conversion",  defaultOn: true  },
  { id: "conversionValue", label: "Revenue",     group: "Conversion",  defaultOn: true  },
  { id: "conversions",     label: "Orders",      group: "Conversion",  defaultOn: true  },
  { id: "roas",            label: "ROAS",        group: "Conversion",  defaultOn: true  },
  { id: "cpa",             label: "CPA",         group: "Conversion",  defaultOn: true  },
  { id: "cvr",             label: "CVR",         group: "Conversion",  defaultOn: false },
  { id: "aov",             label: "AOV",         group: "Conversion",  defaultOn: false },
];
const SAT_DEFAULT_COLS = SAT_ALL_COLS.filter(c => c.defaultOn).map(c => c.id);

function SaturationAnalysis({ adsets, loading, currency }: { adsets: ReturnType<typeof useAdSetInsights>["adsets"]; loading: boolean; currency: string }) {
  const [cols, setCols] = usePersistentColumns("sat", SAT_DEFAULT_COLS);
  const cur = (n: number) => formatMoney(n, currency, 0);
  const cur2 = (n: number) => formatMoney(n, currency, 2);

  const totalReach = useMemo(() => adsets.reduce((s, a) => s + a.reach, 0), [adsets]);
  const enriched = useMemo(() => adsets.map((a) => ({
    ...a,
    ctr:      a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
    cpm:      a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    reachPct: totalReach > 0 ? (a.reach / totalReach) * 100 : 0,
    cpc:      a.clicks > 0 ? a.spend / a.clicks : 0,
    roas:     a.spend > 0 ? a.conversionValue / a.spend : 0,
    cpa:      a.conversions > 0 ? a.spend / a.conversions : 0,
    cvr:      a.clicks > 0 ? (a.conversions / a.clicks) * 100 : 0,
    aov:      a.conversions > 0 ? a.conversionValue / a.conversions : 0,
    fatigue:  0, // set below
  })).map(a => ({ ...a, fatigue: fatigueSeverity(a.frequency, a.ctr) })), [adsets, totalReach]);

  const { sorted, sort: satSort, toggle: satToggle } = useSort(enriched, "frequency", "desc");

  if (loading) return <LoadingState message="Loading saturation data…" />;
  if (!adsets.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  const critical = sorted.filter(a => a.fatigue === 2).length;

  function fmtCol(id: string, a: typeof enriched[0]): string {
    switch (id) {
      case "frequency":       return a.frequency.toFixed(1);
      case "ctr":             return a.ctr > 0 ? `${a.ctr.toFixed(2)}%` : "—";
      case "cpm":             return a.cpm > 0 ? cur(a.cpm) : "—";
      case "reach":           return Math.round(a.reach).toLocaleString("en-IN");
      case "reachPct":        return a.reachPct > 0 ? `${a.reachPct.toFixed(1)}%` : "—";
      case "spend":           return cur(a.spend);
      case "impressions":     return Math.round(a.impressions).toLocaleString("en-IN");
      case "clicks":          return Math.round(a.clicks).toLocaleString("en-IN");
      case "cpc":             return a.cpc > 0 ? cur2(a.cpc) : "—";
      case "conversions":     return Math.round(a.conversions).toLocaleString("en-IN");
      case "roas":            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : "—";
      case "cpa":             return a.cpa > 0 ? cur(a.cpa) : "—";
      case "cvr":             return a.cvr > 0 ? `${a.cvr.toFixed(2)}%` : "—";
      case "aov":             return a.aov > 0 ? cur(a.aov) : "—";
      case "conversionValue": return cur(a.conversionValue);
      default:                return formatStandardKpi(a, id, currency);
    }
  }

  const thBase = "px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600";

  return (
    <div className="space-y-4">
      {critical > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <strong>{critical} ad set{critical !== 1 ? "s" : ""} showing critical fatigue</strong> — frequency ≥ 5 or CTR &lt; 0.5%. Consider refreshing creatives or expanding audiences.
        </div>
      )}
      <div className="flex justify-end">
        <ColPicker cols={cols} setCols={setCols} allCols={SAT_ALL_COLS} />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="name" sort={satSort} onToggle={satToggle} className={`${thBase} sticky left-0 bg-gray-50 z-20 shadow-[1px_0_0_0_rgb(229,231,235)]`}>Audience (Ad Set)</SortTh>
              {cols.map(id => {
                const def = SAT_ALL_COLS.find(c => c.id === id) ?? ALL_STANDARD_KPIS.find(c => c.id === id);
                return <SortTh key={id} col={id} sort={satSort} onToggle={satToggle} className={thBase} align="right">{def?.label ?? id}</SortTh>;
              })}
              <SortTh col="fatigue" sort={satSort} onToggle={satToggle} className={`${thBase} text-center`} align="center">Status</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const { label, color } = fatigueLabel(a.frequency, a.ctr);
              return (
                <tr key={a.id} className="group border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900 break-words min-w-[200px] sticky left-0 bg-white group-hover:bg-gray-50 z-10 shadow-[1px_0_0_0_rgb(229,231,235)]">{a.name}</td>
                  {cols.map(id => (
                    <td key={id} className={`px-4 py-2.5 text-right text-gray-700 whitespace-nowrap ${id === "frequency" ? (a.frequency >= 5 ? "text-red-600 font-bold" : a.frequency >= 3 ? "text-orange-600 font-bold" : "text-gray-900 font-bold") : ""}`}>
                      {fmtCol(id, a)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    {label !== "Healthy" && (
                      <div className="mt-1">
                        <AIRecommendationButton
                          metric={`Audience fatigue — ${a.name}`}
                          value={a.frequency}
                          status={label === "Critical" ? "critical" : "warn"}
                          platform="meta"
                          auditContext={{ module: "Audience Saturation", siblingMetrics: { frequency: a.frequency, ctr: +a.ctr.toFixed(2), cpm: +a.cpm.toFixed(2) } }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Fatigue thresholds: Frequency ≥ 5 or CTR &lt; 0.5% → Critical · Frequency ≥ 3 or CTR &lt; 1% → Fatigued. Reach % = ad set reach as a share of total account reach.
      </p>
    </div>
  );
}

// ─── §8 Expansion Opportunity ───────────────────────────────────────────────

type OpportunityLabel = "Scale up" | "Maintain" | "Review" | "Reduce";

function opportunityLabel(roas: number, spendSharePct: number): { label: OpportunityLabel; color: string } {
  if (roas >= 3 && spendSharePct < 20) return { label: "Scale up", color: "bg-green-100 text-green-800" };
  if (roas >= 2 && spendSharePct < 30) return { label: "Maintain",  color: "bg-blue-100 text-blue-800" };
  if (roas < 1)                         return { label: "Reduce",    color: "bg-red-100 text-red-800" };
  return { label: "Review", color: "bg-yellow-100 text-yellow-800" };
}
function opportunityScore(label: OpportunityLabel): number {
  return { "Scale up": 3, "Maintain": 2, "Review": 1, "Reduce": 0 }[label];
}

const EXP_ALL_COLS: LocalColDef[] = [
  { id: "spend",           label: "Spend",       group: "Core",       defaultOn: true  },
  { id: "spendPct",        label: "Spend %",     group: "Core",       defaultOn: true  },
  { id: "conversionValue", label: "Revenue",     group: "Core",       defaultOn: true  },
  { id: "revPct",          label: "Rev %",       group: "Core",       defaultOn: true  },
  { id: "roas",            label: "ROAS",        group: "Core",       defaultOn: true  },
  { id: "conversions",     label: "Orders",      group: "Conversion", defaultOn: true  },
  { id: "cpa",             label: "CPA",         group: "Conversion", defaultOn: true  },
  { id: "cvr",             label: "CVR",         group: "Conversion", defaultOn: false },
  { id: "aov",             label: "AOV",         group: "Conversion", defaultOn: false },
  { id: "frequency",       label: "Freq.",       group: "Engagement", defaultOn: false },
  { id: "ctr",             label: "CTR",         group: "Engagement", defaultOn: false },
  { id: "cpc",             label: "CPC",         group: "Engagement", defaultOn: false },
  { id: "clicks",          label: "Clicks",      group: "Engagement", defaultOn: false },
  { id: "cpm",             label: "CPM",         group: "Reach",      defaultOn: false },
  { id: "reach",           label: "Reach",       group: "Reach",      defaultOn: false },
  { id: "impressions",     label: "Impr.",       group: "Reach",      defaultOn: false },
];
const EXP_DEFAULT_COLS = EXP_ALL_COLS.filter(c => c.defaultOn).map(c => c.id);

function ExpansionOpportunity({ adsets, loading, currency }: { adsets: ReturnType<typeof useAdSetInsights>["adsets"]; loading: boolean; currency: string }) {
  const [cols, setCols] = usePersistentColumns("sat-exp", EXP_DEFAULT_COLS);
  const cur = (n: number) => formatMoney(n, currency, 0);
  const cur2 = (n: number) => formatMoney(n, currency, 2);

  const totalSpend   = useMemo(() => adsets.reduce((s, a) => s + a.spend, 0), [adsets]);
  const totalRevenue = useMemo(() => adsets.reduce((s, a) => s + a.conversionValue, 0), [adsets]);
  const enriched = useMemo(() => adsets.map((a) => {
    const spendPct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
    const revPct   = totalRevenue > 0 ? (a.conversionValue / totalRevenue) * 100 : 0;
    const roas     = a.spend > 0 ? a.conversionValue / a.spend : 0;
    const ctr      = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
    const cpm      = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
    const cpc      = a.clicks > 0 ? a.spend / a.clicks : 0;
    const cpa      = a.conversions > 0 ? a.spend / a.conversions : 0;
    const cvr      = a.clicks > 0 ? (a.conversions / a.clicks) * 100 : 0;
    const aov      = a.conversions > 0 ? a.conversionValue / a.conversions : 0;
    return { ...a, spendPct, revPct, roas, ctr, cpm, cpc, cpa, cvr, aov, oppScore: opportunityScore(opportunityLabel(roas, spendPct).label) };
  }), [adsets, totalSpend, totalRevenue]);

  const { sorted, sort: expSort, toggle: expToggle } = useSort(enriched, "spend", "desc");

  if (loading) return <LoadingState message="Loading saturation data…" />;
  if (!adsets.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  const scaleUp = sorted.filter(a => opportunityLabel(a.roas, a.spendPct).label === "Scale up").length;

  function fmtCol(id: string, a: typeof enriched[0]): string {
    switch (id) {
      case "spend":           return cur(a.spend);
      case "spendPct":        return `${a.spendPct.toFixed(1)}%`;
      case "conversionValue": return cur(a.conversionValue);
      case "revPct":          return `${a.revPct.toFixed(1)}%`;
      case "roas":            return a.roas > 0 ? `${a.roas.toFixed(2)}×` : "—";
      case "conversions":     return Math.round(a.conversions).toLocaleString("en-IN");
      case "cpa":             return a.cpa > 0 ? cur(a.cpa) : "—";
      case "cvr":             return a.cvr > 0 ? `${a.cvr.toFixed(2)}%` : "—";
      case "aov":             return a.aov > 0 ? cur(a.aov) : "—";
      case "frequency":       return a.frequency.toFixed(1);
      case "ctr":             return a.ctr > 0 ? `${a.ctr.toFixed(2)}%` : "—";
      case "cpc":             return a.cpc > 0 ? cur2(a.cpc) : "—";
      case "clicks":          return Math.round(a.clicks).toLocaleString("en-IN");
      case "cpm":             return a.cpm > 0 ? cur(a.cpm) : "—";
      case "reach":           return Math.round(a.reach).toLocaleString("en-IN");
      case "impressions":     return Math.round(a.impressions).toLocaleString("en-IN");
      default:                return formatStandardKpi(a, id, currency);
    }
  }

  const thBase = "px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600";

  return (
    <div className="space-y-4">
      {scaleUp > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-xs text-green-800">
          <Info className="w-4 h-4 shrink-0" />
          <strong>{scaleUp} ad set{scaleUp !== 1 ? "s" : ""} flagged for scaling</strong> — high ROAS with low spend share. Increase budget here.
        </div>
      )}
      <div className="flex justify-end">
        <ColPicker cols={cols} setCols={setCols} allCols={EXP_ALL_COLS} />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="name" sort={expSort} onToggle={expToggle} className={`${thBase} sticky left-0 bg-gray-50 z-20 shadow-[1px_0_0_0_rgb(229,231,235)]`}>Audience (Ad Set)</SortTh>
              {cols.map(id => {
                const def = EXP_ALL_COLS.find(c => c.id === id) ?? ALL_STANDARD_KPIS.find(c => c.id === id);
                return <SortTh key={id} col={id} sort={expSort} onToggle={expToggle} className={thBase} align="right">{def?.label ?? id}</SortTh>;
              })}
              <SortTh col="oppScore" sort={expSort} onToggle={expToggle} className={`${thBase} text-center`} align="center">Opportunity</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const { label, color } = opportunityLabel(a.roas, a.spendPct);
              return (
                <tr key={a.id} className="group border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900 break-words min-w-[200px] sticky left-0 bg-white group-hover:bg-gray-50 z-10 shadow-[1px_0_0_0_rgb(229,231,235)]">{a.name}</td>
                  {cols.map(id => (
                    <td key={id} className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtCol(id, a)}</td>
                  ))}
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    {(label === "Reduce" || label === "Review") && (
                      <div className="mt-1">
                        <AIRecommendationButton
                          metric={`Expansion opportunity — ${a.name}`}
                          value={`ROAS ${a.roas.toFixed(2)}x, spend share ${a.spendPct.toFixed(1)}%`}
                          status={label === "Reduce" ? "critical" : "warn"}
                          platform="meta"
                          auditContext={{ module: "Expansion Opportunity", siblingMetrics: { roas: +a.roas.toFixed(2), spendSharePct: +a.spendPct.toFixed(1), revSharePct: +a.revPct.toFixed(1) } }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Scale up: ROAS ≥ 3× + spend share &lt; 20% · Maintain: ROAS ≥ 2× + spend share &lt; 30% · Reduce: ROAS &lt; 1×.
      </p>
    </div>
  );
}

// ─── DV360 real per-line-item views (Bid Manager) ────────────────────────────

const fmtMoney0 = (n: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(n);

/** DV360 fatigue is keyed on FREQUENCY only — display/video CTR is inherently
 *  ~0.1-0.2%, so Meta's CTR<0.5% threshold would false-alarm every line item. */
function dvFatigueLabel(freq: number): { label: string; color: string } {
  if (freq >= 5) return { label: "Critical", color: "bg-red-100 text-red-800" };
  if (freq >= 3) return { label: "Fatigued", color: "bg-orange-100 text-orange-800" };
  return { label: "Healthy", color: "bg-green-100 text-green-800" };
}

// DV360 column definitions — mirror the Meta table's picker/sort format.
const DV_SAT_COLS: ColDef[] = [
  { id: "frequency",   label: "Freq.",   group: "Reach",       defaultOn: true  },
  { id: "reach",       label: "Reach",   group: "Reach",       defaultOn: true  },
  { id: "reachPct",    label: "Reach %", group: "Reach",       defaultOn: true  },
  { id: "impressions", label: "Impr.",   group: "Reach",       defaultOn: false },
  { id: "ctr",         label: "CTR",     group: "Engagement",  defaultOn: true  },
  { id: "cpm",         label: "CPM",     group: "Cost",        defaultOn: true  },
  { id: "spend",       label: "Spend",   group: "Cost",        defaultOn: true  },
  { id: "conversions", label: "Conv",    group: "Conversion",  defaultOn: true  },
  { id: "cpa",         label: "CPA",     group: "Conversion",  defaultOn: true  },
  { id: "roas",        label: "ROAS",    group: "Conversion",  defaultOn: false },
];
const DV_SAT_DEFAULT = DV_SAT_COLS.filter(c => c.defaultOn).map(c => c.id);

const DV_EXP_COLS: ColDef[] = [
  { id: "spend",       label: "Spend",   group: "Cost",        defaultOn: true  },
  { id: "spendPct",    label: "Spend %", group: "Cost",        defaultOn: true  },
  { id: "impressions", label: "Impr.",   group: "Reach",       defaultOn: false },
  { id: "clicks",      label: "Clicks",  group: "Engagement",  defaultOn: false },
  { id: "conversions", label: "Conv",    group: "Conversion",  defaultOn: true  },
  { id: "cpa",         label: "CPA",     group: "Conversion",  defaultOn: true  },
  { id: "roas",        label: "ROAS",    group: "Conversion",  defaultOn: true  },
];
const DV_EXP_DEFAULT = DV_EXP_COLS.filter(c => c.defaultOn).map(c => c.id);

/** Column picker for DV360 tables — same control as the Meta tables. */
function Dv360ColPicker({ cols, setCols, allCols }: { cols: string[]; setCols: (c: string[]) => void; allCols: ColDef[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const defaultIds = allCols.filter(c => c.defaultOn).map(c => c.id);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };
  return (
    <ColumnPickerButton
      cols={cols} allDefs={allCols} defaultIds={defaultIds}
      pickerOpen={open} setPickerOpen={setOpen} pickerRef={ref}
      toggleCol={toggleCol} resetCols={(ids) => setCols([...ids])}
    />
  );
}

type DvEnriched = DV360SaturationRow & { name: string; reachPct: number; fatigueSev: number };

function fmtDvCol(id: string, r: DvEnriched, currency: string): string {
  switch (id) {
    case "frequency":   return r.frequency > 0 ? r.frequency.toFixed(1) : "—";
    case "reach":       return r.reach > 0 ? Math.round(r.reach).toLocaleString("en-IN") : "—";
    case "reachPct":    return r.reachPct > 0 ? `${r.reachPct.toFixed(1)}%` : "—";
    case "impressions": return Math.round(r.impressions).toLocaleString("en-IN");
    case "clicks":      return Math.round(r.clicks).toLocaleString("en-IN");
    case "ctr":         return `${r.ctr.toFixed(2)}%`;
    case "cpm":         return fmtMoney0(r.cpm, currency);
    case "spend":       return fmtMoney0(r.spend, currency);
    case "spendPct":    return `${r.spendPct.toFixed(1)}%`;
    case "conversions": return Math.round(r.conversions).toLocaleString("en-IN");
    case "cpa":         return r.cpa > 0 ? fmtMoney0(r.cpa, currency) : "—";
    case "roas":        return r.roas > 0 ? `${r.roas.toFixed(2)}×` : "—";
    default:            return "—";
  }
}

const dvThBase = "px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600";

/** §7 DV360 Saturation — real frequency/reach (REACH report) + CTR/CPM/fatigue.
 *  Column picker + sort + AI reccos mirror the Meta table. When reach isn't
 *  available, frequency/reach columns and fatigue drop out (no proxy). */
function Dv360SaturationView({ rows, reachAvailable, loading, pending, currency }: {
  rows: DV360SaturationRow[]; reachAvailable: boolean; loading: boolean; pending: boolean; currency: string;
}) {
  const [cols, setCols] = usePersistentColumns("dv-sat", DV_SAT_DEFAULT);
  const totalReach = useMemo(() => rows.reduce((s, r) => s + r.reach, 0), [rows]);
  const enriched: DvEnriched[] = useMemo(() => rows.map((r) => ({
    ...r, name: r.lineItem,
    reachPct: totalReach > 0 ? (r.reach / totalReach) * 100 : 0,
    fatigueSev: r.frequency >= 5 ? 2 : r.frequency >= 3 ? 1 : 0,
  })), [rows, totalReach]);
  const { sorted, sort, toggle } = useSort(enriched, "frequency", "desc");

  // Reach-derived columns drop out when the advertiser has no REACH report.
  const shownCols = reachAvailable ? cols : cols.filter((c) => !["frequency", "reach", "reachPct"].includes(c));
  const pickerCols = reachAvailable ? DV_SAT_COLS : DV_SAT_COLS.filter((c) => !["frequency", "reach", "reachPct"].includes(c.id));
  const critical = enriched.filter((r) => r.fatigueSev === 2).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-900">DV360 — Line-Item Saturation</h3>
        </div>
        {!loading && rows.length > 0 && <Dv360ColPicker cols={shownCols} setCols={setCols} allCols={pickerCols} />}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">{pending ? "DV360 reports can take up to a minute — still generating…" : "Loading DV360 saturation…"}</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">No DV360 line-item data for this window.</div>
      ) : (
        <>
          {!reachAvailable && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Per-line-item <strong>frequency &amp; unique reach</strong> aren&apos;t available via the Bid Manager REACH report for this advertiser — showing real delivery efficiency (CTR, CPM, CPA) only. Fatigue needs frequency, so it&apos;s omitted here.
            </div>
          )}
          {reachAvailable && critical > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <strong>{critical} line item{critical !== 1 ? "s" : ""} showing critical frequency</strong> (≥ 5) — consider widening targeting or capping frequency.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                <tr>
                  <SortTh col="name" sort={sort} onToggle={toggle} className={dvThBase}>Line Item</SortTh>
                  {shownCols.map((id) => {
                    const def = DV_SAT_COLS.find((c) => c.id === id);
                    return <SortTh key={id} col={id} sort={sort} onToggle={toggle} className={dvThBase} align="right">{def?.label ?? id}</SortTh>;
                  })}
                  {reachAvailable && <SortTh col="fatigueSev" sort={sort} onToggle={toggle} className={dvThBase} align="center">Status</SortTh>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r) => {
                  const fat = dvFatigueLabel(r.frequency);
                  return (
                    <tr key={r.lineItemId || r.lineItem} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[300px] truncate" title={r.name}>{r.name}</td>
                      {shownCols.map((id) => (
                        <td key={id} className={`px-4 py-2.5 text-right whitespace-nowrap ${id === "frequency" ? (r.frequency >= 5 ? "text-red-600 font-bold" : r.frequency >= 3 ? "text-orange-600 font-bold" : "text-gray-900 font-semibold") : "text-gray-700"}`}>
                          {fmtDvCol(id, r, currency)}
                        </td>
                      ))}
                      {reachAvailable && (
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${fat.color}`}>{fat.label}</span>
                          {fat.label !== "Healthy" && (
                            <div className="mt-1">
                              <AIRecommendationButton
                                metric={`Line-item saturation — ${r.name}`}
                                value={r.frequency}
                                status={fat.label === "Critical" ? "critical" : "warn"}
                                platform="dv360"
                                auditContext={{ module: "DV360 Saturation", siblingMetrics: { frequency: r.frequency, reach: r.reach, ctr: +r.ctr.toFixed(2), cpm: +r.cpm.toFixed(2) } }}
                              />
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            {reachAvailable
              ? "Fatigue keys on frequency (≥ 5 Critical · ≥ 3 Fatigued) — display/video CTR is inherently low, so CTR isn't used. Reach % = line-item unique reach as a share of total. All values from Bid Manager."
              : "All values from Bid Manager standard reports."}
          </p>
        </>
      )}
    </div>
  );
}

/** §8 DV360 Expansion Opportunity — spend share vs efficiency. Uses ROAS when
 *  CM360 conversion-revenue is present, otherwise CPA (both 100% real).
 *  Column picker + sort + AI reccos mirror the Meta table. */
function Dv360ExpansionView({ rows, revenueAvailable, loading, pending, currency }: {
  rows: DV360SaturationRow[]; revenueAvailable: boolean; loading: boolean; pending: boolean; currency: string;
}) {
  const [cols, setCols] = usePersistentColumns("dv-exp", DV_EXP_DEFAULT);
  const enriched: DvEnriched[] = useMemo(() => rows.map((r) => ({
    ...r, name: r.lineItem, reachPct: 0, fatigueSev: 0,
  })), [rows]);
  const { sorted, sort, toggle } = useSort(enriched, "spendPct", "desc");

  const withConv = rows.filter((r) => r.conversions > 0);
  const avgCpa = withConv.length > 0 ? withConv.reduce((s, r) => s + r.cpa, 0) / withConv.length : 0;
  const roasRows = rows.filter((r) => r.roas > 0);
  const avgRoas = roasRows.length > 0 ? roasRows.reduce((s, r) => s + r.roas, 0) / roasRows.length : 0;

  // Recommendation keys on efficiency RELATIVE to the account average (±20%
  // band), not absolute spend-share cutoffs — the latter break for small
  // accounts with only a few line items (every one looks "big"). Reason is
  // attached so the AI reco and tooltip explain the "why".
  const recommend = (r: DV360SaturationRow): { label: string; color: string; reason: string } => {
    const SCALE = { label: "Scale", color: "bg-green-100 text-green-800" };
    const REDUCE = { label: "Reduce", color: "bg-red-100 text-red-800" };
    const MAINTAIN = { label: "Maintain", color: "bg-blue-100 text-blue-800" };
    const REVIEW = { label: "Review", color: "bg-gray-100 text-gray-600" };

    if (revenueAvailable) {
      if (r.roas === 0) return { ...REVIEW, reason: "No attributed revenue — verify conversion tracking before acting." };
      if (avgRoas > 0 && r.roas >= avgRoas * 1.2) return { ...SCALE, reason: `ROAS ${r.roas.toFixed(2)}× is ${Math.round((r.roas / avgRoas - 1) * 100)}% above the account average (${avgRoas.toFixed(2)}×) — shift more budget here.` };
      if (avgRoas > 0 && r.roas <= avgRoas * 0.8) return { ...REDUCE, reason: `ROAS ${r.roas.toFixed(2)}× is ${Math.round((1 - r.roas / avgRoas) * 100)}% below the account average (${avgRoas.toFixed(2)}×) — trim budget or fix targeting/creative.` };
      return { ...MAINTAIN, reason: `ROAS ${r.roas.toFixed(2)}× is within ±20% of the account average — holding steady.` };
    }
    if (r.conversions === 0) return { ...REVIEW, reason: "No conversions in window — check Floodlight tag firing before scaling." };
    if (avgCpa > 0 && r.cpa <= avgCpa * 0.8) return { ...SCALE, reason: `CPA ₹${r.cpa.toLocaleString("en-IN")} is ${Math.round((1 - r.cpa / avgCpa) * 100)}% below the account average (₹${Math.round(avgCpa).toLocaleString("en-IN")}) — efficient, room to scale spend.` };
    if (avgCpa > 0 && r.cpa >= avgCpa * 1.2) return { ...REDUCE, reason: `CPA ₹${r.cpa.toLocaleString("en-IN")} is ${Math.round((r.cpa / avgCpa - 1) * 100)}% above the account average (₹${Math.round(avgCpa).toLocaleString("en-IN")})${r.spendPct >= 15 ? ` and it's eating ${r.spendPct.toFixed(0)}% of spend` : ""} — trim budget or tighten targeting.` };
    return { ...MAINTAIN, reason: `CPA ₹${r.cpa.toLocaleString("en-IN")} is within ±20% of the account average — holding steady.` };
  };

  const shownCols = revenueAvailable ? cols : cols.filter((c) => c !== "roas");
  const pickerCols = revenueAvailable ? DV_EXP_COLS : DV_EXP_COLS.filter((c) => c.id !== "roas");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-900">DV360 — Expansion Opportunity</h3>
        </div>
        {!loading && rows.length > 0 && <Dv360ColPicker cols={shownCols} setCols={setCols} allCols={pickerCols} />}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">{pending ? "DV360 reports can take up to a minute — still generating…" : "Loading DV360 expansion…"}</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">No DV360 line-item data for this window.</div>
      ) : (
        <>
          {!revenueAvailable && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              ROAS needs CM360 conversion-revenue, which isn&apos;t linked for this advertiser — ranking by <strong>spend share vs CPA</strong> (cost efficiency) instead. All values are real Bid Manager data.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                <tr>
                  <SortTh col="name" sort={sort} onToggle={toggle} className={dvThBase}>Line Item</SortTh>
                  {shownCols.map((id) => {
                    const def = DV_EXP_COLS.find((c) => c.id === id);
                    return <SortTh key={id} col={id} sort={sort} onToggle={toggle} className={dvThBase} align="right">{def?.label ?? id}</SortTh>;
                  })}
                  <th className={`${dvThBase} text-center`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r) => {
                  const rec = recommend(r);
                  return (
                    <tr key={r.lineItemId || r.lineItem} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[300px] truncate" title={r.name}>{r.name}</td>
                      {shownCols.map((id) => (
                        <td key={id} className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtDvCol(id, r, currency)}</td>
                      ))}
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${rec.color}`} title={rec.reason}>{rec.label}</span>
                        {(rec.label === "Scale" || rec.label === "Reduce") && (
                          <div className="mt-1">
                            <AIRecommendationButton
                              metric={`${rec.label} "${r.name}" — ${rec.reason}`}
                              value={revenueAvailable ? r.roas : r.cpa}
                              status={rec.label === "Reduce" ? "warn" : "moderate"}
                              platform="dv360"
                              auditContext={{ module: "DV360 Expansion Opportunity", siblingMetrics: { action: rec.label, spendSharePct: +r.spendPct.toFixed(1), cpa: r.cpa, roas: +r.roas.toFixed(2), conversions: r.conversions, spend: r.spend } }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            {revenueAvailable
              ? "Scale = ROAS ≥ 20% above account avg · Reduce = ROAS ≥ 20% below avg · Maintain = within ±20%. Hover an action for the reason; use AI Recommendation for the how."
              : "Scale = CPA ≥ 20% below account avg (more efficient) · Reduce = CPA ≥ 20% above avg · Maintain = within ±20%. Lower CPA is better. Hover an action for the reason; use AI Recommendation for the how."}
          </p>
        </>
      )}
    </div>
  );
}

function PlatformDivider({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{label}</h2>
      <span className="text-xs text-gray-400 font-medium">{sub}</span>
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function AudienceSaturationTab({ platform, dateRange, customStart, customEnd }: Props) {
  const [active, setActive] = useState("saturation");
  const { adsets, loading, error, currency } = useAdSetInsights(platform, dateRange, customStart, customEnd);
  const showMeta = platform !== "dv360";
  const showDv360 = platform === "dv360" || platform === "both";
  const { rows: dvRows, loading: dvLoading, pending: dvPending, reachAvailable, revenueAvailable } =
    useDV360Saturation(dateRange, customStart, customEnd, showDv360);

  if (showMeta && loading && adsets.length === 0) return <LoadingState message="Loading saturation data…" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Zap className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Saturation &amp; Expansion</h1>
          <p className="text-gray-600 mt-1">Frequency, reach%, and fatigue scoring per ad set — plus which audiences to scale vs reduce based on ROAS and spend share.</p>
        </div>
      </div>

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

      {active === "saturation" && (
        <>
          {showMeta && (
            <>
              {platform === "both" && <PlatformDivider label="Meta" sub="Meta Ads" />}
              <SaturationAnalysis adsets={adsets} loading={loading} currency={currency} />
            </>
          )}
          {showDv360 && (
            <>
              {platform === "both" && <PlatformDivider label="DV360" sub="Display & Video 360" />}
              <Dv360SaturationView rows={dvRows} reachAvailable={reachAvailable} loading={dvLoading} pending={dvPending} currency={currency} />
            </>
          )}
        </>
      )}
      {active === "expansion" && (
        <>
          {showMeta && (
            <>
              {platform === "both" && <PlatformDivider label="Meta" sub="Meta Ads" />}
              <ExpansionOpportunity adsets={adsets} loading={loading} currency={currency} />
            </>
          )}
          {showDv360 && (
            <>
              {platform === "both" && <PlatformDivider label="DV360" sub="Display & Video 360" />}
              <Dv360ExpansionView rows={dvRows} revenueAvailable={revenueAvailable} loading={dvLoading} pending={dvPending} currency={currency} />
            </>
          )}
        </>
      )}

      <TabSummaryFooter
        tabName="Saturation & Expansion"
        lines={[
          ...(showMeta ? [
            `${platform === "both" ? "Meta: " : ""}${adsets.length} ad set${adsets.length !== 1 ? "s" : ""} analysed for frequency, reach, and saturation signals.`,
            `${platform === "both" ? "Meta " : ""}Total spend: ${adsets.reduce((s, a) => s + a.spend, 0).toLocaleString("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 })} across all ad sets in window.`,
            `${adsets.filter(a => a.spend > 0 && (a.conversionValue / a.spend) >= 3).length} ad set${adsets.filter(a => a.spend > 0 && (a.conversionValue / a.spend) >= 3).length !== 1 ? "s" : ""} with ROAS ≥ 3× (scale candidates).`,
          ] : []),
          ...(showDv360 && dvRows.length > 0 ? (() => {
            const dvSpend = dvRows.reduce((s, r) => s + r.spend, 0);
            const dvConv = dvRows.reduce((s, r) => s + r.conversions, 0);
            const dvCritical = dvRows.filter(r => r.frequency >= 5).length;
            const dvFatigued = dvRows.filter(r => r.frequency >= 3 && r.frequency < 5).length;
            const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
            return [
              `${platform === "both" ? "DV360: " : ""}${dvRows.length} line item${dvRows.length !== 1 ? "s" : ""} analysed — ${fmt(dvSpend)} spend, ${dvConv.toLocaleString("en-IN")} conversions in window.`,
              reachAvailable
                ? `DV360 saturation: ${dvCritical} critical (freq ≥ 5) · ${dvFatigued} fatigued (freq ≥ 3)${dvCritical > 0 ? " — widen targeting or cap frequency." : "."}`
                : `DV360: frequency/reach not available via API for this advertiser — showing delivery efficiency (CTR, CPM, CPA) only.`,
            ];
          })() : []),
        ]}
        context={{ adSetCount: adsets.length, totalSpend: adsets.reduce((s, a) => s + a.spend, 0), dv360LineItems: dvRows.length, dv360Spend: dvRows.reduce((s, r) => s + r.spend, 0) }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
