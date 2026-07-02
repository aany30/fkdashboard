import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import type { DateRange } from "@/components/shared/DateRangePicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function ConversionMonitoringTab({ platform, dateRange, customStart, customEnd }: Props) {
  const enabled = platform !== "google";
  const { rows, loading } = useMetaBreakdown("daily", dateRange, customStart, customEnd, enabled);

  const totalConv    = rows.reduce((s, r) => s + (r.conversions || 0), 0);
  const totalSpend   = rows.reduce((s, r) => s + (r.spend || 0), 0);
  const totalRevenue = rows.reduce((s, r) => s + (r.conversionValue || 0), 0);
  const roas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "—";

  const kpis = [
    { label: "Total Conversions",  value: totalConv.toLocaleString("en-IN") },
    { label: "Conversion Value",   value: "₹" + totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
    { label: "ROAS",               value: roas + "×" },
    { label: "CPA",                value: totalConv > 0 ? "₹" + (totalSpend / totalConv).toFixed(0) : "—" },
  ];

  return (
    <div className="space-y-6 section-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Conversion Monitoring</h2>
        <p className="text-sm text-gray-500 mt-1">Daily conversion trends and signal quality across attribution windows.</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <div key={k.label} className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 animate-fade-in-up stagger-${Math.min(i + 1, 9)}`}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Daily conversion chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 chart-enter">
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

      {/* Daily spend + revenue */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 chart-enter">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Spend vs Conversion Value</h3>
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
              <Line type="monotone" dataKey="spend"           stroke="#6366f1" strokeWidth={2} dot={false} name="spend"          animationDuration={600} animationEasing="ease-out" />
              <Line type="monotone" dataKey="conversionValue" stroke="#10b981" strokeWidth={2} dot={false} name="conversionValue" animationDuration={700} animationEasing="ease-out" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <TabSummaryFooter
        lines={[
          `${totalConv.toLocaleString("en-IN")} total conversion${totalConv !== 1 ? "s" : ""} tracked across ${rows.length} day${rows.length !== 1 ? "s" : ""}.`,
          `Conversion value: ₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} — ROAS ${roas}×.`,
          totalConv > 0
            ? `Cost per acquisition: ₹${(totalSpend / totalConv).toFixed(0)} on ₹${totalSpend.toLocaleString("en-IN", { maximumFractionDigits: 0 })} total spend.`
            : "No conversions recorded in this date range — check pixel events and attribution windows.",
        ]}
        tabName="Conversion Monitoring"
        context={{ totalConversions: totalConv, totalSpend, totalRevenue, roas, platform, dateRange }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
