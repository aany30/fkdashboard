/**
 * Campaign → Audience Quality & Value (doc §6, §14, §15)
 *
 * §6  Audience Quality  — what Meta provides: AOV, Orders, Revenue, ROAS, CPA.
 *                         LTV/Repeat Rate/Refund Rate/NC ROAS need CRM — noted.
 * §14 Customer Value    — Meta can't segment customers by purchase frequency;
 *                         needs Shopify/CRM integration (info panel).
 * §15 Product Affinity  — needs product catalog + order data (info panel).
 */

import { useMemo, useState } from "react";
import { Star, Info, AlertCircle } from "lucide-react";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useColPicker, ColumnPickerButton, ColHeader, ALL_STANDARD_KPIS, STD_KPI_MAP } from "@/components/shared/ColumnPicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "quality",  label: "Audience Quality",        desc: "Orders, AOV, ROAS, CPA per audience (§6)" },
  { id: "customer", label: "Customer Value",           desc: "LTV segmentation — needs CRM (§14)" },
  { id: "affinity", label: "Product Affinity",         desc: "Top products by audience — needs catalog (§15)" },
];

// ─── §6 KPI config ───────────────────────────────────────────────────────────

const AQ_DEFAULTS = ["orders", "revenue", "roas", "cpa", "aov"];

function fmtAqKpi(id: string, a: ReturnType<typeof useAdSetInsights>["adsets"][number], cur: (n: number) => string): string {
  const roas  = a.spend > 0 ? a.conversionValue / a.spend : 0;
  const cpa   = a.conversions > 0 ? a.spend / a.conversions : 0;
  const aov   = a.conversions > 0 ? a.conversionValue / a.conversions : 0;
  const cvr   = a.clicks > 0 ? (a.conversions / a.clicks) * 100 : 0;
  const ctr   = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
  const cpc   = a.clicks > 0 ? a.spend / a.clicks : 0;
  const cpm   = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
  const freq  = a.frequency ?? 0;
  const acos  = a.conversionValue > 0 ? (a.spend / a.conversionValue) * 100 : 0;
  switch (id) {
    case "spend":          return cur(a.spend);
    case "revenue":        return cur(a.conversionValue);
    case "orders":
    case "sales":          return Math.round(a.conversions).toLocaleString("en-IN");
    case "roas":           return roas > 0 ? `${roas.toFixed(2)}×` : "—";
    case "cpa":
    case "cps":            return cpa > 0 ? cur(cpa) : "—";
    case "cvr":
    case "convRate":
    case "saleConvRate":   return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "aov":            return aov > 0 ? cur(aov) : "—";
    case "impressions":    return Math.round(a.impressions).toLocaleString("en-IN");
    case "reach":          return Math.round(a.reach).toLocaleString("en-IN");
    case "cpm":            return cpm > 0 ? cur(cpm) : "—";
    case "frequency":      return freq > 0 ? `${freq.toFixed(1)}×` : "—";
    case "ctr":            return ctr > 0 ? `${ctr.toFixed(2)}%` : "—";
    case "clicks":         return Math.round(a.clicks).toLocaleString("en-IN");
    case "cpc":            return cpc > 0 ? cur(cpc) : "—";
    case "acos":           return acos > 0 ? `${acos.toFixed(1)}%` : "—";
    default:               return "—";
  }
}

// Only KPIs this table can actually populate — probe fmtAqKpi with a full row;
// anything still "—" (Views, CPV, Leads, …) is dropped from the column picker.
const AQ_SAMPLE = { spend: 5000, impressions: 100000, clicks: 1500, reach: 40000, frequency: 2.5, conversions: 80, conversionValue: 120000 } as ReturnType<typeof useAdSetInsights>["adsets"][number];
const AQ_FETCHABLE = ALL_STANDARD_KPIS.filter((k) => fmtAqKpi(k.id, AQ_SAMPLE, (n) => String(n)) !== "—");

// ─── §6 Audience Quality ────────────────────────────────────────────────────

function AudienceQuality({ adsets, loading, currency }: { adsets: ReturnType<typeof useAdSetInsights>["adsets"]; loading: boolean; currency: string }) {
  const sorted = useMemo(() => [...adsets].sort((a, b) => b.spend - a.spend), [adsets]);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(AQ_DEFAULTS, "aud-quality");

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Meta provides:</strong> Orders, Revenue, AOV, ROAS, CPA per ad set. &nbsp;
          <strong>Needs Shopify/CRM (v1.1):</strong> Repeat Rate, LTV, Refund Rate, NC ROAS.
        </span>
      </div>
      <ColumnPickerButton
        cols={cols} allDefs={AQ_FETCHABLE} defaultIds={AQ_DEFAULTS}
        pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
        toggleCol={toggleCol} resetCols={resetCols}
      />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Audience (Ad Set)</th>
              {cols.map((id, colIdx) => {
                const k = STD_KPI_MAP.get(id);
                return (
                  <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <ColHeader
                      colIdx={colIdx} currentId={id} label={k?.label ?? id}
                      allDefs={AQ_FETCHABLE} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-[220px]" title={a.name}>{a.name}</td>
                {cols.map((id) => (
                  <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {fmtAqKpi(id, a, cur)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Repeat Rate / LTV / Refund Rate require Shopify or CRM integration — coming in v1.1.</p>
    </div>
  );
}

// ─── §14 Customer Value Segmentation ────────────────────────────────────────

function CustomerValueSegmentation() {
  const SEGMENTS = [
    { seg: "First Purchase",  customers: "—", revenue: "—", orders: "—", aov: "—", ltv: "—" },
    { seg: "2 Purchases",     customers: "—", revenue: "—", orders: "—", aov: "—", ltv: "—" },
    { seg: "3–5 Purchases",   customers: "—", revenue: "—", orders: "—", aov: "—", ltv: "—" },
    { seg: "6+ Purchases",    customers: "—", revenue: "—", orders: "—", aov: "—", ltv: "—" },
    { seg: "VIP Top 10%",     customers: "—", revenue: "—", orders: "—", aov: "—", ltv: "—" },
  ];
  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-bold text-orange-900 mb-1">Requires Shopify / CRM integration</h3>
          <p className="text-xs text-orange-800 leading-relaxed">
            Meta&apos;s Ads API tracks aggregate conversions and revenue, but cannot segment individual customers by purchase frequency (1st purchase vs. 2nd purchase vs. VIP). This data lives in your order management system.
          </p>
          <p className="text-xs text-orange-800 mt-2 leading-relaxed">
            <strong>v1.1 roadmap:</strong> Connect Shopify via the Shopify Admin API to pull customer lifetime segments and map them back to ad-set ROAS.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm opacity-60">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Customer Segment</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Customers</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Revenue</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Orders</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">AOV</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">LTV</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map((s) => (
              <tr key={s.seg} className="border-b border-gray-100">
                <td className="px-4 py-2.5 text-gray-700">{s.seg}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{s.customers}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{s.revenue}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{s.orders}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{s.aov}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{s.ltv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── §15 Product Affinity by Audience ───────────────────────────────────────

function ProductAffinity() {
  const ROWS = [
    { audience: "Broad",    topProduct: "—", revenue: "—", orders: "—", aov: "—", repeatRate: "—" },
    { audience: "Interest", topProduct: "—", revenue: "—", orders: "—", aov: "—", repeatRate: "—" },
    { audience: "LAL",      topProduct: "—", revenue: "—", orders: "—", aov: "—", repeatRate: "—" },
    { audience: "Visitors", topProduct: "—", revenue: "—", orders: "—", aov: "—", repeatRate: "—" },
  ];
  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-bold text-orange-900 mb-1">Requires product catalog + order data</h3>
          <p className="text-xs text-orange-800 leading-relaxed">
            Meta&apos;s Ads API returns total conversion value per ad set, but not which specific SKUs or products were purchased. Product affinity requires matching ad conversions back to individual orders in your catalog.
          </p>
          <p className="text-xs text-orange-800 mt-2 leading-relaxed">
            <strong>v1.1 roadmap:</strong> Connect Shopify Product API + Order API to attribute which products each audience buys most — enabling budget allocation by product × audience.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm opacity-60">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Audience</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Top Product</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Revenue</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Orders</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">AOV</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Repeat Rate</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.audience} className="border-b border-gray-100">
                <td className="px-4 py-2.5 text-gray-700">{r.audience}</td>
                <td className="px-4 py-2.5 text-gray-400 italic text-xs">{r.topProduct}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{r.revenue}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{r.orders}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{r.aov}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">{r.repeatRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function AudienceQualityTab({ platform, dateRange, customStart, customEnd }: Props) {
  const [active, setActive] = useState("quality");
  const { adsets, loading, error, currency } = useAdSetInsights(platform, dateRange, customStart, customEnd);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Star className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Quality &amp; Value</h1>
            <p className="text-gray-600 mt-1">AOV, ROAS, CPA per audience from Meta · Customer value &amp; product affinity needs Shopify integration.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Audience Quality & Value"
          context={{
            adSetCount: adsets.length,
            totalSpend: adsets.reduce((s, a) => s + a.spend, 0),
            totalOrders: adsets.reduce((s, a) => s + a.conversions, 0),
            totalRevenue: adsets.reduce((s, a) => s + a.conversionValue, 0),
            avgRoas: adsets.length > 0 ? +(adsets.reduce((s, a) => s + (a.spend > 0 ? a.conversionValue / a.spend : 0), 0) / adsets.length).toFixed(2) : 0,
          }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={String(dateRange)}
          inline
        />
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

      {active === "quality"  && <AudienceQuality adsets={adsets} loading={loading} currency={currency} />}
      {active === "customer" && <CustomerValueSegmentation />}
      {active === "affinity" && <ProductAffinity />}

      <TabSummaryFooter
        tabName="Audience Quality & Value"
        lines={[
          `${adsets.length} ad set${adsets.length !== 1 ? "s" : ""} analysed across audience quality dimensions.`,
          `Total spend: ${adsets.reduce((s, a) => s + a.spend, 0).toLocaleString("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 })} · ${adsets.reduce((s, a) => s + a.conversions, 0).toLocaleString()} conversions.`,
          `Average ROAS: ${adsets.length > 0 ? (adsets.reduce((s, a) => s + (a.spend > 0 ? a.conversionValue / a.spend : 0), 0) / adsets.length).toFixed(2) : "—"}×.`,
        ]}
        context={{ adSetCount: adsets.length, totalSpend: adsets.reduce((s, a) => s + a.spend, 0) }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
