/**
 * Shared KPI value resolver + formatter for the 32 canonical IDs in
 * ALL_STANDARD_KPIS (see src/components/shared/ColumnPicker.tsx).
 *
 * Tables across the app share the same Columns picker, so they need a single
 * way to: (a) pull the value for any picked KPI from a row that has the
 * standard Meta fields (spend, impressions, clicks, reach, conversions,
 * conversionValue), and (b) format it for display. KPIs that Meta doesn't
 * expose at the row level (views, vtr, engagements, leads, addToCart, install,
 * sales, etc.) resolve to null/"—" — they show up in the picker but render
 * blank rather than fabricating numbers.
 */

import { formatMoney } from "./currency";
import { ALL_STANDARD_KPIS, type ColDef } from "@/components/shared/ColumnPicker";

export interface KpiRow {
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  frequency?: number;
  conversions?: number;
  conversionValue?: number;
}

/** Returns the numeric value for a standard KPI id from a row, or null if not derivable. */
export function getStandardKpi(r: KpiRow, id: string): number | null {
  const spend = r.spend ?? 0;
  const imps = r.impressions ?? 0;
  const clicks = r.clicks ?? 0;
  const reach = r.reach ?? 0;
  const conv = r.conversions ?? 0;
  const revenue = r.conversionValue ?? 0;
  switch (id) {
    // Core
    case "spend":          return spend;
    case "revenue":        return revenue;
    case "orders":         return conv;
    case "roas":           return spend > 0 ? revenue / spend : 0;
    case "cpa":            return conv > 0 ? spend / conv : 0;
    case "cvr":            return clicks > 0 ? (conv / clicks) * 100 : 0;
    case "aov":            return conv > 0 ? revenue / conv : 0;
    // Awareness
    case "impressions":    return imps;
    case "reach":          return reach;
    case "cpm":            return imps > 0 ? (spend / imps) * 1000 : 0;
    case "frequency":      return r.frequency ?? (reach > 0 ? imps / reach : 0);
    // Creative quality
    case "ctr":            return imps > 0 ? (clicks / imps) * 100 : 0;
    // Consideration
    case "clicks":         return clicks;
    case "cpc":            return clicks > 0 ? spend / clicks : 0;
    // Aliases — same semantics, different label
    case "convRate":       return clicks > 0 ? (conv / clicks) * 100 : 0;
    case "cps":            return conv > 0 ? spend / conv : 0;
    case "cpl":            return conv > 0 ? spend / conv : 0;
    // Not derivable from Meta insights at the row level
    case "views":
    case "cpv":
    case "vtr":
    case "engagements":
    case "engagementRate":
    case "cpe":
    case "leads":
    case "traffic":
    case "addToCart":
    case "atcConvRate":
    case "install":
    case "cpi":
    case "sales":
    case "saleConvRate":
    case "acos":
      return null;
    default:
      return null;
  }
}

/**
 * The subset of ALL_STANDARD_KPIS that getStandardKpi can actually resolve from
 * the standard Meta row fields. KPIs Meta doesn't expose at the row level (views,
 * cpv, vtr, engagements, leads, sales, acos, …) resolve to null and are excluded,
 * so tables don't offer dead columns that only ever show "—".
 *
 * Probed with a fully-populated sample row so conditional metrics (cpa, aov, …)
 * count as supported.
 */
const FETCHABLE_SAMPLE: KpiRow = {
  spend: 5000, impressions: 100000, clicks: 1500, reach: 40000,
  frequency: 2.5, conversions: 80, conversionValue: 120000,
};

export const FETCHABLE_KPIS: ColDef[] = ALL_STANDARD_KPIS.filter(
  (k) => getStandardKpi(FETCHABLE_SAMPLE, k.id) !== null
);

/** Returns a formatted display string for a KPI id given a row + currency. */
export function formatStandardKpi(r: KpiRow, id: string, currency: string): string {
  const v = getStandardKpi(r, id);
  if (v === null || !Number.isFinite(v)) return "—";
  // Money
  if (["spend", "revenue", "cpm", "cpc", "cpa", "aov", "cpv", "cpe", "cpl", "cpi", "cps"].includes(id)) {
    if (v === 0) return "—";
    return formatMoney(v, currency, 0);
  }
  // Percent
  if (["ctr", "cvr", "convRate", "vtr", "engagementRate", "atcConvRate", "saleConvRate", "acos"].includes(id)) {
    if (v === 0) return "—";
    return `${v.toFixed(2)}%`;
  }
  // Multiplier
  if (id === "roas") {
    if (v === 0) return "—";
    return `${v.toFixed(2)}×`;
  }
  // Decimal (frequency)
  if (id === "frequency") {
    if (v === 0) return "—";
    return v.toFixed(2);
  }
  // Integer counts
  if (v === 0) return "0";
  return Math.round(v).toLocaleString("en-IN");
}
