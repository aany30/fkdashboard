/**
 * POST /api/reporting/breakdown/dv360
 *
 * DV360 breakdowns via Bid Manager v2 — same response shape as the Meta
 * breakdown route ({source, rows}) so reporting tabs can reuse rendering.
 *
 * Supported breakdowns:
 *   age | gender | age,gender  → YOUTUBE_AUDIENCE report (FILTER_AGE/FILTER_GENDER
 *                                are only valid in YouTube-type reports; STANDARD
 *                                reports reject them for display/video delivery).
 *   country | region | city | region,city | zip → STANDARD geo dimensions
 *                                (FILTER_COUNTRY / FILTER_REGION / FILTER_CITY /
 *                                 FILTER_ZIP_POSTAL_CODE).
 *   device | daily | environment | exchange       → STANDARD.
 *
 * Async BM flow with poll budget + cache; on timeout returns 202 {status:
 * "pending"} and the client hook retries (the query resumes via cache).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type BMResult } from "@/lib/api-clients/dv360";
import { isDemoCredential, getDemoDV360Breakdown } from "@/lib/demo-data";
import { reportCache, queryIdCache, reportCacheKey } from "@/lib/report-cache";
import { geoName } from "@/lib/geo-names";

export const config = { maxDuration: 60 };

interface BreakdownRow {
  label: string;
  breakdownValues: Record<string, string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  videoViews: number;
}

// Each breakdown maps to one or more BM dimensions. `cols` lists the label
// columns IN ORDER — the first is primary (used to drop blank rows), and the
// combined label is `col1 · col2`. Each col carries a semantic `key` so the
// response's `breakdownValues` gets per-dimension values (e.g. {region, city})
// — the geo drilldown matches cities to regions on those keys. `re` is a
// fallback matcher since BM's CSV header casing/spacing varies by report type.
//
// `demographic: true` marks currency-free breakdowns (no revenue/spend column).
// Any dimension BM rejects (400) degrades gracefully to { unsupported: true }.
//
// NOTE: age/gender run as STANDARD reports here (no YOUTUBE_AUDIENCE — BM v2
// dropped that report type). STANDARD rejects FILTER_AGE/FILTER_GENDER for most
// display/video advertisers → unsupported:true, and the client falls back to the
// YouTube Analytics API. Left in place so that fallback keeps working.
interface BreakdownCol { key: string; column: string; re?: RegExp }
interface BreakdownDef {
  dimensions: string[];
  cols: BreakdownCol[];
  demographic?: boolean;
  reportType?: string;
}
const BREAKDOWN_TO_BM: Record<string, BreakdownDef> = {
  age:          { dimensions: ["FILTER_AGE"],    cols: [{ key: "age", column: "Age", re: /age/i }], demographic: true },
  gender:       { dimensions: ["FILTER_GENDER"], cols: [{ key: "gender", column: "Gender", re: /gender/i }], demographic: true },
  "age,gender": { dimensions: ["FILTER_AGE", "FILTER_GENDER"], demographic: true,
                  cols: [{ key: "age", column: "Age", re: /age/i }, { key: "gender", column: "Gender", re: /gender/i }] },
  country:      { dimensions: ["FILTER_COUNTRY"], cols: [{ key: "country", column: "Country", re: /country/i }] },
  // Region-name only (no country col) so the geo drilldown can match a city's
  // breakdownValues.region against the region row's label (mirrors Meta).
  region:       { dimensions: ["FILTER_REGION"], cols: [{ key: "region", column: "Region", re: /region|state/i }] },
  // City level — Region · City, keyed so the geo drilldown can nest cities under
  // their region (matches Meta's "region,city" breakdownValues shape).
  city:         { dimensions: ["FILTER_REGION", "FILTER_CITY"],
                  cols: [{ key: "region", column: "Region", re: /region|state/i }, { key: "city", column: "City", re: /^city/i }] },
  "region,city":{ dimensions: ["FILTER_REGION", "FILTER_CITY"],
                  cols: [{ key: "region", column: "Region", re: /region|state/i }, { key: "city", column: "City", re: /^city/i }] },
  // Postal code — a geo dimension (keep currency so spend/CPM/etc. populate).
  // Availability varies per advertiser; degrades to unsupported on 400.
  zip:          { dimensions: ["FILTER_ZIP_POSTAL_CODE"], cols: [{ key: "zip", column: "Zip/Postal Code", re: /zip|postal/i }] },
  // Language of the site/app/content the ad served on (FILTER_SITE_LANGUAGE).
  // A real delivery dimension — strong signal for the audience's language.
  language:     { dimensions: ["FILTER_SITE_LANGUAGE"], cols: [{ key: "language", column: "Language", re: /language/i }] },
  device:       { dimensions: ["FILTER_DEVICE_TYPE"], cols: [{ key: "device", column: "Device Type", re: /device/i }] },
  daily:        { dimensions: ["FILTER_DATE"], cols: [{ key: "daily", column: "Date", re: /^date/i }] },
  // FILTER_ENVIRONMENT is often unsupported per-advertiser (e.g. CTV-only) — mark
  // as demographic so it degrades gracefully to unsupported:true on 400.
  environment:  { dimensions: ["FILTER_ENVIRONMENT"], cols: [{ key: "environment", column: "Environment", re: /environment/i }], demographic: true },
  // FILTER_EXCHANGE returns the human-readable name ("Google Ad Manager") in the
  // "Exchange" column; FILTER_EXCHANGE_ID would return an opaque numeric id.
  exchange:     { dimensions: ["FILTER_EXCHANGE"], cols: [{ key: "exchange", column: "Exchange", re: /exchange/i }] },
  creative_type:{ dimensions: ["FILTER_CREATIVE_TYPE"], cols: [{ key: "creative_type", column: "Creative Type", re: /creative.type/i }] },
};

// Spend metrics require FILTER_ADVERTISER_CURRENCY as a dimension.
const CORE_METRICS = [
  "METRIC_IMPRESSIONS",
  "METRIC_CLICKS",
  "METRIC_REVENUE_ADVERTISER",
  "METRIC_TOTAL_CONVERSIONS",
  "METRIC_TRUEVIEW_VIEWS",
];
// Demographic-safe set — no revenue, so no currency dimension needed.
const DEMO_METRICS = [
  "METRIC_IMPRESSIONS",
  "METRIC_CLICKS",
  "METRIC_TOTAL_CONVERSIONS",
  "METRIC_TRUEVIEW_VIEWS",
];
// CM360 post-click revenue 400s for advertisers without a CM360 link (common),
// so it is NOT requested by default. RICH == CORE keeps the first query valid;
// the fallback harness below is retained as defense for future metric additions.
const RICH_METRICS = [...CORE_METRICS];

/** Bid Manager 400s for unsupported metrics/combos — safe to retry with fewer metrics. */
function isMetricComboError(message: string): boolean {
  return /HTTP 400/.test(message) && /not supported|combination of dimensions|invalid/i.test(message);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    { source: "demo" | "live"; rows: BreakdownRow[]; unsupported?: boolean } | { status: "pending" } | { error: string }
  >
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, breakdown, startDate, endDate } =
    req.body || {};

  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });
  const bm = BREAKDOWN_TO_BM[breakdown as string];
  if (!bm) return res.status(400).json({ error: `Unsupported breakdown "${breakdown}" for DV360` });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", rows: getDemoDV360Breakdown(breakdown) as BreakdownRow[] });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // Ordered attempts — each is a (dims, metrics) combo tried in turn on a
    // metric/dimension-combo 400. Currency-free tiers (no FILTER_ADVERTISER_
    // CURRENCY / no revenue metric) let dimensions that BM won't combine with
    // spend (e.g. FILTER_SITE_LANGUAGE on some inventory) still return
    // impressions/clicks rather than degrading to "unsupported".
    const withCurrency = [...bm.dimensions, "FILTER_ADVERTISER_CURRENCY"];
    const CURRENCY_FREE = ["METRIC_IMPRESSIONS", "METRIC_CLICKS", "METRIC_TOTAL_CONVERSIONS"];
    const attempts: { dims: string[]; metrics: string[] }[] = bm.demographic
      ? [
          { dims: bm.dimensions, metrics: DEMO_METRICS },
          { dims: bm.dimensions, metrics: ["METRIC_IMPRESSIONS", "METRIC_CLICKS"] },
        ]
      : [
          { dims: withCurrency,   metrics: RICH_METRICS },
          { dims: withCurrency,   metrics: CORE_METRICS },
          { dims: bm.dimensions,  metrics: CURRENCY_FREE },  // currency-free last resort
        ];

    // "pending" is signalled via a sentinel so the 202 short-circuits cleanly.
    const PENDING = Symbol("pending");
    const fetchRows = async (
      dims: string[], metrics: string[]
    ): Promise<Array<Record<string, string | number>> | typeof PENDING> => {
      const cacheKey = reportCacheKey({ advertiserId, startDate, endDate, dim: dims.join("+"), rt: bm.reportType ?? "STANDARD", metrics });
      const cached = reportCache.get(cacheKey);
      if (cached) return cached;

      let result: BMResult;
      const pendingIds = queryIdCache.get(cacheKey);
      if (pendingIds) {
        result = await client.resumeReport(pendingIds.queryId, pendingIds.reportId, 40_000);
      } else {
        result = await client.runBidManagerReport(
          { dimensions: dims, metrics, startDate, endDate, reportType: bm.reportType },
          40_000
        );
      }
      if (result.status === "pending") {
        queryIdCache.set(cacheKey, { queryId: result.queryId, reportId: result.reportId });
        return PENDING;
      }
      reportCache.set(cacheKey, result.rows);
      return result.rows;
    };

    let rows: Array<Record<string, string | number>> | typeof PENDING | null = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        rows = await fetchRows(attempts[i].dims, attempts[i].metrics);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isLast = i === attempts.length - 1;
        if (isMetricComboError(msg)) {
          if (isLast) {
            // BM rejected every combo — the dimension genuinely isn't supported
            // for this advertiser's inventory. Degrade gracefully to empty.
            console.warn(`DV360 "${breakdown}" breakdown not supported for this advertiser's report type — returning empty.`);
            return res.status(200).json({ source: "live", rows: [], unsupported: true });
          }
          console.warn(`DV360 "${breakdown}" combo rejected, trying next fallback:`, msg.slice(0, 160));
          continue;
        }
        throw err;
      }
    }
    if (rows === PENDING || rows === null) {
      if (rows === PENDING) return res.status(202).json({ status: "pending" });
      return res.status(200).json({ source: "live", rows: [], unsupported: true });
    }

    const num = (row: Record<string, string | number>, k: string) => {
      const v = row[k];
      return typeof v === "number" ? v : Number(String(v ?? "0").replace(/,/g, "")) || 0;
    };

    // Resolve a column name: exact match first, then a regex fallback (BM header
    // casing/spacing varies between report types).
    const resolveCol = (row: Record<string, string | number>, exact: string, re?: RegExp): string | null => {
      if (exact in row) return exact;
      if (re) { const k = Object.keys(row).find((kk) => re.test(kk)); if (k) return k; }
      return null;
    };

    // Diagnostic: if BM returned rows but the primary label column can't be
    // located (exact or regex), log the real headers so mapping can be fixed
    // without another blind round-trip.
    const primaryCol = bm.cols[0];
    if (rows.length > 0 && !resolveCol(rows[0], primaryCol.column, primaryCol.re)) {
      console.warn(
        `DV360 breakdown "${breakdown}": label column "${primaryCol.column}" not found. ` +
        `Actual columns: ${Object.keys(rows[0]).join(" | ")}`
      );
    }

    const normalizeDate = (raw: string): string => {
      if (breakdown !== "daily") return raw;
      // BM returns dates in various formats: "2026/07/01", "7/1/2026", "20260701"
      const slash = raw.replace(/\//g, "-");
      const d = new Date(slash + (slash.includes("T") ? "" : "T00:00:00Z"));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      // 8-digit compact: YYYYMMDD
      if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      return raw;
    };

    // BM's Country column returns the ISO-3166 alpha-2 code (e.g. "IN"); resolve
    // to a human name ("India"). Falls back to the raw value for anything that
    // isn't a recognizable 2-letter code.
    const countryNames = (() => {
      try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
    })();
    const prettyGeo = (key: string, raw: string): string => {
      if (!raw) return raw;
      if (key === "country" && countryNames && /^[A-Za-z]{2}$/.test(raw)) {
        try { return countryNames.of(raw.toUpperCase()) || raw; } catch { return raw; }
      }
      // FILTER_REGION / FILTER_CITY return numeric geo criteria IDs with no name
      // column — resolve to the canonical name (falls back to the ID if unmapped;
      // leaves non-numeric values like "Unknown" untouched).
      if ((key === "region" || key === "city") && /^\d+$/.test(raw)) {
        return geoName(raw) ?? raw;
      }
      return raw;
    };

    const out: BreakdownRow[] = rows
      .map((row) => {
        // Resolve each label column → its value, keyed by semantic name so the
        // response carries per-dimension breakdownValues (e.g. {region, city}).
        const values: Record<string, string> = {};
        const parts: string[] = [];
        for (const col of bm.cols) {
          const k = resolveCol(row, col.column, col.re);
          const raw = k ? String(row[k] ?? "").trim() : "";
          const v = col.key === "daily" ? normalizeDate(raw) : prettyGeo(col.key, raw);
          values[col.key] = v;
          if (v) parts.push(v);
        }
        const label = parts.join(" · ");
        return {
          rawPrimary: values[primaryCol.key] ?? "",
          label,
          breakdownValues: { ...values, [breakdown as string]: label },
          spend: num(row, "Revenue (Adv Currency)"),
          impressions: num(row, "Impressions"),
          clicks: num(row, "Clicks"),
          conversions: num(row, "Total Conversions"),
          conversionValue: num(row, "CM360 Post-Click Revenue"),
          videoViews: num(row, "TrueView Views"),
        };
      })
      // Drop only rows with no primary label (blank dimension cells).
      .filter((r) => r.rawPrimary !== "")
      .map(({ rawPrimary: _rawPrimary, ...r }) => r);

    return res.status(200).json({ source: "live", rows: out });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 breakdown fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
