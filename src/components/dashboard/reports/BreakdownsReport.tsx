/**
 * Reporting → Breakdowns.
 *
 * Client-side dims (Campaign / Platform / Objective / Status): aggregate the
 * campaign list already in memory — no new API call.
 *
 * API-backed dims (Age / Gender / Country / Device / Daily):
 *   Meta  → /api/reporting/breakdown/meta (synchronous)
 *   DV360 → /api/reporting/breakdown/dv360 (async BM, 202-retry)
 *
 * Placement + Age×Gender: Meta only.
 * Hourly: coming v1.1.
 */

import { useEffect, useMemo, useState } from "react";
import { Layers, AlertCircle, Info } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useAuthStore } from "@/store/auth";
import { usePersistentValue } from "@/hooks/useColumnPrefs";
import { currencyFor, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

type GroupBy =
  | "campaign" | "platform" | "objective" | "status"
  | "age" | "gender" | "country" | "impression_device" | "publisher_platform" | "age,gender"
  | "daily"
  | "hourly";

type Metric = "spend" | "impressions" | "clicks" | "conversions";

interface BreakdownRow {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  metricValue: number;
}

const GROUP_OPTIONS: Array<{
  id: GroupBy;
  label: string;
  source: "client" | "api" | "meta-only" | "coming-soon";
  note?: string;
}> = [
  { id: "campaign",          label: "Campaign",       source: "client" },
  { id: "platform",          label: "Platform",       source: "client" },
  { id: "objective",         label: "Objective",      source: "client" },
  { id: "status",            label: "Status",         source: "client" },
  { id: "daily",             label: "Daily trend",    source: "api" },
  { id: "age",               label: "Age",            source: "api" },
  { id: "gender",            label: "Gender",         source: "api" },
  { id: "country",           label: "Country",        source: "api" },
  { id: "impression_device", label: "Device",         source: "api" },
  { id: "publisher_platform",label: "Placement",      source: "meta-only" },
  { id: "age,gender",        label: "Age × Gender",   source: "meta-only" },
  { id: "hourly",            label: "Hour of day",    source: "coming-soon", note: "Coming v1.1" },
];

export default function BreakdownsReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading: campaignsLoading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const {
    metaAccessToken, metaBusinessId,
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId,
    demoMode,
  } = useAuthStore();
  const currency = currencyFor(campaigns, platform === "dv360" ? "dv360" : "meta");

  const [groupBy, setGroupBy] = usePersistentValue<GroupBy>("breakdowns-groupby", "campaign");
  const [metric, setMetric] = usePersistentValue<Metric>("breakdowns-metric", "spend");

  // API-backed breakdown data
  const [apiRows, setApiRows] = useState<BreakdownRow[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const opt = GROUP_OPTIONS.find((o) => o.id === groupBy)!;

  const [dv360Pending, setDv360Pending] = useState(false);

  useEffect(() => {
    if (opt.source !== "api" && opt.source !== "meta-only") { setApiRows([]); return; }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setApiLoading(true);
    setApiError(null);
    setDv360Pending(false);

    const mapRows = (data: any): BreakdownRow[] =>
      (data.rows || []).map((r: any) => ({
        label: r.label,
        spend: r.spend || 0,
        impressions: r.impressions || 0,
        clicks: r.clicks || 0,
        conversions: r.conversions || 0,
        conversionValue: r.conversionValue || 0,
        metricValue: r[metric] || 0,
      }));

    const fetchMeta = () => {
      const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
      const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
      if (!effectiveToken || !effectiveBiz) { setApiRows([]); setApiLoading(false); return; }
      fetch("/api/reporting/breakdown/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, breakdown: groupBy, startDate, endDate }),
      })
        .then((r) => r.json())
        .then((data) => { if (!cancelled) { if (data.error) { setApiError(data.error); setApiRows([]); } else setApiRows(mapRows(data)); } })
        .catch((e) => { if (!cancelled) setApiError(e.message); })
        .finally(() => { if (!cancelled) setApiLoading(false); });
    };

    const fetchDv360 = (attempt: number) => {
      const dvBreakdown = groupBy === "impression_device" ? "device" : groupBy;
      const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
      if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
        setApiRows([]); setApiLoading(false); return;
      }
      fetch("/api/reporting/breakdown/dv360", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: demoMode ? "demo-client" : dv360ClientId,
          clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
          refreshToken: effectiveRefresh,
          advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
          partnerId: dv360PartnerId || undefined,
          breakdown: dvBreakdown, startDate, endDate,
        }),
      })
        .then(async (r) => {
          if (cancelled) return;
          if (r.status === 202 && attempt < 12) {
            setDv360Pending(true);
            retryTimer = setTimeout(() => fetchDv360(attempt + 1), 5_000);
            return;
          }
          const data = await r.json();
          if (data.error) { setApiError(data.error); setApiRows([]); } else setApiRows(mapRows(data));
          setDv360Pending(false);
          setApiLoading(false);
        })
        .catch((e) => { if (!cancelled) { setApiError(e.message); setApiLoading(false); setDv360Pending(false); } });
    };

    if (opt.source === "meta-only" || platform === "meta") {
      fetchMeta();
    } else if (platform === "dv360") {
      fetchDv360(0);
    } else {
      fetchMeta();
    }

    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, platform, startDate, endDate, metaAccessToken, metaBusinessId, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, demoMode]);

  // Re-sort api rows when metric changes (no refetch needed)
  const sortedApiRows = useMemo(() => {
    return [...apiRows]
      .map((r) => ({ ...r, metricValue: r[metric] || 0 }))
      .sort((a, b) => groupBy === "daily" ? a.label.localeCompare(b.label) : b.metricValue - a.metricValue);
  }, [apiRows, metric, groupBy]);

  // Client-side aggregation for campaign/platform/objective/status
  const clientRows = useMemo((): BreakdownRow[] => {
    if (opt.source !== "client") return [];
    const map = new Map<string, Omit<BreakdownRow, "metricValue">>();
    const keyFn = (c: (typeof campaigns)[number]): string => {
      switch (groupBy) {
        case "campaign":  return c.name || c.id;
        case "platform":  return c.platform === "meta" ? "Meta" : "DV360";
        case "objective": return c.objective || "(none)";
        case "status":    return ["ACTIVE", "ENABLED"].includes((c.status || "").toUpperCase()) ? "Active" : (c.status || "Unknown");
        default:          return c.name || c.id;
      }
    };
    for (const c of campaigns) {
      const k = keyFn(c);
      const cur = map.get(k) || { label: k, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      cur.spend += c.spend || 0;
      cur.impressions += c.impressions || 0;
      cur.clicks += c.clicks || 0;
      cur.conversions += c.conversions || 0;
      cur.conversionValue += c.conversionValue || 0;
      map.set(k, cur);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, metricValue: r[metric as keyof typeof r] as number || 0 }))
      .sort((a, b) => b.metricValue - a.metricValue);
  }, [campaigns, groupBy, metric, opt.source]);

  const rows = opt.source === "client" ? clientRows : sortedApiRows;
  const rowsWithRoas = useMemo(
    () => rows.map((r) => ({ ...r, roas: r.spend > 0 ? r.conversionValue / r.spend : 0 })),
    [rows]
  );
  const { sorted, sort, toggle } = useSort(rowsWithRoas, "spend", "desc");
  const loading = opt.source === "client" ? campaignsLoading : (apiLoading && !dv360Pending);

  const cur = (n: number) => formatMoney(n, currency, 0);
  const fmtMetric = (v: number) => metric === "spend" ? cur(v) : Math.round(v).toLocaleString("en-IN");

  const isDaily = groupBy === "daily";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Layers className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Breakdowns</h1>
            <p className="text-gray-600 mt-1">Slice your spend + delivery by any dimension.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">
            <span className="font-mono text-gray-700">{startDate}</span> → <span className="font-mono text-gray-700">{endDate}</span>
          </div>
          <AIExecutiveSummary
            tabName="Breakdowns Report"
            context={{
              breakdown: groupBy,
              metric,
              rowCount: rows.length,
              totalSpend: Math.round(rows.reduce((s, r) => s + (r.spend || 0), 0)),
              segments: [...rows]
                .sort((a, b) => (b.spend || 0) - (a.spend || 0))
                .slice(0, 25)
                .map((r) => ({
                  label: r.label, spend: Math.round(r.spend || 0),
                  impressions: r.impressions || 0, clicks: r.clicks || 0,
                  conversions: r.conversions || 0,
                  roas: (r.spend || 0) > 0 ? +(((r.conversionValue || 0) / (r.spend || 1))).toFixed(2) : 0,
                })),
            }}
            platform={platform}
            dateRange={String(dateRange)}
            inline
          />
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-700">Group by:</label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white"
          >
            <optgroup label="From campaign list">
              {GROUP_OPTIONS.filter((o) => o.source === "client").map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="API breakdowns">
              {GROUP_OPTIONS.filter((o) => o.source === "api").map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Meta only">
              {GROUP_OPTIONS.filter((o) => o.source === "meta-only").map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Coming v1.1">
              {GROUP_OPTIONS.filter((o) => o.source === "coming-soon").map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        {!isDaily && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-700">Metric:</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white"
              disabled={opt.source === "coming-soon" || (opt.source === "meta-only" && platform === "dv360")}
            >
              <option value="spend">Spend</option>
              <option value="impressions">Impressions</option>
              <option value="clicks">Clicks</option>
              <option value="conversions">Conversions</option>
            </select>
          </div>
        )}

        {/* Source badge */}
        {opt.source === "api" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
            <Info className="w-3 h-3" /> {platform === "dv360" ? "DV360 Bid Manager" : "Meta Insights API"}
          </span>
        )}
        {opt.source === "meta-only" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
            <Info className="w-3 h-3" /> Meta only
          </span>
        )}
        {opt.source === "client" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-semibold">
            From campaign list
          </span>
        )}
      </div>

      {/* Meta-only dims on DV360 */}
      {opt.source === "meta-only" && platform === "dv360" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2 text-xs text-yellow-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {opt.label} is a Meta-only breakdown. Switch to Meta or All to see this data.
        </div>
      )}

      {/* DV360 pending indicator */}
      {dv360Pending && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          DV360 report is generating — this can take up to a minute. Retrying automatically…
        </div>
      )}

      {/* Coming-soon panel */}
      {opt.source === "coming-soon" && (
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-yellow-600 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-yellow-900 mb-1">{opt.label} — coming in v1.1</h3>
          <p className="text-yellow-800 text-sm max-w-xl mx-auto">{opt.note}</p>
        </div>
      )}

      {/* Error */}
      {apiError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {apiError}
        </div>
      )}

      {/* Loading */}
      {loading && opt.source !== "coming-soon" && (
        <div className="text-sm text-gray-500">Loading breakdown data…</div>
      )}

      {/* Charts + table for available dims */}
      {!loading && opt.source !== "coming-soon" && rows.length > 0 && (
        <>
          {/* Daily: line chart; everything else: bar chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-3">
              {isDaily ? "Spend over time" : `By ${opt.label} · ${metric.charAt(0).toUpperCase() + metric.slice(1)}`}
            </h3>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                {isDaily ? (
                  <LineChart data={rows.slice(0, 90)} margin={{ top: 10, right: 16, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={Math.floor(rows.length / 10)} height={60} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => cur(v)} />
                    <Tooltip cursor={{ stroke: "rgba(99,102,241,0.15)", strokeWidth: 1 }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => cur(v)} />
                    <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={600} animationEasing="ease-out" />
                  </LineChart>
                ) : (
                  <BarChart data={rows.slice(0, 20)} margin={{ top: 10, right: 16, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} height={80} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtMetric(v)} />
                    <Tooltip cursor={{ fill: "rgba(99,102,241,0.06)" }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmtMetric(v)} />
                    <Bar dataKey="metricValue" fill="#3b82f6" radius={[4, 4, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-900">All rows ({rows.length})</h3>
            </div>
            <div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
                  <tr>
                    <SortTh col="label" sort={sort} onToggle={toggle} className="text-[11px] uppercase">{opt.label}</SortTh>
                    <SortTh col="spend" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Spend</SortTh>
                    <SortTh col="impressions" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Impressions</SortTh>
                    <SortTh col="clicks" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Clicks</SortTh>
                    <SortTh col="conversions" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Conv</SortTh>
                    <SortTh col="roas" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">ROAS</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.label} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-900 truncate max-w-[300px]" title={r.label}>{r.label}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.impressions.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.clicks.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.conversions.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-gray-700">
                        {r.spend > 0 && r.conversionValue > 0 ? `${(r.conversionValue / r.spend).toFixed(2)}×` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !dv360Pending && opt.source !== "coming-soon" && rows.length === 0 && !apiError && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
          {opt.source === "meta-only" && platform === "dv360"
            ? `${opt.label} is available for Meta only. Switch platform to see data.`
            : "No data for the selected window. Connect an account or widen the date range."}
        </div>
      )}

      {rows.length > 0 && (() => {
        const cur = (n: number) => formatMoney(n, currency, 0);
        const totalSpend = rows.reduce((s, r) => s + (r.spend || 0), 0);
        const topSpend = [...rows].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
        const topRoas = [...rows].filter((r) => (r.spend || 0) > 0 && (r.conversionValue || 0) > 0)
          .sort((a, b) => (b.conversionValue! / b.spend!) - (a.conversionValue! / a.spend!))[0];
        const shareTop = totalSpend > 0 ? Math.round(((topSpend?.spend || 0) / totalSpend) * 100) : 0;
        return (
          <TabSummaryFooter
            lines={[
              `${rows.length} ${opt.label.toLowerCase()} segment${rows.length !== 1 ? "s" : ""} — total spend ${cur(totalSpend)}.`,
              topSpend ? `"${topSpend.label}" accounts for ${shareTop}% of spend at ${cur(topSpend.spend || 0)}.` : "",
              topRoas && topRoas.label !== topSpend?.label
                ? `Best ROAS: "${topRoas.label}" at ${((topRoas.conversionValue || 0) / (topRoas.spend || 1)).toFixed(2)}×.`
                : topRoas ? `Top spender "${topRoas.label}" is also your best ROAS performer.` : "No conversion data available for ROAS comparison.",
            ].filter(Boolean)}
            tabName={`Breakdowns — ${opt.label}`}
            context={{ groupBy, rowCount: rows.length }}
            platform={platform}
            dateRange={String(dateRange)}
          />
        );
      })()}

    </div>
  );
}
