/**
 * Reporting → Dashboard
 *
 * Merged Planning + BBD-style dashboard. Top section is the BBD visual overview
 * (blue date bar, deliveries/targets with pacing, platform table, campaign table).
 * Below that, the full Aggregate Planning system (groupBy views, save plan,
 * download PDF, CSV import/export, snapshots) and per-platform deep-dives.
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { LayoutDashboard, Sparkles, Trash2, Save, ChevronDown, ChevronUp, X } from "lucide-react";
import SmartNumberInput from "@/components/shared/SmartNumberInput";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentJSON } from "@/hooks/useColumnPrefs";
import { useDV360Reach } from "@/hooks/useDV360Reach";
import { useAuthStore } from "@/store/auth";
import { formatMoney } from "@/lib/currency";
import { toDisplayCredits } from "@/lib/ai-cost";
import type { CampaignData } from "@/types";
import {
  AggregatePlanning,
  PlanningSection,
  SectionHeader,
  DailyTrendCharts,
} from "./PlanningReport";

// ─── shared helpers ───

interface Delivered {
  spend: number; impressions: number; clicks: number; reach: number;
  videoViews: number; frequency: number; cpm: number; ctr: number; vtr: number;
}

function baseDelivery(c: CampaignData) {
  const useAllTime = c.platform === "dv360" && (c.allTimeSpend ?? 0) > 0 && c.spend === 0;
  return {
    spend: useAllTime ? (c.allTimeSpend ?? 0) : (c.spend ?? 0),
    impressions: useAllTime ? (c.allTimeImpressions ?? 0) : (c.impressions ?? 0),
    clicks: useAllTime ? (c.allTimeClicks ?? 0) : (c.clicks ?? 0),
    reach: useAllTime ? 0 : (c.reach ?? 0),
    videoViews: c.videoViews ?? 0,
  };
}

function deriveDelivered(b: { spend: number; impressions: number; clicks: number; reach: number; videoViews: number }): Delivered {
  return {
    ...b,
    frequency: b.reach > 0 ? b.impressions / b.reach : 0,
    cpm: b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0,
    ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
    vtr: b.impressions > 0 && b.videoViews > 0 ? (b.videoViews / b.impressions) * 100 : 0,
  };
}

function deliveredOfGroup(list: CampaignData[]): Delivered {
  let spend = 0, impressions = 0, clicks = 0, reach = 0, videoViews = 0;
  for (const c of list) {
    const b = baseDelivery(c);
    spend += b.spend; impressions += b.impressions; clicks += b.clicks;
    reach += b.reach; videoViews += b.videoViews;
  }
  return deriveDelivered({ spend, impressions, clicks, reach, videoViews });
}

const HERO_METRICS = [
  { key: "spend", label: "Net Spends", kind: "money" as const },
  { key: "impressions", label: "Impressions", kind: "int" as const },
  { key: "reach", label: "Reach", kind: "int" as const },
  { key: "frequency", label: "Frequency", kind: "decimal" as const },
];

function fmtBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-IN");
}

function fmtVal(kind: "money" | "int" | "decimal" | "pct", n: number, currency: string): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (kind === "money") return formatMoney(n, currency, 0);
  if (kind === "pct") return `${n.toFixed(2)}%`;
  if (kind === "decimal") return n.toFixed(2);
  return Math.round(n).toLocaleString("en-IN");
}

type PlannedValues = Record<string, number>;

// A dated capture of the overall planned targets vs delivered-so-far, so the
// user can save a plan today and compare it against a fresh save later.
interface OverallSnapshot {
  id: string;
  at: number;
  dateLabel: string;
  metrics: { key: string; label: string; planned: number; delivered: number }[];
}

// ─── Inline AI Gap button (small violet, same style as AI Summary across site) ──

function InlineAiGap({ hasPlanned, aiSummary, aiLoading, estimateCredits, onAnalyze, onRegenerate, pacingRows }: {
  hasPlanned: boolean;
  aiSummary: string | null;
  aiLoading: boolean;
  estimateCredits: number;
  onAnalyze: () => void;
  onRegenerate: () => void;
  pacingRows: { label: string; pc: number }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const handleClick = () => {
    const next = !open;
    setOpen(next);
    if (next && hasPlanned && !aiSummary && !aiLoading) onAnalyze();
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 transition whitespace-nowrap shadow-sm">
        {aiLoading ? <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        AI Gap Analysis
        {!aiSummary && !aiLoading && <span className="text-[10px] opacity-60">~{estimateCredits.toFixed(1)}</span>}
        {open ? <ChevronUp className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-[min(420px,90vw)] z-50 rounded-lg border border-violet-200 bg-white shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-violet-50 border-b border-violet-100">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-600" />
              <span className="text-xs font-bold text-gray-900">AI Gap Analysis</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="px-3 py-3 max-h-[50vh] overflow-y-auto">
            {!hasPlanned ? (
              <p className="text-[11px] text-gray-500 py-2">Enter planned targets to get AI-powered gap analysis.</p>
            ) : aiLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-gray-600 py-3">
                <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin shrink-0" />
                Analyzing planned vs delivered gap…
              </div>
            ) : aiSummary ? (
              <>
                <div className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{aiSummary}</div>
                <button onClick={onRegenerate} disabled={aiLoading}
                  className="mt-2 text-[11px] text-violet-700 hover:text-violet-800 font-medium">↻ Regenerate</button>
              </>
            ) : (
              <div className="text-center py-2">
                <button onClick={onAnalyze} disabled={aiLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 transition">
                  <Sparkles className="w-3 h-3" /> Analyze Gap
                </button>
              </div>
            )}
            {pacingRows.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-violet-100">
                <div className="text-[9px] font-bold text-violet-700 uppercase tracking-wider mb-1">Pacing</div>
                <div className="space-y-0.5">
                  {pacingRows.map((r) => {
                    const color = r.pc >= 90 && r.pc <= 110 ? "text-green-600 bg-green-50" : r.pc >= 70 && r.pc <= 130 ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
                    return (<div key={r.label} className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-600">{r.label}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${color}`}>{r.pc}%</span>
                    </div>);
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── component ───

export default function DashboardReport({
  platform,
  dateRange,
  customStart,
  customEnd,
}: {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}) {
  const { campaigns, loading, metaCurrency, dv360Currency, startDate, endDate } =
    useCampaigns(platform === "dv360" ? "dv360" : platform, dateRange, customStart, customEnd);
  const { demoMode } = useAuthStore();

  // planPlatform removed — always show both platforms
  const [planned, setPlanned] = usePersistentJSON<PlannedValues>("dashboard-planned-overall", {});
  const [snapshots, setSnapshots] = usePersistentJSON<OverallSnapshot[]>("dashboard-overall-snapshots", []);
  const [openSnap, setOpenSnap] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const cur = metaCurrency || dv360Currency || "INR";

  const showMeta = platform !== "dv360";
  const showDv = platform === "dv360" || platform === "both";

  const metaCampaigns = useMemo(() => campaigns.filter((c) => c.platform === "meta"), [campaigns]);

  // Enrich DV360 campaigns with reach from the dedicated endpoint.
  const { reachByCampaign, reachByLineItem } = useDV360Reach(dateRange, customStart, customEnd, showDv, campaigns);
  const dv360Campaigns = useMemo(() =>
    campaigns.filter((c) => c.platform === "dv360").map((c) => {
      const rc = reachByCampaign[c.id];
      return rc && rc.reach > 0 ? { ...c, reach: rc.reach, frequency: rc.frequency || c.frequency } : c;
    }),
  [campaigns, reachByCampaign]);

  const enrichedCampaigns = useMemo(() => [...metaCampaigns, ...dv360Campaigns], [metaCampaigns, dv360Campaigns]);

  const overall = useMemo(() => deliveredOfGroup(enrichedCampaigns), [enrichedCampaigns]);
  const metaD = useMemo(() => deliveredOfGroup(metaCampaigns), [metaCampaigns]);
  const dvD = useMemo(() => deliveredOfGroup(dv360Campaigns), [dv360Campaigns]);

  const pacing = (key: string) => {
    const p = planned[key] || 0;
    const d = key === "spend" ? overall.spend
      : key === "impressions" ? overall.impressions
      : key === "reach" ? overall.reach
      : key === "frequency" ? overall.frequency : 0;
    return p > 0 ? Math.round((d / p) * 100) : null;
  };

  const delVal = (key: string): number => {
    if (key === "spend") return overall.spend;
    if (key === "impressions") return overall.impressions;
    if (key === "reach") return overall.reach;
    if (key === "frequency") return overall.frequency;
    return 0;
  };

  const setPlannedKey = (key: string, val: number) => {
    setPlanned((prev) => ({ ...prev, [key]: val }));
  };

  const saveOverallSnapshot = () => {
    const now = new Date();
    const dateLabel = now.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const snap: OverallSnapshot = {
      id: `dash-snap-${now.getTime()}`, at: now.getTime(), dateLabel,
      metrics: HERO_METRICS.map((m) => ({ key: m.key, label: m.label, planned: planned[m.key] || 0, delivered: delVal(m.key) })),
    };
    setSnapshots((prev) => [snap, ...prev]);
    setOpenSnap(snap.id);
  };
  const removeOverallSnapshot = (id: string) => setSnapshots((prev) => prev.filter((s) => s.id !== id));
  const editOverallSnapshot = (s: OverallSnapshot) => {
    setPlanned((prev) => {
      const next = { ...prev };
      for (const m of s.metrics) next[m.key] = m.planned;
      return next;
    });
    setOpenSnap(null);
  };

  const fetchAiSummary = async () => {
    setAiLoading(true);
    try {
      const deliveredObj: Record<string, number> = {
        spend: overall.spend, impressions: overall.impressions, reach: overall.reach,
        frequency: overall.frequency, clicks: overall.clicks, cpm: overall.cpm,
        ctr: overall.ctr, vtr: overall.vtr, views: overall.videoViews,
      };
      const pacingObj: Record<string, number | null> = {};
      for (const m of HERO_METRICS) pacingObj[m.key] = pacing(m.key);
      const r = await fetch("/api/ai/plan-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: "Overall (All Platforms)", planned, delivered: deliveredObj,
          pacing: pacingObj, dateRange: `${startDate} — ${endDate}`, isDemo: demoMode,
        }),
      });
      const json = await r.json();
      if (json.summary) setAiSummary(json.summary);
      if (json.creditsUsedUsd) useAuthStore.getState().addAiCredits(json.creditsUsedUsd);
    } catch (_e) { setAiSummary("Could not generate summary. Please try again."); }
    finally { setAiLoading(false); }
  };

  const hasPlanned = Object.values(planned).some((v) => v > 0);
  const estimateCredits = toDisplayCredits(0.011);

  return (
    <div className="space-y-8">
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1: BBD-style overview (blue bar, deliveries, targets, tables)
          ═══════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <LayoutDashboard className="w-7 h-7 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Live performance overview — combined Meta + DV360 delivery vs your planned targets.
        </p>

        {/* Blue date-range bar */}
        <div className="rounded-lg bg-[#0072F0] text-white px-6 py-3 mb-6 flex items-center justify-between text-sm font-semibold">
          <span>
            Last updated on {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })}{" "}
            {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
            {dv360Campaigns.length > 0 && " (Google Reach is delayed by 24 Hours)"}
          </span>
          <span className="text-white/80 text-xs font-normal">
            {startDate} → {endDate} · {enrichedCampaigns.length} campaigns
          </span>
        </div>

        {loading && enrichedCampaigns.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-3" />
            Loading campaign data…
          </div>
        ) : (
          <div>
              {/* Overall Deliveries */}
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Overall Deliveries</div>
                <InlineAiGap
                  hasPlanned={hasPlanned}
                  aiSummary={aiSummary}
                  aiLoading={aiLoading}
                  estimateCredits={estimateCredits}
                  onAnalyze={fetchAiSummary}
                  onRegenerate={() => { setAiSummary(null); fetchAiSummary(); }}
                  pacingRows={HERO_METRICS.map((m) => ({ label: m.label, pc: pacing(m.key) })).filter((r) => r.pc !== null) as { label: string; pc: number }[]}
                />
              </div>
              <div className="flex items-center gap-0 mb-2">
                {HERO_METRICS.map((m, i) => {
                  const val = delVal(m.key);
                  // The circle before a box shows the PRECEDING metric's own
                  // pacing, so it appears as soon as that metric's target is
                  // entered — not gated on the next metric having a target too.
                  const prevPc = i > 0 ? pacing(HERO_METRICS[i - 1].key) : null;
                  return (
                    <div key={m.key} className="contents">
                      {i > 0 && prevPc !== null && (
                        <div className="flex-shrink-0 -mx-2 z-10">
                          <div className="w-11 h-11 rounded-full flex items-center justify-center shadow-md" style={{ background: "#F5A623" }}>
                            <span className="text-[11px] font-extrabold text-white">{prevPc}%</span>
                          </div>
                        </div>
                      )}
                      {i > 0 && prevPc === null && <div className="w-3" />}
                      <div className={`flex-1 min-w-[120px] text-center border border-gray-200 bg-white py-3 px-2 ${i === 0 ? "rounded-l-lg" : ""} ${i === HERO_METRICS.length - 1 ? "rounded-r-lg" : ""}`}>
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{m.label}</div>
                        <div className={`font-extrabold tabular-nums ${i === 0 ? "text-2xl text-[#0072F0]" : "text-lg text-gray-900"}`}>
                          {m.kind === "money" ? fmtVal("money", val, cur) : fmtBig(val)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overall Targets */}
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Overall Targets</div>
                <button onClick={saveOverallSnapshot}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition">
                  <Save className="w-3 h-3" /> Save plan
                </button>
              </div>
              <div className="flex gap-0 mb-4">
                {HERO_METRICS.map((m, i) => (
                  <div key={m.key} className={`flex-1 min-w-[120px] text-center bg-gray-50 border border-gray-200 py-3 px-2 ${i === 0 ? "rounded-l-lg" : ""} ${i === HERO_METRICS.length - 1 ? "rounded-r-lg" : ""}`}>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{m.label}</div>
                    <SmartNumberInput
                      value={planned[m.key] || 0}
                      onChange={(v) => setPlannedKey(m.key, v)}
                      deliveredHint={delVal(m.key)}
                      kind={m.kind}
                      currencySymbol={m.kind === "money" ? (cur === "USD" ? "$" : "₹") : undefined}
                      wrapperClassName="inline-flex items-center justify-center gap-1"
                      className="w-20 text-center text-sm font-bold text-gray-700 bg-transparent border-b border-dashed border-gray-300 focus:border-blue-500 focus:outline-none tabular-nums py-0.5"
                    />
                  </div>
                ))}
              </div>

              {/* Saved plans — dated captures the user can view / edit / remove */}
              {snapshots.length > 0 && (
                <div className="mb-6 rounded-lg border border-gray-200">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <span className="text-xs font-bold text-gray-800">Saved plans</span>
                    <span className="text-[11px] text-gray-400"> · {snapshots.length} saved</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {snapshots.map((s) => (
                      <div key={s.id}>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-xs font-semibold text-gray-800">{s.dateLabel}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => setOpenSnap(openSnap === s.id ? null : s.id)}
                              className="px-2 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100">
                              {openSnap === s.id ? "Hide" : "View"}
                            </button>
                            <button onClick={() => editOverallSnapshot(s)}
                              className="px-2 py-1 text-[11px] font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
                              Edit
                            </button>
                            <button onClick={() => removeOverallSnapshot(s.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100">
                              <Trash2 className="w-3 h-3" /> Remove
                            </button>
                          </div>
                        </div>
                        {openSnap === s.id && (
                          <div className="border-t border-gray-100 px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500">
                                  <th className="text-left py-1 font-semibold">Metric</th>
                                  <th className="text-right py-1 font-semibold">Planned</th>
                                  <th className="text-right py-1 font-semibold">Delivered (then)</th>
                                  <th className="text-right py-1 font-semibold">Pacing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.metrics.map((mm) => {
                                  const def = HERO_METRICS.find((x) => x.key === mm.key);
                                  const pace = mm.planned > 0 ? Math.round((mm.delivered / mm.planned) * 100) : null;
                                  const paceCls = pace === null ? "text-gray-400" : pace >= 90 && pace <= 110 ? "text-green-600" : pace >= 70 && pace <= 130 ? "text-amber-600" : "text-red-600";
                                  return (
                                    <tr key={mm.key} className="border-t border-gray-50">
                                      <td className="py-1 text-gray-700">{mm.label}</td>
                                      <td className="py-1 text-right text-gray-700">{mm.planned > 0 ? (def?.kind === "money" ? fmtVal("money", mm.planned, cur) : fmtBig(mm.planned)) : "—"}</td>
                                      <td className="py-1 text-right font-semibold text-gray-900">{def?.kind === "money" ? fmtVal("money", mm.delivered, cur) : fmtBig(mm.delivered)}</td>
                                      <td className={`py-1 text-right font-semibold ${paceCls}`}>{pace === null ? "—" : `${pace}%`}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}



          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2: Full Planning system (from PlanningReport)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="border-t-2 border-gray-200 pt-6">
        <AggregatePlanning
          campaigns={enrichedCampaigns}
          loading={loading}
          metaCurrency={metaCurrency}
          dv360Currency={dv360Currency}
          dateRange={dateRange}
          customStart={customStart}
          customEnd={customEnd}
        />
      </div>

      {/* ── Daily trend charts ── */}
      <DailyTrendCharts dateRange={dateRange} customStart={customStart} customEnd={customEnd} platform={platform} />

      {/* Per-platform deep-dives */}
      {showMeta && metaCampaigns.length > 0 && (
        <div className="space-y-4">
          <SectionHeader label="Meta" sub="Meta Ads" />
          <PlanningSection
            campaigns={metaCampaigns}
            loading={loading}
            currency={metaCurrency}
            storageSuffix="meta"
            dateRange={dateRange}
            aiPlatform="meta"
          />
        </div>
      )}
      {showDv && dv360Campaigns.length > 0 && (
        <div className="space-y-4">
          <SectionHeader label="DV360" sub="Display & Video 360" />
          <PlanningSection
            campaigns={dv360Campaigns}
            loading={loading}
            currency={dv360Currency}
            storageSuffix="dv360"
            dateRange={dateRange}
            aiPlatform="dv360"
            lineItemReach={reachByLineItem}
          />
        </div>
      )}
    </div>
  );
}

// ─── Platform row with data bars ───

function PlatformRow({ label, d, cur, total, color }: { label: string; d: Delivered; cur: string; total: Delivered; color: string }) {
  const bar = (val: number, max: number) => {
    if (max <= 0) return null;
    const pct = Math.min((val / max) * 100, 100);
    return <div className="inline-block h-[6px] rounded-full ml-1.5 align-middle" style={{ width: `${Math.max(pct * 0.6, 4)}px`, background: color }} />;
  };
  return (
    <tr className="even:bg-gray-50 hover:bg-blue-50/30">
      <td className="px-3 py-2 font-semibold">{label}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtVal("money", d.spend, cur)}{bar(d.spend, total.spend)}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtBig(d.impressions)}{bar(d.impressions, total.impressions)}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtBig(d.reach)}{bar(d.reach, total.reach)}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtVal("decimal", d.frequency, "")}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtVal("pct", d.vtr, "")}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtVal("pct", d.ctr, "")}</td>
      <td className="text-right px-3 py-2 tabular-nums">{fmtVal("money", d.cpm, cur)}</td>
    </tr>
  );
}
