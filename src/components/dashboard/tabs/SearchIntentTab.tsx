/**
 * Campaign → Search Intent (doc §12, §13)
 *
 * §12 Search Intent Analysis — Google Ads keyword performance grouped by intent
 *     (Brand / Transactional / Commercial / Competitor / Informational / Navigational)
 * §13 Search Query Intent   — individual keyword / query cluster level
 *
 * For Meta platform: shows "not applicable" message (Meta uses audience-based
 * targeting, not keyword-based). For Google: uses campaign-level data from
 * useCampaigns() grouped by intent-keyword detection in campaign names.
 */

import { useMemo, useState } from "react";
import { Search, AlertCircle, Info } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useColPicker, ColumnPickerButton, ColHeader, ALL_STANDARD_KPIS, STD_KPI_MAP } from "@/components/shared/ColumnPicker";
import { useCampaigns } from "@/hooks/useCampaigns";
import { formatMoney } from "@/lib/currency";
import { detectCurrency } from "@/lib/currency";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import type { DateRange } from "@/components/shared/DateRangePicker";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "intent",  label: "Search Intent",       desc: "Campaign performance grouped by intent type (§12)" },
  { id: "queries", label: "Search Query Intent", desc: "Individual keyword / query cluster view (§13)" },
];

// ─── Intent classification ──────────────────────────────────────────────────

type IntentType = "Brand" | "Transactional" | "Commercial" | "Competitor" | "Informational" | "Navigational";

function classifyIntent(name: string): IntentType {
  const n = name.toLowerCase();
  if (/brand|\bbrand\b|own brand|name/.test(n)) return "Brand";
  if (/compet|versus|\bvs\b|rival|alternative/.test(n)) return "Competitor";
  if (/\bbuy\b|purchase|order|shop|deal|discount|offer|price|cheap|coupon/.test(n)) return "Transactional";
  if (/best|review|compare|top \d|vs |which/.test(n)) return "Commercial";
  if (/how to|what is|guide|tutorial|tips|learn|about/.test(n)) return "Informational";
  if (/login|account|sign in|website|official/.test(n)) return "Navigational";
  return "Transactional"; // default for unlabeled Google campaigns
}

const INTENT_COLORS: Record<IntentType, string> = {
  Brand:          "bg-purple-100 text-purple-800",
  Transactional:  "bg-green-100 text-green-800",
  Commercial:     "bg-blue-100 text-blue-800",
  Competitor:     "bg-orange-100 text-orange-800",
  Informational:  "bg-yellow-100 text-yellow-800",
  Navigational:   "bg-gray-100 text-gray-800",
};

const INTENT_ORDER: IntentType[] = ["Brand", "Transactional", "Commercial", "Competitor", "Informational", "Navigational"];

// ─── Meta N/A panel ─────────────────────────────────────────────────────────

function MetaNotApplicable() {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
      <Search className="w-10 h-10 text-gray-400 mx-auto mb-3" />
      <h3 className="text-base font-bold text-gray-700 mb-1">Not applicable for Meta</h3>
      <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
        Meta Ads uses audience-based targeting (interests, lookalikes, custom audiences) — not keyword-based. Search intent analysis is specific to Google Ads where campaigns target users by the words they search.
      </p>
      <p className="text-xs text-gray-400 mt-3">Switch platform to Google or Both to see Search Intent data.</p>
    </div>
  );
}

// ─── KPI configs ─────────────────────────────────────────────────────────────

const SI_DEFAULTS = ["spend", "revenue", "orders", "roas", "cpa", "cvr", "clicks", "cpc"];
const SQ_DEFAULTS = ["spend", "revenue", "orders", "roas", "cpa", "cvr"];

type SiRow = { spend: number; clicks: number; conversions: number; conversionValue: number; count: number };

function fmtSiKpi(id: string, r: SiRow, cur: (n: number) => string): string {
  const roas = r.spend > 0 ? r.conversionValue / r.spend : 0;
  const cpa  = r.conversions > 0 ? r.spend / r.conversions : 0;
  const cvr  = r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0;
  const aov  = r.conversions > 0 ? r.conversionValue / r.conversions : 0;
  const cpc  = r.clicks > 0 ? r.spend / r.clicks : 0;
  const cpm  = 0; // impressions not available at intent-group level
  switch (id) {
    case "spend":        return cur(r.spend);
    case "revenue":      return cur(r.conversionValue);
    case "orders":       return Math.round(r.conversions).toLocaleString("en-IN");
    case "roas":         return roas > 0 ? `${roas.toFixed(2)}×` : "—";
    case "cpa":          return cpa > 0 ? cur(cpa) : "—";
    case "cvr":
    case "saleConvRate":
    case "convRate":     return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "aov":          return aov > 0 ? cur(aov) : "—";
    case "ctr":          return cpm > 0 ? `${cpm.toFixed(2)}%` : "—";
    case "clicks":       return Math.round(r.clicks).toLocaleString("en-IN");
    case "cpc":          return cpc > 0 ? cur(cpc) : "—";
    case "sales":        return Math.round(r.conversions).toLocaleString("en-IN");
    case "cps":          return cpa > 0 ? cur(cpa) : "—";
    case "acos":         return roas > 0 ? `${(1 / roas * 100).toFixed(1)}%` : "—";
    default:             return "—";
  }
}

// §12 §13 share the same campaign row shape
type CampaignRow = { spend?: number; clicks?: number; conversions?: number; conversionValue?: number };

function fmtCampKpi(id: string, c: CampaignRow, cur: (n: number) => string): string {
  const spend = c.spend || 0; const clicks = c.clicks || 0;
  const conv = c.conversions || 0; const val = c.conversionValue || 0;
  const roas = spend > 0 ? val / spend : 0;
  const cpa  = conv > 0 ? spend / conv : 0;
  const cvr  = clicks > 0 ? (conv / clicks) * 100 : 0;
  const aov  = conv > 0 ? val / conv : 0;
  const cpc  = clicks > 0 ? spend / clicks : 0;
  switch (id) {
    case "spend":        return cur(spend);
    case "revenue":      return cur(val);
    case "orders":       return Math.round(conv).toLocaleString("en-IN");
    case "roas":         return roas > 0 ? `${roas.toFixed(2)}×` : "—";
    case "cpa":          return cpa > 0 ? cur(cpa) : "—";
    case "cvr":
    case "saleConvRate":
    case "convRate":     return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "aov":          return aov > 0 ? cur(aov) : "—";
    case "clicks":       return Math.round(clicks).toLocaleString("en-IN");
    case "cpc":          return cpc > 0 ? cur(cpc) : "—";
    case "sales":        return Math.round(conv).toLocaleString("en-IN");
    case "cps":          return cpa > 0 ? cur(cpa) : "—";
    case "acos":         return roas > 0 ? `${(1 / roas * 100).toFixed(1)}%` : "—";
    default:             return "—";
  }
}

// Only KPIs each table can populate — probe the renderer with a full row; KPIs
// still "—" (impressions/CTR/reach at intent level, Views, Leads, …) are dropped.
const SI_SAMPLE: SiRow = { spend: 5000, clicks: 1500, conversions: 80, conversionValue: 120000, count: 5 };
const SI_FETCHABLE = ALL_STANDARD_KPIS.filter((k) => fmtSiKpi(k.id, SI_SAMPLE, (n) => String(n)) !== "—");
const SQ_SAMPLE: CampaignRow = { spend: 5000, clicks: 1500, conversions: 80, conversionValue: 120000 };
const SQ_FETCHABLE = ALL_STANDARD_KPIS.filter((k) => fmtCampKpi(k.id, SQ_SAMPLE, (n) => String(n)) !== "—");

// ─── §12 Search Intent ──────────────────────────────────────────────────────

function SearchIntentAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading } = useCampaigns(platform === "both" ? "google" : platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);

  const rows = useMemo(() => {
    const map = new Map<IntentType, SiRow>();
    for (const c of campaigns) {
      const intent = classifyIntent(c.name || "");
      const cur = map.get(intent) || { spend: 0, clicks: 0, conversions: 0, conversionValue: 0, count: 0 };
      cur.spend += c.spend || 0;
      cur.clicks += c.clicks || 0;
      cur.conversions += c.conversions || 0;
      cur.conversionValue += c.conversionValue || 0;
      cur.count += 1;
      map.set(intent, cur);
    }
    return INTENT_ORDER.filter((k) => map.has(k)).map((k) => ({ intent: k, ...map.get(k)! }));
  }, [campaigns]);
  const { sorted: intentSorted, sort: intentSort, toggle: intentToggle } = useSort(rows, "spend", "desc");

  const cur = (n: number) => formatMoney(n, currency, 0);

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(SI_DEFAULTS, "search-intent");

  if (loading) return <div className="text-sm text-gray-500">Loading campaign data…</div>;

  if (!campaigns.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No Google Ads campaigns found. Connect a Google account or widen the date range.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Intent classified from campaign names. For precise keyword-level intent, connect Google Search Console or use Smart Bidding intent signals.
      </div>
      <ColumnPickerButton
        cols={cols} allDefs={SI_FETCHABLE} defaultIds={SI_DEFAULTS}
        pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
        toggleCol={toggleCol} resetCols={resetCols}
      />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <SortTh col="intent" sort={intentSort} onToggle={intentToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Intent Type</SortTh>
              <SortTh col="count" sort={intentSort} onToggle={intentToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Campaigns</SortTh>
              {cols.map((id, colIdx) => {
                const k = STD_KPI_MAP.get(id);
                return (
                  <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <ColHeader colIdx={colIdx} currentId={id} label={k?.label ?? id} allDefs={SI_FETCHABLE} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {intentSorted.map((r) => (
              <tr key={r.intent} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${INTENT_COLORS[r.intent]}`}>{r.intent}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{r.count}</td>
                {cols.map((id) => (
                  <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {fmtSiKpi(id, r, cur)}
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

// ─── §13 Search Query Intent ────────────────────────────────────────────────

function SearchQueryIntent({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading } = useCampaigns(platform === "both" ? "google" : platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);
  const cur = (n: number) => formatMoney(n, currency, 0);
  const { sorted: sqSorted, sort: sqSort, toggle: sqToggle } = useSort(campaigns, "spend", "desc");

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(SQ_DEFAULTS, "search-query");

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2 text-xs text-yellow-800">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Full search query data requires Google Ads Query Report API (GAQL) — coming v1.1.</strong>{" "}
          Currently showing campaign-level performance grouped as query clusters derived from campaign names.
        </span>
      </div>
      {campaigns.length > 0 && (
        <>
          <ColumnPickerButton
            cols={cols} allDefs={SQ_FETCHABLE} defaultIds={SQ_DEFAULTS}
            pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
            toggleCol={toggleCol} resetCols={resetCols}
          />
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                <tr>
                  <SortTh col="name" sort={sqSort} onToggle={sqToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap">Query Cluster (Campaign)</SortTh>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Intent</th>
                  {cols.map((id, colIdx) => {
                    const k = STD_KPI_MAP.get(id);
                    return (
                      <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                        <ColHeader colIdx={colIdx} currentId={id} label={k?.label ?? id} allDefs={SQ_FETCHABLE} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sqSorted.map((c) => {
                  const intent = classifyIntent(c.name || "");
                  return (
                    <tr key={`${c.platform}-${c.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-[240px]" title={c.name}>{c.name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${INTENT_COLORS[intent]}`}>{intent}</span>
                      </td>
                      {cols.map((id) => (
                        <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                          {fmtCampKpi(id, c, cur)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function SearchIntentTab(props: Props) {
  const [active, setActive] = useState("intent");
  const isMetaOnly = props.platform === "meta";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Search className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Search Intent</h1>
            <p className="text-gray-600 mt-1">Google Ads campaign performance grouped by search intent — Brand, Transactional, Commercial, Competitor, Informational, Navigational.</p>
          </div>
        </div>
        {!isMetaOnly && (
          <AIExecutiveSummary
            tabName="Search Intent"
            context={{ platform: props.platform, activeSubTab: active, dateRange: String(props.dateRange) }}
            platform={props.platform === "both" ? "google" : props.platform}
            dateRange={String(props.dateRange)}
            inline
          />
        )}
      </div>

      {isMetaOnly && <MetaNotApplicable />}

      {!isMetaOnly && (
        <>
          <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
            {SUB_TABS.map((t) => (
              <button key={t.id} onClick={() => setActive(t.id)}
                className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
                <div>{t.label}</div>
                <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
              </button>
            ))}
          </div>

          {active === "intent"  && <SearchIntentAnalysis {...props} />}
          {active === "queries" && <SearchQueryIntent {...props} />}
        </>
      )}

      <TabSummaryFooter
        tabName="Search Intent"
        lines={[
          isMetaOnly
            ? "Search Intent analysis is not applicable for Meta — this section is Google Ads only."
            : `Search intent analysis across Brand, Transactional, Commercial, Competitor, Informational, and Navigational intent buckets.`,
          `Platform: ${props.platform} · Active view: ${active === "intent" ? "Intent Analysis" : "Search Query Intent"}.`,
          "Rename campaigns with intent keywords (brand:, tran:, comp:) for automatic intent classification.",
        ]}
        context={{ platform: props.platform, activeSubTab: active }}
        platform={props.platform === "both" ? "meta" : props.platform}
        dateRange={String(props.dateRange)}
      />
    </div>
  );
}
