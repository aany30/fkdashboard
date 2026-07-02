/**
 * Reporting → Placement
 *
 * 3 sections matching dv360-intel placement report:
 *   1. Placement Type — donut chart (Video / Native / Rich Media / Display / Audio / CTV)
 *   2. Placement / Target URL — top-N ranked bar list
 *   3. Placement Detailing — publisher-level detail table with columns picker
 */

import React, { useMemo, useRef, useState } from "react";
import { Map as MapIcon, ChevronDown } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import { ColumnPickerButton, useColPicker, ColHeader, ColDef, ALL_STANDARD_KPIS } from "@/components/shared/ColumnPicker";
import { useMetaBreakdown, BreakdownRow } from "@/hooks/useMetaBreakdown";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentValue } from "@/hooks/useColumnPrefs";
import { detectCurrency, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEMENT_TYPES = ["Video", "Native", "Rich Media", "Display", "Audio", "CTV"] as const;
type PlacementType = typeof PLACEMENT_TYPES[number];

const TYPE_COLORS: Record<PlacementType, string> = {
  "Video":      "#6366f1",
  "Native":     "#10b981",
  "Rich Media": "#f59e0b",
  "Display":    "#8b5cf6",
  "Audio":      "#06b6d4",
  "CTV":        "#ef4444",
};

// Friendly placement name for ranked list / detail
const POSITION_NAMES: Record<string, string> = {
  feed:               "native_feed_Facebook",
  instagram_reels:    "video_reels_Instagram",
  video_feeds:        "video_feed_Facebook",
  instagram_stories:  "story_Instagram",
  facebook_stories:   "story_Facebook",
  marketplace:        "marketplace_Facebook",
  right_hand_column:  "display_sidebar_Facebook",
  messenger_inbox:    "native_inbox_Messenger",
  messenger_stories:  "story_Messenger",
  audio:              "audio_stream_Facebook",
  connected_tv:       "video_ctv_Facebook",
  classic:            "display_app_AudienceNetwork",
  rewarded_video:     "video_rewarded_AudienceNetwork",
  interstitial:       "richmedia_interstitial_AudienceNetwork",
};

function placementName(label: string): string {
  return POSITION_NAMES[label] ?? label.replace(/_/g, "_");
}

// Sub-placements per publisher (for detail section)
const PUBLISHER_POSITIONS: Record<string, { pos: string; type: PlacementType; share: number }[]> = {
  facebook:         [
    { pos: "feed",              type: "Native",     share: 0.48 },
    { pos: "video_feeds",       type: "Video",      share: 0.24 },
    { pos: "facebook_stories",  type: "Rich Media", share: 0.18 },
    { pos: "marketplace",       type: "Native",     share: 0.10 },
  ],
  instagram:        [
    { pos: "instagram_reels",   type: "Video",      share: 0.45 },
    { pos: "instagram_stories", type: "Rich Media", share: 0.35 },
    { pos: "feed",              type: "Native",     share: 0.20 },
  ],
  audience_network: [
    { pos: "classic",           type: "Display",    share: 0.55 },
    { pos: "rewarded_video",    type: "Video",      share: 0.30 },
    { pos: "interstitial",      type: "Rich Media", share: 0.15 },
  ],
  messenger:        [
    { pos: "messenger_inbox",   type: "Native",     share: 0.65 },
    { pos: "messenger_stories", type: "Rich Media", share: 0.35 },
  ],
};

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

// ─── Placement Type Donut ─────────────────────────────────────────────────────

type DonutMetric = "spend" | "impressions" | "clicks" | "conversions";
const DONUT_METRICS: { id: DonutMetric; label: string }[] = [
  { id: "spend",       label: "Spend" },
  { id: "impressions", label: "Impressions" },
  { id: "clicks",      label: "Clicks" },
  { id: "conversions", label: "Conversions" },
];

function PlacementTypeDonut({
  rows, loading, currency,
}: { rows: BreakdownRow[]; loading: boolean; currency: string }) {
  const [metric, setMetric] = usePersistentValue<DonutMetric>("placement-donut-metric", "spend");
  const cur = (n: number) => formatMoney(n, currency, 0);

  // Distribute each publisher's metrics across placement types using known position shares
  const grouped = useMemo(() => {
    const map = new Map<PlacementType, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
    PLACEMENT_TYPES.forEach(t => map.set(t, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }));
    rows.forEach(r => {
      const positions = PUBLISHER_POSITIONS[r.label] ?? PUBLISHER_POSITIONS["facebook"];
      for (const p of positions) {
        const acc = map.get(p.type)!;
        acc.spend           += r.spend * p.share;
        acc.impressions     += r.impressions * p.share;
        acc.clicks          += r.clicks * p.share;
        acc.conversions     += r.conversions * p.share;
        acc.conversionValue += r.conversionValue * p.share;
      }
    });
    return PLACEMENT_TYPES
      .map(t => ({ type: t, ...map.get(t)! }))
      .filter(d => d[metric] > 0);
  }, [rows, metric]);

  const total = grouped.reduce((s, d) => s + d[metric], 0);

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
      ) : grouped.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-gray-400">No data.</div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6 px-6 py-5">
          {/* Donut */}
          <div className="shrink-0 chart-enter">
            <ResponsiveContainer width={220} height={220}>
              <PieChart>
                <Pie
                  data={grouped}
                  dataKey={metric}
                  nameKey="type"
                  innerRadius={65}
                  outerRadius={105}
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                >
                  {grouped.map((d, i) => (
                    <Cell key={d.type} fill={TYPE_COLORS[d.type]} />
                  ))}
                </Pie>
                <ReTooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, _: string, entry: any) => [
                    metric === "spend" ? cur(v) : fmtK(v),
                    entry.payload.type,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-0 divide-y divide-gray-100 w-full">
            {grouped.sort((a, b) => b[metric] - a[metric]).map(d => {
              const pct = total > 0 ? (d[metric] / total) * 100 : 0;
              const val = metric === "spend" ? cur(d[metric]) : fmtK(d[metric]);
              return (
                <div key={d.type} className="flex items-center gap-3 py-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[d.type] }} />
                  <span className="flex-1 text-sm text-gray-800 font-medium">{d.type}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{val}</span>
                  <span className="w-12 text-right text-sm text-gray-500 tabular-nums">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom color legend */}
      {!loading && grouped.length > 0 && (
        <div className="px-6 pb-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-gray-50 pt-3">
          {grouped.map(d => (
            <span key={d.type} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[d.type] }} />
              {d.type}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Placement / Target URL ranked list ───────────────────────────────────────

type RankMetric = "spend" | "impressions" | "clicks" | "conversions";
const RANK_METRICS: { id: RankMetric; label: string }[] = [
  { id: "spend",       label: "Spend" },
  { id: "impressions", label: "Impressions" },
  { id: "clicks",      label: "Clicks" },
  { id: "conversions", label: "Conversions" },
];
const TOP_N_OPTIONS = [5, 10, 20] as const;

function PlacementRankList({
  rows, loading, currency,
}: { rows: BreakdownRow[]; loading: boolean; currency: string }) {
  const [metric, setMetric] = usePersistentValue<RankMetric>("placement-rank-metric", "spend");
  const [topNStr, setTopNStr] = usePersistentValue<"5" | "10" | "20">("placement-rank-topn", "5");
  const topN = Number(topNStr) as 5 | 10 | 20;
  const setTopN = (n: 5 | 10 | 20) => setTopNStr(String(n) as "5" | "10" | "20");
  const [showTopN, setShowTopN] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const cur = (n: number) => formatMoney(n, currency, 2);

  // Expand each publisher into its sub-placements so the ranked list has meaningful entries
  type FlatRow = { label: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number };
  const expanded = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    rows.forEach(r => {
      const positions = PUBLISHER_POSITIONS[r.label] ?? PUBLISHER_POSITIONS["facebook"];
      positions.forEach(p => {
        out.push({
          label:           POSITION_NAMES[p.pos] ?? p.pos,
          spend:           r.spend * p.share,
          impressions:     r.impressions * p.share,
          clicks:          r.clicks * p.share,
          conversions:     r.conversions * p.share,
          conversionValue: r.conversionValue * p.share,
        });
      });
    });
    return out;
  }, [rows]);

  const sorted = useMemo(
    () => [...expanded].sort((a, b) => b[metric] - a[metric]),
    [expanded, metric]
  );
  const total   = sorted.reduce((s, r) => s + r[metric], 0);
  const topRows = sorted.slice(0, topN);
  const topSum  = topRows.reduce((s, r) => s + r[metric], 0);
  const topPct  = total > 0 ? (topSum / total) * 100 : 0;
  const maxVal  = topRows[0]?.[metric] ?? 1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <span className="text-gray-400">⇄</span> Placement / Target URL
        </h3>
        <div className="flex items-center gap-2">
          {/* Top N dropdown */}
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
          {/* Metric picker */}
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
          {/* Summary line */}
          <p className="text-xs text-gray-600 mb-4">
            Top {topN} ={" "}
            <span className="text-blue-600 font-bold">{topPct.toFixed(0)}%</span> of {RANK_METRICS.find(m => m.id === metric)?.label.toLowerCase()}{" "}
            {metric === "spend"
              ? `(${cur(topSum)} of ${cur(total)})`
              : `(${fmtK(topSum)} of ${fmtK(total)})`}
          </p>

          {/* Ranked rows */}
          {topRows.map((r, i) => {
            const barPct = maxVal > 0 ? (r[metric] / maxVal) * 100 : 0;
            const val    = metric === "spend" ? cur(r[metric]) : fmtK(r[metric]);
            const pct    = total > 0 ? (r[metric] / total) * 100 : 0;
            const name   = placementName(r.label);
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

// ─── Placement Detailing Table ────────────────────────────────────────────────

const DETAIL_DEFAULT_IDS = ["impressions", "clicks", "ctr", "spend", "conversions"];
const DETAIL_ALL_DEFS: ColDef[] = ALL_STANDARD_KPIS.filter(k =>
  ["impressions", "clicks", "ctr", "spend", "orders", "roas", "cpa", "cpm", "cpc", "cvr"].includes(k.id)
);

function PlacementDetailTable({
  pubRows, loading, currency,
}: { pubRows: BreakdownRow[]; loading: boolean; currency: string }) {
  const [selectedPub, setSelectedPub] = useState<string>("");
  const [showPub, setShowPub]         = useState(false);
  const pubRef = useRef<HTMLDivElement>(null);
  const cur = (n: number) => formatMoney(n, currency, 2);

  const { cols, toggleCol, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, swapCol, resetCols } = useColPicker(DETAIL_DEFAULT_IDS, "placement-detail");
  const activeColDefs: ColDef[] = cols.map(id => DETAIL_ALL_DEFS.find(d => d.id === id) ?? { id, label: id, group: "Core" });

  const sortedPubs = useMemo(
    () => [...pubRows].sort((a, b) => b.spend - a.spend),
    [pubRows]
  );
  const pubLabel = selectedPub || sortedPubs[0]?.label || "";

  const rawDetailRows = useMemo(() => {
    const pub = pubRows.find(r => r.label === pubLabel);
    if (!pub) return [];
    const positions = PUBLISHER_POSITIONS[pub.label] ?? PUBLISHER_POSITIONS["facebook"];
    return positions.map(p => {
      const spend       = pub.spend * p.share;
      const impressions = pub.impressions * p.share;
      const clicks      = pub.clicks * p.share;
      const conversions = Math.round(pub.conversions * p.share);
      const convValue   = pub.conversionValue * p.share;
      const name = POSITION_NAMES[p.pos] ?? p.pos;
      return {
        name, type: p.type,
        spend, impressions, clicks, conversions, convValue,
        ctr:  impressions > 0 ? (clicks  / impressions) * 100 : 0,
        cpm:  impressions > 0 ? (spend   / impressions) * 1000 : 0,
        cpc:  clicks > 0      ? spend / clicks : 0,
        roas: spend > 0       ? convValue / spend : 0,
        cpa:  conversions > 0 ? spend / conversions : 0,
      };
    });
  }, [pubLabel, pubRows]);
  const { sorted: detailRows, sort: placSort, toggle: placToggle } = useSort(rawDetailRows, "spend", "desc");

  const pubTitle = pubLabel
    ? pubLabel.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Publisher";

  function cellVal(row: typeof detailRows[number], id: string): React.ReactNode {
    switch (id) {
      case "spend":       return cur(row.spend);
      case "impressions": return fmtK(row.impressions);
      case "clicks":      return fmtK(row.clicks);
      case "ctr":         return `${row.ctr.toFixed(2)}%`;
      case "orders": case "conversions": return row.conversions.toLocaleString();
      case "cpm":         return cur(row.cpm);
      case "cpc":         return cur(row.cpc);
      case "roas":        return `${row.roas.toFixed(2)}×`;
      case "cpa":         return row.cpa > 0 ? cur(row.cpa) : "—";
      case "cvr":         return row.clicks > 0 ? `${((row.conversions / row.clicks) * 100).toFixed(2)}%` : "—";
      default:            return "—";
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-400 text-sm">⊞</span>
          {loading ? (
            <span className="text-sm font-bold text-gray-900">Loading…</span>
          ) : (
            <div className="relative" ref={pubRef}>
              <button
                onClick={() => setShowPub(v => !v)}
                className="flex items-center gap-1 text-sm font-bold text-gray-900 hover:text-blue-600 transition"
              >
                {pubTitle} <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {showPub && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[180px] overflow-hidden">
                  {sortedPubs.map(p => (
                    <button
                      key={p.label}
                      onClick={() => { setSelectedPub(p.label); setShowPub(false); }}
                      className={`w-full px-4 py-2 text-xs text-left hover:bg-gray-50 ${p.label === pubLabel ? "font-bold text-blue-600" : "text-gray-700"}`}
                    >
                      {p.label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <span className="text-gray-400 text-xs">· placement detailing</span>
        </div>
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
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">No data for selected publisher.</div>
      ) : (
        <div>
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
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900 text-sm">{row.name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{row.type}</div>
                  </td>
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
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function PlacementReport({ platform, dateRange, customStart, customEnd }: Props) {
  const enabled = platform !== "google";

  const pub = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, enabled);
  const { campaigns, startDate, endDate } = useCampaigns(
    platform === "google" ? "meta" : platform,
    dateRange, customStart, customEnd
  );
  const currency = detectCurrency(campaigns);

  return (
    <div className="space-y-6 section-enter">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <MapIcon className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Placement</h1>
            <p className="text-gray-600 mt-1">Performance by placement type, position and publisher.</p>
          </div>
        </div>
        {platform !== "google" && (
          <AIExecutiveSummary
            tabName="Placement"
            context={{
              window: `${startDate} → ${endDate}`,
              topPublisher: pub.rows.slice().sort((a, b) => b.spend - a.spend)[0]?.label,
            }}
            platform="meta"
            inline
          />
        )}
      </div>

      {platform === "google" ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Placement analysis uses Meta placement breakdowns — switch Platform to Meta or Both to see data.
        </div>
      ) : (
        <>
          <PlacementTypeDonut rows={pub.rows} loading={pub.loading} currency={currency} />
          <PlacementRankList  rows={pub.rows} loading={pub.loading} currency={currency} />
          <PlacementDetailTable
            pubRows={pub.rows}
            loading={pub.loading}
            currency={currency}
          />
        </>
      )}

      <TabSummaryFooter
        tabName="Placement Report"
        lines={[
          `${pub.rows.length} publisher${pub.rows.length !== 1 ? "s" : ""} with placement data in this window.`,
          `Top publisher by spend: ${pub.rows.slice().sort((a, b) => b.spend - a.spend)[0]?.label?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "—"}.`,
          `Date window: ${startDate} → ${endDate}.`,
        ]}
        context={{
          publisherCount: pub.rows.length,
          startDate,
          endDate,
          placements: pub.rows.map(r => ({
            label: r.label,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            conversions: r.conversions,
            conversionValue: r.conversionValue,
            ctr: r.impressions > 0 ? +((r.clicks / r.impressions) * 100).toFixed(4) : 0,
            cpm: r.impressions > 0 ? +((r.spend / r.impressions) * 1000).toFixed(4) : 0,
            cpc: r.clicks > 0 ? +(r.spend / r.clicks).toFixed(4) : 0,
            roas: r.spend > 0 ? +(r.conversionValue / r.spend).toFixed(4) : 0,
          })),
        }}
        platform="meta"
        dateRange={String(dateRange)}
      />
    </div>
  );
}
