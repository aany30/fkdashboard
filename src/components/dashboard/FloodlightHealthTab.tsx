/**
 * Floodlight (DV360) — audit tab.
 *
 * Shows Floodlight group info, activity health table with 14-day sparklines,
 * health cards, zero-conversion callouts, and lookback advisory.
 * Visible only when platform = DV360 or All; shows N/A banner for Meta.
 */

import { useMemo } from "react";
import { AlertCircle, CheckCircle2, XCircle, TrendingDown, Info, Zap } from "lucide-react";
import LoadingState from "@/components/shared/LoadingState";
import { useFloodlight, activityHealth, type FloodlightActivity, type ActivityHealth } from "@/hooks/useFloodlight";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

const HEALTH_BADGE: Record<ActivityHealth, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  healthy:   { label: "Healthy",   cls: "bg-green-100 text-green-800",  Icon: CheckCircle2  },
  declining: { label: "Declining", cls: "bg-yellow-100 text-yellow-800", Icon: TrendingDown },
  zero:      { label: "Zero",      cls: "bg-red-100 text-red-800",      Icon: XCircle       },
  disabled:  { label: "Disabled",  cls: "bg-gray-100 text-gray-500",    Icon: AlertCircle   },
};

function MiniSparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 28;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4)}`).join(" ");
  const total = values.reduce((s, v) => s + v, 0);
  const color = total === 0 ? "#d1d5db" : "#3b82f6";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FloodlightHealthTab({ platform, dateRange }: Props) {
  const { data, loading, error } = useFloodlight();

  if (platform === "meta") {
    return (
      <div className="space-y-6">
        <Header platform={platform} dateRange={dateRange} />
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-yellow-900 mb-1">Not applicable</h3>
          <p className="text-yellow-800 text-sm">Floodlight is a DV360/CM360 tracking system. Switch to DV360 or All to view Floodlight health.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Header platform={platform} dateRange={dateRange} />
        <LoadingState message="Loading Floodlight data…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Header platform={platform} dateRange={dateRange} />
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      </div>
    );
  }

  if (!data || !data.group) {
    return (
      <div className="space-y-6">
        <Header platform={platform} dateRange={dateRange} />
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
          {data?.note || "No Floodlight configuration found. Connect a DV360 account with Floodlight enabled."}
        </div>
      </div>
    );
  }

  const acts = data.activities;
  const healthMap = acts.map((a) => ({ ...a, health: activityHealth(a) }));

  const counts = {
    total: acts.length,
    healthy: healthMap.filter((a) => a.health === "healthy").length,
    declining: healthMap.filter((a) => a.health === "declining").length,
    zero: healthMap.filter((a) => a.health === "zero").length,
    disabled: healthMap.filter((a) => a.health === "disabled").length,
  };

  const totalConversions = acts.reduce((s, a) => s + a.conversions14d.reduce((ss, v) => ss + v, 0), 0);

  // Real data snapshot for the AI summary. The Floodlight tab always uses a
  // fixed trailing 14-day window (not the dashboard picker), so we pass that
  // window explicitly — and include per-activity health, lookback, line-item
  // usage, and the first-7-vs-last-7 split that drives the "declining" flag, so
  // the AI's "how to improve" advice is grounded in these exact numbers.
  const windowLabel = data.windowStart && data.windowEnd
    ? `${data.windowStart} → ${data.windowEnd} (14 days)`
    : "last 14 days";
  const summaryContext = {
    platform,
    windowDays: 14,
    window: windowLabel,
    activityCount: counts.total,
    healthy: counts.healthy,
    declining: counts.declining,
    zeroConversion: counts.zero,
    disabled: counts.disabled,
    total14dConversions: totalConversions,
    cm360NamesAvailable: acts.some((a) => !/^Floodlight Activity /.test(a.name)),
    activities: healthMap.map((a) => {
      const first7 = a.conversions14d.slice(0, 7).reduce((s, v) => s + v, 0);
      const last7 = a.conversions14d.slice(7).reduce((s, v) => s + v, 0);
      return {
        name: a.name,
        health: a.health,
        conversions14d: a.conversions14d.reduce((s, v) => s + v, 0),
        first7Conversions: first7,
        last7Conversions: last7,
        weekOverWeekDropPct: first7 > 0 ? Math.round((1 - last7 / first7) * 100) : null,
        clickLookbackDays: a.clickLookbackDays,
        viewLookbackDays: a.viewLookbackDays,
        lineItems: a.lineItemCount ?? null,
        activeLineItems: a.activeLineItemCount ?? null,
        sslRequired: a.sslRequired ?? null,
      };
    }),
  };

  return (
    <div className="space-y-6">
      <Header platform={platform} dateRange={dateRange} summaryContext={summaryContext} summaryDateRange={windowLabel} />

      {/* 60-day banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Floodlight conversion reports are limited to a 60-day lookback window by the Bid Manager API.
        Showing a 14-day trend for each activity.
      </div>

      {/* API limitation note (e.g. third-party ad server advertisers) */}
      {data.note && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-xs text-amber-800">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {data.note}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label="Activities" value={counts.total} sub={`${counts.healthy} healthy`} color="blue" />
        <KpiCard label="Total Conversions" value={totalConversions.toLocaleString("en-IN")} sub="14-day window" color="green" />
        <KpiCard
          label="Issues"
          value={counts.zero + counts.declining}
          sub={`${counts.zero} zero · ${counts.declining} declining`}
          color={counts.zero + counts.declining > 0 ? "red" : "green"}
        />
      </div>

      {/* Floodlight group info */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-bold text-gray-900">Floodlight Group</span>
        </div>
        <div className="text-xs text-gray-600 break-words">
          {data.group.id !== "third-party"
            ? <>{data.group.name} · <span className="font-mono text-gray-500">{data.group.id}</span></>
            : <span className="text-gray-600">Discovered via line-item conversion tracking</span>
          }
          {data.windowStart && data.windowEnd && (
            <span className="ml-3 text-gray-400">Window: {data.windowStart} → {data.windowEnd}</span>
          )}
        </div>
      </div>

      {/* Activity table */}
      <ActivityTable activities={healthMap} />

      {/* Zero-conversion callouts */}
      {counts.zero > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
            <XCircle className="w-4 h-4" /> {counts.zero} activit{counts.zero === 1 ? "y" : "ies"} with zero conversions
          </h3>
          {healthMap.filter((a) => a.health === "zero").map((a) => (
            <div key={a.id} className="text-xs text-red-800 ml-6">
              <span className="font-semibold">{a.name}</span> — check that the Floodlight tag is deployed on the
              target page and that the activity is mapped to at least one line item.
            </div>
          ))}
        </div>
      )}

      {/* Declining callouts */}
      {counts.declining > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-bold text-yellow-900 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" /> {counts.declining} activit{counts.declining === 1 ? "y" : "ies"} declining
          </h3>
          {healthMap.filter((a) => a.health === "declining").map((a) => (
            <div key={a.id} className="text-xs text-yellow-800 ml-6">
              <span className="font-semibold">{a.name}</span> — second-week conversions dropped &gt;50% vs first week.
              Check tag firing and line-item pacing.
            </div>
          ))}
        </div>
      )}

      <TabSummaryFooter
        lines={[
          `${counts.total} Floodlight activit${counts.total !== 1 ? "ies" : "y"} — ${counts.healthy} healthy, ${counts.zero} zero-conversion, ${counts.declining} declining, ${counts.disabled} disabled.`,
          `14-day totals: ${totalConversions.toLocaleString("en-IN")} conversions.`,
          counts.zero > 0
            ? `Action needed: ${counts.zero} activit${counts.zero === 1 ? "y has" : "ies have"} no conversions — verify tag deployment.`
            : "All enabled activities are recording conversions.",
        ]}
        tabName="Floodlight Health"
        context={{ total: counts.total, healthy: counts.healthy, zero: counts.zero, declining: counts.declining, windowDays: 14, total14dConversions: totalConversions }}
        platform="dv360"
        dateRange={windowLabel}
      />
    </div>
  );
}

function Header({ platform, dateRange, summaryContext, summaryDateRange }: { platform: string; dateRange: DateRange; summaryContext?: Record<string, unknown>; summaryDateRange?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <Zap className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Floodlight Health</h1>
          <p className="text-gray-600 mt-1">DV360/CM360 Floodlight activity status, conversions, and health monitoring.</p>
        </div>
      </div>
      <AIExecutiveSummary
        tabName="Floodlight Health"
        context={summaryContext ?? { platform }}
        platform="dv360"
        dateRange={summaryDateRange ?? String(dateRange)}
        inline
      />
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const bg: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200", green: "bg-green-50 border-green-200",
    purple: "bg-purple-50 border-purple-200", red: "bg-red-50 border-red-200",
  };
  const text: Record<string, string> = {
    blue: "text-blue-700", green: "text-green-700", purple: "text-purple-700", red: "text-red-700",
  };
  return (
    <div className={`rounded-lg border p-4 ${bg[color] || bg.blue}`}>
      <div className="text-xs font-semibold text-gray-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${text[color] || text.blue}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

type ActivityWithHealth = FloodlightActivity & { health: ActivityHealth };

function ActivityTable({ activities }: { activities: ActivityWithHealth[] }) {
  const rows = useMemo(() =>
    activities.map((a) => ({
      ...a,
      total14d: a.conversions14d.reduce((s, v) => s + v, 0),
    })),
    [activities]
  );
  const { sorted, sort, toggle } = useSort(rows, "total14d", "desc");

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-900">Activities ({activities.length})</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
          <tr>
            <SortTh col="name" sort={sort} onToggle={toggle} className="text-[11px] uppercase">Activity</SortTh>
            <SortTh col="servingStatus" sort={sort} onToggle={toggle} className="text-[11px] uppercase">Status</SortTh>
            <SortTh col="health" sort={sort} onToggle={toggle} className="text-[11px] uppercase">Health</SortTh>
            <SortTh col="total14d" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Conv (14d)</SortTh>
            <th className="px-4 py-2.5 text-[11px] uppercase text-gray-500 text-left">Trend</th>
            <SortTh col="clickLookbackDays" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Click LB</SortTh>
            <SortTh col="viewLookbackDays" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">View LB</SortTh>
            <th className="px-4 py-2.5 text-[11px] uppercase text-gray-500 text-right">Line Items</th>
            <th className="px-4 py-2.5 text-[11px] uppercase text-gray-500 text-center">SSL</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const badge = HEALTH_BADGE[a.health];
            return (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[260px] truncate" title={a.name}>{a.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    a.servingStatus === "ENABLED" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                  }`}>
                    {a.servingStatus === "ENABLED" ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>
                    <badge.Icon className="w-3 h-3" /> {badge.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{a.total14d.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2.5"><MiniSparkline values={a.conversions14d} /></td>
                <td className="px-4 py-2.5 text-right text-gray-600">{a.clickLookbackDays > 0 ? `${a.clickLookbackDays}d` : "—"}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{a.viewLookbackDays > 0 ? `${a.viewLookbackDays}d` : "—"}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {a.lineItemCount != null
                    ? <span title={`${a.activeLineItemCount ?? 0} active`}>{a.lineItemCount} <span className="text-gray-400 text-[10px]">({a.activeLineItemCount ?? 0} active)</span></span>
                    : "—"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {a.sslRequired != null
                    ? <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${a.sslRequired ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {a.sslRequired ? "Yes" : "No"}
                      </span>
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
