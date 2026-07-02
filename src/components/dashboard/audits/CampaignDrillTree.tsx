/**
 * Hierarchical drill-down tree: campaigns → ad sets → ads.
 *
 * Uses the shared ColumnPickerButton (same 32 KPIs, same white/blue styling as
 * every other table in the app). All column headers sortable at the campaign
 * level. Rows with zero delivery show 0 / ₹0 instead of —.
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, ArrowUpDown, ChevronUp } from "lucide-react";
import type { CampaignData } from "@/types";
import { detectCurrency } from "@/lib/currency";
import {
  useColPicker,
  ColumnPickerButton,
  ALL_STANDARD_KPIS,
} from "@/components/shared/ColumnPicker";

interface Props {
  campaigns: CampaignData[];
  currency?: string;
}

type NodeType = "CAMP" | "AS" | "AD";

const CHIP_STYLES: Record<NodeType, string> = {
  CAMP: "bg-gray-100 text-gray-700",
  AS:   "bg-blue-100 text-blue-700",
  AD:   "bg-pink-100 text-pink-700",
};

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCur(n: number | undefined, currency = "USD"): string {
  const val = n ?? 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(val);
  } catch {
    return `$${val.toFixed(2)}`;
  }
}

function fmtPct(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtX(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${n.toFixed(2)}x`;
}

// ─── Derived metrics ─────────────────────────────────────────────────────────

interface M {
  spend: number; impressions: number; clicks: number; reach: number;
  conversions: number; conversionValue: number;
  ctr?: number; cpm?: number; cpc?: number;
  roas?: number; cpa?: number; cvr?: number; aov?: number;
}

function derive(
  impressions?: number, clicks?: number, spend?: number, reach?: number,
  conversions?: number, conversionValue?: number,
): M {
  const s = spend ?? 0;
  const imp = impressions ?? 0;
  const cl = clicks ?? 0;
  const cv = conversions ?? 0;
  const rv = conversionValue ?? 0;
  const m: M = { spend: s, impressions: imp, clicks: cl, reach: reach ?? 0, conversions: cv, conversionValue: rv };
  if (imp > 0) { m.ctr = (cl / imp) * 100; m.cpm = (s / imp) * 1000; }
  if (cl > 0)  { m.cpc = s / cl; m.cvr = (cv / cl) * 100; }
  if (s > 0)   { m.roas = rv / s; if (cv > 0) m.cpa = s / cv; }
  if (cv > 0 && rv > 0) m.aov = rv / cv;
  return m;
}

// ─── KPI render + sort map ────────────────────────────────────────────────────

type Renderer = (m: M, cur: string) => string;
type Sorter   = (m: M) => number;

const KPI_RENDER: Record<string, Renderer> = {
  spend:          (m, c) => fmtCur(m.spend, c),
  revenue:        (m, c) => fmtCur(m.conversionValue, c),
  orders:         (m)    => fmt(m.conversions),
  roas:           (m)    => fmtX(m.roas),
  cpa:            (m, c) => m.cpa !== undefined ? fmtCur(m.cpa, c) : "—",
  cvr:            (m)    => fmtPct(m.cvr),
  aov:            (m, c) => m.aov !== undefined ? fmtCur(m.aov, c) : "—",
  impressions:    (m)    => fmt(m.impressions),
  reach:          (m)    => fmt(m.reach),
  cpm:            (m, c) => m.cpm !== undefined ? fmtCur(m.cpm, c) : "—",
  frequency:      ()     => "—",
  views:          ()     => "—",
  cpv:            ()     => "—",
  vtr:            ()     => "—",
  ctr:            (m)    => fmtPct(m.ctr),
  clicks:         (m)    => fmt(m.clicks),
  cpc:            (m, c) => m.cpc !== undefined ? fmtCur(m.cpc, c) : "—",
  engagements:    ()     => "—",
  engagementRate: ()     => "—",
  cpe:            ()     => "—",
  leads:          ()     => "—",
  convRate:       (m)    => fmtPct(m.cvr),
  cpl:            ()     => "—",
  traffic:        ()     => "—",
  addToCart:      ()     => "—",
  atcConvRate:    ()     => "—",
  install:        ()     => "—",
  cpi:            ()     => "—",
  sales:          (m)    => fmt(m.conversions),
  saleConvRate:   (m)    => fmtPct(m.cvr),
  cps:            (m, c) => m.cpa !== undefined ? fmtCur(m.cpa, c) : "—",
  acos:           (m)    => m.roas !== undefined ? fmtPct(m.roas > 0 ? (1 / m.roas) * 100 : undefined) : "—",
};

const KPI_SORT: Record<string, Sorter> = {
  spend:          (m) => m.spend,
  revenue:        (m) => m.conversionValue,
  orders:         (m) => m.conversions,
  roas:           (m) => m.roas ?? 0,
  cpa:            (m) => m.cpa ?? 0,
  cvr:            (m) => m.cvr ?? 0,
  aov:            (m) => m.aov ?? 0,
  impressions:    (m) => m.impressions,
  reach:          (m) => m.reach,
  cpm:            (m) => m.cpm ?? 0,
  frequency:      ()  => 0,
  views:          ()  => 0,
  cpv:            ()  => 0,
  vtr:            ()  => 0,
  ctr:            (m) => m.ctr ?? 0,
  clicks:         (m) => m.clicks,
  cpc:            (m) => m.cpc ?? 0,
  engagements:    ()  => 0,
  engagementRate: ()  => 0,
  cpe:            ()  => 0,
  leads:          ()  => 0,
  convRate:       (m) => m.cvr ?? 0,
  cpl:            ()  => 0,
  traffic:        ()  => 0,
  addToCart:      ()  => 0,
  atcConvRate:    ()  => 0,
  install:        ()  => 0,
  cpi:            ()  => 0,
  sales:          (m) => m.conversions,
  saleConvRate:   (m) => m.cvr ?? 0,
  cps:            (m) => m.cpa ?? 0,
  acos:           (m) => m.roas !== undefined && m.roas > 0 ? 1 / m.roas : 0,
};

// Default columns shown on first load
const DEFAULT_COL_IDS = ["spend", "revenue", "orders", "roas", "cpa", "impressions", "clicks", "ctr"];

// Only KPIs this table can actually populate from campaign data (spend,
// impressions, clicks, reach, conversions, conversionValue + derivations).
// Probe each renderer with a fully-populated sample row: anything that still
// returns "—" has no backing data here (Views, CPV, Frequency, VTR, Leads…)
// and is dropped from the column picker so users aren't offered dead columns.
const SAMPLE_M = derive(1000, 100, 5000, 800, 10, 20000);
const DRILL_KPIS = ALL_STANDARD_KPIS.filter(
  (k) => (KPI_RENDER[k.id]?.(SAMPLE_M, "USD") ?? "—") !== "—"
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function CampaignDrillTree({ campaigns, currency }: Props) {
  const cur = currency || detectCurrency(campaigns);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "spend", dir: "desc" });

  const {
    cols, pickerOpen, setPickerOpen, pickerRef, toggleCol, resetCols,
  } = useColPicker(DEFAULT_COL_IDS, "drill");

  const toggle = (id: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSort = (col: string) =>
    setSort((s) => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" });

  // Ordered active column defs (restricted to KPIs this table can populate)
  const activeCols = cols
    .map((id) => DRILL_KPIS.find((k) => k.id === id))
    .filter(Boolean) as typeof ALL_STANDARD_KPIS;

  // Column density scales with how many columns are shown — the more columns,
  // the tighter the padding / smaller the text, so they fit before scrolling.
  const density: "normal" | "compact" | "tight" =
    activeCols.length >= 12 ? "tight" : activeCols.length >= 9 ? "compact" : "normal";
  const cellX     = density === "tight" ? "px-1.5" : density === "compact" ? "px-2" : "px-3";
  const cellText  = density === "tight" ? "text-[11px]" : density === "compact" ? "text-xs" : "text-sm";
  const firstMin  = density === "tight" ? "min-w-[200px]" : density === "compact" ? "min-w-[240px]" : "min-w-[280px]";

  // Sort campaigns
  const sorted = [...campaigns].sort((a, b) => {
    const ma = derive(a.impressions, a.clicks, a.spend, a.reach, a.conversions, a.conversionValue);
    const mb = derive(b.impressions, b.clicks, b.spend, b.reach, b.conversions, b.conversionValue);
    const sorter = KPI_SORT[sort.col] ?? (() => 0);
    const va = sorter(ma), vb = sorter(mb);
    return sort.dir === "asc" ? va - vb : vb - va;
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-gray-200 bg-white">
        <ColumnPickerButton
          cols={cols}
          allDefs={DRILL_KPIS}
          defaultIds={DEFAULT_COL_IDS}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          pickerRef={pickerRef}
          toggleCol={toggleCol}
          resetCols={resetCols}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className={`w-full ${cellText}`}>
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <th className={`${cellX} py-2 text-left font-semibold text-gray-700 ${firstMin}`}>
                Campaigns / Ad Sets / Ads
              </th>
              {activeCols.map((c) => (
                <th
                  key={c.id}
                  className={`${cellX} py-2 text-right font-semibold text-gray-700 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 group`}
                  onClick={() => handleSort(c.id)}
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    {c.label}
                    {sort.col === c.id ? (
                      sort.dir === "asc"
                        ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
                        : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={activeCols.length + 1} className="px-4 py-8 text-center text-gray-500">
                  No campaigns.
                </td>
              </tr>
            )}
            {sorted.map((c) => {
              const cId = c.id;
              const cOpen = expanded.has(cId);
              const adSets = c.adSets || [];
              const cMetrics = derive(c.impressions, c.clicks, c.spend, c.reach, c.conversions, c.conversionValue);
              const rowCur = c.currency || cur;
              return (
                <RowFragment key={`c-${cId}`}>
                  <Row indent={0} type="CAMP" hasChildren={adSets.length > 0} expanded={cOpen}
                    onToggle={() => toggle(cId)} name={c.name} metrics={cMetrics}
                    currency={rowCur} activeCols={activeCols} cellX={cellX} />
                  {cOpen && adSets.map((as) => {
                    const asOpen = expanded.has(as.id);
                    const asMetrics = derive(as.impressions, as.clicks, as.spend, as.reach);
                    return (
                      <RowFragment key={`as-${as.id}`}>
                        <Row indent={1} type="AS" hasChildren={as.ads.length > 0} expanded={asOpen}
                          onToggle={() => toggle(as.id)} name={as.name} metrics={asMetrics}
                          currency={rowCur} activeCols={activeCols} cellX={cellX} />
                        {asOpen && as.ads.map((ad) => (
                          <Row key={`ad-${ad.id}`} indent={2} type="AD" hasChildren={false}
                            expanded={false} onToggle={() => {}} name={ad.name}
                            metrics={derive(ad.impressions, ad.clicks, ad.spend, ad.reach)}
                            currency={rowCur} activeCols={activeCols} cellX={cellX} />
                        ))}
                      </RowFragment>
                    );
                  })}
                </RowFragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

interface RowProps {
  indent: number; type: NodeType; hasChildren: boolean; expanded: boolean;
  onToggle: () => void; name: string; metrics: M; currency: string;
  activeCols: typeof ALL_STANDARD_KPIS; cellX: string;
}

function Row({ indent, type, hasChildren, expanded, onToggle, name, metrics, currency, activeCols, cellX }: RowProps) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 align-middle">
      <td className={`${cellX} py-2.5`} style={{ paddingLeft: `${12 + indent * 22}px` }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={hasChildren ? onToggle : undefined}
            className={`shrink-0 ${hasChildren ? "text-gray-500 hover:text-gray-900 cursor-pointer" : "text-transparent cursor-default"}`}
          >
            {hasChildren
              ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)
              : <ChevronRight className="w-4 h-4 opacity-0" />}
          </button>
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${CHIP_STYLES[type]}`}>{type}</span>
          <span className="font-mono text-gray-900 break-words" title={name}>{name}</span>
        </div>
      </td>
      {activeCols.map((c) => (
        <td key={c.id} className={`${cellX} py-2.5 text-right text-gray-900 whitespace-nowrap`}>
          {(KPI_RENDER[c.id] ?? (() => "—"))(metrics, currency)}
        </td>
      ))}
    </tr>
  );
}
