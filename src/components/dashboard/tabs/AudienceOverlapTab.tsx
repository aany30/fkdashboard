/**
 * Campaign → Audience Overlap (doc §4)
 *
 * Uses ad sets from useAdSetInsights (always available) instead of the
 * deprecated Meta Custom Audiences API. Overlap is estimated heuristically
 * from audience-type similarity and funnel-stage proximity.
 */

import React, { useState, useMemo } from "react";
import { Users, ExternalLink, AlertCircle, Info, Plus, X, PieChart as PieIcon, Loader2, Repeat2 } from "lucide-react";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import { useDV360Audiences } from "@/hooks/useDV360Audiences";
import { useDV360FrequencyBurden } from "@/hooks/useDV360FrequencyBurden";
import { useAuthStore } from "@/store/auth";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
  XAxis, YAxis, CartesianGrid,
  ComposedChart, Bar, Line, Legend as ReLegend,
} from "recharts";
import type { DateRange } from "@/components/shared/DateRangePicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import LoadingState from "@/components/shared/LoadingState";
import { useAdSetInsights, type AdSetRow } from "@/hooks/useAdSetInsights";
import { useAnnualFrequency } from "@/hooks/useAnnualFrequency";
import { formatMoney } from "@/lib/currency";
import {
  classifyAdSet, AUDIENCE_COLORS, STAGE_COLORS,
  type AudienceClassification, type AudienceClass,
} from "@/lib/audience-classifier";

const MAX_AUDIENCES = 10;
const SLOT_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

// ─── Audience / funnel helpers — delegate to the shared classifier ──────────

type FunnelStage = "TOF" | "MOF" | "BOF" | "Loyalty";

// Overlap heuristic: 0–1 score based on audience class + funnel-stage proximity.
// Uses the marketing-meaning AudienceClass keys (real Meta-targeting categories).
const STAGE_ORDER: Record<FunnelStage, number> = { TOF: 0, MOF: 1, BOF: 2, Loyalty: 3 };

const TYPE_BASE: Partial<Record<AudienceClass, Partial<Record<AudienceClass, number>>>> = {
  Broad:                       { Broad: 0.65, Interest: 0.40, Lookalike: 0.30, "Advantage+ Audience": 0.55, "ASC / Shopping": 0.55, Unclassified: 0.35 },
  "Advantage+ Audience":       { "Advantage+ Audience": 0.62, Broad: 0.55, Interest: 0.35, Lookalike: 0.28, "ASC / Shopping": 0.50, Unclassified: 0.30 },
  Interest:                    { Broad: 0.40, Interest: 0.55, Lookalike: 0.30, "Advantage+ Audience": 0.35, Unclassified: 0.25 },
  Lookalike:                   { Broad: 0.30, Interest: 0.30, Lookalike: 0.55, "Advantage+ Audience": 0.28, Unclassified: 0.20 },
  "ASC / Shopping":            { Broad: 0.55, Interest: 0.35, Lookalike: 0.25, "ASC / Shopping": 0.60, "Advantage+ Audience": 0.45, Unclassified: 0.30 },
  "Retargeting — Website":     { "Retargeting — Website": 0.75, "Retargeting — Engagement": 0.45, "Retargeting — App": 0.35, "Mixed Custom": 0.55, "Catalog/DPA": 0.45, Unclassified: 0.25 },
  "Retargeting — Engagement":  { "Retargeting — Engagement": 0.70, "Retargeting — Website": 0.45, "Retargeting — App": 0.35, "Mixed Custom": 0.55, Unclassified: 0.20 },
  "Retargeting — App":         { "Retargeting — App": 0.70, "Retargeting — Engagement": 0.35, "Retargeting — Website": 0.30, "Mixed Custom": 0.45, Unclassified: 0.20 },
  "Customer List":             { "Customer List": 0.75, "Mixed Custom": 0.40, Unclassified: 0.10 },
  "Mixed Custom":              { "Mixed Custom": 0.55, "Retargeting — Website": 0.50, "Retargeting — Engagement": 0.45, "Customer List": 0.40, Unclassified: 0.20 },
  "Catalog/DPA":               { "Catalog/DPA": 0.70, "Retargeting — Website": 0.45, "Customer List": 0.30, Unclassified: 0.20 },
  Unclassified:                { Unclassified: 0.20 },
};

function estimateOverlapPct(clsA: AudienceClass, stageA: FunnelStage, clsB: AudienceClass, stageB: FunnelStage): number {
  const baseAB = TYPE_BASE[clsA]?.[clsB] ?? TYPE_BASE[clsB]?.[clsA] ?? 0.15;
  const stageDiff = Math.abs(STAGE_ORDER[stageA] - STAGE_ORDER[stageB]);
  const stageMod = stageDiff === 0 ? 1.0 : stageDiff === 1 ? 0.7 : stageDiff === 2 ? 0.4 : 0.2;
  return Math.min(0.95, baseAB * stageMod) * 100;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("en-IN");
}

// Annual frequency-distribution model (low→high frequency = green→red saturation).
const FREQ_BUCKETS = [
  { label: "1–5×",   lo: 1,  hi: 5,  color: "#10B981" },
  { label: "6–10×",  lo: 6,  hi: 10, color: "#F59E0B" },
  { label: "11–20×", lo: 11, hi: 20, color: "#F97316" },
  { label: "21×+",   lo: 21, hi: Infinity, color: "#EF4444" },
];

/**
 * Estimate the per-user frequency distribution from real annual reach + average
 * frequency using a zero-truncated geometric model (mean = 1/p, support k≥1).
 * Meta doesn't expose a true per-user histogram — this is a labeled estimate.
 */
function freqDistribution(reach: number, frequency: number) {
  const F = Math.max(1, frequency);
  const q = 1 - 1 / F;                       // P(freq ≥ k+1) / P(freq ≥ k)
  const tailGE = (k: number) => Math.pow(q, k - 1); // P(freq ≥ k)
  return FREQ_BUCKETS.map((b) => {
    const share = b.hi === Infinity ? tailGE(b.lo) : tailGE(b.lo) - tailGE(b.hi + 1);
    return { ...b, share, people: Math.round(reach * Math.max(0, share)) };
  });
}

function OverlapBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped > 50 ? "bg-red-500" : clamped > 25 ? "bg-orange-400" : "bg-green-500";
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
      <div className={`h-3 rounded-full transition-all duration-500 ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function riskLabel(pct: number): { label: string; color: string } {
  if (pct > 50) return { label: "High cannibalization risk",  color: "text-red-700 bg-red-50 border-red-200" };
  if (pct > 25) return { label: "Moderate overlap",           color: "text-orange-700 bg-orange-50 border-orange-200" };
  return            { label: "Low overlap",                   color: "text-green-700 bg-green-50 border-green-200" };
}

function audienceBadge(cls: AudienceClassification) {
  const color = AUDIENCE_COLORS[cls.cls] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color} ${cls.source === "name-fallback" ? "border border-dashed border-gray-400" : ""}`}
      title={cls.source === "name-fallback"
        ? "Inferred from ad-set name — Meta didn't return targeting (likely Advantage+ Shopping)."
        : (cls.detail || "Classified from Meta targeting setup")}
    >
      {cls.cls}
    </span>
  );
}


// ─── Audience Size table helpers ────────────────────────────────────────────

type SizeRisk = "Too small" | "Limited" | "OK";

function sizeRisk(size: number): SizeRisk {
  if (size > 0 && size < 1000) return "Too small";
  if (size >= 1000 && size < 10000) return "Limited";
  return "OK";
}

function sizeRiskBadge(risk: SizeRisk) {
  const styles: Record<SizeRisk, string> = {
    "Too small": "bg-red-100 text-red-800",
    Limited:     "bg-yellow-100 text-yellow-800",
    OK:          "bg-green-100 text-green-800",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${styles[risk]}`}>{risk}</span>;
}

function fmtDaysAgo(timeUpdated?: string): string {
  if (!timeUpdated) return "—";
  const days = Math.round((Date.now() - new Date(timeUpdated).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

interface AudienceSizeTableProps {
  audiences: import("@/lib/audience-classifier").CustomAudienceDetail[];
}

function AudienceSizeTable({ audiences }: AudienceSizeTableProps) {
  const rows = useMemo(() =>
    audiences.map((a) => ({
      ...a,
      risk: sizeRisk(a.size),
      riskRank: sizeRisk(a.size) === "Too small" ? 0 : sizeRisk(a.size) === "Limited" ? 1 : 2,
      daysAgo: fmtDaysAgo(a.timeUpdated),
      daysAgoNum: a.timeUpdated
        ? Math.round((Date.now() - new Date(a.timeUpdated).getTime()) / 86400000)
        : Number.MAX_SAFE_INTEGER,
    })),
  [audiences]);

  const { sorted, sort, toggle } = useSort(rows, "riskRank", "asc");

  const tooSmallCount = rows.filter((r) => r.risk === "Too small").length;
  const limitedCount  = rows.filter((r) => r.risk === "Limited").length;

  if (audiences.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Audience Size</h3>
          <div className="text-xs text-gray-600 mt-0.5">
            Audiences under 1,000 can&apos;t be reliably delivered; 1K–10K exhausts fast and drives frequency up.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tooSmallCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-700 border border-red-200">
              {tooSmallCount} too small
            </span>
          )}
          {limitedCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-yellow-50 text-yellow-700 border border-yellow-200">
              {limitedCount} limited
            </span>
          )}
        </div>
      </div>
      <div>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-20 bg-gray-50 shadow-[0_1px_0_0_rgb(229,231,235)]">
            <tr>
              <SortTh col="name" sort={sort} onToggle={toggle} className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500 sticky left-0 bg-gray-50 z-10">Audience</SortTh>
              <SortTh col="subtype" sort={sort} onToggle={toggle} className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500">Type</SortTh>
              <SortTh col="size" sort={sort} onToggle={toggle} className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500" align="right">Size</SortTh>
              <SortTh col="daysAgoNum" sort={sort} onToggle={toggle} className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500" align="right">Last Updated</SortTh>
              <SortTh col="riskRank" sort={sort} onToggle={toggle} className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500" align="right">Status</SortTh>
              <th className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-500 text-right">AI Plan</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const rowBg = a.risk === "Too small" ? "bg-red-50/30" : a.risk === "Limited" ? "bg-yellow-50/20" : "bg-white";
              const aiStatus = a.risk === "Too small" ? "critical" : a.risk === "Limited" ? "warn" : "moderate";
              return (
                <tr key={a.id} className={`group border-b border-gray-50 last:border-0 ${rowBg}`}>
                  <td className={`px-3 py-2 font-medium text-gray-800 max-w-[220px] truncate sticky left-0 z-[5] ${rowBg} group-hover:bg-gray-50`} title={a.name}>{a.name}</td>
                  <td className="px-3 py-2 text-gray-500">{a.subtype || "—"}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{a.size > 0 ? a.size.toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{a.daysAgo}</td>
                  <td className="px-3 py-2 text-right">{sizeRiskBadge(a.risk)}</td>
                  <td className="px-3 py-2 text-right">
                    <AIRecommendationButton
                      metric="Audience size"
                      value={a.risk}
                      status={aiStatus}
                      platform="meta"
                      threshold={
                        a.risk === "Too small"
                          ? `Size ${a.size.toLocaleString("en-IN")} — below 1,000 users; Meta can't reliably deliver.`
                          : a.risk === "Limited"
                          ? `Size ${a.size.toLocaleString("en-IN")} — 1K–10K range exhausts quickly and drives up frequency.`
                          : `Size ${a.size.toLocaleString("en-IN")} — healthy delivery range.`
                      }
                      auditContext={{
                        module: "Audience Size",
                        siblingMetrics: {
                          audience: a.name,
                          subtype: a.subtype || "unknown",
                          size: a.size,
                          lastUpdated: a.daysAgo,
                          risk: a.risk,
                        },
                      }}
                      compact
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Audience Type Spend Efficiency matrix ──────────────────────────────────
// Groups ad sets by their classified audience type (from real targeting) and
// aggregates real spend / reach / conversions / value. ROAS, CPA, CPM and
// $/Unique Reach are arithmetic of those real fields — no modeling, no proxy.

interface AudienceTypeEfficiencyProps {
  adsets: AdSetRow[];
  classifyRow: (a: AdSetRow) => AudienceClassification;
  cur: (n: number) => string;
  curPrecise: (n: number) => string;
}

function AudienceTypeEfficiency({ adsets, classifyRow, cur, curPrecise }: AudienceTypeEfficiencyProps) {
  if (adsets.length === 0) return null;

  const groups = new Map<AudienceClass, { spend: number; reach: number; impressions: number; conversions: number; conversionValue: number; count: number }>();
  for (const a of adsets) {
    const cls = classifyRow(a).cls;
    const g = groups.get(cls) || { spend: 0, reach: 0, impressions: 0, conversions: 0, conversionValue: 0, count: 0 };
    g.spend += a.spend || 0;
    g.reach += a.reach || 0;
    g.impressions += a.impressions || 0;
    g.conversions += a.conversions || 0;
    g.conversionValue += a.conversionValue || 0;
    g.count += 1;
    groups.set(cls, g);
  }

  const totalSpend = Array.from(groups.values()).reduce((s, g) => s + g.spend, 0);
  const rows = Array.from(groups.entries())
    .map(([cls, g]) => ({
      cls,
      ...g,
      spendShare: totalSpend > 0 ? g.spend / totalSpend : 0,
      costPerUniqueReach: g.reach > 0 ? g.spend / g.reach : null,
      cpa: g.conversions > 0 ? g.spend / g.conversions : null,
      roas: g.spend > 0 ? g.conversionValue / g.spend : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  // Highlight the best & worst ROAS among groups that actually have ROAS.
  const roasVals = rows.map((r) => r.roas).filter((v): v is number => v !== null);
  const bestRoas = roasVals.length ? Math.max(...roasVals) : null;
  const worstRoas = roasVals.length ? Math.min(...roasVals) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Audience Type — Spend Efficiency</h3>
          <div className="text-xs text-gray-600 mt-0.5">Real spend, reach &amp; conversions grouped by audience type. Spot where budget concentrates vs. where it returns.</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold uppercase border border-green-200">Real</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase text-[10px]">Audience Type</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">Ad Sets</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">Spend</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">% Spend</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">$/Unique Reach</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">Conv.</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">CPA</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase text-[10px]">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cls} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${AUDIENCE_COLORS[r.cls] ?? "bg-gray-100 text-gray-600"}`}>{r.cls}</span>
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{r.count}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{(r.spendShare * 100).toFixed(0)}%</td>
                <td className="px-3 py-2 text-right text-gray-700">{r.costPerUniqueReach !== null ? curPrecise(r.costPerUniqueReach) : "—"}</td>
                <td className="px-3 py-2 text-right text-gray-700">{r.conversions.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-gray-700">{r.cpa !== null ? cur(r.cpa) : "—"}</td>
                <td className={`px-3 py-2 text-right font-bold ${r.roas !== null && r.roas === bestRoas ? "text-green-700" : r.roas !== null && r.roas === worstRoas ? "text-red-600" : "text-gray-700"}`}>
                  {r.roas !== null ? `${r.roas.toFixed(2)}x` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 font-medium leading-relaxed">
        Audience type classified from each ad set&apos;s real Meta targeting setup. Green/red ROAS marks the best &amp; worst-returning types.
      </div>
    </div>
  );
}

// ─── Cross-Campaign Frequency Burden ────────────────────────────────────────
// True cross-campaign frequency = account-level `frequency` (real, deduplicated
// across every campaign). Overlap factor = Σ ad-set reach ÷ account dedup reach
// (both real Meta numbers) = how many ad sets the average reached person sits in.

interface CrossCampaignBurdenProps {
  adsets: AdSetRow[];
  accountReach: number;
  accountFrequency: number;
}

function CrossCampaignBurden({ adsets, accountReach, accountFrequency }: CrossCampaignBurdenProps) {
  if (accountReach <= 0 || adsets.length === 0) return null;

  const sumAdSetReach = adsets.reduce((s, a) => s + (a.reach || 0), 0);
  const overlapFactor = accountReach > 0 ? sumAdSetReach / accountReach : 0;
  // Severity from real numbers: high account frequency + heavy ad-set overlap.
  const freqHot = accountFrequency >= 8;
  const freqWarm = accountFrequency >= 5;
  const overlapHot = overlapFactor >= 2.5;

  const burden = freqHot || overlapHot ? "High burden" : freqWarm || overlapFactor >= 1.8 ? "Moderate" : "Healthy";
  const burdenStyle = burden === "High burden"
    ? "bg-red-100 text-red-800 border-red-200"
    : burden === "Moderate"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-green-100 text-green-800 border-green-200";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Cross-Campaign Frequency Burden</h3>
          <div className="text-xs text-gray-600 mt-0.5">How hard the average person is hit across all campaigns combined — deduplicated by Meta.</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${burdenStyle}`}>{burden}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-100">
        <div className="bg-white px-5 py-4">
          <div className={`text-2xl font-bold ${freqHot ? "text-red-600" : freqWarm ? "text-yellow-600" : "text-gray-900"}`}>{accountFrequency.toFixed(1)}×</div>
          <div className="text-xs text-gray-500 mt-0.5">account frequency</div>
          <div className="text-xs text-gray-600 mt-1">avg impressions per person, all campaigns</div>
        </div>
        <div className="bg-white px-5 py-4">
          <div className={`text-2xl font-bold ${overlapHot ? "text-red-600" : overlapFactor >= 1.8 ? "text-yellow-600" : "text-gray-900"}`}>{overlapFactor.toFixed(2)}×</div>
          <div className="text-xs text-gray-500 mt-0.5">ad-set overlap factor</div>
          <div className="text-xs text-gray-600 mt-1">avg ad sets each person falls into</div>
        </div>
        <div className="bg-white px-5 py-4">
          <div className="text-2xl font-bold text-gray-900">{fmtSize(accountReach)}</div>
          <div className="text-xs text-gray-500 mt-0.5">deduplicated reach</div>
          <div className="text-xs text-gray-600 mt-1">vs {fmtSize(sumAdSetReach)} summed across ad sets</div>
        </div>
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 font-medium leading-relaxed">
        Account frequency &amp; deduplicated reach are real Meta account-level fields for the selected period. Overlap factor = Σ ad-set reach ÷ deduplicated reach.
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function stageBadge(stage: FunnelStage) {
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[stage]}`}>{stage}</span>;
}

export default function AudienceOverlapTab({ platform, dateRange, customStart, customEnd }: Props) {
  const { isMetaConnected, isDV360Connected, demoMode } = useAuthStore();
  const metaOn = isMetaConnected() || demoMode;
  const dv360On = isDV360Connected() || demoMode;
  const showMeta = metaOn && (platform === "meta" || platform === "both");
  const showDV360 = dv360On && (platform === "dv360" || platform === "both");

  const { adsets, audiences, audienceMap, loading, error: insightsError, currency, accountReach, accountFrequency } = useAdSetInsights(
    platform === "both" ? "meta" : platform,
    dateRange, customStart, customEnd
  );

  const { audiences: dv360Audiences, loading: dvAudLoading, error: dvAudError } = useDV360Audiences(showDV360);
  const { sorted: sortedDvAud, sort: dvAudSort, toggle: dvAudToggle } = useSort(dv360Audiences, "name", "asc");
  const dvFirstParty = dv360Audiences.filter((a) => a.type === "First Party");
  const dvThirdParty = dv360Audiences.filter((a) => a.type === "Third Party");
  const {
    crossCampaign, crossCampaignPending, monthly: dvMonthlyFreq, monthlyPending: dvMonthlyPending, loading: dvFreqLoading,
  } = useDV360FrequencyBurden(dateRange, customStart, customEnd, showDV360);

  // Classify every ad set once, reused below.
  const classifyRow = (a: AdSetRow): AudienceClassification =>
    classifyAdSet(a.targeting, audienceMap, a.campaignObjective, a.name);
  const cur = (n: number) => formatMoney(n, currency, 0);
  // Cost-per-unique-reach is typically < 1 currency unit, so it needs decimals.
  const curPrecise = (n: number) => formatMoney(n, currency, 2);

  // Annual (trailing 12-month) reach + avg frequency for the distribution chart.
  const annual = useAnnualFrequency(platform === "both" ? "meta" : platform);
  const freqDist = useMemo(
    () => (annual.reach > 0 && annual.frequency > 0 ? freqDistribution(annual.reach, annual.frequency) : []),
    [annual.reach, annual.frequency]
  );

  // Per-month real trend (no modeling): reach + avg frequency for each month.
  // Used as the honest top chart so users can see "April/May/August ran hot" directly.
  // Builds a FULL trailing-12-month skeleton (this month → 11 months back) and
  // fills in real Meta data where it exists — zero for months the account didn't
  // run. Meta omits zero-activity months entirely, so without the skeleton the
  // chart would only show the months that had spend (e.g. Jan–Jun).
  const monthlyTrend = useMemo(() => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (annual.monthly.length === 0) return [];
    const byMonth = new Map(annual.monthly.map((m) => [m.month, m]));
    const now = new Date();
    const out: Array<{ label: string; reach: number; frequency: number; impressions: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = byMonth.get(key);
      out.push({
        label: `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
        reach: m?.reach ?? 0,
        frequency: m ? +m.frequency.toFixed(2) : 0,
        impressions: m?.impressions ?? 0,
      });
    }
    return out;
  }, [annual.monthly]);

  // "Months of activity" — derived from real numbers only.
  // sumMonthlyReach / annualReach = avg distinct months a reached user appeared in.
  // Real signal, no modeling: tells whether exposure is concentrated or spread.
  const monthsOfActivity = useMemo(() => {
    const sumMonthly = annual.monthly.reduce((s, m) => s + (m.reach || 0), 0);
    const avg = annual.reach > 0 ? sumMonthly / annual.reach : 0;
    return { sumMonthly, avg };
  }, [annual.monthly, annual.reach]);


  // 2–4 selectable slots; start with two empty.
  const [selected, setSelected] = useState<string[]>(["", ""]);
  const setSlot = (idx: number, id: string) =>
    setSelected((prev) => prev.map((v, i) => (i === idx ? id : v)));
  const addSlot = () => setSelected((prev) => (prev.length < MAX_AUDIENCES ? [...prev, ""] : prev));
  const removeSlot = (idx: number) =>
    setSelected((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const adSetMap = useMemo(() => new Map(adsets.map((a) => [a.id, a])), [adsets]);

  // Resolve the chosen ad sets (non-empty, valid, de-duplicated, in slot order).
  const analysis = useMemo(() => {
    const seen = new Set<string>();
    const items = selected
      .map((id) => adSetMap.get(id))
      .filter((r): r is AdSetRow => !!r && (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((row) => {
        const cls = classifyRow(row);
        return { row, cls, size: row.reach || row.impressions || 0 };
      });
    if (items.length < 2) return null;

    const pairs: { a: typeof items[number]; b: typeof items[number]; pct: number; users: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const pct = estimateOverlapPct(a.cls.cls, a.cls.funnelStage, b.cls.cls, b.cls.funnelStage);
        const users = Math.round(Math.min(a.size, b.size) * (pct / 100));
        pairs.push({ a, b, pct, users });
      }
    }
    const sumSizes = items.reduce((s, x) => s + x.size, 0);
    const sumOverlap = pairs.reduce((s, p) => s + p.users, 0);
    const maxSize = Math.max(...items.map((x) => x.size), 0);
    // Heuristic union via pairwise inclusion–exclusion, clamped to a sane range.
    const unionReach = Math.max(maxSize, Math.min(sumSizes, sumSizes - sumOverlap));
    const topPair = [...pairs].sort((a, b) => b.pct - a.pct)[0] ?? null;

    return { items, pairs, unionReach, topPair };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, adSetMap, audienceMap]);

  const chosenNames = analysis?.items.map((it) => it.row.name) ?? [];

  if (loading && adsets.length === 0) return <LoadingState message="Loading overlap data…" />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Overlap</h1>
            <p className="text-gray-600 mt-1">Compare 2–4 ad sets to estimate audience cannibalization.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Audience Overlap"
          context={{
            ...(showMeta ? {
              meta: {
                adSetCount: adsets.length,
                lastCompared: chosenNames.length >= 2 ? chosenNames : null,
                topOverlapPct: analysis?.topPair ? Number(analysis.topPair.pct.toFixed(1)) : null,
                overlapPairs: analysis?.pairs.length ?? 0,
                note: "Meta audience overlap is estimated heuristically (Meta deprecated the overlap API). DV360 overlap isn't available via API at all.",
              },
            } : {}),
            ...(showDV360 ? {
              dv360: {
                audienceCount: dv360Audiences.length,
                firstParty: dvFirstParty.length,
                thirdParty: dvThirdParty.length,
                crossCampaignUniqueReach: crossCampaign?.reach ?? null,
                avgFrequencyBurden: crossCampaign?.frequency ?? null,
                currency,
                note: "DV360 audience overlap between segments is not exposed by any API; only inventory + cross-campaign frequency burden are real.",
              },
            } : {}),
          }}
          platform={platform}
          inline
        />
      </div>

      {/* ── Meta Section ─────────────────────────────────────────────── */}
      {showMeta && platform === "both" && (
        <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Meta</h2>
          <span className="text-xs text-gray-400 font-medium">Meta Ads</span>
        </div>
      )}

      {showMeta && (
        <>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Overlap estimated from audience type and funnel stage similarity.{" "}
              For an exact audience-level check,{" "}
              <a href="https://www.facebook.com/adsmanager/audiences" target="_blank" rel="noopener noreferrer"
                className="underline font-semibold inline-flex items-center gap-0.5">
                open Audience Manager <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          </div>

          {/* Monthly exposure intensity: real reach + avg frequency, plus a modeled bucket bubble view */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap rounded-t-xl overflow-hidden">
              <div className="flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-bold text-gray-900">Monthly Exposure Intensity</h3>
              </div>
              <span className="text-[10px] text-gray-500">Trailing 12 months · all campaigns</span>
            </div>

            {annual.loading ? (
              <div className="px-5 py-10 text-sm text-gray-500 text-center">Loading monthly reach &amp; frequency…</div>
            ) : monthlyTrend.length === 0 ? (
              <div className="px-5 py-10 text-sm text-gray-500 text-center">No monthly reach/frequency data for the trailing 12 months.</div>
            ) : (
              <>
                {/* TOP: real Meta data — monthly reach (bars) + avg frequency (line). Scrollable so all 12 months are visible. */}
                <div className="p-5 pb-2">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-bold text-gray-900">Monthly Reach &amp; Avg Frequency</div>
                      <div className="text-xs text-gray-500 mt-0.5">Real Meta data — months with a higher orange line ran more repeat exposure.</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold uppercase border border-green-200">Real</span>
                  </div>
                  {/* Fixed pixel width per bar; overflow-x-scroll always shows a scrollbar. */}
                  <div className="overflow-x-scroll pb-1" style={{ scrollbarWidth: "thin" }}>
                    <ComposedChart data={monthlyTrend} width={Math.max(monthlyTrend.length * 120, 600)} height={220} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E5E9F0" }} />
                      <YAxis yAxisId="reach" tickFormatter={(v: number) => fmtSize(v)} tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E5E9F0" }} width={48} />
                      <YAxis yAxisId="freq" orientation="right" tickFormatter={(v: number) => `${v}×`} tick={{ fontSize: 10, fill: "#F59E0B" }} tickLine={false} axisLine={{ stroke: "#E5E9F0" }} width={36} />
                      <ReTooltip
                        formatter={(value: number, name: string) => {
                          if (name === "reach") return [fmtSize(value), "Reach"];
                          if (name === "frequency") return [`${value.toFixed(2)}×`, "Avg Frequency"];
                          return [value, name];
                        }}
                      />
                      <ReLegend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="reach" dataKey="reach" name="Reach" fill="#6366F1" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                      <Line yAxisId="freq" type="monotone" dataKey="frequency" name="Avg Frequency" stroke="#F59E0B" strokeWidth={2.4} dot={{ r: 3, fill: "#F59E0B" }} />
                    </ComposedChart>
                  </div>
                </div>

                {/* BOTTOM: real cross-month exposure stat — derived from data we already fetch */}
                <div className="p-5 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <div className="text-sm font-bold text-gray-900">Months of Activity (real)</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Cross-month exposure intensity, derived directly from Meta — no modeling.
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold uppercase border border-green-200">Real</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Annual Unique Reach</div>
                      <div className="text-2xl font-bold text-gray-900">{fmtSize(annual.reach)}</div>
                      <div className="text-xs text-gray-600 mt-1">people reached in the year</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Sum of Monthly Reaches</div>
                      <div className="text-2xl font-bold text-gray-900">{fmtSize(monthsOfActivity.sumMonthly)}</div>
                      <div className="text-xs text-gray-600 mt-1">Σ of each month&apos;s reach</div>
                    </div>
                    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-violet-700">Avg Months / Reached User</div>
                      <div className="text-2xl font-bold text-violet-800">
                        {monthsOfActivity.avg > 0 ? `${monthsOfActivity.avg.toFixed(1)} mo` : "—"}
                      </div>
                      <div className="text-xs text-violet-700 mt-1">distinct months active</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-gray-600 leading-relaxed">
                    {monthsOfActivity.avg > 0 && (
                      <>
                        On average, each reached user appeared across <span className="font-semibold">{monthsOfActivity.avg.toFixed(1)}</span> distinct months this year.
                        {monthsOfActivity.avg >= 3
                          ? " Exposure is spread broadly — users come back across many months (good for steady brand familiarity)."
                          : monthsOfActivity.avg >= 1.8
                            ? " Exposure is moderately spread — users typically see ads across 2–3 months."
                            : " Exposure is concentrated — users mostly saw ads in a single month (heavier bursts, less continuity)."}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 leading-relaxed">
              All numbers on this card come directly from Meta (monthly <code>reach</code>, <code>frequency</code>, <code>impressions</code> over the trailing 12 months).
              <span className="block mt-1">A per-user frequency histogram (e.g. "10% saw 6× in Apr/May/Aug") is not exposed by Meta's auction Insights API — only by <a href="https://developers.facebook.com/docs/marketing-api/reach-and-frequency/" target="_blank" rel="noopener noreferrer" className="underline">Reach &amp; Frequency campaigns</a>, which use reserved buying.</span>
            </div>
          </div>

          {/* ── Audience Size table ──────────────────────────────────────── */}
          <AudienceSizeTable audiences={audiences} />

          {/* ── Cross-campaign frequency burden (real account-level data) ── */}
          <CrossCampaignBurden adsets={adsets} accountReach={accountReach} accountFrequency={accountFrequency} />

          {/* ── Audience type spend efficiency (real, grouped by classifier) ── */}
          <AudienceTypeEfficiency adsets={adsets} classifyRow={classifyRow} cur={cur} curPrecise={curPrecise} />

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Select ad sets to compare</h3>
              <span className="text-xs text-gray-400">{selected.length} of {MAX_AUDIENCES}</span>
            </div>

            {loading ? (
              <div className="text-sm text-gray-500">Loading ad sets…</div>
            ) : adsets.length === 0 ? (
              <div className="text-sm text-gray-500">No ad sets found. Connect a Meta account or widen the date range.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {selected.map((val, idx) => {
                    const others = new Set(selected.filter((_, i) => i !== idx));
                    const row = val ? adSetMap.get(val) : undefined;
                    const cls = row ? classifyRow(row) : null;
                    return (
                      <div key={idx}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-semibold text-gray-600">Ad Set {SLOT_LABELS[idx]}</label>
                          {selected.length > 2 && (
                            <button
                              onClick={() => removeSlot(idx)}
                              className="text-gray-400 hover:text-red-600 inline-flex items-center gap-0.5 text-[11px] font-medium"
                              title="Remove this audience"
                            >
                              <X className="w-3 h-3" /> Remove
                            </button>
                          )}
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setSlot(idx, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value="">— Select ad set —</option>
                          {[...adsets].sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((a) => (
                            <option key={a.id} value={a.id} disabled={others.has(a.id)}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        {cls && (
                          <div className="mt-1.5 flex items-center gap-2">
                            {stageBadge(cls.funnelStage)}
                            {audienceBadge(cls)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selected.length < MAX_AUDIENCES && (
                  <button
                    onClick={addSlot}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add audience
                  </button>
                )}
              </>
            )}
          </div>

          {analysis && (() => {
            const { items, pairs, unionReach, topPair } = analysis;
            const fmt = (n: number | null, suffix = "") => n !== null ? `${n.toFixed(suffix === "x" ? 2 : suffix === "%" ? 2 : 0)}${suffix}` : "—";
            const cpm  = (r: AdSetRow) => r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null;
            const ctr  = (r: AdSetRow) => r.impressions > 0 ? (r.clicks  / r.impressions) * 100 : null;
            const cpc  = (r: AdSetRow) => r.clicks > 0 ? r.spend / r.clicks : null;
            const roas = (r: AdSetRow) => r.spend > 0 ? r.conversionValue / r.spend : null;
            const cpa  = (r: AdSetRow) => r.conversions > 0 ? r.spend / r.conversions : null;
            const cvr  = (r: AdSetRow) => r.clicks > 0 ? (r.conversions / r.clicks) * 100 : null;

            const cpuReach = (r: AdSetRow) => r.reach > 0 ? r.spend / r.reach : null;

            const rows: { label: string; values: React.ReactNode[]; combined: React.ReactNode }[] = [
              { label: "Funnel Stage",      values: items.map((it) => stageBadge(it.cls.funnelStage)), combined: "—" },
              { label: "Audience Type",     values: items.map((it) => audienceBadge(it.cls)), combined: "—" },
              { label: "Spend",             values: items.map((it) => cur(it.row.spend)), combined: cur(items.reduce((s, it) => s + it.row.spend, 0)) },
              { label: "Impressions",       values: items.map((it) => fmtSize(it.row.impressions)), combined: fmtSize(items.reduce((s, it) => s + it.row.impressions, 0)) },
              { label: "Reach (period)",    values: items.map((it) => it.size > 0 ? fmtSize(it.size) : "—"), combined: unionReach > 0 ? fmtSize(unionReach) : "—" },
              { label: "Frequency",         values: items.map((it) => it.row.frequency?.toFixed(1) ?? "—"), combined: "—" },
              { label: "$/Unique Reach",    values: items.map((it) => cpuReach(it.row) !== null ? curPrecise(cpuReach(it.row)!) : "—"), combined: "—" },
              { label: "CPM",               values: items.map((it) => cpm(it.row) !== null ? cur(cpm(it.row)!) : "—"), combined: "—" },
              { label: "CTR",               values: items.map((it) => fmt(ctr(it.row), "%")), combined: "—" },
              { label: "CPC",               values: items.map((it) => cpc(it.row) !== null ? cur(cpc(it.row)!) : "—"), combined: "—" },
              { label: "Conversions",       values: items.map((it) => it.row.conversions.toLocaleString()), combined: items.reduce((s, it) => s + it.row.conversions, 0).toLocaleString() },
              { label: "Conv. Value",       values: items.map((it) => cur(it.row.conversionValue)), combined: cur(items.reduce((s, it) => s + it.row.conversionValue, 0)) },
              { label: "CPA",               values: items.map((it) => cpa(it.row) !== null ? cur(cpa(it.row)!) : "—"), combined: "—" },
              { label: "CVR",               values: items.map((it) => fmt(cvr(it.row), "%")), combined: "—" },
              { label: "ROAS",              values: items.map((it) => fmt(roas(it.row), "x")), combined: "—" },
            ];

            return (
              <div className="space-y-6">
                {/* Reach summary */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900">Reach Summary</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold uppercase border border-blue-200">Heuristic</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-gray-100">
                    {items.map((it, i) => (
                      <div key={i} className="bg-white px-5 py-4">
                        <div className="text-2xl font-bold text-gray-900">{it.size > 0 ? fmtSize(it.size) : "—"}</div>
                        <div className="text-xs text-gray-500 mt-0.5">reach (period)</div>
                        <div className="text-xs text-gray-600 mt-1 truncate" title={it.row.name}>
                          {SLOT_LABELS[i]} · {it.row.name}
                        </div>
                      </div>
                    ))}
                    <div className="bg-white px-5 py-4">
                      <div className="text-2xl font-bold text-blue-700">{unionReach > 0 ? fmtSize(unionReach) : "—"}</div>
                      <div className="text-xs text-gray-500 mt-0.5">combined union</div>
                      <div className="text-xs text-gray-600 mt-1">de-duplicated est.</div>
                    </div>
                  </div>
                </div>

                {/* Pairwise overlap */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-900">Pairwise Overlap</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {pairs.length} pair{pairs.length > 1 ? "s" : ""} compared.
                      {topPair && topPair.pct > 30 && " High-overlap pairs may be bidding against each other — consider exclusions."}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {pairs.map((p, i) => {
                      const isTop = topPair === p && p.pct > 25;
                      return (
                        <div key={i} className={`px-5 py-4 ${isTop ? "bg-red-50/40" : ""}`}>
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <div className="text-sm font-medium text-gray-800 truncate">
                              <span title={p.a.row.name}>{p.a.row.name}</span>
                              <span className="text-gray-400 mx-1.5">↔</span>
                              <span title={p.b.row.name}>{p.b.row.name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">{p.users > 0 ? `${fmtSize(p.users)} shared` : "—"}</span>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${riskLabel(p.pct).color}`}>
                                {p.pct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          <OverlapBar pct={p.pct} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Metric comparison */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-900">Metric Comparison</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Metric</th>
                          {items.map((it, i) => (
                            <th key={i} className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase max-w-[160px] truncate" title={it.row.name}>
                              {SLOT_LABELS[i]} · {it.row.name}
                            </th>
                          ))}
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Combined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.label} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-2.5 text-gray-700 font-medium">{r.label}</td>
                            {r.values.map((v, i) => (
                              <td key={i} className="px-4 py-2.5 text-right text-gray-900">{v}</td>
                            ))}
                            <td className="px-4 py-2.5 text-right font-bold text-blue-700">{r.combined}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── DV360 Audience Inventory ─────────────────────────────────── */}
      {showDV360 && platform === "both" && (
        <div className="flex items-center gap-3 pt-4 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">DV360</h2>
          <span className="text-xs text-gray-400 font-medium">Display &amp; Video 360</span>
        </div>
      )}

      {showDV360 && (
        <>
          {/* KPI cards — only show when audiences actually exist */}
          {dv360Audiences.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <div className="text-sm text-gray-600">Total Audiences</div>
                <div className="text-3xl font-bold text-gray-900 mt-1">{dv360Audiences.length}</div>
                <div className="text-xs text-gray-500 mt-1">Accessible to this advertiser</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <div className="text-sm text-gray-600">First-Party</div>
                <div className="text-3xl font-bold text-blue-600 mt-1">{dvFirstParty.length}</div>
                <div className="text-xs text-gray-500 mt-1">Activity-based, Customer Match, etc.</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <div className="text-sm text-gray-600">Third-Party / Google</div>
                <div className="text-3xl font-bold text-purple-600 mt-1">{dvThirdParty.length}</div>
                <div className="text-xs text-gray-500 mt-1">In-market, affinity, custom intent</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <div className="text-sm text-gray-600">Customer Match</div>
                <div className="text-3xl font-bold text-green-600 mt-1">
                  {dv360Audiences.filter((a) => a.source.toLowerCase().includes("customer match")).length}
                </div>
                <div className="text-xs text-gray-500 mt-1">CRM list uploads</div>
              </div>
            </div>
          )}

          {dvAudError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{dvAudError}</div>
          )}

          {/* Audience inventory table — only when audiences exist */}
          {dv360Audiences.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">DV360 Audience Inventory</h2>
                <p className="text-sm text-gray-600 mt-1">All first-party and third-party audiences accessible to this advertiser</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                    <tr>
                      <SortTh col="name" sort={dvAudSort} onToggle={dvAudToggle} className="px-6 py-3">Audience Name</SortTh>
                      <SortTh col="type" sort={dvAudSort} onToggle={dvAudToggle} className="px-6 py-3">Type</SortTh>
                      <SortTh col="source" sort={dvAudSort} onToggle={dvAudToggle} className="px-6 py-3">Source</SortTh>
                      <SortTh col="activeSize" sort={dvAudSort} onToggle={dvAudToggle} className="px-6 py-3" align="right">Active Size</SortTh>
                      <SortTh col="membershipDays" sort={dvAudSort} onToggle={dvAudToggle} className="px-6 py-3" align="right">Membership</SortTh>
                      <th className="px-6 py-3 text-left font-semibold text-gray-700">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDvAud.map((a) => (
                      <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium text-gray-900 max-w-[250px] truncate">{a.name}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            a.type === "First Party" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                          }`}>{a.type}</span>
                        </td>
                        <td className="px-6 py-3 text-gray-700 text-xs">{a.source}</td>
                        <td className="px-6 py-3 text-right text-gray-900 font-medium">{a.activeSize}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{a.membershipDays ? `${a.membershipDays}d` : "—"}</td>
                        <td className="px-6 py-3 text-gray-500 text-xs max-w-[200px] truncate">{a.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Overlap is a UI-only DV360 feature — no API endpoint exists. This is
              a static fact, so show it immediately rather than behind a spinner —
              audience inventory below fills in when its (slower) fetch completes. */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 mt-0.5 shrink-0 text-blue-500" />
              <div className="space-y-2">
                <h2 className="text-base font-bold text-gray-900">Audience overlap isn&apos;t available via the DV360 API</h2>
                <p className="text-sm text-gray-600">
                  DV360 exposes audience overlap only in its own UI — there is no API endpoint that returns
                  shared-user counts or overlap percentages between audiences. Check it directly in DV360:
                  <span className="font-medium text-gray-800"> Audiences → Audience Insights → Overlap Report</span>.
                </p>
                <p className="text-xs text-gray-500">
                  Audience lists and line-item targeting (geo, demographics, device, etc.) are shown under
                  <span className="font-medium"> Audience Analysis</span> and <span className="font-medium">Account Structure</span>.
                  {dvAudLoading && <span className="italic"> Loading audience inventory…</span>}
                </p>
              </div>
            </div>
          </div>

          {dv360Audiences.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>Audience sizes shown are approximate ranges provided by Google — exact counts are not exposed via API.</div>
            </div>
          )}

          {/* Cross-Campaign Frequency Burden — real REACH-report data, unlike
              overlap % which DV360's API doesn't expose. */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200 flex items-start gap-3">
              <Repeat2 className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-gray-900">Cross-Campaign Frequency Burden</h2>
                <p className="text-sm text-gray-600 mt-1">
                  De-duplicated unique reach across ALL campaigns combined — a person shown ads by 3 different
                  campaigns is counted once, not three times. Computed from a Bid Manager REACH report scoped to the
                  whole advertiser (real data, not a per-campaign sum).
                </p>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-5">
                <div className="text-sm text-gray-600">Unique Reach (whole period, all campaigns)</div>
                <div className="text-3xl font-bold text-gray-900 mt-1">
                  {(crossCampaignPending || dvFreqLoading) && !crossCampaign
                    ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    : crossCampaign ? crossCampaign.reach.toLocaleString("en-IN") : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {crossCampaignPending ? "Report still generating on Google's side…" : "People, not impressions"}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-5">
                <div className="text-sm text-gray-600">Avg Frequency Burden (per person)</div>
                <div className="text-3xl font-bold text-gray-900 mt-1">
                  {(crossCampaignPending || dvFreqLoading) && !crossCampaign
                    ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    : crossCampaign ? `${crossCampaign.frequency.toFixed(1)}×` : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">Impressions per unique person, summed across all campaigns</div>
              </div>
            </div>

            {dvMonthlyFreq.length > 0 && (
              <div className="px-6 pb-6">
                <div className="text-sm font-semibold text-gray-900 mb-3">Monthly Exposure Intensity</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dvMonthlyFreq} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="reach" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="freq" orientation="right" tick={{ fontSize: 11 }} />
                      <ReTooltip formatter={(v: number, name: string) => [name === "Frequency" ? `${v.toFixed(1)}×` : v.toLocaleString("en-IN"), name]} />
                      <ReLegend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="reach" dataKey="reach" name="Unique Reach" fill="#6366F1" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="freq" type="monotone" dataKey="frequency" name="Frequency" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Each month is its own independently de-duplicated REACH query — not a slice of the period total, so
                  monthly reach numbers won&apos;t sum to the whole-period figure above (the same person seen in two
                  months counts once per month, but only once for the whole period).
                  {dvMonthlyFreq.some((m) => m.partial) && (
                    <> A label like &ldquo;Jun 16–30&rdquo; means the selected date range only covers part of that
                    month, so its bar isn&apos;t a full-month figure and isn&apos;t comparable to a complete month.</>
                  )}
                </p>
              </div>
            )}
            {dvMonthlyPending && dvMonthlyFreq.length === 0 && (
              <div className="px-6 pb-6 text-sm text-gray-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Monthly breakdown still generating…
              </div>
            )}
          </div>
        </>
      )}

      {(showMeta || showDV360) && (
        <TabSummaryFooter
          lines={(() => {
            // Chart-derived insight lines (always shown when data exists).
            const chartLines: string[] = [];

            // Line 1 — peak frequency month from Monthly Exposure Intensity chart.
            if (showMeta && monthlyTrend.length > 0) {
              const peakFreqMonth = [...monthlyTrend].sort((a, b) => b.frequency - a.frequency)[0];
              const peakReachMonth = [...monthlyTrend].sort((a, b) => b.reach - a.reach)[0];
              chartLines.push(
                `Peak frequency in ${peakFreqMonth.label} (${peakFreqMonth.frequency.toFixed(1)}×); peak reach in ${peakReachMonth.label} (${fmtSize(peakReachMonth.reach)} people).`
              );
            }

            // Line 2 — frequency distribution breakdown (Annual Frequency Distribution donut).
            if (showMeta && freqDist.length > 0 && annual.reach > 0) {
              const low = freqDist[0];   // 1–5×
              const high = freqDist.find((b) => b.lo >= 11); // 11–20× bucket
              const veryHigh = freqDist[freqDist.length - 1]; // 21×+
              const oversatPct = ((veryHigh.share + (high?.share ?? 0)) * 100).toFixed(0);
              chartLines.push(
                `Meta: ${(low.share * 100).toFixed(0)}% of your annual reach saw ads 1–5× (light touch); ${oversatPct}% saw 11×+ (potential ad fatigue).`
              );
            }

            // Line 3 — months of activity or overlap insight (Meta).
            if (showMeta && analysis) {
              const { topPair, unionReach } = analysis;
              chartLines.push(
                topPair && topPair.pct > 30
                  ? `Highest overlap: "${topPair.a.row.name}" ↔ "${topPair.b.row.name}" at ${topPair.pct.toFixed(1)}% — add exclusions to reduce cannibalization.`
                  : topPair
                    ? `Compared ${analysis.items.length} ad sets — est. union reach ${fmtSize(unionReach)}; overlap within healthy range (<30%).`
                    : `Avg exposure spread: ${monthsOfActivity.avg.toFixed(1)} months per reached user — ${monthsOfActivity.avg >= 3 ? "broad continuity across the year" : "concentrated bursts; consider always-on spend"}.`
              );
            } else if (showMeta && monthsOfActivity.avg > 0) {
              chartLines.push(
                `Avg ${monthsOfActivity.avg.toFixed(1)} months of active exposure per reached user — ${monthsOfActivity.avg >= 3 ? "healthy spread across the year" : "mostly burst activity; consider more even pacing"}.`
              );
            } else if (showMeta && adsets.length > 0) {
              chartLines.push(`${adsets.length} ad sets available — select 2 or more above to compare audience overlap.`);
            }

            // DV360 lines — real inventory + cross-campaign frequency burden.
            if (showDV360) {
              chartLines.push(
                `DV360: ${dv360Audiences.length} audiences available (${dvFirstParty.length} first-party, ${dvThirdParty.length} third-party). Segment-to-segment overlap isn't exposed by the DV360 API.`
              );
              if (crossCampaign?.reach) {
                chartLines.push(
                  `DV360 cross-campaign unique reach: ${fmtSize(crossCampaign.reach)} people at ${crossCampaign.frequency?.toFixed(1) ?? "—"}× avg frequency burden (de-duplicated across all campaigns).`
                );
              }
            }

            return chartLines.length > 0
              ? chartLines
              : ["No reach/frequency data available for the trailing 12 months."];
          })()}
          tabName="Audience Overlap"
          context={{
            ...(showMeta ? { meta: { adSetCount: adsets.length, overlapPairs: analysis?.pairs.length ?? 0 } } : {}),
            ...(showDV360 ? { dv360: {
              audienceCount: dv360Audiences.length,
              firstParty: dvFirstParty.length,
              thirdParty: dvThirdParty.length,
              crossCampaignUniqueReach: crossCampaign?.reach ?? null,
              avgFrequencyBurden: crossCampaign?.frequency ?? null,
              currency,
            } } : {}),
          }}
          platform={platform}
          dateRange={String(dateRange)}
        />
      )}
    </div>
  );
}
