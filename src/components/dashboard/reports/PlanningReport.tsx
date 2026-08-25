/**
 * Reporting → Planning
 *
 * Planned vs Delivered media-plan reconciliation, per platform.
 *
 * The marketer picks which campaigns to plan for (dropdown). Each selected
 * campaign is a row: type the PLANNED buy (Net Spend / Reach / Impressions),
 * and DELIVERED is shown right beside it — auto-matched from real ad data over
 * the selected date range, with a pacing % and an AI insight panel.
 *
 * In "Both" mode the page splits into a Meta section and a DV360 section, each
 * with its own campaign picker + planned/delivered deep-dive. Planned inputs +
 * selection persist per account AND per platform (separate storage keys) so the
 * two plans never collide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Info, Sparkles, Download, Upload, Save, Trash2, FileDown, Layers, Plus, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ComposedChart, Bar,
} from "recharts";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentJSON } from "@/hooks/useColumnPrefs";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import { useDV360Reach } from "@/hooks/useDV360Reach";
import { useMetaAdSets, useDV360LineItems } from "@/hooks/useAudienceData";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { useMetaCampaignLifetime } from "@/hooks/useMetaCampaignLifetime";
import CampaignMultiPicker from "@/components/shared/CampaignMultiPicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import DrillBreadcrumb from "@/components/dashboard/reports/planning/DrillBreadcrumb";
import { useAuthStore } from "@/store/auth";
import { toDisplayCredits } from "@/lib/ai-cost";
import { formatMoney } from "@/lib/currency";
import type { CampaignData, AdSetData } from "@/types";
import type { PlanGroup, SavedPlanStoreV2, DrillPathEntry } from "@/types/planning";
import SmartNumberInput from "@/components/shared/SmartNumberInput";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

// spend/reach/impressions are the primary inputs; frequency/cpm are optional
// direct overrides (else auto-derived). vtr/ctr/views/clicks are optional planned
// targets set in the per-campaign deep-dive.
interface Planned {
  spend: number; reach: number; impressions: number;
  frequency?: number; cpm?: number;
  vtr?: number; ctr?: number; views?: number; clicks?: number;
}
type PlannedMap = Record<string, Planned>; // key = campaign id

const fmtInt = (n: number) => (n > 0 ? Math.round(n).toLocaleString("en-IN") : "—");
const fmtPct = (n: number) => (Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}%` : "—");
const fmtX = (n: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—");

interface Delivered {
  spend: number; impressions: number; clicks: number; reach: number; videoViews: number;
  frequency: number; cpm: number; ctr: number; vtr: number;
}
// Base delivery for a campaign. A media plan spans the whole flight, so for
// DV360 — where the campaign may have ended before the rolling date window — we
// fall back to FULL-FLIGHT (all-time) delivery when the window shows nothing,
// instead of a misleading blank. (All-time reach/views aren't fetched, so those
// resolve to "—" on the fallback path — honest, not zero-as-fact.) Meta has no
// all-time field, so it always uses the window.
function baseDelivery(
  c: CampaignData | undefined,
  preferFlight = false,
  metaLifetime?: Record<string, { spend: number; impressions: number; clicks: number; reach: number; videoViews: number }>,
): { spend: number; impressions: number; clicks: number; reach: number; videoViews: number } {
  const winSpend = c?.spend || 0, winImpr = c?.impressions || 0;
  const hasAllTimeDV = c?.platform === "dv360" && ((c?.allTimeSpend || 0) > 0 || (c?.allTimeImpressions || 0) > 0);
  const useAllTimeDV = hasAllTimeDV && (preferFlight || (winSpend === 0 && winImpr === 0));

  // Meta lifetime fallback: when the window shows no delivery, use lifetime data
  const metaLT = c?.platform === "meta" && metaLifetime && c?.id ? metaLifetime[c.id] : undefined;
  const useMetaLT = !!metaLT && winSpend === 0 && winImpr === 0;

  if (useMetaLT && metaLT) {
    return {
      spend: metaLT.spend, impressions: metaLT.impressions, clicks: metaLT.clicks,
      reach: metaLT.reach, videoViews: metaLT.videoViews,
    };
  }
  return {
    spend:       useAllTimeDV ? (c?.allTimeSpend || 0)       : winSpend,
    impressions: useAllTimeDV ? (c?.allTimeImpressions || 0) : winImpr,
    clicks:      useAllTimeDV ? (c?.allTimeClicks || 0)      : (c?.clicks || 0),
    reach:       c?.reach || 0,
    videoViews:  useAllTimeDV ? 0 : (c?.videoViews || 0),
  };
}

function deriveDelivered(b: { spend: number; impressions: number; clicks: number; reach: number; videoViews: number }): Delivered {
  const { spend, impressions, clicks, reach, videoViews } = b;
  return {
    spend, impressions, clicks, reach, videoViews,
    frequency: reach > 0 ? impressions / reach : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    vtr: impressions > 0 ? (videoViews / impressions) * 100 : 0,
  };
}

function deliveredOf(
  c: CampaignData | undefined,
  metaLifetime?: Record<string, { spend: number; impressions: number; clicks: number; reach: number; videoViews: number }>,
): Delivered {
  return deriveDelivered(baseDelivery(c, true, metaLifetime));
}

export function SectionHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{label}</h2>
      <span className="text-xs text-gray-400 font-medium">{sub}</span>
    </div>
  );
}

// Compact per-campaign gap explainer — 2-3 plain-English sentences, on demand.
function GapInsight({ campaign, planned, delivered, pacing, dateRange, platform, align = "end", label = "Explain the gap" }: {
  campaign: string;
  planned: Record<string, number>;
  delivered: Record<string, number>;
  pacing: Record<string, number | null>;
  dateRange: string;
  platform: "meta" | "dv360" | "both";
  align?: "start" | "end";
  label?: string;
}) {
  const demoMode = useAuthStore((s) => s.demoMode);
  const addAiCredits = useAuthStore((s) => s.addAiCredits);
  const [state, setState] = useState<{ loading: boolean; text: string | null; err: string | null }>({ loading: false, text: null, err: null });

  const run = async () => {
    setState({ loading: true, text: null, err: null });
    try {
      const r = await fetch("/api/ai/plan-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign, planned, delivered, pacing, dateRange, platform, isDemo: demoMode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (typeof j.creditsUsedUsd === "number") addAiCredits(j.creditsUsedUsd);
      setState({ loading: false, text: j.summary, err: null });
    } catch (e) {
      setState({ loading: false, text: null, err: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className={`flex flex-col gap-1 max-w-full ${align === "start" ? "items-start" : "items-end"}`}>
      <button
        onClick={run}
        disabled={state.loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition disabled:opacity-60"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {state.loading ? "Analysing…" : state.text ? "Explain again" : label}
        <span className="text-violet-400 font-normal">~${toDisplayCredits(0.0006).toFixed(2)}</span>
      </button>
      {state.text && (
        <div className="mt-1 w-full max-w-xl bg-violet-50/60 border border-violet-100 rounded-lg px-3 py-2 text-xs text-gray-700 leading-relaxed text-left whitespace-pre-line">
          {state.text}
        </div>
      )}
      {state.err && <div className="text-[11px] text-red-500 max-w-xl text-left">{state.err}</div>}
    </div>
  );
}

type LIReachMap = Record<string, { reach: number; frequency: number; campaignId?: string; name: string }>;

function AdSetBreakdownTable({ adSets, currency }: { adSets: AdSetData[]; currency: string }) {
  const [open, setOpen] = useState(false);
  const active = adSets.filter((a) => (a.spend ?? 0) > 0 || (a.impressions ?? 0) > 0);
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const totSpend = sorted.reduce((s, a) => s + (a.spend ?? 0), 0);
  const totImpr = sorted.reduce((s, a) => s + (a.impressions ?? 0), 0);
  const totClicks = sorted.reduce((s, a) => s + (a.clicks ?? 0), 0);
  const totReach = sorted.reduce((s, a) => s + (a.reach ?? 0), 0);
  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-2.5 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition text-xs font-semibold text-gray-700">
        <span>Ad Sets — Delivered Breakdown ({sorted.length})</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Ad Set</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Spend</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Reach</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Freq</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Impr</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Clicks</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">CTR</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">CPM</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const sp = a.spend ?? 0, im = a.impressions ?? 0, cl = a.clicks ?? 0, re = a.reach ?? 0;
                return (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700 max-w-[260px] truncate" title={a.name}>{a.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{sp > 0 ? formatMoney(sp, currency, 0) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{re > 0 ? fmtInt(re) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{re > 0 && im > 0 ? fmtX(im / re) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{im > 0 ? fmtInt(im) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{cl > 0 ? fmtInt(cl) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{im > 0 ? fmtPct((cl / im) * 100) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{im > 0 ? formatMoney((sp / im) * 1000, currency, 0) : "—"}</td>
                  </tr>
                );
              })}
              {sorted.length > 1 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2 text-gray-700">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{formatMoney(totSpend, currency, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{totReach > 0 ? fmtInt(totReach) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{totReach > 0 && totImpr > 0 ? fmtX(totImpr / totReach) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtInt(totImpr)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtInt(totClicks)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{totImpr > 0 ? fmtPct((totClicks / totImpr) * 100) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{totImpr > 0 ? formatMoney((totSpend / totImpr) * 1000, currency, 0) : "—"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LineItemReachTable({ lineItems, currency }: { lineItems: [string, { reach: number; frequency: number; name: string }][]; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-2.5 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition text-xs font-semibold text-gray-700">
        <span>Line Items — Reach &amp; Frequency ({lineItems.length})</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Line Item</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Reach</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Frequency</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map(([id, v]) => (
                <tr key={id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700 max-w-[320px] truncate" title={v.name}>{v.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{fmtInt(v.reach)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtX(v.frequency)}</td>
                </tr>
              ))}
              {lineItems.length > 1 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2 text-gray-700">Total (sum of line items)</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtInt(lineItems.reduce((s, [, v]) => s + v.reach, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {(() => {
                      const totalR = lineItems.reduce((s, [, v]) => s + v.reach, 0);
                      const totalI = lineItems.reduce((s, [, v]) => s + v.reach * v.frequency, 0);
                      return totalR > 0 ? fmtX(totalI / totalR) : "—";
                    })()}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── Multi-entity dropdown for deep-dive (campaigns + ad sets + ads) ────────
type DeepDiveItem = { id: string; name: string; type: "campaign" | "adset" | "ad" | "adgroup" | "creative" };
const TYPE_LABEL: Record<string, string> = { campaign: "Campaign", adset: "Ad Set", ad: "Ad", adgroup: "Ad Group", creative: "Creative" };
const TYPE_COLOR: Record<string, string> = {
  campaign: "bg-blue-100 text-blue-700",
  adset: "bg-purple-100 text-purple-700",
  ad: "bg-amber-100 text-amber-700",
  adgroup: "bg-teal-100 text-teal-700",
  creative: "bg-pink-100 text-pink-700",
};

function DeepDiveDropdown({ items, focusId, setFocusId, platform }: {
  items: DeepDiveItem[];
  focusId: string;
  setFocusId: (id: string) => void;
  platform?: "meta" | "dv360";
}) {
  const labels: Record<string, string> = platform === "dv360"
    ? { campaign: "Campaign", adset: "IO", ad: "Line Item", adgroup: "Ad Group", creative: "Creative" }
    : TYPE_LABEL;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusIds = useMemo(() => new Set(focusId ? focusId.split(",").filter(Boolean) : [items[0]?.id]), [focusId, items]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) => {
    const next = new Set(focusIds);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    if (next.size === 0) next.add(id);
    setFocusId([...next].join(","));
  };

  const selectAll = () => setFocusId(items.map((r) => r.id).join(","));
  const allSelected = focusIds.size === items.length;

  const checkedCount = [...focusIds].filter((id) => items.some((r) => r.id === id)).length;
  const label = checkedCount === 1
    ? (items.find((r) => focusIds.has(r.id))?.name ?? "Select")
    : checkedCount === items.length
      ? `All ${items.length} items`
      : `${checkedCount} selected`;

  return (
    <div className="relative mt-2.5" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 max-w-[500px] truncate"
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[360px] max-w-[520px] max-h-[340px] overflow-y-auto py-1">
          {items.length > 1 && (
            <button
              onClick={allSelected ? () => { setFocusId(items[0]?.id ?? ""); } : selectAll}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-100"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${allSelected ? "bg-blue-600 border-blue-600" : "border-gray-300"}`}>
                {allSelected && <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
              </span>
              <span className="font-semibold text-gray-600">{allSelected ? "Deselect all" : "Select all"}</span>
            </button>
          )}
          {items.map((r) => {
            const checked = focusIds.has(r.id);
            return (
              <button
                key={r.id}
                onClick={() => toggle(r.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-blue-50 transition ${checked ? "bg-blue-50/50" : ""}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-600 border-blue-600" : "border-gray-300"}`}>
                  {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                </span>
                <span className="truncate text-gray-700 text-left flex-1">{r.name}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${TYPE_COLOR[r.type]}`}>{labels[r.type]}</span>
              </button>
            );
          })}
          <div className="border-t border-gray-100 px-3 py-2 flex justify-end">
            <button onClick={() => setOpen(false)} className="px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-md">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Extra deep-dive panel (additional comparison window) ─
function ExtraDeepDivePanel({
  panelId, items, rows, byId, currency, metaLifetime, aiPlatform, dateRange, onRemove,
  entityDeliveredMap, onSavePlan, initialFocusId, onFocusChange,
}: {
  panelId: string;
  items: DeepDiveItem[];
  rows: { id: string; name: string; planned: Planned; delivered: any }[];
  byId: Map<string, CampaignData>;
  currency: string;
  metaLifetime: Record<string, any>;
  aiPlatform: "meta" | "dv360";
  dateRange: DateRange;
  onRemove: () => void;
  entityDeliveredMap: Map<string, Delivered>;
  onSavePlan: (name: string, entityIds: Set<string>) => void;
  initialFocusId?: string;
  onFocusChange?: (panelId: string, focusId: string) => void;
}) {
  const [focusId, setFocusIdRaw] = useState<string>(initialFocusId || (items[0]?.id ?? ""));
  const setFocusId = (id: string) => { setFocusIdRaw(id); onFocusChange?.(panelId, id); };
  const [localSaveName, setLocalSaveName] = useState<string | null>(null);
  const [localJustSaved, setLocalJustSaved] = useState(false);

  // Each extra panel has its own independent planned values
  const [localPlanned, setLocalPlanned] = useState<Record<string, Planned>>({});
  const planned = localPlanned;
  const setPlan = (id: string, patch: Partial<Planned>) =>
    setLocalPlanned((prev) => {
      const cur0 = prev[id] ?? { spend: 0, reach: 0, impressions: 0 };
      return { ...prev, [id]: { ...cur0, ...patch } };
    });

  const focusIds = new Set(focusId ? focusId.split(",").filter(Boolean) : [items[0]?.id]);
  // Resolve focused items — check campaign rows first, then entityDeliveredMap
  const focusEntries: { id: string; name: string; planned: Planned; delivered: Delivered }[] = [];
  for (const fid of focusIds) {
    const campaignRow = rows.find((r) => r.id === fid);
    if (campaignRow) {
      focusEntries.push(campaignRow);
    } else {
      const ed = entityDeliveredMap.get(fid);
      const item = items.find((i) => i.id === fid);
      if (ed && item) {
        focusEntries.push({
          id: fid,
          name: item.name,
          planned: planned[fid] ?? { spend: 0, reach: 0, impressions: 0 },
          delivered: ed,
        });
      }
    }
  }
  const isMulti = focusEntries.length > 1;
  const focus = focusEntries[0] ?? rows[0];
  if (!focus) return null;

  const aggD = { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0, frequency: 0, cpm: 0, ctr: 0, vtr: 0 };
  for (const r of focusEntries) {
    const rd = r.delivered;
    aggD.spend += rd.spend; aggD.impressions += rd.impressions; aggD.clicks += rd.clicks;
    aggD.reach += rd.reach; aggD.videoViews += rd.videoViews;
  }
  aggD.frequency = aggD.reach > 0 ? aggD.impressions / aggD.reach : 0;
  aggD.cpm = aggD.impressions > 0 ? (aggD.spend / aggD.impressions) * 1000 : 0;
  aggD.ctr = aggD.impressions > 0 ? (aggD.clicks / aggD.impressions) * 100 : 0;
  aggD.vtr = aggD.impressions > 0 && aggD.videoViews > 0 ? (aggD.videoViews / aggD.impressions) * 100 : 0;

  const groupKey = isMulti ? `group:${[...focusIds].sort().join(",")}` : undefined;
  const groupPlanned = groupKey ? (planned[groupKey] ?? { spend: 0, reach: 0, impressions: 0 }) : undefined;
  const p = isMulti ? groupPlanned! : focus.planned;
  const d = isMulti ? aggD : focus.delivered;
  const pFreq = (p as any).frequency && (p as any).frequency > 0 ? (p as any).frequency : (p.reach > 0 ? p.impressions / p.reach : 0);
  const pCpm = (p as any).cpm && (p as any).cpm > 0 ? (p as any).cpm : (p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0);

  const money = (n: number) => (n > 0 ? formatMoney(n, currency, 0) : "—");
  const pct = (pl: number, de: number) => (pl > 0 ? Math.round((de / pl) * 100) : null);
  type Kind = "money" | "int" | "pct" | "decimal";
  const metricRows: {
    label: string; field: keyof Planned; kind: Kind; step: number;
    plannedEff: number; deliveredNum: number; deliveredStr: string; placeholder?: string;
  }[] = [
    { label: "Net Spend",   field: "spend",       kind: "money",   step: 1,    plannedEff: p.spend,        deliveredNum: d.spend,        deliveredStr: money(d.spend) },
    { label: "Reach",       field: "reach",       kind: "int",     step: 1,    plannedEff: p.reach,        deliveredNum: d.reach,        deliveredStr: fmtInt(d.reach) },
    { label: "Frequency",   field: "frequency",   kind: "decimal", step: 0.1,  plannedEff: pFreq,          deliveredNum: d.frequency,    deliveredStr: fmtX(d.frequency), placeholder: pFreq > 0 ? pFreq.toFixed(1) : "0" },
    { label: "Impressions", field: "impressions", kind: "int",     step: 1,    plannedEff: p.impressions,  deliveredNum: d.impressions,  deliveredStr: fmtInt(d.impressions) },
    { label: "Views",       field: "views",       kind: "int",     step: 1,    plannedEff: (p as any).views ?? 0,   deliveredNum: d.videoViews ?? (d as any).videoViews ?? 0,   deliveredStr: fmtInt(d.videoViews ?? (d as any).videoViews ?? 0) },
    { label: "VTR",         field: "vtr",         kind: "pct",     step: 0.01, plannedEff: (p as any).vtr ?? 0,     deliveredNum: d.vtr,          deliveredStr: fmtPct(d.vtr) },
    { label: "Clicks",      field: "clicks",      kind: "int",     step: 1,    plannedEff: (p as any).clicks ?? 0,  deliveredNum: d.clicks,       deliveredStr: fmtInt(d.clicks) },
    { label: "CTR",         field: "ctr",         kind: "pct",     step: 0.01, plannedEff: (p as any).ctr ?? 0,     deliveredNum: d.ctr,          deliveredStr: fmtPct(d.ctr) },
    { label: "CPM",         field: "cpm",         kind: "money",   step: 1,    plannedEff: pCpm,           deliveredNum: d.cpm,          deliveredStr: money(d.cpm), placeholder: pCpm > 0 ? String(Math.round(pCpm)) : "0" },
  ];

  const planKey = isMulti ? groupKey! : focus.id;

  const focusLabel = isMulti ? `${focusEntries.length} campaigns` : focus.name;
  const pct2 = (pl: number, de: number) => (pl > 0 ? Math.round((de / pl) * 100) : null);
  const extraFocusContext = {
    planned: { spend: p.spend, reach: p.reach, impressions: p.impressions, frequency: pFreq, cpm: pCpm, views: (p as any).views ?? 0, clicks: (p as any).clicks ?? 0, ctr: (p as any).ctr ?? 0, vtr: (p as any).vtr ?? 0 },
    delivered: { spend: d.spend, reach: d.reach, impressions: d.impressions, frequency: d.frequency, cpm: d.cpm, views: d.videoViews, clicks: d.clicks, ctr: d.ctr, vtr: d.vtr },
    pacing: { spend: pct2(p.spend, d.spend), reach: pct2(p.reach, d.reach), impressions: pct2(p.impressions, d.impressions) },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm scroll-mt-24">
      <div className="px-5 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-gray-900">Campaign deep-dive</h3>
          <div className="flex items-center gap-2">
            {localSaveName !== null ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = localSaveName.trim();
                  if (trimmed) {
                    const entityKeys = isMulti
                      ? new Set(focusEntries.map((r) => `campaign:${r.id}`))
                      : new Set([`campaign:${focus.id}`]);
                    onSavePlan(trimmed, entityKeys);
                    setLocalJustSaved(true);
                    setTimeout(() => setLocalJustSaved(false), 2000);
                  }
                  setLocalSaveName(null);
                }}
                className="inline-flex items-center gap-1.5"
              >
                <input
                  autoFocus
                  value={localSaveName}
                  onChange={(e) => setLocalSaveName(e.target.value)}
                  placeholder="Plan name"
                  className="px-2 py-1 text-xs border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 w-40"
                  onKeyDown={(e) => { if (e.key === "Escape") setLocalSaveName(null); }}
                />
                <button type="submit" className="px-2 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700">Save</button>
                <button type="button" onClick={() => setLocalSaveName(null)} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
              </form>
            ) : (
              <button
                onClick={() => setLocalSaveName(isMulti ? `${focusEntries.length} campaigns plan` : `${focus.name} plan`)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border shadow-sm transition ${
                  localJustSaved ? "bg-green-50 border-green-300 text-green-700" : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                {localJustSaved ? "Saved ✓" : "Save plan"}
              </button>
            )}
            <GapInsight
              campaign={focusLabel}
              planned={extraFocusContext.planned}
              delivered={extraFocusContext.delivered}
              pacing={extraFocusContext.pacing}
              dateRange={String(dateRange)}
              platform={aiPlatform}
            />
            <button
              onClick={onRemove}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
              title="Remove this panel"
            >
              <X className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
        <DeepDiveDropdown items={items} focusId={focusId} setFocusId={setFocusId} platform={aiPlatform} />
      </div>
      <div className="p-5">
        {isMulti && (
          <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-800">
            Showing aggregated results for {focusEntries.length} campaigns: {focusEntries.map((r) => r.name).join(", ")}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Metric</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Planned</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Delivered</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Pacing</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map((m) => {
                const stored = (planned[planKey]?.[m.field] as number | undefined) ?? 0;
                return (
                  <tr key={m.label} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2 font-medium text-gray-700">{m.label}</td>
                    <td className="px-3 py-2 text-right">
                      <SmartNumberInput
                        value={stored || 0}
                        onChange={(v) => setPlan(planKey, { [m.field]: v })}
                        deliveredHint={m.deliveredNum}
                        kind={m.kind}
                        currencySymbol={m.kind === "money" && currency === "INR" ? "₹" : m.kind === "money" ? "$" : undefined}
                        placeholder={m.placeholder ?? "0"}
                        step={m.step}
                        className="w-28 px-2 py-1 text-xs text-right border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">{m.deliveredStr}</td>
                    <td className="px-3 py-2 text-right">
                      {m.plannedEff <= 0 ? <span className="text-gray-300">—</span> : (() => {
                        const pacing = Math.round((m.deliveredNum / m.plannedEff) * 100);
                        const off = Math.abs(pacing - 100);
                        const cls = off <= 10 ? "bg-green-100 text-green-800" : off <= 25 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
                        return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{pacing}%</span>;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-gray-500">
          {isMulti
            ? `Aggregated delivery for ${focusEntries.length} campaigns. Enter planned targets for the group.`
            : <>Planned vs delivered for <span className="font-medium">{focus.name}</span>.</>}
        </p>
      </div>
    </div>
  );
}

// ─── One platform's planning surface (picker + deep-dive), fully self-contained ─
export function PlanningSection({ campaigns, loading, currency, storageSuffix, dateRange, aiPlatform, lineItemReach }: {
  campaigns: CampaignData[];
  loading: boolean;
  currency: string;
  storageSuffix: string;
  dateRange: DateRange;
  aiPlatform: "meta" | "dv360";
  lineItemReach?: LIReachMap;
}) {
  const byId = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);

  // Persisted per account AND per platform so Meta and DV360 plans don't collide.
  const [selected, setSelected] = usePersistentJSON<string[]>(`planning-selected-${storageSuffix}`, []);
  const [selectedAdSets, setSelectedAdSets] = usePersistentJSON<string[]>(`planning-selected-adsets-${storageSuffix}`, []);
  const [selectedAds, setSelectedAds] = usePersistentJSON<string[]>(`planning-selected-ads-${storageSuffix}`, []);
  const [selectedAdGroups, setSelectedAdGroups] = usePersistentJSON<string[]>(`planning-selected-adgroups-${storageSuffix}`, []);
  const [selectedCreatives, setSelectedCreatives] = usePersistentJSON<string[]>(`planning-selected-creatives-${storageSuffix}`, []);
  const [planned, setPlanned] = usePersistentJSON<PlannedMap>(`planning-planned-${storageSuffix}`, {});

  // ── Plan Groups (v2) — replaces old flat saved plans ──
  const [planGroups, setPlanGroups] = usePersistentJSON<SavedPlanStoreV2>(`planning-groups-${storageSuffix}`, { version: 2, groups: [] });
  const [savePlanName, setSavePlanName] = useState<string | null>(null);

  // Migrate v1 saved plans to v2 plan groups on first load
  const [oldSaved] = usePersistentJSON<Record<string, { at: number; plan: Planned }>>(`planning-saved-${storageSuffix}`, {});
  useEffect(() => {
    if (planGroups.groups.length === 0 && Object.keys(oldSaved).length > 0) {
      const migrated: PlanGroup = {
        id: `migrated-${Date.now()}`,
        name: "Imported Plans",
        items: Object.entries(oldSaved).map(([id, s]) => ({
          entityType: "campaign" as const,
          entityId: id,
          entityName: byId.get(id)?.name || id,
          campaignId: id,
          plan: s.plan,
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPlanGroups({ version: 2, groups: [migrated] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drill path for hierarchical navigation ──
  const [drillPath, setDrillPath] = useState<DrillPathEntry[]>([]);

  const [focusId, setFocusId] = useState<string>("");
  const [justSavedId, setJustSavedId] = useState<string>("");
  const deepDiveRef = useRef<HTMLDivElement>(null);

  // Extra deep-dive panels
  const [extraPanels, setExtraPanels] = useState<{ id: string; focusId: string }[]>([]);
  const [saveAllName, setSaveAllName] = useState<string | null>(null);
  const [justSavedAll, setJustSavedAll] = useState(false);

  // Saved plans management
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showSavedPlans, setShowSavedPlans] = useState(false);

  const handleExtraPanelFocusChange = (panelId: string, newFocusId: string) => {
    setExtraPanels((prev) => prev.map((p) => p.id === panelId ? { ...p, focusId: newFocusId } : p));
  };

  const loadPlanGroup = (group: PlanGroup) => {
    const campaignIds = [...new Set(group.items.filter((i) => i.entityType === "campaign").map((i) => i.entityId))];
    if (campaignIds.length > 0) setSelected(campaignIds);
    const newPlanned: PlannedMap = {};
    for (const item of group.items) {
      const key = item.entityType === "campaign" ? item.entityId : `${item.entityType}:${item.entityId}`;
      newPlanned[key] = item.plan;
    }
    setPlanned(newPlanned);
    setActivePlanId(group.id);
    // Restore deep-dive panels
    const pf = group.panelFocusIds ?? [];
    if (pf.length > 0) {
      setFocusId(pf[0]);
      setExtraPanels(pf.slice(1).map((fid, i) => ({ id: `panel-loaded-${Date.now()}-${i}`, focusId: fid })));
    } else if (campaignIds.length > 0) {
      setFocusId(campaignIds[0]);
      setExtraPanels([]);
    }
  };

  // Auto-load the most recent saved plan on first mount
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (planGroups.groups.length === 0) return;
    autoLoadedRef.current = true;
    const sorted = [...planGroups.groups].sort((a, b) => b.updatedAt - a.updatedAt);
    loadPlanGroup(sorted[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planGroups.groups.length]);

  const renamePlanGroup = (id: string, newName: string) => {
    setPlanGroups((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => g.id === id ? { ...g, name: newName, updatedAt: Date.now() } : g),
    }));
    setRenamingPlanId(null);
  };

  const removePlanGroup = (id: string) => {
    setPlanGroups((prev) => ({ ...prev, groups: prev.groups.filter((g) => g.id !== id) }));
    if (activePlanId === id) setActivePlanId(null);
  };

  // ── Meta ad set data for the focused campaign ──
  const { rows: metaAdSetRows, loading: metaAdSetsLoading } = useMetaAdSets(
    dateRange, undefined, undefined,
    aiPlatform === "meta" && selected.length > 0
  );
  const focusedMetaAdSets = useMemo(
    () => focusId ? metaAdSetRows.filter((r) => r.campaignId === focusId) : [],
    [metaAdSetRows, focusId]
  );

  // ── Ad set + ad picker options (derived from campaign hierarchy) ──
  const adSetOptions = useMemo<{ id: string; name: string }[]>(() => {
    const result: { id: string; name: string }[] = [];
    for (const cId of selected) {
      const c = byId.get(cId);
      if (c?.adSets) for (const as of c.adSets) result.push({ id: as.id, name: as.name });
    }
    return result;
  }, [selected, byId]);

  const adOptions = useMemo<{ id: string; name: string }[]>(() => {
    const result: { id: string; name: string }[] = [];
    for (const cId of selected) {
      const c = byId.get(cId);
      if (c?.adSets) for (const as of c.adSets) {
        if (as.ads) for (const ad of as.ads) result.push({ id: ad.id, name: ad.name });
      }
    }
    return result;
  }, [selected, byId]);

  // DV360-only: ad groups (from line items) and creatives
  const adGroupOptions = useMemo<{ id: string; name: string }[]>(() => {
    if (aiPlatform !== "dv360") return [];
    const result: { id: string; name: string }[] = [];
    for (const cId of selected) {
      const c = byId.get(cId);
      if (c?.adSets) for (const io of c.adSets) {
        if (io.ads) for (const li of io.ads) {
          if (li.adGroups) for (const ag of li.adGroups) result.push({ id: ag.id, name: ag.name });
        }
      }
    }
    return result;
  }, [selected, byId, aiPlatform]);

  const creativeOptions = useMemo<{ id: string; name: string }[]>(() => {
    if (aiPlatform !== "dv360") return [];
    const result: { id: string; name: string }[] = [];
    for (const cId of selected) {
      const c = byId.get(cId);
      if (c?.adSets) for (const io of c.adSets) {
        if (io.ads) for (const li of io.ads) {
          if (li.creatives) for (const cr of li.creatives) result.push({ id: cr.id, name: cr.name });
        }
      }
    }
    return result;
  }, [selected, byId, aiPlatform]);

  // ── Meta lifetime fallback: fetch all-time delivery for selected campaigns ──
  const selectedMetaIds = useMemo(
    () => aiPlatform === "meta" ? selected : [],
    [selected, aiPlatform]
  );
  const hasZeroDelivery = useMemo(() => {
    if (aiPlatform !== "meta") return false;
    return selected.some((id) => {
      const c = byId.get(id);
      return c && (c.spend || 0) === 0 && (c.impressions || 0) === 0;
    });
  }, [selected, byId, aiPlatform]);
  const { data: metaLifetime } = useMetaCampaignLifetime(selectedMetaIds, hasZeroDelivery);

  // Open a saved plan group in the deep-dive

  const setPlan = (id: string, patch: Partial<Planned>) =>
    setPlanned((prev) => {
      const cur0 = prev[id] ?? { spend: 0, reach: 0, impressions: 0 };
      return { ...prev, [id]: { ...cur0, ...patch } };
    });

  const savePlanAsGroup = (name: string, selectedEntityIds: Set<string>, panelFocusIds?: string[]) => {
    const items = [...selectedEntityIds].map((key) => {
      const [entityType, entityId] = key.includes(":") ? key.split(":", 2) : ["campaign", key];
      const campaignId = entityType === "campaign" ? entityId : "";
      const entityName = entityType === "campaign"
        ? (byId.get(entityId)?.name || entityId)
        : entityId;
      return {
        entityType: entityType as "campaign" | "adset" | "ad",
        entityId,
        entityName,
        campaignId,
        plan: planned[entityType === "campaign" ? entityId : `${entityType}:${entityId}`] ?? { spend: 0, reach: 0, impressions: 0 },
      };
    });
    const group: PlanGroup = {
      id: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      items,
      panelFocusIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPlanGroups((prev) => ({ ...prev, groups: [...prev.groups, group] }));
    setJustSavedId(group.id);
    setTimeout(() => setJustSavedId(""), 2000);
  };

  const saveAllPlans = (name: string) => {
    const allEntityIds = new Set<string>();
    for (const id of selected) allEntityIds.add(`campaign:${id}`);
    for (const [key, val] of Object.entries(planned)) {
      if (val && (val.spend > 0 || val.reach > 0 || val.impressions > 0)) {
        allEntityIds.add(key.includes(":") ? key : `campaign:${key}`);
      }
    }
    if (allEntityIds.size === 0) return;
    const effectiveFocusId = focusId || rows[0]?.id || "";
    const panelFocusIds = [effectiveFocusId, ...extraPanels.map((p) => p.focusId || rows[0]?.id || "")].filter(Boolean);
    savePlanAsGroup(name, allEntityIds, panelFocusIds);
    setJustSavedAll(true);
    setTimeout(() => setJustSavedAll(false), 2000);
  };

  const rows = useMemo(() =>
    selected.map((id) => {
      const c = byId.get(id);
      return {
        id,
        name: c?.name ?? id,
        planned: planned[id] ?? { spend: 0, reach: 0, impressions: 0 },
        delivered: deliveredOf(c, metaLifetime),
      };
    }),
  [selected, byId, planned, metaLifetime]);

  const totals = useMemo(() => {
    const p = { spend: 0, reach: 0, impressions: 0 };
    const d = { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0 };
    for (const row of rows) {
      p.spend += row.planned.spend || 0; p.reach += row.planned.reach || 0; p.impressions += row.planned.impressions || 0;
      d.spend += row.delivered.spend; d.impressions += row.delivered.impressions; d.clicks += row.delivered.clicks;
      d.reach += row.delivered.reach; d.videoViews += row.delivered.videoViews;
    }
    return {
      planned: { ...p, frequency: p.reach > 0 ? p.impressions / p.reach : 0, cpm: p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0 },
      delivered: {
        ...d,
        frequency: d.reach > 0 ? d.impressions / d.reach : 0,
        cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
        ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
        vtr: d.impressions > 0 ? (d.videoViews / d.impressions) * 100 : 0,
      },
    };
  }, [rows]);

  const aiContext = useMemo(() => ({
    platform: aiPlatform,
    window: dateRange,
    campaigns: rows.map((r) => ({
      name: r.name,
      planned: r.planned,
      delivered: {
        spend: Math.round(r.delivered.spend), reach: Math.round(r.delivered.reach),
        impressions: Math.round(r.delivered.impressions), frequency: +r.delivered.frequency.toFixed(2),
        cpm: +r.delivered.cpm.toFixed(2), ctr: +r.delivered.ctr.toFixed(2), vtr: +r.delivered.vtr.toFixed(2),
        views: Math.round(r.delivered.videoViews), clicks: Math.round(r.delivered.clicks),
      },
      spendPacingPct: r.planned.spend > 0 ? Math.round((r.delivered.spend / r.planned.spend) * 100) : null,
      impressionPacingPct: r.planned.impressions > 0 ? Math.round((r.delivered.impressions / r.planned.impressions) * 100) : null,
    })),
    totals: {
      plannedSpend: totals.planned.spend, deliveredSpend: Math.round(totals.delivered.spend),
      plannedImpressions: totals.planned.impressions, deliveredImpressions: Math.round(totals.delivered.impressions),
    },
  }), [rows, totals, dateRange, aiPlatform]);

  const options = useMemo(() => campaigns.map((c) => ({ id: c.id, name: c.name })), [campaigns]);

  const deepDiveItems: DeepDiveItem[] = useMemo(() => [
    ...rows.map((r) => ({ id: r.id, name: r.name, type: "campaign" as const })),
    ...(selectedAdSets.length > 0
      ? adSetOptions.filter((o) => selectedAdSets.includes(o.id)).map((o) => ({ id: o.id, name: o.name, type: "adset" as const }))
      : []),
    ...(selectedAds.length > 0
      ? adOptions.filter((o) => selectedAds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, type: "ad" as const }))
      : []),
    ...(selectedAdGroups.length > 0
      ? adGroupOptions.filter((o) => selectedAdGroups.includes(o.id)).map((o) => ({ id: o.id, name: o.name, type: "adgroup" as const }))
      : []),
    ...(selectedCreatives.length > 0
      ? creativeOptions.filter((o) => selectedCreatives.includes(o.id)).map((o) => ({ id: o.id, name: o.name, type: "creative" as const }))
      : []),
  ], [rows, selectedAdSets, adSetOptions, selectedAds, adOptions, selectedAdGroups, adGroupOptions, selectedCreatives, creativeOptions]);

  // Build a delivered-metrics lookup for non-campaign entities (IOs, LIs, AdGroups, Creatives)
  // so the deep-dive can show real delivered data when one of these is focused.
  const entityDeliveredMap = useMemo(() => {
    const map = new Map<string, Delivered>();
    // Campaigns are already in `rows` — add them too for a single lookup path
    for (const r of rows) map.set(r.id, r.delivered);
    for (const cId of selected) {
      const c = byId.get(cId);
      if (!c?.adSets) continue;
      for (const io of c.adSets) {
        map.set(io.id, deriveDelivered({
          spend: io.spend || 0, impressions: io.impressions || 0,
          clicks: io.clicks || 0, reach: io.reach || 0, videoViews: 0,
        }));
        if (!io.ads) continue;
        for (const li of io.ads) {
          map.set(li.id, deriveDelivered({
            spend: li.spend || 0, impressions: li.impressions || 0,
            clicks: li.clicks || 0, reach: li.reach || 0, videoViews: 0,
          }));
          if (li.adGroups) {
            for (const ag of li.adGroups) {
              map.set(ag.id, deriveDelivered({ spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0 }));
            }
          }
          if (li.creatives) {
            for (const cr of li.creatives) {
              map.set(cr.id, deriveDelivered({
                spend: cr.spend || 0, impressions: cr.impressions || 0,
                clicks: cr.clicks || 0, reach: 0, videoViews: 0,
              }));
            }
          }
        }
      }
    }
    return map;
  }, [selected, byId, rows]);

  return (
    <div className="space-y-4">
      {/* Per-section AI summary */}
      {rows.length > 0 && (
        <div className="flex justify-end">
          <AIExecutiveSummary tabName={`Planning — ${aiPlatform === "dv360" ? "DV360" : "Meta"}`} context={aiContext} platform={aiPlatform} dateRange={String(dateRange)} inline />
        </div>
      )}

      {/* Campaign / Ad Set / Ad selectors */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap flex-1">
            <span className="text-sm font-semibold text-gray-700">Campaigns:</span>
            <CampaignMultiPicker options={options} values={selected} onChange={setSelected} allLabelText="None selected — pick campaigns to plan" loading={loading} />
          </div>
          {/* Saved Plans dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowSavedPlans(!showSavedPlans)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                activePlanId ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              {activePlanId ? planGroups.groups.find((g) => g.id === activePlanId)?.name || "Saved Plan" : "Saved Plans"}
              {planGroups.groups.length > 0 && <span className="text-[10px] bg-gray-200 text-gray-600 rounded-full px-1.5">{planGroups.groups.length}</span>}
            </button>
            {showSavedPlans && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl border border-gray-200 shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-900">Saved Plans</span>
                  <button onClick={() => setShowSavedPlans(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
                {planGroups.groups.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">No saved plans yet. Enter planned targets and click &quot;Save plan&quot; to save one.</div>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                    {planGroups.groups.map((g) => (
                      <div key={g.id} className={`px-4 py-3 hover:bg-gray-50 transition ${activePlanId === g.id ? "bg-blue-50" : ""}`}>
                        {renamingPlanId === g.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) renamePlanGroup(g.id, renameValue.trim()); if (e.key === "Escape") setRenamingPlanId(null); }}
                              className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <button onClick={() => { if (renameValue.trim()) renamePlanGroup(g.id, renameValue.trim()); }} className="text-xs font-semibold text-blue-600 hover:text-blue-800">Save</button>
                            <button onClick={() => setRenamingPlanId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-semibold text-gray-900 truncate max-w-[160px]" title={g.name}>{g.name}</span>
                              <span className="text-[10px] text-gray-400 shrink-0">{new Date(g.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                            </div>
                            <div className="text-[11px] text-gray-500 mb-2">
                              {g.items.filter((i) => i.entityType === "campaign").length} campaign{g.items.filter((i) => i.entityType === "campaign").length === 1 ? "" : "s"}
                              {(g.panelFocusIds?.length ?? 0) > 1 && <> · {g.panelFocusIds!.length} deep-dives</>}
                              {g.items.some((i) => i.plan.spend > 0) && <> · {"₹"}{Math.round(g.items.reduce((s, i) => s + (i.plan.spend || 0), 0)).toLocaleString("en-IN")} planned</>}
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => { loadPlanGroup(g); setShowSavedPlans(false); }}
                                className="px-2 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition">
                                {activePlanId === g.id ? "Reload" : "Load"}
                              </button>
                              <button onClick={() => { setRenamingPlanId(g.id); setRenameValue(g.name); }}
                                className="px-2 py-1 text-[11px] font-semibold text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition">
                                Rename
                              </button>
                              <button onClick={() => removePlanGroup(g.id)}
                                className="px-2 py-1 text-[11px] font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition">
                                Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {selected.length > 0 && adSetOptions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">{aiPlatform === "dv360" ? "Insertion Orders:" : "Ad Sets:"}</span>
            <CampaignMultiPicker
              options={adSetOptions}
              values={selectedAdSets}
              onChange={setSelectedAdSets}
              allLabelText={`All ${aiPlatform === "dv360" ? "IOs" : "ad sets"}`}
              entityLabel={aiPlatform === "dv360" ? "insertion orders" : "ad sets"}
              icon={<Layers className="w-3.5 h-3.5 text-gray-400" />}
            />
          </div>
        )}
        {selected.length > 0 && adOptions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">{aiPlatform === "dv360" ? "Line Items:" : "Ads:"}</span>
            <CampaignMultiPicker
              options={adOptions}
              values={selectedAds}
              onChange={setSelectedAds}
              allLabelText={`All ${aiPlatform === "dv360" ? "line items" : "ads"}`}
              entityLabel={aiPlatform === "dv360" ? "line items" : "ads"}
              icon={<ClipboardList className="w-3.5 h-3.5 text-gray-400" />}
            />
          </div>
        )}
        {aiPlatform === "dv360" && selected.length > 0 && adGroupOptions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">Ad Groups:</span>
            <CampaignMultiPicker
              options={adGroupOptions}
              values={selectedAdGroups}
              onChange={setSelectedAdGroups}
              allLabelText="All ad groups"
              entityLabel="ad groups"
              icon={<Layers className="w-3.5 h-3.5 text-gray-400" />}
            />
          </div>
        )}
        {aiPlatform === "dv360" && selected.length > 0 && creativeOptions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">Creatives:</span>
            <CampaignMultiPicker
              options={creativeOptions}
              values={selectedCreatives}
              onChange={setSelectedCreatives}
              allLabelText="All creatives"
              entityLabel="creatives"
              icon={<ClipboardList className="w-3.5 h-3.5 text-gray-400" />}
            />
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Pick the campaigns in your plan above, then open the deep-dive below to enter planned targets for a campaign and compare against delivery. Frequency &amp; CPM auto-calculate (or override them). Use <span className="font-semibold">Explain the gap</span> for a quick AI read.
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">
          {loading ? "Loading campaigns…" : "No campaigns selected yet — use the picker above to choose which campaigns to plan for."}
        </div>
      ) : (() => {
        // Multi-select: user can pick 1+ items for aggregated deep-dive.
        const focusIds = new Set(focusId ? focusId.split(",").filter(Boolean) : [rows[0]?.id]);
        // Resolve focused items — check campaign rows first, then entityDeliveredMap for IOs/LIs/etc.
        const focusEntries: { id: string; name: string; planned: Planned; delivered: Delivered }[] = [];
        for (const fid of focusIds) {
          const campaignRow = rows.find((r) => r.id === fid);
          if (campaignRow) {
            focusEntries.push(campaignRow);
          } else {
            const ed = entityDeliveredMap.get(fid);
            const item = deepDiveItems.find((i) => i.id === fid);
            if (ed && item) {
              focusEntries.push({
                id: fid,
                name: item.name,
                planned: planned[fid] ?? { spend: 0, reach: 0, impressions: 0 },
                delivered: ed,
              });
            }
          }
        }
        const isMulti = focusEntries.length > 1;
        const focus = focusEntries[0] ?? rows[0];
        if (!focus) return null;

        // Aggregate delivered across all focused entities.
        const aggD = { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0, frequency: 0, cpm: 0, ctr: 0, vtr: 0 };
        for (const r of focusEntries) {
          const rd = r.delivered;
          aggD.spend += rd.spend; aggD.impressions += rd.impressions; aggD.clicks += rd.clicks;
          aggD.reach += rd.reach; aggD.videoViews += rd.videoViews;
        }
        aggD.frequency = aggD.reach > 0 ? aggD.impressions / aggD.reach : 0;
        aggD.cpm = aggD.impressions > 0 ? (aggD.spend / aggD.impressions) * 1000 : 0;
        aggD.ctr = aggD.impressions > 0 ? (aggD.clicks / aggD.impressions) * 100 : 0;
        aggD.vtr = aggD.impressions > 0 && aggD.videoViews > 0 ? (aggD.videoViews / aggD.impressions) * 100 : 0;

        // For multi-select, use a group-level planned key so values start fresh
        // (not summed from individual campaigns). The key is stable for the same
        // set of selected campaigns.
        const groupKey = isMulti
          ? `group:${[...focusIds].sort().join(",")}`
          : undefined;
        const groupPlanned = groupKey ? (planned[groupKey] ?? { spend: 0, reach: 0, impressions: 0 }) : undefined;

        const p = isMulti ? (groupPlanned!) : focus.planned;
        const d = isMulti ? aggD : focus.delivered;
        const pFreq = (p as any).frequency && (p as any).frequency > 0 ? (p as any).frequency : (p.reach > 0 ? p.impressions / p.reach : 0);
        const pCpm = (p as any).cpm && (p as any).cpm > 0 ? (p as any).cpm : (p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0);

        const money = (n: number) => (n > 0 ? formatMoney(n, currency, 0) : "—");
        const pct = (pl: number, de: number) => (pl > 0 ? Math.round((de / pl) * 100) : null);
        type Kind = "money" | "int" | "pct" | "decimal";
        const metricRows: {
          label: string; field: keyof Planned; kind: Kind; step: number;
          plannedEff: number; deliveredNum: number; deliveredStr: string; placeholder?: string;
        }[] = [
          { label: "Net Spend",   field: "spend",       kind: "money",   step: 1,    plannedEff: p.spend,        deliveredNum: d.spend,        deliveredStr: money(d.spend) },
          { label: "Reach",       field: "reach",       kind: "int",     step: 1,    plannedEff: p.reach,        deliveredNum: d.reach,        deliveredStr: fmtInt(d.reach) },
          { label: "Frequency",   field: "frequency",   kind: "decimal", step: 0.1,  plannedEff: pFreq,          deliveredNum: d.frequency,    deliveredStr: fmtX(d.frequency), placeholder: pFreq > 0 ? pFreq.toFixed(1) : "0" },
          { label: "Impressions", field: "impressions", kind: "int",     step: 1,    plannedEff: p.impressions,  deliveredNum: d.impressions,  deliveredStr: fmtInt(d.impressions) },
          { label: "Views",       field: "views",       kind: "int",     step: 1,    plannedEff: (p as any).views ?? 0,   deliveredNum: d.videoViews ?? (d as any).videoViews ?? 0,   deliveredStr: fmtInt(d.videoViews ?? (d as any).videoViews ?? 0) },
          { label: "VTR",         field: "vtr",         kind: "pct",     step: 0.01, plannedEff: (p as any).vtr ?? 0,     deliveredNum: d.vtr,          deliveredStr: fmtPct(d.vtr) },
          { label: "Clicks",      field: "clicks",      kind: "int",     step: 1,    plannedEff: (p as any).clicks ?? 0,  deliveredNum: d.clicks,       deliveredStr: fmtInt(d.clicks) },
          { label: "CTR",         field: "ctr",         kind: "pct",     step: 0.01, plannedEff: (p as any).ctr ?? 0,     deliveredNum: d.ctr,          deliveredStr: fmtPct(d.ctr) },
          { label: "CPM",         field: "cpm",         kind: "money",   step: 1,    plannedEff: pCpm,           deliveredNum: d.cpm,          deliveredStr: money(d.cpm), placeholder: pCpm > 0 ? String(Math.round(pCpm)) : "0" },
        ];
        const focusLabel = isMulti ? `${focusEntries.length} campaigns (aggregated)` : focus.name;
        const focusContext = {
          campaign: focusLabel,
          window: String(dateRange),
          planned: {
            spend: p.spend, reach: p.reach, impressions: p.impressions, frequency: +pFreq.toFixed(2), cpm: +pCpm.toFixed(2),
            vtr: (p as any).vtr ?? 0, ctr: (p as any).ctr ?? 0, views: (p as any).views ?? 0, clicks: (p as any).clicks ?? 0,
          },
          delivered: {
            spend: Math.round(d.spend), reach: Math.round(d.reach), impressions: Math.round(d.impressions),
            frequency: +d.frequency.toFixed(2), cpm: +d.cpm.toFixed(2), vtr: +d.vtr.toFixed(2), ctr: +d.ctr.toFixed(2),
            views: Math.round(d.videoViews ?? (d as any).videoViews ?? 0), clicks: Math.round(d.clicks),
          },
          pacing: {
            spendPct: pct(p.spend, d.spend), reachPct: pct(p.reach, d.reach), impressionPct: pct(p.impressions, d.impressions),
            vtrPct: pct((p as any).vtr ?? 0, d.vtr), ctrPct: pct((p as any).ctr ?? 0, d.ctr), viewsPct: pct((p as any).views ?? 0, d.videoViews ?? (d as any).videoViews ?? 0), clicksPct: pct((p as any).clicks ?? 0, d.clicks),
          },
        };
        return (
          <div ref={deepDiveRef} className="bg-white rounded-xl border border-gray-200 shadow-sm scroll-mt-24">
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-gray-900">Campaign deep-dive</h3>
                <div className="flex items-center gap-2">
                  {savePlanName !== null ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = savePlanName.trim();
                        if (trimmed) {
                          const entityKeys = isMulti
                            ? new Set(focusEntries.map((r) => `campaign:${r.id}`))
                            : new Set([`campaign:${focus.id}`]);
                          const eFid = focusId || rows[0]?.id || "";
                          const pids = [eFid, ...extraPanels.map((p) => p.focusId || rows[0]?.id || "")].filter(Boolean);
                          savePlanAsGroup(trimmed, entityKeys, pids);
                        }
                        setSavePlanName(null);
                      }}
                      className="inline-flex items-center gap-1.5"
                    >
                      <input
                        autoFocus
                        value={savePlanName}
                        onChange={(e) => setSavePlanName(e.target.value)}
                        placeholder="Plan name"
                        className="px-2 py-1 text-xs border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 w-40"
                        onKeyDown={(e) => { if (e.key === "Escape") setSavePlanName(null); }}
                      />
                      <button type="submit" className="px-2 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700">Save</button>
                      <button type="button" onClick={() => setSavePlanName(null)} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setSavePlanName(isMulti ? `${focusEntries.length} campaigns plan` : `${focus.name} plan`)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border shadow-sm transition ${
                        justSavedId ? "bg-green-50 border-green-300 text-green-700" : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {justSavedId ? "Saved ✓" : "Save plan"}
                    </button>
                  )}
                  <GapInsight
                    campaign={focusLabel}
                    planned={focusContext.planned}
                    delivered={focusContext.delivered}
                    pacing={focusContext.pacing}
                    dateRange={String(dateRange)}
                    platform={aiPlatform}
                  />
                </div>
              </div>
              {/* Multi-entity dropdown: campaigns + ad sets + ads */}
              <DeepDiveDropdown
                items={deepDiveItems}
                focusId={focusId}
                setFocusId={setFocusId}
                platform={aiPlatform}
              />
            </div>
            <div className="p-5">
              {/* Drill breadcrumb for hierarchical navigation */}
              {!isMulti && drillPath.length > 1 && (
                <DrillBreadcrumb
                  path={drillPath}
                  onNavigate={(depth) => setDrillPath(drillPath.slice(0, depth + 1))}
                />
              )}
              {isMulti && (
                <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-800">
                  Showing aggregated results for {focusEntries.length} campaigns: {focusEntries.map((r) => r.name).join(", ")}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Metric</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Planned</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Delivered</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Pacing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map((m) => {
                      const planKey = isMulti ? groupKey! : focus.id;
                      const stored = (planned[planKey]?.[m.field] as number | undefined) ?? 0;
                      return (
                        <tr key={m.label} className="border-b border-gray-50 last:border-0">
                          <td className="px-3 py-2 font-medium text-gray-700">{m.label}</td>
                          <td className="px-3 py-2 text-right">
                              <SmartNumberInput
                                value={stored || 0}
                                onChange={(v) => setPlan(planKey, { [m.field]: v })}
                                deliveredHint={m.deliveredNum}
                                kind={m.kind}
                                currencySymbol={m.kind === "money" && currency === "INR" ? "₹" : m.kind === "money" ? "$" : undefined}
                                placeholder={m.placeholder ?? "0"}
                                step={m.step}
                                className="w-28 px-2 py-1 text-xs text-right border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                              />
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">
                            {m.deliveredStr === "—" && DASH_REASON[m.field]
                              ? <Tip text={DASH_REASON[m.field]}><span className="text-gray-400 cursor-help">—</span></Tip>
                              : m.deliveredStr}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.plannedEff <= 0 ? <span className="text-gray-300">—</span> : (() => {
                              const pacing = Math.round((m.deliveredNum / m.plannedEff) * 100);
                              const off = Math.abs(pacing - 100);
                              const cls = off <= 10 ? "bg-green-100 text-green-800" : off <= 25 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
                              return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{pacing}%</span>;
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-gray-500">
                {isMulti
                  ? `Aggregated delivery for ${focusEntries.length} campaigns. Enter planned targets for the group and save as a named plan.`
                  : <>Enter planned targets for each metric; delivered is matched from real {aiPlatform === "dv360" ? "DV360" : "Meta"} data and pacing is delivered ÷ planned. Click <span className="font-semibold">Explain the gap</span> for a 2-3 line read on <span className="font-medium">{focus.name}</span>.</>}
              </p>

              {/* ── Hierarchy drill-down — clickable ad set / IO breakdown ── */}
              {!isMulti && drillPath.length <= 1 && focusEntries.map((fr) => {
                const c = byId.get(fr.id);
                if (!c) return null;
                return (
                  <div key={fr.id} className="mt-4">
                    {aiPlatform === "meta" && (() => {
                      const adSets = focusedMetaAdSets.filter((as) => as.campaignId === fr.id);
                      if (metaAdSetsLoading) return <div className="text-xs text-gray-400 py-2">Loading ad sets…</div>;
                      if (adSets.length === 0) return null;
                      const sorted = [...adSets].sort((a, b) => b.spend - a.spend);
                      return (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-2.5 bg-gray-50 text-xs font-semibold text-gray-700">
                            Ad Sets ({sorted.length}) — click to drill down
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                  <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Ad Set</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Spend</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Impr</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Clicks</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">CTR</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sorted.map((as) => (
                                  <tr
                                    key={as.id}
                                    className="border-b border-gray-50 last:border-0 hover:bg-blue-50 cursor-pointer transition"
                                    onClick={() => setDrillPath([
                                      { type: "campaign", id: fr.id, name: fr.name },
                                      { type: "adset", id: as.id, name: as.name },
                                    ])}
                                  >
                                    <td className="px-4 py-2 text-blue-700 font-medium max-w-[260px] truncate hover:underline" title={as.name}>{as.name}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{as.spend > 0 ? formatMoney(as.spend, currency, 0) : "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{as.impressions > 0 ? fmtInt(as.impressions) : "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{as.clicks > 0 ? fmtInt(as.clicks) : "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{as.impressions > 0 ? fmtPct((as.clicks / as.impressions) * 100) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                    {aiPlatform === "dv360" && (() => {
                      const ios = c.adSets?.filter((a) => (a.spend ?? 0) > 0 || (a.impressions ?? 0) > 0) || [];
                      if (ios.length === 0) return null;
                      return (
                        <>
                          {ios.length > 0 && (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="px-4 py-2.5 bg-gray-50 text-xs font-semibold text-gray-700">
                                Insertion Orders ({ios.length}) — click to drill down
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">IO</th>
                                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Spend</th>
                                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Impr</th>
                                      <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Clicks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ios.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)).map((io) => (
                                      <tr
                                        key={io.id}
                                        className="border-b border-gray-50 last:border-0 hover:bg-blue-50 cursor-pointer transition"
                                        onClick={() => setDrillPath([
                                          { type: "campaign", id: fr.id, name: fr.name },
                                          { type: "io", id: io.id, name: io.name },
                                        ])}
                                      >
                                        <td className="px-4 py-2 text-blue-700 font-medium max-w-[260px] truncate hover:underline" title={io.name}>{io.name}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{(io.spend ?? 0) > 0 ? formatMoney(io.spend ?? 0, currency, 0) : "—"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-900">{(io.impressions ?? 0) > 0 ? fmtInt(io.impressions ?? 0) : "—"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-900">{(io.clicks ?? 0) > 0 ? fmtInt(io.clicks ?? 0) : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                );
              })}
              {/* ── Drilled-in view: ad set / IO detail ── */}
              {!isMulti && drillPath.length > 1 && (() => {
                const entry = drillPath[drillPath.length - 1];
                if (entry.type === "adset") {
                  const as = focusedMetaAdSets.find((r) => r.id === entry.id);
                  if (!as) return <div className="mt-2 text-xs text-gray-400">Ad set not found.</div>;
                  return (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                      <h4 className="text-xs font-bold text-gray-800">{as.name}</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Spend", value: as.spend > 0 ? formatMoney(as.spend, currency, 0) : "—" },
                          { label: "Impressions", value: fmtInt(as.impressions) },
                          { label: "Clicks", value: fmtInt(as.clicks) },
                          { label: "CTR", value: as.impressions > 0 ? fmtPct((as.clicks / as.impressions) * 100) : "—" },
                          { label: "Reach", value: fmtInt(as.reach) },
                          { label: "Frequency", value: fmtX(as.frequency) },
                          { label: "CPM", value: as.impressions > 0 ? formatMoney(as.cpm, currency, 0) : "—" },
                          { label: "Conversions", value: fmtInt(as.conversions) },
                        ].map((m) => (
                          <div key={m.label} className="bg-white rounded-md p-2.5 border border-gray-100">
                            <div className="text-[10px] uppercase font-semibold text-gray-400">{m.label}</div>
                            <div className="text-sm font-bold text-gray-900 tabular-nums">{m.value}</div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400">Targeting: {as.targeting}</p>
                    </div>
                  );
                }
                if (entry.type === "io") {
                  const c = byId.get(drillPath[0]?.id || "");
                  const io = c?.adSets?.find((a) => a.id === entry.id);
                  if (!io) return <div className="mt-2 text-xs text-gray-400">IO not found.</div>;
                  const lineItems = io.ads || [];
                  return (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                      <h4 className="text-xs font-bold text-gray-800">{io.name}</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Spend", value: (io.spend ?? 0) > 0 ? formatMoney(io.spend ?? 0, currency, 0) : "—" },
                          { label: "Impressions", value: fmtInt(io.impressions ?? 0) },
                          { label: "Clicks", value: fmtInt(io.clicks ?? 0) },
                          { label: "Reach", value: fmtInt(io.reach ?? 0) },
                        ].map((m) => (
                          <div key={m.label} className="bg-white rounded-md p-2.5 border border-gray-100">
                            <div className="text-[10px] uppercase font-semibold text-gray-400">{m.label}</div>
                            <div className="text-sm font-bold text-gray-900 tabular-nums">{m.value}</div>
                          </div>
                        ))}
                      </div>
                      {lineItems.length > 0 && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-700">
                            Line Items ({lineItems.length})
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                  <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Line Item</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Spend</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Impr</th>
                                  <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Clicks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lineItems.map((li: any) => (
                                  <tr key={li.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                                    <td className="px-4 py-2 text-gray-700 font-medium max-w-[260px] truncate" title={li.name}>{li.name}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{(li.spend ?? 0) > 0 ? formatMoney(li.spend ?? 0, currency, 0) : "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{(li.impressions ?? 0) > 0 ? fmtInt(li.impressions ?? 0) : "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{(li.clicks ?? 0) > 0 ? fmtInt(li.clicks ?? 0) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── Extra deep-dive panels ── */}
      {rows.length > 0 && extraPanels.map((panel) => (
        <ExtraDeepDivePanel
          key={panel.id}
          panelId={panel.id}
          items={deepDiveItems}
          rows={rows}
          byId={byId}
          currency={currency}
          metaLifetime={metaLifetime}
          aiPlatform={aiPlatform}
          dateRange={dateRange}
          entityDeliveredMap={entityDeliveredMap}
          onRemove={() => setExtraPanels((prev) => prev.filter((p) => p.id !== panel.id))}
          onSavePlan={savePlanAsGroup}
          initialFocusId={panel.focusId}
          onFocusChange={handleExtraPanelFocusChange}
        />
      ))}

      {/* ── Add another deep-dive + Save all ── */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExtraPanels((prev) => [...prev, { id: `panel-${Date.now()}`, focusId: "" }])}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-400 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition"
          >
            <Plus className="w-4 h-4" /> Add another deep-dive
          </button>
          {saveAllName !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = saveAllName.trim();
                if (trimmed) saveAllPlans(trimmed);
                setSaveAllName(null);
              }}
              className="flex items-center gap-1.5 shrink-0"
            >
              <input
                autoFocus
                value={saveAllName}
                onChange={(e) => setSaveAllName(e.target.value)}
                placeholder="Plan group name"
                className="px-2.5 py-2 text-xs border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 w-44"
                onKeyDown={(e) => { if (e.key === "Escape") setSaveAllName(null); }}
              />
              <button type="submit" className="px-3 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
              <button type="button" onClick={() => setSaveAllName(null)} className="px-2 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
            </form>
          ) : (
            <button
              onClick={() => {
                const names = selected.slice(0, 2).map((id) => byId.get(id)?.name || id);
                setSaveAllName(extraPanels.length > 0 ? `${names.join(" + ")}${selected.length > 2 ? " +…" : ""} plan` : `${names[0] || "Plan"}`);
              }}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border shadow-sm transition ${
                justSavedAll
                  ? "bg-green-50 border-green-300 text-green-700"
                  : "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              <Save className="w-4 h-4" />
              {justSavedAll ? "All saved ✓" : `Save all plans (${1 + extraPanels.length})`}
            </button>
          )}
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate Planned vs Delivered — Overall / Channel / Objective
// Planned = user input (persisted per account, CSV import/export). Delivered =
// real, summed from the ad accounts and grouped by the chosen dimension. Ratio
// metrics (CPM/CTR/VTR/Frequency) are recomputed from summed bases, never averaged.
// ─────────────────────────────────────────────────────────────────────────────
type MetricKind = "money" | "int" | "decimal" | "pct";
interface AggMetric { key: string; label: string; kind: MetricKind }
const AGG_METRICS: AggMetric[] = [
  { key: "spend",       label: "Spend",       kind: "money" },
  { key: "reach",       label: "Reach",       kind: "int" },
  { key: "frequency",   label: "Frequency",   kind: "decimal" },
  { key: "impressions", label: "Impressions", kind: "int" },
  { key: "views",       label: "Views",       kind: "int" },
  { key: "vtr",         label: "VTR",         kind: "pct" },
  { key: "clicks",      label: "Clicks",      kind: "int" },
  { key: "ctr",         label: "CTR",         kind: "pct" },
  { key: "cpm",         label: "CPM",         kind: "money" },
];

function deliveredOfGroup(list: CampaignData[]): Delivered {
  let spend = 0, impressions = 0, clicks = 0, reach = 0, videoViews = 0;
  for (const c of list) {
    const b = baseDelivery(c); // per-campaign window-or-full-flight (DV360) delivery
    spend += b.spend; impressions += b.impressions; clicks += b.clicks;
    reach += b.reach; videoViews += b.videoViews;
  }
  return deriveDelivered({ spend, impressions, clicks, reach, videoViews });
}
function deliveredMetric(d: Delivered, key: string): number {
  if (key === "views") return d.videoViews;
  return (d as unknown as Record<string, number>)[key] ?? 0;
}
const ZERO_DELIVERED: Delivered = { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0, frequency: 0, cpm: 0, ctr: 0, vtr: 0 };
// Sub-channel delivered from a breakdown row. Reach may be present (Meta); views
// are never exposed per sub-channel, so Views/VTR honestly resolve to "—".
function deliveredFromRow(r?: { spend: number; impressions: number; clicks: number; reach?: number; frequency?: number; videoViews?: number }): Delivered {
  if (!r) return ZERO_DELIVERED;
  const { spend, impressions, clicks, reach = 0, videoViews = 0 } = r;
  return {
    spend, impressions, clicks, reach, videoViews,
    frequency: reach > 0 ? impressions / reach : (r.frequency ?? 0),
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    vtr: impressions > 0 && videoViews > 0 ? (videoViews / impressions) * 100 : 0,
  };
}
const META_PUB_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger",
};
const metaPubLabel = (v: string) => META_PUB_LABEL[v] || v.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
function fmtMetric(kind: MetricKind, n: number, currency: string): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (kind === "money") return formatMoney(n, currency, 0);
  if (kind === "pct") return `${n.toFixed(2)}%`;
  if (kind === "decimal") return n.toFixed(1);
  return Math.round(n).toLocaleString("en-IN");
}
const DASH_REASON: Record<string, string> = {
  reach: "DV360 unique reach is only available at account or campaign level — not per exchange/objective",
  frequency: "Frequency = impressions ÷ reach — unavailable when reach isn't reported",
  views: "Only reported for video/YouTube line items — display campaigns have no view data",
  vtr: "VTR requires video views — unavailable for non-video campaigns",
};
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 min-w-[280px] max-w-[360px] w-max rounded-md bg-gray-800 px-3 py-2 text-[11px] leading-snug text-white opacity-0 group-hover/tip:opacity-100 transition-opacity z-50 text-left shadow-lg whitespace-normal">
        {text}
      </span>
    </span>
  );
}
function prettyObjective(o?: string): string {
  if (!o) return "Unspecified";
  return o.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

type AggGroupBy = "overall" | "channel" | "objective" | "creative" | "audience";
type AggPlanned = Record<string, Record<string, number>>; // groupKey -> metricKey -> planned

function pacingBadge(planned: number, delivered: number): { text: string; cls: string } {
  if (!(planned > 0)) return { text: "—", cls: "text-gray-400" };
  const pct = Math.round((delivered / planned) * 100);
  const cls = pct >= 90 && pct <= 110 ? "text-green-600" : pct >= 70 && pct <= 130 ? "text-amber-600" : "text-red-600";
  return { text: `${pct}%`, cls };
}

interface AggTable { key: string; label: string; sub?: string; count: number; delivered: Delivered; gcur: string; platform?: "meta" | "dv360" }
// A dated capture of planned-vs-delivered for the current view, so a plan can be
// saved today and re-saved later when delivery changes — kept as a history.
interface AggSnapshot {
  id: string; at: number; dateLabel: string; scope: string;
  // Captured view so "Edit" can restore the inputs where they were entered.
  groupBy?: AggGroupBy;
  sel?: { metaChannel: string; dv360Channel: string; metaObjective: string; dv360Objective: string; metaCreative?: string; dv360Creative?: string };
  rows: { key?: string; label: string; sub?: string; gcur: string; metrics: { key: string; planned: number; delivered: number }[] }[];
}

// ─── Daily trend charts: Reach Build-up, Daily Reach & Impressions, Spends vs Impressions ───
const shortNum = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

const CHART_RANGES: { label: string; value: DateRange }[] = [
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "90 Days", value: "90d" },
];

const CHART_PLATFORMS: { label: string; value: "both" | "meta" | "dv360" }[] = [
  { label: "Both", value: "both" },
  { label: "Meta", value: "meta" },
  { label: "DV360", value: "dv360" },
];

export function DailyTrendCharts({ dateRange: parentRange, customStart, customEnd, platform: parentPlatform }: {
  dateRange: DateRange; customStart?: string; customEnd?: string; platform: "meta" | "dv360" | "both";
}) {
  const [localRange, setLocalRange] = useState<DateRange | null>(null);
  const [localPlatform, setLocalPlatform] = useState<"both" | "meta" | "dv360" | null>(null);
  const [localCustomStart, setLocalCustomStart] = useState(customStart || "");
  const [localCustomEnd, setLocalCustomEnd] = useState(customEnd || "");
  const dateRange = localRange ?? parentRange;
  const isCustom = dateRange === ("custom" as DateRange);
  const effectiveCustomStart = localRange === ("custom" as DateRange) ? localCustomStart : (localRange ? undefined : customStart);
  const effectiveCustomEnd = localRange === ("custom" as DateRange) ? localCustomEnd : (localRange ? undefined : customEnd);
  const platform = localPlatform ?? parentPlatform;
  const showMeta = platform !== "dv360";
  const showDv = platform !== "meta";

  const customReady = !isCustom || (!!effectiveCustomStart && !!effectiveCustomEnd);
  const { rows: metaDaily, loading: metaLoading } = useMetaBreakdown("daily", dateRange, effectiveCustomStart, effectiveCustomEnd, showMeta && customReady);
  const { rows: dv360Daily, loading: dv360Loading } = useDV360Breakdown("daily", dateRange, effectiveCustomStart, effectiveCustomEnd, showDv && customReady);

  const loading = metaLoading || dv360Loading;

  const chartData = useMemo(() => {
    const dateMap = new Map<string, { date: string; metaReach: number; dv360Reach: number; metaImpr: number; dv360Impr: number; metaSpend: number; dv360Spend: number }>();
    for (const r of metaDaily) {
      const d = r.breakdownValues?.date || r.label;
      const cur = dateMap.get(d) || { date: d, metaReach: 0, dv360Reach: 0, metaImpr: 0, dv360Impr: 0, metaSpend: 0, dv360Spend: 0 };
      cur.metaReach += r.reach ?? 0;
      cur.metaImpr += r.impressions ?? 0;
      cur.metaSpend += r.spend ?? 0;
      dateMap.set(d, cur);
    }
    for (const r of dv360Daily) {
      const d = r.breakdownValues?.daily || r.breakdownValues?.date || r.label;
      const cur = dateMap.get(d) || { date: d, metaReach: 0, dv360Reach: 0, metaImpr: 0, dv360Impr: 0, metaSpend: 0, dv360Spend: 0 };
      cur.dv360Impr += r.impressions ?? 0;
      cur.dv360Spend += r.spend ?? 0;
      dateMap.set(d, cur);
    }
    const sorted = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    let cumReach = 0;
    return sorted.map((d) => {
      const totalReach = d.metaReach + d.dv360Reach;
      cumReach += totalReach;
      const totalImpr = d.metaImpr + d.dv360Impr;
      const totalSpend = d.metaSpend + d.dv360Spend;
      const label = new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { month: "short", day: "numeric" });
      return { date: d.date, label, reach: totalReach, cumReach, impressions: totalImpr, spend: totalSpend };
    });
  }, [metaDaily, dv360Daily]);

  const hasReach = chartData.some((d) => d.reach > 0);
  const noData = chartData.length === 0;

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-lg font-bold text-gray-900 mr-auto">Daily Trends</h2>
      {/* Platform toggle */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
        {CHART_PLATFORMS.map((p) => (
          <button key={p.value}
            onClick={() => setLocalPlatform(p.value === parentPlatform ? null : p.value)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              platform === p.value ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            {p.label}
          </button>
        ))}
      </div>
      {/* Date range toggle */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
        {CHART_RANGES.map((r) => (
          <button key={r.value}
            onClick={() => { setLocalRange(r.value === parentRange ? null : r.value); }}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              dateRange === r.value && !isCustom ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            {r.label}
          </button>
        ))}
        <button
          onClick={() => {
            if (localRange === ("custom" as DateRange)) { setLocalRange(null); }
            else { setLocalRange("custom" as DateRange); setLocalCustomStart(customStart || ""); setLocalCustomEnd(customEnd || ""); }
          }}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
            isCustom ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}>
          Custom
        </button>
      </div>
      {isCustom && localRange === ("custom" as DateRange) && (
        <div className="flex items-center gap-2">
          <input type="date" value={localCustomStart}
            onChange={(e) => setLocalCustomStart(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <span className="text-[11px] text-gray-400">to</span>
          <input type="date" value={localCustomEnd}
            onChange={(e) => setLocalCustomEnd(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}
    </div>
  );

  if (loading && noData) {
    return (
      <div className="space-y-4">
        {header}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">
          Loading daily trends…
        </div>
      </div>
    );
  }
  if (noData && !isCustom && !loading) return null;

  return (
    <div className="space-y-4">
      {header}

      {isCustom && noData && !loading && !customReady && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">
          Pick a start and end date above to view trends
        </div>
      )}
      {isCustom && noData && !loading && customReady && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">
          No daily data available for this date range
        </div>
      )}

      {/* Chart 1: Reach Build Up (cumulative) */}
      {hasReach && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-800 mb-3">Reach Build Up</h3>
          <p className="text-[11px] text-gray-400 mb-2">Cumulative unique reach over time{!showDv ? "" : " (Meta only — DV360 daily reach not available via API)"}</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tickFormatter={shortNum} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => shortNum(v)} labelFormatter={(l) => `Date: ${l}`} />
                <Legend />
                <Line type="monotone" dataKey="cumReach" name="Cumulative Reach" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Chart 2: Day-Wise Unique Reach & Impressions */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Day-Wise {hasReach ? "Unique Reach & " : ""}Impressions</h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tickFormatter={shortNum} tick={{ fontSize: 10 }} />
              {hasReach && <YAxis yAxisId="right" orientation="right" tickFormatter={shortNum} tick={{ fontSize: 10 }} />}
              <Tooltip formatter={(v: number) => shortNum(v)} labelFormatter={(l) => `Date: ${l}`} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="impressions" name="Impressions" stroke="#f59e0b" strokeWidth={2} dot={false} />
              {hasReach && <Line yAxisId="right" type="monotone" dataKey="reach" name="Daily Unique Reach" stroke="#3b82f6" strokeWidth={2} dot={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 3: Spends vs Impressions */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Spends vs Impressions</h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tickFormatter={shortNum} tick={{ fontSize: 10 }} label={{ value: "Impressions", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "#9ca3af" } }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={shortNum} tick={{ fontSize: 10 }} label={{ value: "Spends", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "#9ca3af" } }} />
              <Tooltip formatter={(v: number, name: string) => [shortNum(v), name]} labelFormatter={(l) => `Date: ${l}`} />
              <Legend />
              <Bar yAxisId="left" dataKey="impressions" name="Impressions" fill="#f59e0b" opacity={0.7} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="spend" name="Spends" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function AggregatePlanning({ campaigns, loading, metaCurrency, dv360Currency, dateRange, customStart, customEnd }: {
  campaigns: CampaignData[]; loading: boolean; metaCurrency: string; dv360Currency: string;
  dateRange: DateRange; customStart?: string; customEnd?: string;
}) {
  const [groupBy, setGroupBy] = useState<AggGroupBy>("overall");
  const [planned, setPlanned] = usePersistentJSON<AggPlanned>("planning-agg", {});
  const [metaChannel, setMetaChannel] = useState("all");
  const [dv360Channel, setDv360Channel] = useState("all");
  const [metaObjective, setMetaObjective] = useState("all");
  const [dv360Objective, setDv360Objective] = useState("all");
  const [metaCreative, setMetaCreative] = useState("all");
  const [dv360Creative, setDv360Creative] = useState("all");
  const [snapshots, setSnapshots] = usePersistentJSON<AggSnapshot[]>("planning-agg-snapshots", []);
  const [openSnap, setOpenSnap] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const metaCampaigns = useMemo(() => campaigns.filter((c) => c.platform === "meta"), [campaigns]);
  const dv360Campaigns = useMemo(() => campaigns.filter((c) => c.platform === "dv360"), [campaigns]);
  const hasMeta = metaCampaigns.length > 0, hasDv = dv360Campaigns.length > 0;

  // Planning always uses the widest flight window (not the date picker) so that
  // channel/exchange breakdowns cover the full campaign delivery period.
  const wideWindow = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const DAY = 86_400_000;
    let earliest: string | undefined, latest: string | undefined;
    for (const c of campaigns) {
      if (c.flightStart && (!earliest || c.flightStart < earliest)) earliest = c.flightStart;
      if (c.flightEnd && (!latest || c.flightEnd > latest)) latest = c.flightEnd;
    }
    const start = earliest || new Date(Date.now() - 456 * DAY).toISOString().slice(0, 10);
    const end = (latest && latest < today) ? latest : today;
    return { start, end };
  }, [campaigns]);

  // Real sub-channel delivery (only fetched when the Channel view is active).
  const metaPub = useMetaBreakdown("publisher_platform", "custom" as DateRange, wideWindow.start, wideWindow.end);
  const dvExch = useDV360Breakdown("exchange", "custom" as DateRange, wideWindow.start, wideWindow.end, groupBy === "channel" && hasDv);
  const dvCreativeType = useDV360Breakdown("creative_type", "custom" as DateRange, wideWindow.start, wideWindow.end, groupBy === "creative" && hasDv);

  // Audience breakdowns for the PDF (always fetched — real data from APIs).
  const metaAge = useMetaBreakdown("age", "custom" as DateRange, wideWindow.start, wideWindow.end, hasMeta);
  const metaGender = useMetaBreakdown("gender", "custom" as DateRange, wideWindow.start, wideWindow.end, hasMeta);
  const dvAge = useDV360Breakdown("age", "custom" as DateRange, wideWindow.start, wideWindow.end, hasDv);
  const dvGender = useDV360Breakdown("gender", "custom" as DateRange, wideWindow.start, wideWindow.end, hasDv);

  // Audience data (ad-set / line-item level) — only fetched when "Audience" view is active.
  const metaAdSets = useMetaAdSets("custom" as DateRange, wideWindow.start, wideWindow.end, groupBy === "audience" && hasMeta);
  const dv360LineItems = useDV360LineItems("custom" as DateRange, wideWindow.start, wideWindow.end, groupBy === "audience" && hasDv);
  const [metaAudFilter, setMetaAudFilter] = useState("all");
  const [dv360AudFilter, setDv360AudFilter] = useState("all");

  // Saved audiences from the account — used for the audience dropdown.
  const { audiences: savedAudiences, audienceMap, adsets: insightAdSets } = useAdSetInsights(
    hasMeta ? "meta" : "dv360",
    "custom" as DateRange, wideWindow.start, wideWindow.end
  );

  // Build a map: saved audience name → set of ad set IDs + names that target it
  const audNameToAdSetMatch = useMemo(() => {
    const m = new Map<string, { ids: Set<string>; names: Set<string> }>();
    for (const a of savedAudiences) {
      m.set(a.name, { ids: new Set(), names: new Set() });
    }
    for (const as_ of insightAdSets) {
      const cas = (as_.targeting as any)?.custom_audiences as Array<{ id: string }> | undefined;
      if (!cas) continue;
      for (const ca of cas) {
        const aud = audienceMap.get(ca.id);
        if (aud) {
          const entry = m.get(aud.name);
          if (entry) {
            entry.ids.add(as_.id);
            entry.names.add(as_.name);
          }
        }
      }
    }
    return m;
  }, [savedAudiences, insightAdSets, audienceMap]);

  const META_OBJECTIVES = ["Awareness", "Traffic", "Engagement", "Leads", "App Promotion", "Sales"];
  const DV360_OBJECTIVES = ["Brand Awareness", "Conversions", "Offline Action", "App Installs"];
  const metaObjectives = useMemo(() => {
    const from = metaCampaigns.map((c) => prettyObjective(c.objective));
    return [...new Set([...META_OBJECTIVES, ...from])].filter(Boolean).sort();
  }, [metaCampaigns]);
  const dv360Objectives = useMemo(() => {
    const from = dv360Campaigns.map((c) => prettyObjective(c.objective));
    return [...new Set([...DV360_OBJECTIVES, ...from])].filter(Boolean).sort();
  }, [dv360Campaigns]);

  // Normalise a raw format token to the same labels the Creative Intelligence tab uses.
  function normFormat(raw: string): string {
    const s = raw.toLowerCase().trim();
    if (s.includes("carousel")) return "Carousel";
    if (s.includes("audio")) return "Audio";
    if (s.includes("native")) return "Native";
    if (s.includes("ctv") || s.includes("connected tv")) return "CTV";
    if (s.includes("reel") || s.includes("stories")) return "Video";
    if (/video.*30|30\s?s/.test(s)) return "Video 30s";
    if (/video.*15|15\s?s/.test(s)) return "Video 15s";
    if (s.includes("video")) return "Video";
    if (s.includes("display") || s.includes("standard") || s.includes("static") || s.includes("banner")
        || s.includes("image") || s.includes("photo") || s.includes("html")) return "Static / Banner";
    if (s.includes("rich")) return "Rich Media";
    return raw || "Other";
  }

  // ── Meta creative format breakdown (ad-level, same source as Creative Intelligence) ──
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  interface MetaFormatRow { label: string; spend: number; impressions: number; reach: number; clicks: number; conversions: number; conversionValue: number; videoViews: number }
  const [metaFormatRows, setMetaFormatRows] = useState<MetaFormatRow[]>([]);
  const [metaFormatLoading, setMetaFormatLoading] = useState(false);
  useEffect(() => {
    if (groupBy !== "creative" || !hasMeta) { setMetaFormatRows([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) return;
    let cancelled = false;
    setMetaFormatLoading(true);
    fetch("/api/reporting/ad-insights/meta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, startDate: wideWindow.start, endDate: wideWindow.end, limit: 200 }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.ads) return;
        const byFmt = new Map<string, MetaFormatRow>();
        for (const ad of d.ads as Array<{ name: string; creativeType?: string; spend: number; impressions: number; reach: number; clicks: number; conversions: number; conversionValue: number; videoViews: number }>) {
          const t = (ad.creativeType || "").toUpperCase();
          const n = ad.name.toLowerCase();
          let fmt: string;
          if (t.includes("CAROUSEL") || n.includes("carousel")) fmt = "Carousel";
          else if (t.includes("AUDIO")) fmt = "Audio";
          else if (t.includes("NATIVE")) fmt = "Native";
          else if (t.includes("VIDEO") || t === "REEL" || n.includes("reel") || n.includes("video")) fmt = "Video";
          else if (t.includes("DISPLAY") || t.includes("STANDARD") || t.includes("IMAGE") || t.includes("PHOTO")
              || t.includes("STATIC") || n.includes("static") || n.includes("banner")) fmt = "Static / Banner";
          else fmt = "Other";
          const cur = byFmt.get(fmt) ?? { label: fmt, spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0, videoViews: 0 };
          cur.spend += ad.spend; cur.impressions += ad.impressions; cur.reach += ad.reach || 0; cur.clicks += ad.clicks;
          cur.conversions += ad.conversions; cur.conversionValue += ad.conversionValue;
          cur.videoViews += ad.videoViews || 0;
          byFmt.set(fmt, cur);
        }
        setMetaFormatRows([...byFmt.values()].sort((a, b) => b.spend - a.spend));
      })
      .finally(() => { if (!cancelled) setMetaFormatLoading(false); });
    return () => { cancelled = true; };
  }, [groupBy, hasMeta, demoMode, metaAccessToken, metaBusinessId, wideWindow.start, wideWindow.end]);

  const metaFormats = useMemo(() => metaFormatRows.map((r) => r.label), [metaFormatRows]);
  const dv360Formats = useMemo(() => {
    const from = dvCreativeType.rows.map((r) => normFormat(r.label));
    return [...new Set(from)].filter(Boolean).sort();
  }, [dvCreativeType.rows]);

  // Audience filter options — show saved audience names from the account.
  const metaAudCategory = useCallback((row: { name: string; targeting: string }) => {
    const t = (row.targeting + " " + row.name).toLowerCase();
    if (t.includes("lookalike")) return "Lookalike";
    if (t.includes("custom audience") || t.includes("retarget") || t.includes("cart abandon") || t.includes("video viewer") || t.includes("website visitor")) return "Retargeting / Custom";
    if (t.includes("interest:") || t.includes("interest -")) return "Interest-Based";
    if (t.includes("broad")) return "Broad / Prospecting";
    return "Other";
  }, []);
  const metaAudOptions = useMemo(() => {
    if (savedAudiences.length > 0) {
      const set = new Set(savedAudiences.map((a) => a.name).filter(Boolean));
      return ["all", ...Array.from(set).sort()];
    }
    const set = new Set(metaAdSets.rows.map((r) => r.name).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [savedAudiences, metaAdSets.rows]);
  const dv360AudOptions = useMemo(() => {
    const set = new Set(dv360LineItems.rows.map((r) => r.audienceType).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [dv360LineItems.rows]);

  const setPlan = (groupKey: string, metric: string, value: number) =>
    setPlanned((prev) => ({ ...prev, [groupKey]: { ...(prev[groupKey] || {}), [metric]: value } }));

  // DV360 reach is now enriched on each campaign object (summed from line-item
  // REACH reports). deliveredOfGroup already sums it, so no special override
  // needed — every group (full or sub) gets real summed LI reach.

  // The tables currently on screen — drives both the render and CSV export.
  const tables = useMemo<AggTable[]>(() => {
    if (groupBy === "overall") {
      const delivered = deliveredOfGroup(campaigns);
      return [{ key: "overall", label: "Overall — all campaigns", count: campaigns.length, delivered, gcur: metaCurrency }];
    }
    if (groupBy === "channel") {
      const out: AggTable[] = [];
      if (hasMeta) {
        const d = metaChannel === "all" ? deliveredOfGroup(metaCampaigns) : deliveredFromRow(metaPub.rows.find((r) => r.label === metaChannel));
        out.push({ key: `channel:meta:${metaChannel}`, label: "Meta", sub: metaChannel === "all" ? "All channels" : metaPubLabel(metaChannel), count: metaCampaigns.length, delivered: d, gcur: metaCurrency, platform: "meta" });
      }
      if (hasDv) {
        const d = dv360Channel === "all" ? deliveredOfGroup(dv360Campaigns) : deliveredFromRow(dvExch.rows.find((r) => r.label === dv360Channel));
        out.push({ key: `channel:dv360:${dv360Channel}`, label: "DV360", sub: dv360Channel === "all" ? "All exchanges" : dv360Channel, count: dv360Campaigns.length, delivered: d, gcur: dv360Currency, platform: "dv360" });
      }
      return out;
    }
    if (groupBy === "objective") {
      const out: AggTable[] = [];
      if (hasMeta) {
        const mc = metaObjective === "all" ? metaCampaigns : metaCampaigns.filter((c) => prettyObjective(c.objective) === metaObjective);
        out.push({ key: `obj:meta:${metaObjective}`, label: "Meta", sub: metaObjective === "all" ? "All objectives" : metaObjective, count: mc.length, delivered: deliveredOfGroup(mc), gcur: metaCurrency, platform: "meta" });
      }
      if (hasDv) {
        const dc = dv360Objective === "all" ? dv360Campaigns : dv360Campaigns.filter((c) => prettyObjective(c.objective) === dv360Objective);
        out.push({ key: `obj:dv360:${dv360Objective}`, label: "DV360", sub: dv360Objective === "all" ? "All objectives" : dv360Objective, count: dc.length, delivered: deliveredOfGroup(dc), gcur: dv360Currency, platform: "dv360" });
      }
      return out;
    }
    if (groupBy === "creative") {
      const out: AggTable[] = [];
      if (hasMeta) {
        const d = metaCreative === "all"
          ? deliveredOfGroup(metaCampaigns)
          : deliveredFromRow(metaFormatRows.find((r) => r.label === metaCreative));
        out.push({ key: `creative:meta:${metaCreative}`, label: "Meta", sub: metaCreative === "all" ? "All formats" : metaCreative, count: metaCreative === "all" ? metaCampaigns.length : 0, delivered: d, gcur: metaCurrency, platform: "meta" });
      }
      if (hasDv) {
        const d = dv360Creative === "all" ? deliveredOfGroup(dv360Campaigns) : deliveredFromRow(dvCreativeType.rows.find((r) => normFormat(r.label) === dv360Creative));
        out.push({ key: `creative:dv360:${dv360Creative}`, label: "DV360", sub: dv360Creative === "all" ? "All creative types" : dv360Creative, count: dv360Campaigns.length, delivered: d, gcur: dv360Currency, platform: "dv360" });
      }
      return out;
    }
    // groupBy === "audience" — always 2 summary cards (Meta + DV360), detail table below shows filtered rows
    const out: AggTable[] = [];
    if (hasMeta) {
      const match = audNameToAdSetMatch.get(metaAudFilter);
      const filtered = metaAudFilter === "all"
        ? metaAdSets.rows
        : match && (match.ids.size > 0 || match.names.size > 0)
          ? metaAdSets.rows.filter((r) => match.ids.has(r.id) || match.names.has(r.name))
          : metaAdSets.rows.filter((r) => (r.targeting + " " + r.name).toLowerCase().includes(metaAudFilter.toLowerCase()));
      const d = filtered.length > 0
        ? deriveDelivered(filtered.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, reach: a.reach + r.reach, videoViews: a.videoViews + r.videoViews }), { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0 }))
        : deliveredOfGroup(metaCampaigns);
      const subLabel = metaAdSets.loading ? "Loading ad sets…" : metaAudFilter === "all" ? `All ad sets (${filtered.length})` : `${metaAudFilter} (${filtered.length} ad set${filtered.length === 1 ? "" : "s"})`;
      out.push({ key: "aud:meta", label: "Meta", sub: subLabel, count: filtered.length || metaCampaigns.length, delivered: d, gcur: metaCurrency, platform: "meta" });
    }
    if (hasDv) {
      const filtered = dv360AudFilter === "all" ? dv360LineItems.rows : dv360LineItems.rows.filter((r) => r.audienceType === dv360AudFilter);
      const d = filtered.length > 0
        ? deriveDelivered(filtered.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, reach: 0, videoViews: a.videoViews + r.videoViews }), { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0 }))
        : deliveredOfGroup(dv360Campaigns);
      const subLabel = dv360LineItems.loading ? "Loading line items…" : dv360AudFilter === "all" ? `All line items (${filtered.length})` : `${dv360AudFilter} (${filtered.length} line item${filtered.length === 1 ? "" : "s"})`;
      out.push({ key: "aud:dv360", label: "DV360", sub: subLabel, count: filtered.length || dv360Campaigns.length, delivered: d, gcur: dv360Currency, platform: "dv360" });
    }
    return out;
  }, [groupBy, campaigns, metaCampaigns, dv360Campaigns, hasMeta, hasDv, metaChannel, dv360Channel, metaObjective, dv360Objective, metaCreative, dv360Creative, metaPub.rows, dvExch.rows, dvCreativeType.rows, metaFormatRows, metaCurrency, dv360Currency, metaAudFilter, dv360AudFilter, metaAdSets.rows, metaAdSets.loading, dv360LineItems.rows, dv360LineItems.loading, audNameToAdSetMatch]);

  const scopeLabel = groupBy === "overall" ? "Overall"
    : groupBy === "channel" ? "By channel"
    : groupBy === "objective" ? `By objective (Meta: ${metaObjective}, DV360: ${dv360Objective})`
    : groupBy === "audience" ? `By audience (Meta: ${metaAudFilter}, DV360: ${dv360AudFilter})`
    : `By creative (Meta: ${metaCreative}, DV360: ${dv360Creative})`;

  // Gap explainer data — the current view's PLANNED (user inputs) vs DELIVERED,
  // combined across the visible groups. Additive metrics are summed; ratio
  // metrics are recomputed from the summed bases (never averaged).
  const gapData = useMemo(() => {
    const bd = { spend: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0 };
    const plannedRec: Record<string, number> = {};
    for (const t of tables) {
      bd.spend += t.delivered.spend; bd.impressions += t.delivered.impressions; bd.clicks += t.delivered.clicks;
      bd.reach += t.delivered.reach; bd.videoViews += t.delivered.videoViews;
      const pp = planned[t.key] || {};
      for (const m of AGG_METRICS) plannedRec[m.key] = (plannedRec[m.key] || 0) + (pp[m.key] || 0);
    }
    const dd = deriveDelivered(bd);
    const deliveredRec: Record<string, number> = {
      spend: dd.spend, impressions: dd.impressions, reach: dd.reach, clicks: dd.clicks,
      views: dd.videoViews, cpm: dd.cpm, ctr: dd.ctr, vtr: dd.vtr, frequency: dd.frequency,
    };
    const pacing: Record<string, number | null> = {};
    for (const m of AGG_METRICS) {
      const p = plannedRec[m.key] || 0;
      pacing[m.key] = p > 0 ? Math.round((deliveredRec[m.key] / p) * 100) : null;
    }
    const plats = new Set(tables.map((t) => t.platform).filter(Boolean));
    const platform: "meta" | "dv360" | "both" = plats.size === 1 ? ([...plats][0] as "meta" | "dv360") : "both";
    return { planned: plannedRec, delivered: deliveredRec, pacing, platform };
  }, [tables, planned]);

  const saveSnapshot = () => {
    const now = new Date();
    const dateLabel = now.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const snap: AggSnapshot = {
      id: `snap-${now.getTime()}`, at: now.getTime(), dateLabel, scope: scopeLabel,
      groupBy,
      sel: { metaChannel, dv360Channel, metaObjective, dv360Objective, metaCreative, dv360Creative },
      rows: tables.map((t) => ({
        key: t.key, label: t.label, sub: t.sub, gcur: t.gcur,
        metrics: AGG_METRICS.map((m) => ({ key: m.key, planned: planned[t.key]?.[m.key] ?? 0, delivered: deliveredMetric(t.delivered, m.key) })),
      })),
    };
    setSnapshots((prev) => [snap, ...prev]);
    setOpenSnap(snap.id);
  };
  const removeSnapshot = (id: string) => setSnapshots((prev) => prev.filter((s) => s.id !== id));
  // Edit = load this snapshot's planned inputs back into the live editor + restore
  // its view, so the user can tweak the numbers and Save again.
  const editSnapshot = (s: AggSnapshot) => {
    setPlanned((prev) => {
      const next = { ...prev };
      for (const r of s.rows) {
        if (!r.key) continue;
        const pm: Record<string, number> = { ...(next[r.key] || {}) };
        for (const m of r.metrics) pm[m.key] = m.planned;
        next[r.key] = pm;
      }
      return next;
    });
    if (s.groupBy) setGroupBy(s.groupBy);
    if (s.sel) {
      setMetaChannel(s.sel.metaChannel); setDv360Channel(s.sel.dv360Channel);
      setMetaObjective(s.sel.metaObjective); setDv360Objective(s.sel.dv360Objective);
      if (s.sel.metaCreative) setMetaCreative(s.sel.metaCreative);
      if (s.sel.dv360Creative) setDv360Creative(s.sel.dv360Creative);
    }
    setOpenSnap(null);
  };

  const exportCsv = () => {
    const lines = [["Key", "Group", "Metric", "Planned", "Delivered", "Pacing%"].join(",")];
    for (const t of tables) {
      for (const m of AGG_METRICS) {
        const p = planned[t.key]?.[m.key] ?? 0;
        const dv = deliveredMetric(t.delivered, m.key);
        const pace = p > 0 ? `${Math.round((dv / p) * 100)}%` : "";
        lines.push([t.key, `${t.label}${t.sub ? ` (${t.sub})` : ""}`, m.label, p || "", Math.round(dv * 100) / 100, pace].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `planning-${groupBy}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const labelToKey = new Map(AGG_METRICS.map((m) => [m.label.toLowerCase(), m.key]));
    setPlanned((prev) => {
      const next: AggPlanned = { ...prev };
      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(",");
        const gKey = (cols[0] || "").trim();
        const mKey = labelToKey.get((cols[2] || "").trim().toLowerCase());
        const val = parseFloat((cols[3] || "").replace(/[^0-9.\-]/g, ""));
        if (gKey && mKey && Number.isFinite(val)) next[gKey] = { ...(next[gKey] || {}), [mKey]: val };
      }
      return next;
    });
  };

  const downloadPdf = () => {
    const f = (v: number, kind: string, cur: string) => {
      if (kind === "money") return formatMoney(v, cur);
      if (kind === "pct") return v > 0 ? v.toFixed(2) + "%" : "—";
      if (kind === "decimal") return v > 0 ? v.toFixed(1) : "—";
      if (kind === "int") return v > 0 ? v.toLocaleString("en-IN") : "—";
      return String(v);
    };
    const fBig = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : f(n,"int","");
    const now = new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
    const nowFull = new Date().toLocaleString("en-IN",{month:"2-digit",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
    const totalD = tables.reduce((a,t)=>{for(const m of AGG_METRICS)a[m.key]=(a[m.key]||0)+deliveredMetric(t.delivered,m.key);return a;},{} as Record<string,number>);
    const totalP = tables.reduce((a,t)=>{for(const m of AGG_METRICS)a[m.key]=(a[m.key]||0)+(planned[t.key]?.[m.key]||0);return a;},{} as Record<string,number>);
    const cur0 = tables[0]?.gcur||"INR";
    const cRows = campaigns.map(c=>{const b=baseDelivery(c);const d=deriveDelivered(b);return{name:c.name,platform:c.platform==="meta"?"Meta":"DV360",spend:d.spend,impressions:d.impressions,reach:d.reach,clicks:d.clicks,ctr:d.ctr,cpm:d.cpm,vtr:d.vtr,videoViews:d.videoViews,frequency:d.frequency,cur:c.platform==="meta"?metaCurrency:dv360Currency,objective:c.objective||""};}).sort((a,b)=>b.spend-a.spend);
    const metaRows = cRows.filter(c=>c.platform==="Meta");
    const dvRows = cRows.filter(c=>c.platform==="DV360");
    const metaTotal = metaRows.reduce((a,c)=>({spend:a.spend+c.spend,imp:a.imp+c.impressions,reach:a.reach+c.reach,clicks:a.clicks+c.clicks,views:a.views+c.videoViews}),{spend:0,imp:0,reach:0,clicks:0,views:0});
    const dvTotal = dvRows.reduce((a,c)=>({spend:a.spend+c.spend,imp:a.imp+c.impressions,reach:a.reach+c.reach,clicks:a.clicks+c.clicks,views:a.views+c.videoViews}),{spend:0,imp:0,reach:0,clicks:0,views:0});
    const grandTotal = {spend:metaTotal.spend+dvTotal.spend,imp:metaTotal.imp+dvTotal.imp,reach:metaTotal.reach+dvTotal.reach,clicks:metaTotal.clicks+dvTotal.clicks,views:metaTotal.views+dvTotal.views};

    const paceVal = (pl: number, dl: number) => pl>0 ? Math.round((dl/pl)*100) : null;
    const pacePill = (pc: number|null) => {
      if (pc === null) return '<span style="color:#9ca3af">—</span>';
      const bg = pc>=90&&pc<=110 ? "#dcfce7" : pc>=70&&pc<=130 ? "#fef9c3" : "#fee2e2";
      const fg = pc>=90&&pc<=110 ? "#15803d" : pc>=70&&pc<=130 ? "#a16207" : "#b91c1c";
      return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${bg};color:${fg}">${pc}%</span>`;
    };
    const paceCircle = (pc: number|null) => {
      if (pc === null) return "";
      return `<div style="width:42px;height:42px;border-radius:50%;background:#F5A623;display:flex;align-items:center;justify-content:center;margin:0 auto"><span style="font-size:11px;font-weight:800;color:#fff">${pc}%</span></div>`;
    };

    const maxSpend = Math.max(...cRows.map(c=>c.spend),1);
    const maxImp = Math.max(...cRows.map(c=>c.impressions),1);
    const maxReach = Math.max(...cRows.map(c=>c.reach),1);

    const dataBar = (val: number, max: number, color: string) => {
      const pct = max > 0 ? Math.min((val/max)*100, 100) : 0;
      return pct > 0 ? `<span style="display:inline-block;width:${Math.max(pct*0.5,2)}px;height:10px;background:${color};margin-left:4px;vertical-align:middle"></span>` : "";
    };

    const platTableRow = (name: string, tot: typeof metaTotal, cur: string) => {
      const barMaxSpend = Math.max(metaTotal.spend, dvTotal.spend, 1);
      const barMaxImp = Math.max(metaTotal.imp, dvTotal.imp, 1);
      const barMaxReach = Math.max(metaTotal.reach, dvTotal.reach, 1);
      return `<tr>
        <td style="font-weight:600">${name}</td>
        <td class="r">${f(tot.spend,"int","").replace(/[₹$]/g,"")}${dataBar(tot.spend,barMaxSpend,"#0072F0")}</td>
        <td class="r">${f(tot.imp,"int","")}${dataBar(tot.imp,barMaxImp,"#0072F0")}</td>
        <td class="r">${f(tot.reach,"int","")}${dataBar(tot.reach,barMaxReach,"#F10096")}</td>
        <td class="r">${tot.reach>0?(tot.imp/tot.reach).toFixed(2):"—"}</td>
        <td class="r">${tot.imp>0&&tot.views>0?((tot.views/tot.imp)*100).toFixed(2):"0"}</td>
        <td class="r">${tot.imp>0?((tot.clicks/tot.imp)*100).toFixed(2):"0"}</td>
        <td class="r">${cur==="INR"?"₹":"$"}${tot.imp>0?Math.round((tot.spend/tot.imp)*1000):"0"}</td>
      </tr>`;
    };

    const campTableBBD = (rows: typeof cRows, title: string, columns: string[], maxR = 20) => {
      if (!rows.length) return "";
      const totalSpend=rows.reduce((s,c)=>s+c.spend,0), totalImp=rows.reduce((s,c)=>s+c.impressions,0),
            totalReach=rows.reduce((s,c)=>s+c.reach,0), totalClicks=rows.reduce((s,c)=>s+c.clicks,0),
            totalViews=rows.reduce((s,c)=>s+c.videoViews,0);
      const colMap: Record<string, (c: typeof cRows[0]) => string> = {
        "Net Spends": c => f(c.spend,"money",c.cur),
        "Impression": c => f(c.impressions,"int",""),
        "Reach": c => f(c.reach,"int",""),
        "Freq": c => c.frequency > 0 ? c.frequency.toFixed(1) : "—",
        "eCPM": c => f(c.cpm,"money",c.cur),
        "VTR": c => c.vtr > 0 ? c.vtr.toFixed(2)+"%" : "—",
        "CTR": c => c.ctr > 0 ? c.ctr.toFixed(2)+"%" : "—",
        "Clicks": c => f(c.clicks,"int",""),
      };
      const totalMap: Record<string, string> = {
        "Net Spends": f(totalSpend,"money",rows[0].cur),
        "Impression": f(totalImp,"int",""),
        "Reach": f(totalReach,"int",""),
        "Freq": totalReach>0?(totalImp/totalReach).toFixed(1):"—",
        "eCPM": totalImp>0?f((totalSpend/totalImp)*1000,"money",rows[0].cur):"—",
        "VTR": totalImp>0&&totalViews>0?((totalViews/totalImp)*100).toFixed(2)+"%":"—",
        "CTR": totalImp>0?((totalClicks/totalImp)*100).toFixed(2)+"%":"—",
        "Clicks": f(totalClicks,"int",""),
      };
      return `<div class="sec-title">${title}</div>
      <table><thead><tr><th style="text-align:left">Campaign</th>${columns.map(c=>`<th class="r">${c}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0,maxR).map(c=>`<tr><td class="camp-name">${c.name}</td>${columns.map(col=>`<td class="r">${(colMap[col]||(() => "—"))(c)}</td>`).join("")}</tr>`).join("")}
      ${rows.length>1?`<tr class="total-row"><td>Grand total</td>${columns.map(col=>`<td class="r">${totalMap[col]||"—"}</td>`).join("")}</tr>`:""}</tbody></table>
      ${rows.length>maxR?`<div style="text-align:center;font-size:9px;color:#9ca3af;margin:4px 0">… and ${rows.length-maxR} more</div>`:""}`;
    };

    const platformDetailPage = (platName: string, rows: typeof cRows, tot: typeof metaTotal, cur: string) => {
      if (!rows.length) return "";
      return `<div class="page">
  <div class="page-header">${platName} Detailed Performance</div>
  <div class="page-body">
    <div class="sec-title">${platName} Overall Deliveries</div>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-lbl">Net Spends</div><div class="kpi-val">${f(tot.spend,"money",cur)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">Impression</div><div class="kpi-val">${fBig(tot.imp)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">Reach</div><div class="kpi-val">${fBig(tot.reach)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">Delivered CPM</div><div class="kpi-val">${tot.imp>0?f((tot.spend/tot.imp)*1000,"money",cur):"—"}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">Freq</div><div class="kpi-val">${tot.reach>0?(tot.imp/tot.reach).toFixed(2):"—"}</div></div>
    </div>
    ${campTableBBD(rows, "Campaign Wise Performance", ["Net Spends","Impression","Reach","Freq","eCPM","VTR","CTR"], 20)}
  </div>
  <div class="page-footer"><span>Generated by Auditor</span><span>${now}</span></div>
</div>`;
    };

    const savedPlanPages = snapshots.map((snap) => {
      const snapRows = snap.rows.map(r => {
        const cells = r.metrics.map(mm => {
          const def = AGG_METRICS.find(x => x.key === mm.key);
          const kind = def?.kind ?? "int";
          const pc = paceVal(mm.planned, mm.delivered);
          return `<td class="r" style="color:#6b7280">${mm.planned>0?f(mm.planned,kind,r.gcur):"—"}</td><td class="r" style="font-weight:600">${f(mm.delivered,kind,r.gcur)}</td><td class="r">${pacePill(pc)}</td>`;
        }).join("");
        return `<tr><td style="font-weight:600">${r.label}${r.sub?` <span style="color:#6b7280;font-weight:400">· ${r.sub}</span>`:""}</td>${cells}</tr>`;
      }).join("");
      return `<div class="page">
  <div class="page-header">Saved Plan — ${snap.dateLabel}</div>
  <div class="page-body">
    <div style="font-size:10px;color:#6b7280;margin-bottom:10px">Saved on ${snap.dateLabel} · View: ${snap.scope} · ${snap.rows.length} group${snap.rows.length===1?"":"s"}</div>
    <table>
      <thead>
        <tr><th></th>${AGG_METRICS.map(m=>`<th class="r" colspan="3" style="border-bottom:2px solid #0072F0;color:#0072F0;font-size:8px">${m.label}</th>`).join("")}</tr>
        <tr><th style="font-size:8px">Group</th>${AGG_METRICS.map(()=>`<th class="r" style="font-size:7px;color:#9ca3af;font-weight:500">Target</th><th class="r" style="font-size:7px;color:#9ca3af;font-weight:500">Actual</th><th class="r" style="font-size:7px;color:#9ca3af;font-weight:500">Pacing</th>`).join("")}</tr>
      </thead>
      <tbody>${snapRows}</tbody>
    </table>
  </div>
  <div class="page-footer"><span>Generated by Auditor</span><span>${now}</span></div>
</div>`;
    }).join("\n");

    const hasPlanned = totalP.spend>0||totalP.impressions>0||totalP.reach>0;

    const html = `<html><head><title>Performance Report — ${now}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Roboto,'Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#202124;background:#fff;line-height:1.4;font-size:11px}
@page{size:A4 landscape;margin:0}
.page{page-break-after:always;position:relative;width:100%;min-height:100vh;background:#fff;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}

.page-header{background:#fff;border-bottom:3px solid #0072F0;padding:12px 32px 8px;display:flex;align-items:center;gap:12px}
.page-header .logo{width:28px;height:28px;background:#0072F0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff}
.page-header .title{font-size:16px;font-weight:700;color:#202124}
.page-body{flex:1;padding:14px 32px 8px}
.page-footer{display:flex;justify-content:space-between;padding:6px 32px;font-size:8px;color:#9ca3af}

.sec-title{font-size:13px;font-weight:700;color:#202124;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #0072F0}

/* KPI scorecards */
.kpi-row{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:90px;background:#fff;border:1px solid #dadce0;border-top:3px solid #0072F0;padding:10px 12px;text-align:center}
.kpi-val{font-size:18px;font-weight:800;color:#202124;font-variant-numeric:tabular-nums}
.kpi-lbl{font-size:8px;font-weight:600;color:#5f6368;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px}

/* Deliveries vs Targets with pacing circles */
.del-row{display:flex;align-items:center;gap:0;margin-bottom:6px}
.del-card{flex:1;min-width:80px;text-align:center;border:1px solid #dadce0;padding:10px 8px;background:#fff}
.del-card .val{font-size:16px;font-weight:800;color:#202124;font-variant-numeric:tabular-nums}
.del-card .lbl{font-size:7px;font-weight:600;color:#5f6368;text-transform:uppercase;letter-spacing:0.05em}
.del-hero{flex:1.2;min-width:100px;text-align:center;border:1px solid #dadce0;padding:10px 8px;background:#fff}
.del-hero .val{font-size:28px;font-weight:900;color:#0072F0;font-variant-numeric:tabular-nums}
.del-hero .lbl{font-size:8px;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.08em}
.pace-circle{width:38px;height:38px;border-radius:50%;background:#F5A623;display:flex;align-items:center;justify-content:center;margin:0 -6px;z-index:1;flex-shrink:0}
.pace-circle span{font-size:10px;font-weight:800;color:#fff}
.tgt-row{display:flex;gap:0;margin-bottom:14px}
.tgt-card{flex:1;text-align:center;background:#f8f9fa;border:1px solid #dadce0;padding:8px 6px}
.tgt-card .val{font-size:13px;font-weight:700;color:#3c4043;font-variant-numeric:tabular-nums}
.tgt-card .lbl{font-size:7px;font-weight:600;color:#80868b;text-transform:uppercase}

/* Tables */
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px}
th{background:#0072F0;color:#fff;font-weight:600;text-align:left;padding:6px 8px;white-space:nowrap;font-size:8px;text-transform:uppercase;letter-spacing:0.03em}
td{padding:5px 8px;border-bottom:1px solid #e8eaed;white-space:nowrap;font-variant-numeric:tabular-nums}
tr:nth-child(even){background:#f8f9fa}
.total-row{background:#e8f0fe !important;font-weight:700}
.total-row td{border-top:2px solid #0072F0;border-bottom:2px solid #0072F0}
.r{text-align:right}
.camp-name{max-width:280px;overflow:hidden;text-overflow:ellipsis;font-weight:500}

/* Planned vs Actual table */
.pva-table th{background:#0072F0;color:#fff}
</style></head><body>

<!-- ═══ PAGE 1: OVERALL SUMMARY (BBD style exact) ═══ -->
<div class="page">
  <div class="page-header">
    <div class="logo">A</div>
    <div class="title">PERFORMANCE REPORT · DIGITAL MEDIA</div>
  </div>
  <div class="page-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
      <div class="sec-title" style="margin:0;border:none;padding:0;font-size:14px">Overall Summary</div>
      <div style="font-size:9px;color:#80868b">Last updated on ${nowFull}</div>
    </div>

    <!-- Overall Deliveries row + pacing circles + Overall Targets row (BBD exact) -->
    <div style="font-size:9px;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.08em;margin:10px 0 4px">Overall Deliveries</div>
    <div class="del-row">
      <div class="del-hero">
        <div class="lbl">Reach</div>
        <div class="val">${fBig(grandTotal.reach)}</div>
      </div>
      ${(()=>{const pc=paceVal(totalP.reach||0,grandTotal.reach);return pc!==null?`<div class="pace-circle"><span>${pc}%</span></div>`:""})()}
      <div class="del-card">
        <div class="lbl">Net Spends</div>
        <div class="val">${f(grandTotal.spend,"money",cur0)}</div>
      </div>
      ${(()=>{const pc=paceVal(totalP.spend||0,grandTotal.spend);return pc!==null?`<div class="pace-circle"><span>${pc}%</span></div>`:""})()}
      <div class="del-card">
        <div class="lbl">Impression</div>
        <div class="val">${fBig(grandTotal.imp)}</div>
      </div>
      ${(()=>{const pc=paceVal(totalP.impressions||0,grandTotal.imp);return pc!==null?`<div class="pace-circle"><span>${pc}%</span></div>`:""})()}
      <div class="del-card">
        <div class="lbl">Freq</div>
        <div class="val">${grandTotal.reach>0?(grandTotal.imp/grandTotal.reach).toFixed(2):"—"}</div>
      </div>
      ${(()=>{const pc=paceVal(totalP.frequency||0,grandTotal.reach>0?grandTotal.imp/grandTotal.reach:0);return pc!==null?`<div class="pace-circle"><span>${pc}%</span></div>`:""})()}
    </div>
    ${hasPlanned?`
    <div class="tgt-row">
      <div class="tgt-card" style="flex:1.2"><div class="lbl">Reach</div><div class="val">${totalP.reach>0?fBig(totalP.reach):"—"}</div></div>
      <div class="tgt-card"><div class="lbl">Net Spends</div><div class="val">${totalP.spend>0?f(totalP.spend,"money",cur0):"—"}</div></div>
      <div class="tgt-card"><div class="lbl">Impression</div><div class="val">${totalP.impressions>0?fBig(totalP.impressions):"—"}</div></div>
      <div class="tgt-card"><div class="lbl">Freq</div><div class="val">${totalP.frequency>0?totalP.frequency.toFixed(2):"—"}</div></div>
    </div>
    <div style="font-size:8px;color:#80868b;margin:-10px 0 6px;text-align:left">Overall Targets</div>`:""}

    <!-- Platform Wise Performance (BBD exact: blue header, data bars) -->
    <div class="sec-title">Platform Wise Performance</div>
    <table>
      <thead><tr><th style="text-align:left">Platforms</th><th class="r">Net Spends</th><th class="r">Impressions</th><th class="r">Reach</th><th class="r">Frequency</th><th class="r">VTR%</th><th class="r">CTR%</th><th class="r">eCPM</th></tr></thead>
      <tbody>
        ${metaRows.length?platTableRow("Meta",metaTotal,metaCurrency):""}
        ${dvRows.length?platTableRow("DV360",dvTotal,dv360Currency):""}
        <tr class="total-row">
          <td>Grand total</td>
          <td class="r">${f(grandTotal.spend,"int","")}</td>
          <td class="r">${f(grandTotal.imp,"int","")}</td>
          <td class="r">${f(grandTotal.reach,"int","")}</td>
          <td class="r">${grandTotal.reach>0?(grandTotal.imp/grandTotal.reach).toFixed(2):"—"}</td>
          <td class="r">${grandTotal.imp>0&&grandTotal.views>0?((grandTotal.views/grandTotal.imp)*100).toFixed(2):"0"}</td>
          <td class="r">${grandTotal.imp>0?((grandTotal.clicks/grandTotal.imp)*100).toFixed(2):"0"}</td>
          <td class="r">${cur0==="INR"?"₹":"$"}${grandTotal.imp>0?Math.round((grandTotal.spend/grandTotal.imp)*1000):"0"}</td>
        </tr>
      </tbody>
    </table>

    <!-- Campaign Wise Performance (BBD's Audience Wise equivalent) -->
    ${cRows.length>0?`
    <div class="sec-title">Campaign Wise Performance</div>
    <table>
      <thead><tr><th style="text-align:left">Campaign</th><th class="r">Net Spends</th><th class="r">Impressions</th><th class="r">Reach</th><th class="r">Frequency</th><th class="r">eCPM</th></tr></thead>
      <tbody>${cRows.slice(0,15).map(c=>`<tr>
        <td class="camp-name">${c.name}</td>
        <td class="r">${f(c.spend,"money",c.cur)}</td>
        <td class="r">${f(c.impressions,"int","")}</td>
        <td class="r">${f(c.reach,"int","")}</td>
        <td class="r">${c.frequency>0?c.frequency.toFixed(1):"—"}</td>
        <td class="r">${f(c.cpm,"money",c.cur)}</td>
      </tr>`).join("")}
      <tr class="total-row">
        <td>Grand total</td>
        <td class="r">${f(grandTotal.spend,"money",cur0)}</td>
        <td class="r">${f(grandTotal.imp,"int","")}</td>
        <td class="r">${f(grandTotal.reach,"int","")}</td>
        <td class="r">${grandTotal.reach>0?(grandTotal.imp/grandTotal.reach).toFixed(1):"—"}</td>
        <td class="r">${grandTotal.imp>0?f((grandTotal.spend/grandTotal.imp)*1000,"money",cur0):"—"}</td>
      </tr></tbody>
    </table>
    ${cRows.length>15?`<div style="text-align:center;font-size:9px;color:#80868b">… and ${cRows.length-15} more campaigns</div>`:""}`:""}
  </div>
  <div class="page-footer"><span>Generated by Auditor · Tracking Audit & Conversion Intelligence</span><span>${now}</span></div>
</div>

<!-- ═══ PAGE 1b: AUDIENCE WISE PERFORMANCE (real data from Meta/DV360 APIs) ═══ -->
${(()=>{
  const allAgeRows = [...metaAge.rows, ...dvAge.rows];
  const allGenderRows = [...metaGender.rows, ...dvGender.rows];
  if (!allAgeRows.length && !allGenderRows.length) return "";
  const ageAgg: Record<string,{spend:number,imp:number,reach:number,clicks:number,views:number}> = {};
  for (const r of allAgeRows) {
    const k = r.label || "Unknown";
    if (!ageAgg[k]) ageAgg[k] = {spend:0,imp:0,reach:0,clicks:0,views:0};
    ageAgg[k].spend += r.spend; ageAgg[k].imp += r.impressions; ageAgg[k].reach += (r as any).reach||0;
    ageAgg[k].clicks += r.clicks; ageAgg[k].views += (r as any).videoViews||r.videoViews||0;
  }
  const genderAgg: Record<string,{spend:number,imp:number,reach:number,clicks:number,views:number}> = {};
  for (const r of allGenderRows) {
    const k = r.label || "Unknown";
    if (!genderAgg[k]) genderAgg[k] = {spend:0,imp:0,reach:0,clicks:0,views:0};
    genderAgg[k].spend += r.spend; genderAgg[k].imp += r.impressions; genderAgg[k].reach += (r as any).reach||0;
    genderAgg[k].clicks += r.clicks; genderAgg[k].views += (r as any).videoViews||r.videoViews||0;
  }
  const ageEntries = Object.entries(ageAgg).sort((a,b) => b[1].spend - a[1].spend);
  const genderEntries = Object.entries(genderAgg).sort((a,b) => b[1].spend - a[1].spend);
  const audTable = (title: string, entries: [string,typeof ageAgg[string]][]) => {
    if (!entries.length) return "";
    const tot = entries.reduce((a,e) => ({spend:a.spend+e[1].spend,imp:a.imp+e[1].imp,reach:a.reach+e[1].reach,clicks:a.clicks+e[1].clicks,views:a.views+e[1].views}),{spend:0,imp:0,reach:0,clicks:0,views:0});
    return `<div class="sec-title">${title}</div>
    <table><thead><tr><th style="text-align:left">Segment</th><th class="r">Net Spends</th><th class="r">Impressions</th><th class="r">Reach</th><th class="r">Frequency</th><th class="r">CTR%</th><th class="r">eCPM</th></tr></thead>
    <tbody>${entries.map(([k,v]) => `<tr><td style="font-weight:600">${k}</td><td class="r">${f(v.spend,"money",cur0)}</td><td class="r">${f(v.imp,"int","")}</td><td class="r">${f(v.reach,"int","")}</td><td class="r">${v.reach>0?(v.imp/v.reach).toFixed(1):"—"}</td><td class="r">${v.imp>0?((v.clicks/v.imp)*100).toFixed(2)+"%":"—"}</td><td class="r">${v.imp>0?f((v.spend/v.imp)*1000,"money",cur0):"—"}</td></tr>`).join("")}
    <tr class="total-row"><td>Grand total</td><td class="r">${f(tot.spend,"money",cur0)}</td><td class="r">${f(tot.imp,"int","")}</td><td class="r">${f(tot.reach,"int","")}</td><td class="r">${tot.reach>0?(tot.imp/tot.reach).toFixed(1):"—"}</td><td class="r">${tot.imp>0?((tot.clicks/tot.imp)*100).toFixed(2)+"%":"—"}</td><td class="r">${tot.imp>0?f((tot.spend/tot.imp)*1000,"money",cur0):"—"}</td></tr>
    </tbody></table>`;
  };
  return `<div class="page">
  <div class="page-header"><div class="logo">A</div><div class="title">Audience Wise Performance</div></div>
  <div class="page-body">
    ${audTable("Age Group Wise Performance", ageEntries)}
    ${audTable("Gender Wise Performance", genderEntries)}
  </div>
  <div class="page-footer"><span>Generated by Auditor</span><span>${now}</span></div>
</div>`;
})()}

<!-- ═══ PAGE 2: PLANNED vs DELIVERED (BBD's "Overall Planned vs Spends" equivalent) ═══ -->
${hasPlanned||tables.length>1?`<div class="page">
  <div class="page-header">
    <div class="logo">A</div>
    <div class="title">Planned vs Delivered — ${groupBy.charAt(0).toUpperCase()+groupBy.slice(1)} View</div>
  </div>
  <div class="page-body">
    ${hasPlanned?`
    <div class="sec-title">Overall Planned vs Actual</div>
    <table class="pva-table">
      <thead><tr><th style="text-align:left">Metric</th><th class="r">Target (Planned)</th><th class="r">Delivered</th><th class="r">Pacing</th></tr></thead>
      <tbody>${AGG_METRICS.filter(m=>totalP[m.key]>0||totalD[m.key]>0).map(m=>{
        const pl=totalP[m.key]||0,dv=totalD[m.key]||0,pc=paceVal(pl,dv);
        return `<tr><td style="font-weight:600">${m.label}</td><td class="r" style="color:#5f6368">${pl>0?f(pl,m.kind,cur0):"—"}</td><td class="r" style="font-weight:700">${f(dv,m.kind,cur0)}</td><td class="r">${pacePill(pc)}</td></tr>`;
      }).join("")}</tbody>
    </table>`:""}

    ${tables.length>1?`
    <div class="sec-title" style="margin-top:18px">Per-Group Breakdown</div>
    ${tables.map(t => {
      const badge = t.platform==="meta"?'<span style="display:inline-block;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;background:#dbeafe;color:#1d4ed8;margin-right:4px">Meta</span>':t.platform==="dv360"?'<span style="display:inline-block;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;background:#fef3c7;color:#92400e;margin-right:4px">DV360</span>':"";
      return `<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:700;color:#202124;margin-bottom:3px">${badge}${t.label}${t.sub?` · ${t.sub}`:""}</div>
      <table><thead><tr><th style="text-align:left">Metric</th><th class="r">Target</th><th class="r">Delivered</th><th class="r">Pacing</th></tr></thead>
      <tbody>${AGG_METRICS.map(m=>{
        const pl=planned[t.key]?.[m.key]||0;
        const dv=deliveredMetric(t.delivered,m.key);
        const pc=paceVal(pl,dv);
        return `<tr><td>${m.label}</td><td class="r" style="color:#80868b">${pl>0?f(pl,m.kind,t.gcur):"—"}</td><td class="r" style="font-weight:600">${f(dv,m.kind,t.gcur)}</td><td class="r">${pacePill(pc)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    }).join("")}`:""}
  </div>
  <div class="page-footer"><span>Generated by Auditor</span><span>${now}</span></div>
</div>`:""}

<!-- ═══ META DETAILED PERFORMANCE (BBD's "Facebook Detailed Performance") ═══ -->
${platformDetailPage("Meta", metaRows, metaTotal, metaCurrency)}

<!-- ═══ DV360 DETAILED PERFORMANCE (BBD's "Google Detailed Performance") ═══ -->
${platformDetailPage("DV360", dvRows, dvTotal, dv360Currency)}

<!-- ═══ SAVED PLANS ═══ -->
${savedPlanPages}

</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const seg = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`;

  const channelDropdown = (platform: "meta" | "dv360") => {
    const isMeta = platform === "meta";
    const sel = isMeta ? metaChannel : dv360Channel;
    const setSel = isMeta ? setMetaChannel : setDv360Channel;
    const opts = isMeta
      ? metaPub.rows.map((r) => ({ v: r.label, label: metaPubLabel(r.label) }))
      : dvExch.rows.map((r) => ({ v: r.label, label: r.label }));
    const busy = isMeta ? metaPub.loading : (dvExch.loading || dvExch.pending);
    return (
      <select value={sel} onChange={(e) => setSel(e.target.value)}
        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
        <option value="all">{isMeta ? "All channels" : "All exchanges"}</option>
        {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        {busy && opts.length === 0 && <option disabled>Loading…</option>}
      </select>
    );
  };

  const objectiveDropdown = (platform: "meta" | "dv360") => {
    const isMeta = platform === "meta";
    const sel = isMeta ? metaObjective : dv360Objective;
    const setSel = isMeta ? setMetaObjective : setDv360Objective;
    const opts = isMeta ? metaObjectives : dv360Objectives;
    return (
      <select value={sel} onChange={(e) => setSel(e.target.value)}
        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
        <option value="all">All objectives</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  };

  const creativeDropdown = (platform: "meta" | "dv360") => {
    const isMeta = platform === "meta";
    const sel = isMeta ? metaCreative : dv360Creative;
    const setSel = isMeta ? setMetaCreative : setDv360Creative;
    const opts = isMeta ? metaFormats : dv360Formats;
    const busy = isMeta ? metaFormatLoading : (dvCreativeType.loading || dvCreativeType.pending);
    return (
      <div className="flex items-center gap-1.5">
        <select value={sel} onChange={(e) => setSel(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="all">{isMeta ? "All formats" : "All creative types"}</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          {busy && opts.length === 0 && <option disabled>Loading…</option>}
        </select>
        {busy && <span className="text-[10px] text-gray-400 animate-pulse">Loading…</span>}
      </div>
    );
  };

  const audienceDropdown = (platform: "meta" | "dv360") => {
    const isMeta = platform === "meta";
    const sel = isMeta ? metaAudFilter : dv360AudFilter;
    const setSel = isMeta ? setMetaAudFilter : setDv360AudFilter;
    const opts = isMeta ? metaAudOptions : dv360AudOptions;
    const busy = isMeta ? metaAdSets.loading : dv360LineItems.loading;
    return (
      <div className="flex items-center gap-1.5">
        <select value={sel} onChange={(e) => setSel(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[220px]">
          <option value="all">{isMeta ? "All ad sets" : "All audience types"}</option>
          {opts.filter((o) => o !== "all").map((o) => <option key={o} value={o}>{o}</option>)}
          {busy && opts.length <= 1 && <option disabled>Loading…</option>}
        </select>
        {busy && <span className="text-[10px] text-gray-400 animate-pulse">Loading…</span>}
      </div>
    );
  };

  const renderTable = (t: AggTable) => (
    <div key={t.key} className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-gray-900">{t.label}</span>
          {t.sub && <span className="text-[11px] text-gray-400 truncate">· {t.sub}</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {groupBy === "channel" && t.platform && channelDropdown(t.platform)}
          {groupBy === "objective" && t.platform && objectiveDropdown(t.platform)}
          {groupBy === "creative" && t.platform && creativeDropdown(t.platform)}
          {groupBy === "audience" && t.platform && audienceDropdown(t.platform)}
          <span className="text-[11px] text-gray-400">{t.count} campaign{t.count === 1 ? "" : "s"}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-white">
            <th className="px-4 py-2 text-left text-[10px] uppercase font-semibold text-gray-500">Metric</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500 w-40">Planned</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Delivered</th>
            <th className="px-3 py-2 text-right text-[10px] uppercase font-semibold text-gray-500">Pacing</th>
          </tr>
        </thead>
        <tbody>
          {AGG_METRICS.map((m) => {
            const p = planned[t.key]?.[m.key] ?? 0;
            const dv = deliveredMetric(t.delivered, m.key);
            const pace = pacingBadge(p, dv);
            return (
              <tr key={m.key} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 text-gray-700">
                  {m.label}
                  {m.key === "reach" && <Tip text="Sum of per-campaign reach — may include overlap across campaigns"><span className="ml-1 text-[10px] text-gray-400 cursor-help">ⓘ</span></Tip>}
                </td>
                <td className="px-3 py-2">
                  <SmartNumberInput
                    value={p}
                    onChange={(v) => setPlan(t.key, m.key, v)}
                    deliveredHint={dv}
                    kind={m.kind}
                    currencySymbol={m.kind === "money" ? (t.gcur === "USD" ? "$" : "₹") : undefined}
                    className="w-28 shrink-0 text-right text-sm border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">
                  {fmtMetric(m.kind, dv, t.gcur) === "—" && DASH_REASON[m.key]
                    ? <Tip text={DASH_REASON[m.key]}><span className="text-gray-400 cursor-help">—</span></Tip>
                    : fmtMetric(m.kind, dv, t.gcur)}
                </td>
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${pace.cls}`}>{pace.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Planned vs Delivered — Aggregate</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-2xl">Enter planned targets; delivered is fetched real from the ad accounts and grouped by your view. Pacing = delivered ÷ planned. DV360 campaigns with no delivery in the window fall back to full-flight totals. DV360 reach is summed from per-line-item REACH reports (the same source as the Saturation tab).</p>
          <div className="mt-2">
            <GapInsight
              campaign={`Aggregate — ${scopeLabel}`}
              planned={gapData.planned}
              delivered={gapData.delivered}
              pacing={gapData.pacing}
              dateRange={String(dateRange)}
              platform={gapData.platform}
              align="start"
              label="AI: explain planned vs delivered gap"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          <button onClick={saveSnapshot} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 border border-blue-600 rounded-md hover:bg-blue-700">
            <Save className="w-3.5 h-3.5" /> Save plan
          </button>
          <button onClick={downloadPdf} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 border border-indigo-600 rounded-md hover:bg-indigo-700">
            <FileDown className="w-3.5 h-3.5" /> Download PDF
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50">
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        </div>
      </div>

      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">Group by</span>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {([["overall", "Overall"], ["channel", "Channel"], ["objective", "Objective"], ["creative", "Creative"], ["audience", "Audience"]] as const).map(([g, label]) => (
              <button key={g} onClick={() => setGroupBy(g)} className={seg(groupBy === g)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <div className="h-24 flex items-center justify-center text-sm text-gray-400">Loading campaigns…</div>
        ) : tables.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-sm text-gray-400">No campaigns in this view.</div>
        ) : tables.map((t) => renderTable(t))}
      </div>

      {/* Audience detail table — shows filtered ad sets / line items when Audience view is active */}
      {groupBy === "audience" && (() => {
        const detailMatch = audNameToAdSetMatch.get(metaAudFilter);
        const filteredMeta = metaAudFilter === "all"
          ? metaAdSets.rows
          : detailMatch && (detailMatch.ids.size > 0 || detailMatch.names.size > 0)
            ? metaAdSets.rows.filter((r) => detailMatch.ids.has(r.id) || detailMatch.names.has(r.name))
            : metaAdSets.rows.filter((r) => (r.targeting + " " + r.name).toLowerCase().includes(metaAudFilter.toLowerCase()));
        const filteredDv = dv360AudFilter === "all" ? dv360LineItems.rows : dv360LineItems.rows.filter((r) => r.audienceType === dv360AudFilter);
        return (
          <div className="border-t border-gray-100 px-5 py-4">
            {hasMeta && filteredMeta.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-bold text-gray-900 mb-2">
                  Meta Ad Sets ({filteredMeta.length})
                  {metaAudFilter !== "all" && <span className="text-xs font-normal text-gray-400 ml-2">filtered by: {metaAudFilter}</span>}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-semibold">Ad Set</th>
                        <th className="text-left py-2 px-2 font-semibold">Audience Type</th>
                        <th className="text-right py-2 px-2 font-semibold">Spend</th>
                        <th className="text-right py-2 px-2 font-semibold">Impressions</th>
                        <th className="text-right py-2 px-2 font-semibold">Reach</th>
                        <th className="text-right py-2 px-2 font-semibold">Clicks</th>
                        <th className="text-right py-2 px-2 font-semibold">CTR</th>
                        <th className="text-right py-2 px-2 font-semibold">CPM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMeta.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                          <td className="py-1.5 px-2 font-medium text-gray-800 max-w-[200px] truncate" title={r.name}>{r.name}</td>
                          <td className="py-1.5 px-2 text-gray-500 max-w-[240px] truncate" title={r.targeting}>{metaAudCategory(r)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{formatMoney(r.spend, metaCurrency)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.impressions)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.reach)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.clicks)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{r.ctr > 0 ? `${r.ctr.toFixed(2)}%` : "—"}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{formatMoney(r.cpm, metaCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {hasMeta && metaAdSets.loading && <div className="mb-4 text-sm text-gray-400 animate-pulse">Loading Meta ad sets…</div>}
            {hasDv && filteredDv.length > 0 && (
              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-2">
                  DV360 Line Items ({filteredDv.length})
                  {dv360AudFilter !== "all" && <span className="text-xs font-normal text-gray-400 ml-2">filtered by: {dv360AudFilter}</span>}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-semibold">Line Item</th>
                        <th className="text-left py-2 px-2 font-semibold">Insertion Order</th>
                        <th className="text-left py-2 px-2 font-semibold">Audience Type</th>
                        <th className="text-left py-2 px-2 font-semibold">Targeting</th>
                        <th className="text-right py-2 px-2 font-semibold">Spend</th>
                        <th className="text-right py-2 px-2 font-semibold">Impressions</th>
                        <th className="text-right py-2 px-2 font-semibold">Clicks</th>
                        <th className="text-right py-2 px-2 font-semibold">CTR</th>
                        <th className="text-right py-2 px-2 font-semibold">CPM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDv.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                          <td className="py-1.5 px-2 font-medium text-gray-800 max-w-[180px] truncate" title={r.name}>{r.name}</td>
                          <td className="py-1.5 px-2 text-gray-500 max-w-[160px] truncate" title={r.insertionOrderName}>{r.insertionOrderName}</td>
                          <td className="py-1.5 px-2"><span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">{r.audienceType}</span></td>
                          <td className="py-1.5 px-2 text-gray-500 max-w-[200px] truncate" title={r.targeting}>{r.targeting}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{formatMoney(r.spend, dv360Currency)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.impressions)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(r.clicks)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{r.ctr > 0 ? `${r.ctr.toFixed(2)}%` : "—"}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{formatMoney(r.cpm, dv360Currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {hasDv && dv360LineItems.loading && <div className="text-sm text-gray-400 animate-pulse">Loading DV360 line items…</div>}
          </div>
        );
      })()}

      {/* Saved plans — dated snapshots to review later */}
      {snapshots.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-4">
          <h4 className="text-sm font-bold text-gray-900">Saved plans</h4>
          <p className="text-[11px] text-gray-400 mt-0.5 mb-3">Dated captures of planned vs delivered — save again anytime delivery changes to keep a history for this account.</p>
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-900">{s.dateLabel}</span>
                    <span className="text-[11px] text-gray-400"> · {s.scope} · {s.rows.length} group{s.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setOpenSnap(openSnap === s.id ? null : s.id)}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100">
                      {openSnap === s.id ? "Hide" : "View"}
                    </button>
                    <button onClick={() => editSnapshot(s)}
                      className="px-2.5 py-1 text-xs font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
                      Edit
                    </button>
                    <button onClick={() => removeSnapshot(s.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100">
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                </div>
                {openSnap === s.id && (
                  <div className="border-t border-gray-100 px-3 py-3 space-y-4">
                    {s.rows.map((r, ri) => (
                      <div key={ri}>
                        <div className="text-xs font-bold text-gray-900 mb-1">{r.label}{r.sub ? ` · ${r.sub}` : ""}</div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left py-1 font-semibold">Metric</th>
                              <th className="text-right py-1 font-semibold">Planned</th>
                              <th className="text-right py-1 font-semibold">Delivered</th>
                              <th className="text-right py-1 font-semibold">Pacing</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.metrics.map((mm) => {
                              const def = AGG_METRICS.find((x) => x.key === mm.key);
                              const pace = pacingBadge(mm.planned, mm.delivered);
                              return (
                                <tr key={mm.key} className="border-t border-gray-50">
                                  <td className="py-1 text-gray-700">{def?.label ?? mm.key}</td>
                                  <td className="py-1 text-right text-gray-700">{mm.planned > 0 ? fmtMetric(def?.kind ?? "int", mm.planned, r.gcur) : "—"}</td>
                                  <td className="py-1 text-right font-semibold text-gray-900">{fmtMetric(def?.kind ?? "int", mm.delivered, r.gcur)}</td>
                                  <td className={`py-1 text-right font-semibold ${pace.cls}`}>{pace.text}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanningReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, metaCurrency, dv360Currency } = useCampaigns(
    platform === "dv360" ? "dv360" : platform,
    dateRange, customStart, customEnd,
  );

  const showMeta = platform !== "dv360";
  const showDv   = platform === "dv360" || platform === "both";

  const metaCampaigns = useMemo(() => campaigns.filter((c) => c.platform === "meta"), [campaigns]);

  // Reach comes from a DEDICATED endpoint (not the heavy campaigns route, where
  // it gets starved by slow entity calls). Enrich DV360 campaigns with it so
  // Reach/Frequency populate everywhere in this tab.
  const { reachByCampaign, reachByLineItem } = useDV360Reach(dateRange, customStart, customEnd, showDv, campaigns);
  const dv360Campaigns = useMemo(() =>
    campaigns.filter((c) => c.platform === "dv360").map((c) => {
      const rc = reachByCampaign[c.id];
      return rc && rc.reach > 0 ? { ...c, reach: rc.reach, frequency: rc.frequency || c.frequency } : c;
    }),
  [campaigns, reachByCampaign]);

  // Combined list (Meta + reach-enriched DV360) for the aggregate panel.
  const enrichedCampaigns = useMemo(() => [...metaCampaigns, ...dv360Campaigns], [metaCampaigns, dv360Campaigns]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Planning</h1>
            <p className="text-gray-600 mt-1 text-sm">What you planned to buy vs what actually delivered — overall, by channel, by objective, and per campaign.</p>
          </div>
        </div>
      </div>

      {/* ── Aggregate views: Overall / Channel / Objective (planned vs delivered) ── */}
      <AggregatePlanning
        campaigns={enrichedCampaigns}
        loading={loading}
        metaCurrency={metaCurrency}
        dv360Currency={dv360Currency}
        dateRange={dateRange}
        customStart={customStart}
        customEnd={customEnd}
      />

      {/* ── Daily trend charts ── */}
      <DailyTrendCharts dateRange={dateRange} customStart={customStart} customEnd={customEnd} platform={platform} />

      {/* ── Meta section ── */}
      {showMeta && (
        <div className="space-y-4">
          {platform === "both" && <SectionHeader label="Meta" sub="Meta Ads" />}
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

      {/* ── DV360 section ── */}
      {showDv && (
        <div className="space-y-4">
          {platform === "both" && <SectionHeader label="DV360" sub="Display & Video 360" />}
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
