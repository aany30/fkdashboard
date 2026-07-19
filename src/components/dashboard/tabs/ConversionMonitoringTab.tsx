import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import type { DateRange } from "@/components/shared/DateRangePicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

interface DailyRow {
  label: string;
  spend: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

/** Combined overview when both platforms are active: 3 KPI cards + dual-line chart. */
function CombinedSection({ metaRows, dvRows }: { metaRows: DailyRow[]; dvRows: DailyRow[] }) {
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const totalConv = metaRows.reduce((s, r) => s + r.conversions, 0) + dvRows.reduce((s, r) => s + r.conversions, 0);
  const totalSpend = metaRows.reduce((s, r) => s + r.spend, 0) + dvRows.reduce((s, r) => s + r.spend, 0);
  const cpa = totalConv > 0 ? inr(totalSpend / totalConv) : "—";

  // Merge Meta + DV360 by date label — union of all dates, zero-fill missing.
  const combined = useMemo(() => {
    const metaByDate = new Map(metaRows.map((r) => [r.label, r.conversions]));
    const dvByDate = new Map(dvRows.map((r) => [r.label, r.conversions]));
    const allDates = Array.from(new Set([...metaByDate.keys(), ...dvByDate.keys()])).sort();
    return allDates.map((d) => ({
      label: d,
      meta: metaByDate.get(d) ?? 0,
      dv360: dvByDate.get(d) ?? 0,
    }));
  }, [metaRows, dvRows]);

  const kpis = [
    { label: "Total Conversions", value: totalConv.toLocaleString("en-IN"), sub: "Meta + DV360" },
    { label: "Total Spend", value: inr(totalSpend), sub: "Combined" },
    { label: "Blended CPA", value: cpa, sub: "Spend ÷ conversions" },
  ];

  return (
    <div className="space-y-4 pb-2 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Combined Overview</h3>
        <span className="text-xs text-gray-400">Meta + DV360</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Conversions — Meta vs DV360</h3>
        {combined.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data for selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={combined} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ stroke: "rgba(99,102,241,0.15)", strokeWidth: 1 }}
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [v.toLocaleString("en-IN"), name === "meta" ? "Meta" : "DV360"]}
              />
              <Legend formatter={(v) => (v === "meta" ? "Meta" : "DV360")} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="meta" stroke="#3b82f6" strokeWidth={2} dot={false} name="meta" animationDuration={600} />
              <Line type="monotone" dataKey="dv360" stroke="#f97316" strokeWidth={2} dot={false} name="dv360" animationDuration={700} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/** One platform's conversion block: KPI row + daily charts. Revenue/ROAS are
 *  shown only when `showRevenue` (Meta always; DV360 only if CM360 conversion-
 *  revenue is present — otherwise those aren't fetchable, so they're omitted
 *  rather than shown as a misleading ₹0 / 0×). */
function ConversionSection({ header, sub, rows, loading, showRevenue, revenueNote }: {
  header?: string; sub?: string; rows: DailyRow[]; loading: boolean; showRevenue: boolean; revenueNote?: string;
}) {
  const totalConv = rows.reduce((s, r) => s + (r.conversions || 0), 0);
  const totalSpend = rows.reduce((s, r) => s + (r.spend || 0), 0);
  const totalRevenue = rows.reduce((s, r) => s + (r.conversionValue || 0), 0);
  const roas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "—";
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  const kpis = showRevenue
    ? [
        { label: "Total Conversions", value: totalConv.toLocaleString("en-IN") },
        { label: "Conversion Value", value: inr(totalRevenue) },
        { label: "ROAS", value: roas + "×" },
        { label: "CPA", value: totalConv > 0 ? inr(totalSpend / totalConv) : "—" },
      ]
    : [
        { label: "Total Conversions", value: totalConv.toLocaleString("en-IN") },
        { label: "Total Spend", value: inr(totalSpend) },
        { label: "CPA", value: totalConv > 0 ? inr(totalSpend / totalConv) : "—" },
      ];

  return (
    <div className="space-y-4">
      {header && (
        <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{header}</h2>
          {sub && <span className="text-xs text-gray-400 font-medium">{sub}</span>}
        </div>
      )}

      {!showRevenue && revenueNote && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">{revenueNote}</div>
      )}

      <div className={`grid grid-cols-2 ${kpis.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"} gap-4`}>
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Conversions</h3>
        {loading ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data for selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: "rgba(99,102,241,0.15)", strokeWidth: 1 }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v.toLocaleString("en-IN"), "Conversions"]} />
              <Line type="monotone" dataKey="conversions" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={600} animationEasing="ease-out" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{showRevenue ? "Daily Spend vs Conversion Value" : "Daily Spend"}</h3>
        {loading ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data for selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: "rgba(99,102,241,0.15)", strokeWidth: 1 }} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }} formatter={(v: number, name: string) => ["₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 }), name === "spend" ? "Spend" : "Conv. Value"]} />
              <Line type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={2} dot={false} name="spend" animationDuration={600} animationEasing="ease-out" />
              {showRevenue && <Line type="monotone" dataKey="conversionValue" stroke="#10b981" strokeWidth={2} dot={false} name="conversionValue" animationDuration={700} animationEasing="ease-out" />}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function ConversionMonitoringTab({ platform, dateRange, customStart, customEnd }: Props) {
  const useMeta = platform !== "dv360";
  const useDv = platform === "dv360" || platform === "both";
  const { rows: metaRows, loading: metaLoading } = useMetaBreakdown("daily", dateRange, customStart, customEnd, useMeta);
  const { rows: dvRows, loading: dvLoading } = useDV360Breakdown("daily", dateRange, customStart, customEnd, useDv);

  const metaData = metaRows as DailyRow[];
  const dvData = dvRows as DailyRow[];
  const loading = (useMeta && metaLoading) || (useDv && dvLoading);

  if (loading && metaData.length === 0 && dvData.length === 0) return <LoadingState message="Loading conversion data…" />;

  // DV360 conversion-revenue (and thus ROAS) is only present when CM360 is
  // linked — otherwise Bid Manager returns count-only. Show revenue metrics
  // for DV360 only when they're genuinely there (no misleading ₹0 / 0×).
  const dvHasRevenue = dvData.some((r) => r.conversionValue > 0);

  const sum = (arr: DailyRow[], k: keyof DailyRow) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const metaConv = sum(metaData, "conversions"), metaSpend = sum(metaData, "spend"), metaRev = sum(metaData, "conversionValue");
  const dvConv = sum(dvData, "conversions"), dvSpend = sum(dvData, "spend");
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6 section-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Conversion Monitoring</h2>
        <p className="text-sm text-gray-500 mt-1">Daily conversion trends and signal quality, per platform.</p>
      </div>

      {platform === "both" && (
        <CombinedSection metaRows={metaData} dvRows={dvData} />
      )}

      {useMeta && (
        <ConversionSection
          header={platform === "both" ? "Meta" : undefined}
          sub="Meta Ads"
          rows={metaData}
          loading={metaLoading}
          showRevenue
        />
      )}

      {useDv && (
        <ConversionSection
          header={platform === "both" ? "DV360" : undefined}
          sub="Display & Video 360"
          rows={dvData}
          loading={dvLoading}
          showRevenue={dvHasRevenue}
          revenueNote="Conversion value & ROAS aren't available — DV360 exposes them only via CM360 conversion-revenue, which isn't linked for this advertiser. Showing conversions, spend, and CPA (all real Bid Manager data)."
        />
      )}

      <TabSummaryFooter
        lines={[
          ...(useMeta ? [
            `${platform === "both" ? "Meta: " : ""}${metaConv.toLocaleString("en-IN")} conversions, ${inr(metaSpend)} spend${metaRev > 0 ? ` — ROAS ${(metaRev / metaSpend).toFixed(2)}×` : ""}.`,
          ] : []),
          ...(useDv ? [
            dvHasRevenue
              ? `${platform === "both" ? "DV360: " : ""}${dvConv.toLocaleString("en-IN")} conversions, ${inr(dvSpend)} spend — ROAS ${dvSpend > 0 ? (sum(dvData, "conversionValue") / dvSpend).toFixed(2) : "—"}×.`
              : `${platform === "both" ? "DV360: " : ""}${dvConv.toLocaleString("en-IN")} conversions, ${inr(dvSpend)} spend, CPA ${dvConv > 0 ? inr(dvSpend / dvConv) : "—"} — conversion value/ROAS not available via API.`,
          ] : []),
        ]}
        tabName="Conversion Monitoring"
        context={{ metaConversions: metaConv, metaSpend, dvConversions: dvConv, dvSpend, platform, dateRange }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
