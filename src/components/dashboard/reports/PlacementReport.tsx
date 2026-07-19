/**
 * Reporting → Placement
 *
 * Meta section:
 *   1. Placement Type chart — real platform_position rows classified to type
 *   2. Placement Ranked List — platform_position rows ranked by metric
 *   3. Publisher Detail Table — publisher_platform rows with KPI columns
 *
 * DV360 section:
 *   1. Environment chart — FILTER_ENVIRONMENT rows (Web / App / Connected TV)
 *   2. Exchange Ranked List — FILTER_EXCHANGE_ID rows ranked by metric
 *   3. Exchange Detail Table — same rows in tabular form
 */

import React, { useMemo, useRef, useState } from "react";
import { Map as MapIcon, ChevronDown, Info } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import { ColumnPickerButton, useColPicker, ColHeader, ColDef, ALL_STANDARD_KPIS } from "@/components/shared/ColumnPicker";
import { useMetaBreakdown, BreakdownRow } from "@/hooks/useMetaBreakdown";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentValue } from "@/hooks/useColumnPrefs";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEMENT_TYPES = ["Video", "Native", "Rich Media", "Display", "Audio", "CTV", "Other"] as const;
type PlacementType = typeof PLACEMENT_TYPES[number];

const TYPE_COLORS: Record<string, string> = {
  "Video":       "#6366f1",
  "Native":      "#10b981",
  "Rich Media":  "#f59e0b",
  "Display":     "#8b5cf6",
  "Audio":       "#06b6d4",
  "CTV":         "#ef4444",
  "Other":       "#9ca3af",
  // DV360 environment types
  "Web":          "#3b82f6",
  "App":          "#10b981",
  "Connected TV": "#ef4444",
  "AMP":          "#8b5cf6",
  "Unknown":      "#9ca3af",
};

// Deterministic mapping from Meta platform_position labels to placement types.
// No synthetic guessing — each key is a real value the Meta API returns.
const META_POSITION_TO_TYPE: Record<string, PlacementType> = {
  feed:                "Native",
  marketplace:         "Native",
  messenger_inbox:     "Native",
  search:              "Native",
  instagram_explore:   "Native",
  instagram_reels:     "Video",
  video_feeds:         "Video",
  rewarded_video:      "Video",
  facebook_reels:      "Video",
  instream_video:      "Video",
  facebook_stories:    "Rich Media",
  instagram_stories:   "Rich Media",
  messenger_stories:   "Rich Media",
  right_hand_column:   "Display",
  classic:             "Display",
  interstitial:        "Display",
  audio:               "Audio",
  connected_tv:        "CTV",
};

function classifyPosition(label: string): PlacementType {
  return META_POSITION_TO_TYPE[label] ?? "Other";
}

// Friendly display names for Meta platform_position values
function friendlyPosition(label: string): string {
  const map: Record<string, string> = {
    feed:               "Feed (Facebook/Instagram)",
    instagram_reels:    "Instagram Reels",
    video_feeds:        "Video Feeds",
    facebook_stories:   "Facebook Stories",
    instagram_stories:  "Instagram Stories",
    marketplace:        "Marketplace",
    right_hand_column:  "Right Column (Desktop)",
    messenger_inbox:    "Messenger Inbox",
    messenger_stories:  "Messenger Stories",
    audio:              "Audio Stream",
    connected_tv:       "Connected TV",
    classic:            "App Display (AN)",
    rewarded_video:     "Rewarded Video (AN)",
    interstitial:       "Interstitial (AN)",
    facebook_reels:     "Facebook Reels",
    instream_video:     "In-Stream Video",
    search:             "Search",
    instagram_explore:  "Instagram Explore",
  };
  return map[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

// ─── Placement Type Chart ─────────────────────────────────────────────────────

type DonutMetric = "spend" | "impressions" | "clicks" | "conversions";
const DONUT_METRICS: { id: DonutMetric; label: string }[] = [
  { id: "spend",       label: "Spend" },
  { id: "impressions", label: "Impressions" },
  { id: "clicks",      label: "Clicks" },
  { id: "conversions", label: "Conversions" },
];

interface TypeRow { type: string; spend: number; impressions: number; clicks: number; conversions: number }

function PlacementTypeChart({
  typeRows, loading, currency, ns,
}: { typeRows: TypeRow[]; loading: boolean; currency: string; ns: string }) {
  const [metric, setMetric] = usePersistentValue<DonutMetric>(`${ns}-donut-metric`, "spend");
  const cur = (n: number) => formatMoney(n, currency, 0);

  const sorted = useMemo(() => [...typeRows].sort((a, b) => b[metric] - a[metric]).filter(d => d[metric] > 0), [typeRows, metric]);
  const total = sorted.reduce((s, d) => s + d[metric], 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-900">
          Placement Type <span className="text-gray-400 font-normal">· by {DONUT_METRICS.find(m => m.id === metric)?.label}</span>
        </h3>
        <div className="flex items-center gap-1">
          {DONUT_METRICS.map(m => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${metric === m.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-56 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-gray-400">No data.</div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6 px-6 py-5">
          <div className="shrink-0 chart-enter">
            <ResponsiveContainer width={220} height={220}>
              <PieChart>
                <Pie
                  data={sorted}
                  dataKey={metric}
                  nameKey="type"
                  innerRadius={65}
                  outerRadius={105}
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                >
                  {sorted.map((d) => (
                    <Cell key={d.type} fill={TYPE_COLORS[d.type] ?? "#9ca3af"} />
                  ))}
                </Pie>
                <ReTooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, _: string, entry: any) => [
                    metric === "spend" ? cur(v as number) : fmtK(v as number),
                    (entry?.payload as TypeRow)?.type ?? "",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-0 divide-y divide-gray-100 w-full">
            {sorted.map(d => {
              const pct = total > 0 ? (d[metric] / total) * 100 : 0;
              const val = metric === "spend" ? cur(d[metric]) : fmtK(d[metric]);
              return (
                <div key={d.type} className="flex items-center gap-3 py-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[d.type] ?? "#9ca3af" }} />
                  <span className="flex-1 text-sm text-gray-800 font-medium">{d.type}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{val}</span>
                  <span className="w-12 text-right text-sm text-gray-500 tabular-nums">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Placement Ranked List ────────────────────────────────────────────────────

type RankMetric = "spend" | "impressions" | "clicks" | "conversions";
const RANK_METRICS: { id: RankMetric; label: string }[] = [
  { id: "spend",       label: "Spend" },
  { id: "impressions", label: "Impressions" },
  { id: "clicks",      label: "Clicks" },
  { id: "conversions", label: "Conversions" },
];
const TOP_N_OPTIONS = [5, 10, 20] as const;

function PlacementRankList({
  rows, loading, currency, title, labelFmt, ns,
}: {
  rows: BreakdownRow[]; loading: boolean; currency: string;
  title: string; labelFmt?: (s: string) => string; ns: string;
}) {
  const [metric, setMetric] = usePersistentValue<RankMetric>(`${ns}-rank-metric`, "spend");
  const [topNStr, setTopNStr] = usePersistentValue<"5" | "10" | "20">(`${ns}-rank-topn`, "5");
  const topN = Number(topNStr) as 5 | 10 | 20;
  const setTopN = (n: 5 | 10 | 20) => setTopNStr(String(n) as "5" | "10" | "20");
  const [showTopN, setShowTopN] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const cur = (n: number) => formatMoney(n, currency, 2);

  const sorted = useMemo(() => [...rows].sort((a, b) => b[metric] - a[metric]), [rows, metric]);
  const total   = sorted.reduce((s, r) => s + r[metric], 0);
  const topRows = sorted.slice(0, topN);
  const topSum  = topRows.reduce((s, r) => s + r[metric], 0);
  const topPct  = total > 0 ? (topSum / total) * 100 : 0;
  const maxVal  = topRows[0]?.[metric] ?? 1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <span className="text-gray-400">⇄</span> {title}
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative" ref={dropRef}>
            <button
              onClick={() => setShowTopN(v => !v)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 transition"
            >
              Top {topN} <ChevronDown className="w-3 h-3" />
            </button>
            {showTopN && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden min-w-[80px]">
                {TOP_N_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => { setTopN(n); setShowTopN(false); }}
                    className={`w-full px-4 py-2 text-xs text-left hover:bg-gray-50 ${topN === n ? "font-bold text-blue-600" : "text-gray-700"}`}
                  >
                    Top {n}
                  </button>
                ))}
              </div>
            )}
          </div>
          {RANK_METRICS.map(m => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${metric === m.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">No data.</div>
      ) : (
        <div className="px-5 py-4 space-y-1">
          <p className="text-xs text-gray-600 mb-4">
            Top {topN} ={" "}
            <span className="text-blue-600 font-bold">{topPct.toFixed(0)}%</span> of {RANK_METRICS.find(m => m.id === metric)?.label.toLowerCase()}{" "}
            {metric === "spend"
              ? `(${cur(topSum)} of ${cur(total)})`
              : `(${fmtK(topSum)} of ${fmtK(total)})`}
          </p>
          {topRows.map((r, i) => {
            const barPct = maxVal > 0 ? (r[metric] / maxVal) * 100 : 0;
            const val    = metric === "spend" ? cur(r[metric]) : fmtK(r[metric]);
            const pct    = total > 0 ? (r[metric] / total) * 100 : 0;
            const name   = labelFmt ? labelFmt(r.label) : r.label;
            return (
              <div key={r.label} className="py-2">
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-gray-900 truncate" title={name}>{name}</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{val}</span>
                  <span className="w-10 text-right text-xs text-gray-500 tabular-nums">{pct.toFixed(1)}%</span>
                </div>
                <div className="ml-8 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Placement Detail Table ───────────────────────────────────────────────────

const DETAIL_DEFAULT_IDS = ["impressions", "clicks", "ctr", "spend", "cpm"];
const DETAIL_ALL_DEFS: ColDef[] = ALL_STANDARD_KPIS.filter(k =>
  ["impressions", "clicks", "ctr", "spend", "orders", "roas", "cpa", "cpm", "cpc", "cvr"].includes(k.id)
);

interface DetailRow {
  name: string;
  spend: number; impressions: number; clicks: number;
  conversions: number; conversionValue: number;
  ctr: number; cpm: number; cpc: number; roas: number; cpa: number;
}

function PlacementDetailTable({
  rows, loading, currency, rowLabel, ns, convAvailable,
}: {
  rows: BreakdownRow[]; loading: boolean; currency: string;
  rowLabel?: (s: string) => string; ns: string; convAvailable?: boolean;
}) {
  const cur = (n: number) => formatMoney(n, currency, 2);
  const { cols, toggleCol, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, swapCol, resetCols } =
    useColPicker(DETAIL_DEFAULT_IDS, `placement-detail-${ns}`);
  const activeColDefs: ColDef[] = cols.map(id => DETAIL_ALL_DEFS.find(d => d.id === id) ?? { id, label: id, group: "Core" });

  const rawDetailRows = useMemo<DetailRow[]>(() => rows.map(r => ({
    name: rowLabel ? rowLabel(r.label) : r.label,
    spend: r.spend, impressions: r.impressions, clicks: r.clicks,
    conversions: r.conversions, conversionValue: r.conversionValue,
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
    cpc:  r.clicks > 0      ? r.spend / r.clicks : 0,
    roas: r.spend > 0       ? r.conversionValue / r.spend : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
  })), [rows, rowLabel]);

  const { sorted: detailRows, sort: placSort, toggle: placToggle } = useSort(rawDetailRows, "spend", "desc");
  const NA = "—";
  const CONV_COLS = new Set(["orders", "conversions", "roas", "cpa", "cvr"]);

  function cellVal(row: DetailRow, id: string): React.ReactNode {
    if (CONV_COLS.has(id) && !convAvailable) return NA;
    switch (id) {
      case "spend":       return cur(row.spend);
      case "impressions": return fmtK(row.impressions);
      case "clicks":      return fmtK(row.clicks);
      case "ctr":         return `${row.ctr.toFixed(2)}%`;
      case "orders": case "conversions": return row.conversions.toLocaleString();
      case "cpm":         return cur(row.cpm);
      case "cpc":         return cur(row.cpc);
      case "roas":        return `${row.roas.toFixed(2)}×`;
      case "cpa":         return row.cpa > 0 ? cur(row.cpa) : NA;
      case "cvr":         return row.clicks > 0 ? `${((row.conversions / row.clicks) * 100).toFixed(2)}%` : NA;
      default:            return NA;
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-bold text-gray-900">Placement Detail</span>
        <ColumnPickerButton
          cols={cols}
          allDefs={DETAIL_ALL_DEFS}
          defaultIds={DETAIL_DEFAULT_IDS}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          pickerRef={pickerRef}
          toggleCol={toggleCol}
          resetCols={resetCols}
        />
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : detailRows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">No data.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="name" sort={placSort} onToggle={placToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Placement</SortTh>
                {activeColDefs.map((c, i) => (
                  <th key={c.id} className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                    <ColHeader
                      colIdx={i}
                      currentId={c.id}
                      label={c.label}
                      allDefs={DETAIL_ALL_DEFS}
                      swapIdx={swapIdx}
                      setSwapIdx={setSwapIdx}
                      swapCol={swapCol}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.map(row => (
                <tr key={row.name} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{row.name}</td>
                  {activeColDefs.map(c => (
                    <td key={c.id} className="px-4 py-3 text-right text-gray-800 tabular-nums">
                      {cellVal(row, c.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function PlacementReport({ platform, dateRange, customStart, customEnd }: Props) {
  const showMeta = platform !== "dv360";
  const showDv   = platform === "dv360" || platform === "both";

  // ── Meta breakdowns ─────────────────────────────────────────────────────────
  const { rows: metaPositions, loading: metaPosL, error: metaPosErr } =
    useMetaBreakdown("platform_position", dateRange, customStart, customEnd, showMeta);
  const { rows: metaPub, loading: metaPubL, error: metaPubErr } =
    useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, showMeta);
  const metaErr = metaPosErr || metaPubErr;

  // Aggregate platform_position rows by type (deterministic, no synthetic shares)
  const metaTypeRows = useMemo<TypeRow[]>(() => {
    const map = new Map<string, TypeRow>();
    for (const r of metaPositions) {
      const type = classifyPosition(r.label);
      const cur = map.get(type) ?? { type, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
      cur.spend       += r.spend;
      cur.impressions += r.impressions;
      cur.clicks      += r.clicks;
      cur.conversions += r.conversions;
      map.set(type, cur);
    }
    return Array.from(map.values());
  }, [metaPositions]);

  // ── DV360 breakdowns ─────────────────────────────────────────────────────────
  const { rows: dvEnv, loading: dvEnvL, pending: dvEnvPending, unsupported: dvEnvUnsupported } =
    useDV360Breakdown("environment", dateRange, customStart, customEnd, showDv);
  const { rows: dvExchange, loading: dvExchangeL, pending: dvExchangePending, error: dvExchangeErr } =
    useDV360Breakdown("exchange",    dateRange, customStart, customEnd, showDv);

  const dvEnvTypeRows = useMemo<TypeRow[]>(() =>
    dvEnv.map(r => ({
      type: r.label || "Unknown",
      spend: r.spend, impressions: r.impressions,
      clicks: r.clicks, conversions: r.conversions,
    })),
  [dvEnv]);

  const { startDate, endDate, metaCurrency, dv360Currency: dvCurrency } = useCampaigns(
    platform === "dv360" ? "dv360" : platform,
    dateRange, customStart, customEnd
  );

  const SectionHeader = ({ label, sub }: { label: string; sub: string }) => (
    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{label}</h2>
      <span className="text-xs text-gray-400 font-medium">{sub}</span>
    </div>
  );

  return (
    <div className="space-y-6 section-enter">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <MapIcon className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Placement</h1>
            <p className="text-gray-600 mt-1">Performance by placement type, position and publisher.</p>
          </div>
        </div>
        {showMeta && (
          <AIExecutiveSummary
            tabName="Placement"
            context={{
              window: `${startDate} → ${endDate}`,
              ...(showMeta ? { metaPositions: metaPositions.map(r => ({ label: r.label, spend: Math.round(r.spend), impressions: r.impressions })), metaPublishers: metaPub.length } : {}),
              ...(showDv ? {
                dvExchanges: dvExchange.map(r => ({ label: r.label, spend: Math.round(r.spend), impressions: r.impressions })),
                dvEnvironments: dvEnv.map(r => ({ label: r.label, impressions: r.impressions })),
              } : {}),
            }}
            platform={platform}
            inline
          />
        )}
      </div>

      {/* ── Meta section ── */}
      {showMeta && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="Meta" sub="Meta Ads" />}
          {metaErr && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <span className="font-semibold">Meta placement data unavailable:</span> {metaErr}
              {/rate limit|request limit|reduce the amount|too many|#17|#80/i.test(metaErr) && (
                <span className="block mt-1 text-amber-700">Meta is rate-limiting this ad account. Wait a minute and reload — the placement breakdowns will populate once the limit resets.</span>
              )}
            </div>
          )}
          <PlacementTypeChart
            typeRows={metaTypeRows}
            loading={metaPosL}
            currency={metaCurrency}
            ns="meta"
          />
          <PlacementRankList
            rows={metaPositions}
            loading={metaPosL}
            currency={metaCurrency}
            title="Placement / Position"
            labelFmt={friendlyPosition}
            ns="meta"
          />
          <PlacementDetailTable
            rows={metaPub}
            loading={metaPubL}
            currency={metaCurrency}
            rowLabel={(s) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            ns="meta"
            convAvailable
          />
        </div>
      )}

      {/* ── DV360 section ── */}
      {showDv && (
        <div className="space-y-5">
          {platform === "both" && <SectionHeader label="DV360" sub="Display & Video 360" />}

          {dvExchangeErr ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <span className="font-semibold">DV360 placement data unavailable:</span> {dvExchangeErr}
            </div>
          ) : (
            <>
              {dvEnvUnsupported ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                  <span>Placement type breakdown (Web / App / CTV) is not available for this advertiser via Bid Manager API — the environment filter isn&apos;t supported for this account&apos;s inventory type.</span>
                </div>
              ) : (
                <PlacementTypeChart
                  typeRows={dvEnvTypeRows}
                  loading={dvEnvL || dvEnvPending}
                  currency={dvCurrency}
                  ns="dv360"
                />
              )}
              <PlacementRankList
                rows={dvExchange}
                loading={dvExchangeL || dvExchangePending}
                currency={dvCurrency}
                title="Exchange / Publisher"
                ns="dv360"
              />
              <PlacementDetailTable
                rows={dvExchange}
                loading={dvExchangeL || dvExchangePending}
                currency={dvCurrency}
                ns="dv360"
                convAvailable={false}
              />
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Site-level URL breakdown is not available via Bid Manager API. Exchange-level data shown above is the most granular publisher breakdown DV360 exposes.</span>
              </div>
            </>
          )}
        </div>
      )}

      <TabSummaryFooter
        tabName="Placement Report"
        lines={(() => {
          const lines: string[] = [];
          if (showMeta) lines.push(`Meta — ${metaPositions.length} placement positions · ${metaPub.length} publishers.`);
          if (showDv && !dvExchangeErr) lines.push(`DV360 — ${dvEnv.length} environment types · ${dvExchange.length} exchanges.`);
          lines.push(`Date window: ${startDate} → ${endDate}.`);
          return lines;
        })()}
        context={{
          startDate, endDate,
          metaPositions: metaPositions.map(r => ({ label: r.label, spend: r.spend, impressions: r.impressions })),
          dvExchanges:   dvExchange.map(r => ({ label: r.label, spend: r.spend, impressions: r.impressions })),
          dvEnvironments: dvEnv.map(r => ({ label: r.label, impressions: r.impressions })),
        }}
        platform={showMeta ? "meta" : "dv360"}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
