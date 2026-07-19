import { useState, useMemo, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { CampaignData } from "@/types";
import { TermText } from "@/components/shared/Term";
import { basisMetrics, BASIS_OPTIONS, BASIS_SUBTITLE, type SpendBasis, type LifetimeMap } from "@/lib/spend-basis";
import { currencyFor, formatMoney } from "@/lib/currency";
import AttributionInfo from "@/components/shared/AttributionInfo";
import FunnelStageCompare from "./FunnelStageCompare";
import { usePersistentValue } from "@/hooks/useColumnPrefs";

type Stage = "TOF" | "MOF" | "BOF";

function bucket(objective?: string): Stage | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video") || o.includes("store")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration")) return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog") || o.includes("app")) return "BOF";
  return "Unknown";
}

/** Each Y-axis metric the user can pick. Spend is first so it lands as the
 * default primary bar — the most natural baseline for "did I invest here?"
 * before layering Impressions / Reach / CPM on the secondary line. */
const METRIC_OPTIONS = [
  { id: "spend", label: "Spend", unit: "$" },
  { id: "impressions", label: "Impressions", unit: "" },
  { id: "reach", label: "Reach", unit: "" },
  { id: "cpm", label: "CPM", unit: "$" },
  { id: "frequency", label: "Frequency", unit: "" },
  { id: "clicks", label: "Clicks", unit: "" },
  { id: "ctr", label: "CTR", unit: "%" },
  { id: "cpc", label: "CPC", unit: "$" },
  { id: "engagements", label: "Engagements", unit: "" },
  { id: "engRate", label: "Eng Rate", unit: "%" },
  { id: "cpe", label: "CPE", unit: "$" },
  { id: "views", label: "Views", unit: "" },
  { id: "vtr", label: "VTR", unit: "%" },
  { id: "cpv", label: "CPV", unit: "$" },
  { id: "leads", label: "Leads", unit: "" },
  { id: "convRate", label: "Conv Rate", unit: "%" },
  { id: "cpl", label: "CPL", unit: "$" },
  { id: "atc", label: "ATC", unit: "" },
  { id: "atcConvRate", label: "ATC Conv Rate", unit: "%" },
  { id: "sales", label: "Sales", unit: "" },
  { id: "saleConvRate", label: "Sale Conv Rate", unit: "%" },
  { id: "cps", label: "CPS", unit: "$" },
] as const;

type MetricId = (typeof METRIC_OPTIONS)[number]["id"];

/** Aggregate per-stage metrics from the raw campaign list, on the chosen spend basis. */
function aggregateByStage(campaigns: CampaignData[], lifetime: LifetimeMap, basis: SpendBasis) {
  const init = () => ({
    campaignCount: 0, spend: 0, impressions: 0, clicks: 0,
    reach: 0, conversions: 0, conversionValue: 0,
    windowSpend: 0, windowClicks: 0, windowImpressions: 0,
  });
  const stages: Record<Stage, ReturnType<typeof init>> = {
    TOF: init(), MOF: init(), BOF: init(),
  };

  for (const c of campaigns) {
    const stage = bucket(c.objective);
    if (stage === "Unknown") continue;
    const s = stages[stage];
    s.campaignCount += 1;
    const { spend, impressions, clicks } = basisMetrics(c, lifetime, basis);
    s.spend += spend;
    s.impressions += impressions;
    s.clicks += clicks;
    s.reach += c.reach || 0;
    s.conversions += c.conversions || 0;
    s.conversionValue += c.conversionValue || 0;
    s.windowSpend += c.spend || 0;
    s.windowClicks += c.clicks || 0;
    s.windowImpressions += c.impressions || 0;
  }
  return stages;
}

type StageData = ReturnType<ReturnType<typeof aggregateByStage>[Stage] extends infer T ? () => T : never>;

/** Compute a single metric value for a given stage's aggregates. */
function metricValue(s: ReturnType<typeof aggregateByStage>[Stage], metric: MetricId): number {
  switch (metric) {
    case "spend": return s.spend;
    case "impressions": return s.impressions;
    case "clicks": return s.clicks;
    case "reach": return s.reach;
    case "sales": return s.conversions;
    case "cpm": return s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0;
    case "frequency": return s.reach > 0 ? s.windowImpressions / s.reach : 0;
    case "ctr": return s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
    case "cpc": return s.clicks > 0 ? s.spend / s.clicks : 0;
    case "convRate": return s.windowClicks > 0 ? (s.conversions / s.windowClicks) * 100 : 0;
    case "saleConvRate": return s.windowClicks > 0 ? (s.conversions / s.windowClicks) * 100 : 0;
    case "cps": return s.conversions > 0 ? s.windowSpend / s.conversions : 0;
    case "cpl": return s.conversions > 0 ? s.windowSpend / s.conversions : 0;
    case "cpv": return s.conversions > 0 ? s.windowSpend / s.conversions : 0;
    case "cpe": return s.clicks > 0 ? s.windowSpend / s.clicks : 0;
    // Metrics not available at campaign level from Meta API
    case "engagements": return 0;
    case "engRate": return 0;
    case "views": return 0;
    case "vtr": return 0;
    case "leads": return 0;
    case "atc": return 0;
    case "atcConvRate": return 0;
  }
}

function formatValue(v: number, unit: string, acctCurrency = "USD"): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  if (unit === "%") return `${v.toFixed(2)}%`;
  // Use account currency for monetary values instead of hardcoded "$"
  if (unit === "$") return formatMoney(v, acctCurrency, 2);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(v < 10 ? 1 : 0);
}

interface Props {
  campaigns: CampaignData[];
  /** Total campaigns on the ad account (unfiltered) — denominator for "% of Campaigns". */
  accountTotal?: number;
  /** Current date range string from the dashboard picker — used to auto-switch
   *  the basis to "window" so changing dates immediately reflects in the chart. */
  dateRange?: string;
  customStart?: string;
  customEnd?: string;
  /** When set, renders a header above the chart section for this platform slice. */
  platformLabel?: string;
}

/** Derive ISO start/end from the picker — mirrors AccountStructureTab.rangeToDates. */
function resolveWindow(range?: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

function fmtHumanDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

export default function FunnelStagePerformance({ campaigns, accountTotal, dateRange, customStart, customEnd, platformLabel }: Props) {
  // Detect account currency from campaign data — avoids hardcoding "$"
  const acctCurrency = currencyFor(campaigns, "meta");
  const { metaAccessToken, metaBusinessId } = useAuthStore();
  const [compareMode, setCompareMode] = useState(false);
  const keyPrefix = platformLabel ? `funnel-stage-perf-${platformLabel.toLowerCase()}` : "funnel-stage-perf";
  const [primaryMetric, setPrimaryMetric] = usePersistentValue<MetricId>(`${keyPrefix}-primary`, "spend");
  const [secondaryMetric, setSecondaryMetric] = usePersistentValue<MetricId>(`${keyPrefix}-secondary`, "cpm");
  const [tertiaryMetric, setTertiaryMetric] = usePersistentValue<MetricId>(`${keyPrefix}-tertiary`, "ctr");
  // Default to "window" so the date picker IMMEDIATELY affects the chart.
  // Avg/day uses lifetime data and ignores the date range — users found this confusing.
  const [basis, setBasis] = useState<SpendBasis>("window");

  // When the date range changes, auto-switch back to "window" so the user
  // always sees data for the period they selected.
  useEffect(() => {
    setBasis("window");
  }, [dateRange]);
  // Which stage's campaign list is expanded (merged into the summary cards).
  const [openStage, setOpenStage] = useState<Stage | null>(null);

  // Lifetime spend + run-dates per campaign — fetched on mount for ALL Meta
  // campaigns (not just zero-window ones) so Lifetime / Avg-day modes are
  // correct for active campaigns too. One batched call.
  const [lifetime, setLifetime] = useState<LifetimeMap>({});

  useEffect(() => {
    if (!metaAccessToken) return;
    const needFetch = campaigns
      .filter((c) => c.platform === "meta")
      .filter((c) => !(c.id in lifetime))
      .map((c) => c.id);
    if (needFetch.length === 0) return;
    fetch("/api/naming/campaigns/lifetime-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: needFetch }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.metrics) setLifetime((s) => ({ ...s, ...data.metrics }));
      })
      .catch(() => { /* silent — chart still renders with window data */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, metaAccessToken]);

  const stages = useMemo(() => aggregateByStage(campaigns, lifetime, basis), [campaigns, lifetime, basis]);

  // Frozen X-axis: TOF, MOF, BOF — even if some buckets are empty (shows 0).
  const stageOrder: Stage[] = ["TOF", "MOF", "BOF"];

  // Left-sidebar: campaigns %, spend %, impressions % per stage
  const loadedCampaignCount = stages.TOF.campaignCount + stages.MOF.campaignCount + stages.BOF.campaignCount;
  const totals = {
    // "% of Campaigns" divides by the whole ad account, not just the loaded/filtered set.
    campaignCount: accountTotal ?? loadedCampaignCount,
    spend: stages.TOF.spend + stages.MOF.spend + stages.BOF.spend,
    impressions: stages.TOF.impressions + stages.MOF.impressions + stages.BOF.impressions,
  };

  const pct = (val: number, total: number) => (total > 0 ? Math.round((val / total) * 100) : 0);

  // Chart data
  const primary = METRIC_OPTIONS.find((m) => m.id === primaryMetric)!;
  const secondary = METRIC_OPTIONS.find((m) => m.id === secondaryMetric)!;
  const tertiary = METRIC_OPTIONS.find((m) => m.id === tertiaryMetric)!;

  const chartData = stageOrder.map((stage) => ({
    stage,
    [primaryMetric]: Number(metricValue(stages[stage], primaryMetric).toFixed(2)),
    [secondaryMetric]: Number(metricValue(stages[stage], secondaryMetric).toFixed(2)),
    [`__tertiary__${tertiaryMetric}`]: Number(metricValue(stages[stage], tertiaryMetric).toFixed(2)),
  }));

  const stageColor = (stage: Stage) =>
    stage === "TOF" ? "bg-purple-500" : stage === "MOF" ? "bg-blue-500" : "bg-green-500";

  const isMeta = !platformLabel || platformLabel === "Meta";

  return (
   <div className="space-y-4">
    {platformLabel && (
      <div className="flex items-center gap-2 pt-2">
        <h3 className="text-base font-bold text-gray-900">{platformLabel}</h3>
        <span className="text-xs text-gray-500">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</span>
      </div>
    )}
    {/* Compare-periods toggle */}
    {isMeta && metaAccessToken && metaBusinessId && (
      <div className="flex justify-end">
        <button
          onClick={() => setCompareMode((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            compareMode
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
          }`}
        >
          {compareMode ? "✕ Close comparison" : "⇄ Compare two periods"}
        </button>
      </div>
    )}

    {isMeta && compareMode && metaAccessToken && metaBusinessId && (
      <FunnelStageCompare
        metaAccessToken={metaAccessToken}
        metaBusinessId={metaBusinessId}
        currency={acctCurrency}
      />
    )}

    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Left: 3 small sparkbar groups — Campaigns %, Spend %, Impressions % */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-1">Funnel Distribution</h3>
        <p className="text-xs text-gray-500 mb-4">
          <TermText>How TOF / MOF / BOF split across your account — by count, spend, and impressions.</TermText>
        </p>

        {([
          { label: "% of Campaigns", get: (s: Stage) => pct(stages[s].campaignCount, totals.campaignCount), totalLabel: `${totals.campaignCount} campaigns` },
          { label: "% of Spend", get: (s: Stage) => pct(stages[s].spend, totals.spend), totalLabel: formatValue(totals.spend, "$", acctCurrency) + " total" },
          { label: "% of Impressions", get: (s: Stage) => pct(stages[s].impressions, totals.impressions), totalLabel: formatValue(totals.impressions, "") + " total" },
        ] as const).map((row) => (
          <div key={row.label} className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700">{row.label}</span>
              <span className="text-[10px] text-gray-400">{row.totalLabel}</span>
            </div>
            <div className="space-y-1.5">
              {stageOrder.map((stage) => {
                const p = row.get(stage);
                return (
                  <div key={stage}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-mono text-gray-700 w-9">{stage}</span>
                      <span className="font-mono text-gray-900">{p}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`${stageColor(stage)} h-full transition-all`} style={{ width: `${p}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right: chart with axis selectors */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between mb-1 gap-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1">
            Stage Performance
            <AttributionInfo compact />
          </h3>
          {/* Spend-basis toggle — keeps every bar on the SAME time basis. */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            {BASIS_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBasis(b.id)}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                  basis === b.id ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500">
          <TermText>{BASIS_SUBTITLE[basis]}</TermText>
        </p>
        {basis === "window" && (() => {
          const win = resolveWindow(dateRange, customStart, customEnd);
          const days = Math.max(1, Math.round((new Date(win.endDate).getTime() - new Date(win.startDate).getTime()) / 86_400_000) + 1);
          return (
            <p className="text-[11px] text-gray-500 mt-0.5 mb-4 font-mono">
              Window: <span className="font-semibold text-gray-700">{fmtHumanDate(win.startDate)} → {fmtHumanDate(win.endDate)}</span>{" "}
              <span className="text-gray-400">({days} days)</span>
            </p>
          );
        })()}
        {basis !== "window" && <div className="mb-4" />}

        {/* Axis selectors */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">X axis:</span>
            <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded font-semibold text-gray-700">
              Funnel Stage (frozen)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">Primary Y:</span>
            <select
              value={primaryMetric}
              onChange={(e) => setPrimaryMetric(e.target.value as MetricId)}
              className="px-2 py-1 bg-white border border-gray-300 rounded font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">Secondary Y:</span>
            <select
              value={secondaryMetric}
              onChange={(e) => setSecondaryMetric(e.target.value as MetricId)}
              className="px-2 py-1 bg-white border border-gray-300 rounded font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">Tertiary Y:</span>
            <select
              value={tertiaryMetric}
              onChange={(e) => setTertiaryMetric(e.target.value as MetricId)}
              className="px-2 py-1 bg-white border border-orange-300 rounded font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Composed chart: bars for primary, line for secondary */}
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 80, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="stage" stroke="#6b7280" tick={{ fill: "#374151", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="#4f46e5"
                tick={{ fill: "#4f46e5", fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatValue(v, primary.unit, acctCurrency)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#10b981"
                tick={{ fill: "#10b981", fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatValue(v, secondary.unit, acctCurrency)}
              />
              <YAxis
                yAxisId="right2"
                orientation="right"
                stroke="#f59e0b"
                tick={{ fill: "#f59e0b", fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatValue(v, tertiary.unit, acctCurrency)}
                width={60}
              />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                formatter={(value: number, name: string) => {
                  if (name === primary.label) return [formatValue(value, primary.unit, acctCurrency), name];
                  if (name === secondary.label) return [formatValue(value, secondary.unit, acctCurrency), name];
                  if (name === tertiary.label) return [formatValue(value, tertiary.unit, acctCurrency), name];
                  return [value, name];
                }}
                contentStyle={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="left"
                dataKey={primaryMetric}
                name={primary.label}
                fill="#4f46e5"
                radius={[4, 4, 0, 0]}
                animationDuration={600}
                animationEasing="ease-out"
              />
              <Line
                yAxisId="right"
                dataKey={secondaryMetric}
                name={secondary.label}
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 5, fill: "#10b981" }}
                activeDot={{ r: 7 }}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Line
                yAxisId="right2"
                dataKey={`__tertiary__${tertiaryMetric}`}
                name={tertiary.label}
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 5, fill: "#f59e0b" }}
                activeDot={{ r: 7 }}
                strokeDasharray="5 3"
                animationDuration={800}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Merged per-stage summary — Primary + Secondary metric values, campaign
            count, and a click-to-expand toggle, all in one row (no separate
            "Campaigns per stage" cards below). */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="text-xs font-semibold text-gray-700 mb-2">Per-stage summary — click a stage to see its campaigns</div>
          <div className="grid grid-cols-3 gap-2">
            {stageOrder.map((stage) => {
              const count = stages[stage].campaignCount;
              const isOpen = openStage === stage;
              return (
                <button
                  key={stage}
                  onClick={() => setOpenStage(isOpen ? null : stage)}
                  className={`text-left text-xs border rounded p-2.5 transition ${isOpen ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-gray-900">{stage}</span>
                    <span className="text-gray-500">{count} campaign{count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="text-gray-600">
                    {primary.label}:{" "}
                    <span className="font-mono text-indigo-700 font-semibold">
                      {formatValue(metricValue(stages[stage], primaryMetric), primary.unit, acctCurrency)}
                    </span>
                  </div>
                  <div className="text-gray-600">
                    {secondary.label}:{" "}
                    <span className="font-mono text-green-700 font-semibold">
                      {formatValue(metricValue(stages[stage], secondaryMetric), secondary.unit, acctCurrency)}
                    </span>
                  </div>
                  <div className="text-gray-600">
                    {tertiary.label}:{" "}
                    <span className="font-mono font-semibold" style={{ color: "#d97706" }}>
                      {formatValue(metricValue(stages[stage], tertiaryMetric), tertiary.unit, acctCurrency)}
                    </span>
                  </div>
                  <div className="text-[10px] text-indigo-600 mt-1">{isOpen ? "▼ Hide campaigns" : "▶ Show campaigns"}</div>
                </button>
              );
            })}
          </div>

          {/* Expandable per-campaign detail for the open stage. */}
          <StageCampaignBreakdown campaigns={campaigns} bucket={bucket} lifetime={lifetime} openStage={openStage} acctCurrency={acctCurrency} />

          {/* Verify-against-Ads-Manager footer — spells out exactly what the
              chart is showing so the client can reproduce the totals in Meta. */}
          {isMeta && basis === "window" && (() => {
            const win = resolveWindow(dateRange, customStart, customEnd);
            const days = Math.max(1, Math.round((new Date(win.endDate).getTime() - new Date(win.startDate).getTime()) / 86_400_000) + 1);
            const adsMgrUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?date=${win.startDate}_${win.endDate}%2Cmaximum&insights_date=${win.startDate}_${win.endDate}%2Cmaximum`;
            const totalCount = (campaigns || []).filter((c) => bucket(c.objective) !== "Unknown").length;
            return (
              <div className="mt-4 border-t border-gray-100 pt-3 space-y-1.5">
                <div className="text-[11px] font-semibold text-gray-700">Verify against Ads Manager</div>
                <ul className="text-[11px] text-gray-600 space-y-0.5 leading-relaxed">
                  <li>• <strong>Window:</strong> <span className="font-mono">{fmtHumanDate(win.startDate)} → {fmtHumanDate(win.endDate)}</span> ({days} days)</li>
                  <li>• <strong>Attribution:</strong> 7-day click + 1-day view (Meta default — change account default and reload to override)</li>
                  <li>• <strong>Campaigns shown:</strong> {totalCount} of {campaigns.length} (TOF/MOF/BOF classified — campaigns with an unrecognised objective are excluded)</li>
                  <li>• <strong>Basis:</strong> Window — spend is exactly what Meta Insights returns for the selected range (paused campaigns may show ₹0)</li>
                </ul>
                <a
                  href={adsMgrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900"
                >
                  Open Ads Manager with this date range ↗
                </a>
              </div>
            );
          })()}
        </div>
      </div>
    </div>

   </div>
  );
}

interface BreakdownProps {
  acctCurrency: string;
  campaigns: CampaignData[];
  bucket: (objective?: string) => Stage | "Unknown";
  /** Lifetime metrics cache, passed down from the parent so we don't re-fetch. */
  lifetime: Record<string, { spend: number; impressions: number; clicks: number; dateStart?: string; dateStop?: string }>;
  /** Controlled: which stage is expanded (driven by the merged summary cards). */
  openStage: Stage | null;
}

function StageCampaignBreakdown({ campaigns, bucket, lifetime, openStage, acctCurrency }: BreakdownProps) {
  const grouped: Record<Stage, CampaignData[]> = { TOF: [], MOF: [], BOF: [] };
  for (const c of campaigns) {
    const s = bucket(c.objective);
    if (s === "Unknown") continue;
    grouped[s].push(c);
  }

  const fmtMoney = (n: number, currency = acctCurrency) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `$${Math.round(n).toLocaleString()}`;
    }
  };

  return (
    <>
      {openStage && (
        <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 border-b border-gray-200">
            {openStage} campaigns ({grouped[openStage].length})
          </div>
          {grouped[openStage].length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500 text-center">No campaigns in this stage.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Campaign</th>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Objective</th>
                  <th className="px-3 py-1.5 text-center text-gray-600 font-semibold">Status</th>
                  <th className="px-3 py-1.5 text-right text-gray-600 font-semibold">Spend (window)</th>
                  <th className="px-3 py-1.5 text-right text-gray-600 font-semibold">Lifetime spend</th>
                  <th className="px-3 py-1.5 text-right text-gray-600 font-semibold">Impressions (window)</th>
                </tr>
              </thead>
              <tbody>
                {grouped[openStage].map((c) => {
                  const isActive = c.status === "ACTIVE" || c.status === "ENABLED";
                  const lt = lifetime[c.id];
                  const hadWindowSpend = c.spend !== undefined && c.spend > 0;
                  return (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="px-3 py-1.5 font-mono text-gray-900 truncate max-w-xs" title={c.name}>{c.name}</td>
                      <td className="px-3 py-1.5 text-gray-700">{c.objective || "—"}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{c.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                        {c.spend !== undefined ? fmtMoney(c.spend, c.currency || "USD") : <span className="text-gray-400 italic">no data</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {hadWindowSpend ? (
                          <span className="text-gray-400">—</span>
                        ) : lt ? (
                          lt.spend > 0 ? (
                            <span className="text-indigo-700 font-semibold" title={lt.dateStart && lt.dateStop ? `Lifetime range: ${lt.dateStart} → ${lt.dateStop}` : undefined}>
                              {fmtMoney(lt.spend, c.currency || "USD")}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">never spent</span>
                          )
                        ) : c.platform === "meta" ? (
                          <span className="text-gray-400 italic">loading…</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                        {c.impressions !== undefined ? c.impressions.toLocaleString() : <span className="text-gray-400 italic">no data</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="bg-blue-50 border-t border-blue-200 px-3 py-2 text-[11px] text-blue-900">
            <strong>Spend (window)</strong> = spend in your selected date range. <strong>Lifetime spend</strong> = total spend the campaign ever made (auto-fetched for paused / no-window-spend campaigns). If both are $0 the campaign genuinely never delivered — check it in Meta Ads Manager.
          </div>
        </div>
      )}
    </>
  );
}
