/**
 * Reporting → Planning
 *
 * Planned vs Delivered media-plan reconciliation (Meta only, v1).
 *
 * The marketer picks which campaigns to plan for (dropdown). Each selected
 * campaign is a row: type the PLANNED buy (Net Spend / Reach / Impressions),
 * and DELIVERED is shown right beside it — auto-matched from real Meta data over
 * the selected date range, with a pacing % and an AI insight panel.
 *
 * Planned inputs + the campaign selection persist per account via
 * usePersistentJSON, so they survive reloads. Planned rows are driven purely by
 * the persisted selection + planned map (NOT the live fetch), so typing is never
 * interrupted when delivered data refreshes.
 */

import { useMemo, useState } from "react";
import { ClipboardList, Info, Sparkles } from "lucide-react";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePersistentJSON } from "@/hooks/useColumnPrefs";
import CampaignMultiPicker from "@/components/shared/CampaignMultiPicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAuthStore } from "@/store/auth";
import { toDisplayCredits } from "@/lib/ai-cost";
import { detectCurrency, formatMoney } from "@/lib/currency";
import type { CampaignData } from "@/types";

interface Props {
  platform: "meta" | "google" | "both";
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
function deliveredOf(c: CampaignData | undefined): Delivered {
  const spend = c?.spend || 0, impressions = c?.impressions || 0, clicks = c?.clicks || 0;
  const reach = c?.reach || 0, videoViews = c?.videoViews || 0;
  return {
    spend, impressions, clicks, reach, videoViews,
    frequency: reach > 0 ? impressions / reach : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    vtr: impressions > 0 ? (videoViews / impressions) * 100 : 0,
  };
}

// Pacing sentiment is by DISTANCE FROM 100% — for spend, both large over- and
// under-delivery are off-plan (235% is an overspend, not "good"), so green =
// on-plan (±10%), yellow = drifting (±25%), red = materially off.
function pacingCell(delivered: number, planned: number) {
  if (!planned || planned <= 0) return <span className="text-gray-300" title="Enter a planned spend to see pacing">—</span>;
  const pct = (delivered / planned) * 100;
  const off = Math.abs(pct - 100);
  const cls =
    off <= 10 ? "bg-green-100 text-green-800"
    : off <= 25 ? "bg-yellow-100 text-yellow-800"
    : "bg-red-100 text-red-800";
  const label = pct > 100 ? "over plan" : "under plan";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`} title={`Delivered spend is ${Math.round(pct)}% of planned (${label})`}>
      {Math.round(pct)}%
    </span>
  );
}

// Compact per-campaign gap explainer — 2-3 plain-English sentences, on demand.
function GapInsight({ campaign, planned, delivered, pacing, dateRange }: {
  campaign: string;
  planned: Record<string, number>;
  delivered: Record<string, number>;
  pacing: Record<string, number | null>;
  dateRange: string;
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
        body: JSON.stringify({ campaign, planned, delivered, pacing, dateRange, isDemo: demoMode }),
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
    <div className="flex flex-col items-end gap-1 max-w-full">
      <button
        onClick={run}
        disabled={state.loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition disabled:opacity-60"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {state.loading ? "Analysing…" : state.text ? "Explain again" : "Explain the gap"}
        <span className="text-violet-400 font-normal">~${toDisplayCredits(0.0006).toFixed(2)}</span>
      </button>
      {state.text && (
        <div className="mt-1 w-full max-w-xl bg-violet-50/60 border border-violet-100 rounded-lg px-3 py-2 text-xs text-gray-700 leading-relaxed text-left">
          {state.text}
        </div>
      )}
      {state.err && <div className="text-[11px] text-red-500 max-w-xl text-left">{state.err}</div>}
    </div>
  );
}

export default function PlanningReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading } = useCampaigns("meta", dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);
  const cur = (n: number) => (n > 0 ? formatMoney(n, currency, 0) : "—");

  const metaCampaigns = useMemo(() => campaigns.filter((c) => c.platform === "meta"), [campaigns]);
  const byId = useMemo(() => new Map(metaCampaigns.map((c) => [c.id, c])), [metaCampaigns]);

  // Persisted per account: which campaigns to plan for + their planned numbers.
  const [selected, setSelected] = usePersistentJSON<string[]>("planning-selected", []);
  const [planned, setPlanned] = usePersistentJSON<PlannedMap>("planning-planned", {});

  // Which campaign the deep-dive comparison window focuses on (session-only).
  const [focusId, setFocusId] = useState<string>("");

  const setPlan = (id: string, patch: Partial<Planned>) =>
    setPlanned((prev) => {
      const cur0 = prev[id] ?? { spend: 0, reach: 0, impressions: 0 };
      return { ...prev, [id]: { ...cur0, ...patch } };
    });

  // Rows come from the persisted selection (stable), name resolved from the
  // fetched list when available; delivered looked up by id (— while loading).
  const rows = useMemo(() =>
    selected.map((id) => {
      const c = byId.get(id);
      return {
        id,
        name: c?.name ?? id,
        planned: planned[id] ?? { spend: 0, reach: 0, impressions: 0 },
        delivered: deliveredOf(c),
      };
    }),
  [selected, byId, planned]);

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

  // Compact context for the AI insight panel — planned vs delivered per row.
  const aiContext = useMemo(() => ({
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
  }), [rows, totals, dateRange]);

  const hasPlan = rows.some((r) => r.planned.spend > 0 || r.planned.reach > 0 || r.planned.impressions > 0);

  const th = "px-3 py-2 text-[10px] uppercase font-semibold text-gray-500 whitespace-nowrap";
  const td = "px-3 py-2 text-right text-gray-800 whitespace-nowrap tabular-nums";
  const numField = (id: string, field: keyof Planned, value: number, opts?: { placeholder?: string; step?: number }) => (
    <input
      type="number" min={0} step={opts?.step ?? 1} value={value || ""}
      onChange={(e) => setPlan(id, { [field]: Math.max(0, Number(e.target.value) || 0) })}
      placeholder={opts?.placeholder ?? "0"}
      className="w-24 px-2 py-1 text-xs text-right border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
    />
  );

  const options = useMemo(() => metaCampaigns.map((c) => ({ id: c.id, name: c.name })), [metaCampaigns]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Planning</h1>
            <p className="text-gray-600 mt-1 text-sm">What you planned to buy vs what actually delivered — per campaign. Meta only.</p>
          </div>
        </div>
        {rows.length > 0 && (
          <AIExecutiveSummary tabName="Planning (Planned vs Delivered)" context={aiContext} platform="meta" dateRange={String(dateRange)} inline />
        )}
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          Planning is Meta-specific right now — switch Platform to Meta or Both.
        </div>
      )}

      {/* Campaign selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">Campaigns in this plan:</span>
        <CampaignMultiPicker options={options} values={selected} onChange={setSelected} allLabelText="None selected — pick campaigns to plan" />
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Pick the campaigns in your plan above, then open the deep-dive below to enter planned targets for a campaign and compare against delivery. Frequency &amp; CPM auto-calculate (or override them). Use <span className="font-semibold">Explain the gap</span> for a quick AI read.
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-10 text-center text-sm text-gray-400">
          {loading ? "Loading campaigns…" : "No campaigns selected yet — use the picker above to choose which campaigns to plan for."}
        </div>
      ) : (
        <>
        {/* ── Per-campaign deep-dive: pick one campaign, compare every metric
              planned vs delivered, with an AI insight for that exact campaign ── */}
        {(() => {
          const focus = rows.find((r) => r.id === focusId) ?? rows[0];
          if (!focus) return null;
          const p = focus.planned;
          const d = focus.delivered;
          const pFreq = p.frequency && p.frequency > 0 ? p.frequency : (p.reach > 0 ? p.impressions / p.reach : 0);
          const pCpm = p.cpm && p.cpm > 0 ? p.cpm : (p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0);

          // Per-metric comparison rows. Every planned cell is editable; freq/cpm
          // fall back to a derived placeholder until overridden. pacing = delivered
          // ÷ planned effective value.
          const money = (n: number) => (n > 0 ? formatMoney(n, currency, 0) : "—");
          const pct = (pl: number, de: number) => (pl > 0 ? Math.round((de / pl) * 100) : null);
          type Kind = "money" | "int" | "pct" | "decimal";
          const metricRows: {
            label: string; field: keyof Planned; kind: Kind; step: number;
            plannedEff: number; deliveredNum: number; deliveredStr: string; placeholder?: string;
          }[] = [
            { label: "Net Spend",   field: "spend",       kind: "money",   step: 1,    plannedEff: p.spend,        deliveredNum: d.spend,        deliveredStr: money(d.spend) },
            { label: "Reach",       field: "reach",       kind: "int",     step: 1,    plannedEff: p.reach,        deliveredNum: d.reach,        deliveredStr: fmtInt(d.reach) },
            { label: "Impressions", field: "impressions", kind: "int",     step: 1,    plannedEff: p.impressions,  deliveredNum: d.impressions,  deliveredStr: fmtInt(d.impressions) },
            { label: "Frequency",   field: "frequency",   kind: "decimal", step: 0.1,  plannedEff: pFreq,          deliveredNum: d.frequency,    deliveredStr: fmtX(d.frequency), placeholder: pFreq > 0 ? pFreq.toFixed(1) : "0" },
            { label: "CPM",         field: "cpm",         kind: "money",   step: 1,    plannedEff: pCpm,           deliveredNum: d.cpm,          deliveredStr: money(d.cpm), placeholder: pCpm > 0 ? String(Math.round(pCpm)) : "0" },
            { label: "VTR",         field: "vtr",         kind: "pct",     step: 0.01, plannedEff: p.vtr ?? 0,     deliveredNum: d.vtr,          deliveredStr: fmtPct(d.vtr) },
            { label: "CTR",         field: "ctr",         kind: "pct",     step: 0.01, plannedEff: p.ctr ?? 0,     deliveredNum: d.ctr,          deliveredStr: fmtPct(d.ctr) },
            { label: "Views",       field: "views",       kind: "int",     step: 1,    plannedEff: p.views ?? 0,   deliveredNum: d.videoViews,   deliveredStr: fmtInt(d.videoViews) },
            { label: "Clicks",      field: "clicks",      kind: "int",     step: 1,    plannedEff: p.clicks ?? 0,  deliveredNum: d.clicks,       deliveredStr: fmtInt(d.clicks) },
          ];
          const focusContext = {
            campaign: focus.name,
            window: String(dateRange),
            planned: {
              spend: p.spend, reach: p.reach, impressions: p.impressions, frequency: +pFreq.toFixed(2), cpm: +pCpm.toFixed(2),
              vtr: p.vtr ?? 0, ctr: p.ctr ?? 0, views: p.views ?? 0, clicks: p.clicks ?? 0,
            },
            delivered: {
              spend: Math.round(d.spend), reach: Math.round(d.reach), impressions: Math.round(d.impressions),
              frequency: +d.frequency.toFixed(2), cpm: +d.cpm.toFixed(2), vtr: +d.vtr.toFixed(2), ctr: +d.ctr.toFixed(2),
              views: Math.round(d.videoViews), clicks: Math.round(d.clicks),
            },
            pacing: {
              spendPct: pct(p.spend, d.spend), reachPct: pct(p.reach, d.reach), impressionPct: pct(p.impressions, d.impressions),
              vtrPct: pct(p.vtr ?? 0, d.vtr), ctrPct: pct(p.ctr ?? 0, d.ctr), viewsPct: pct(p.views ?? 0, d.videoViews), clicksPct: pct(p.clicks ?? 0, d.clicks),
            },
          };
          return (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-sm font-bold text-gray-900">Campaign deep-dive</h3>
                  <select
                    value={focus.id}
                    onChange={(e) => setFocusId(e.target.value)}
                    className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 max-w-[280px]"
                  >
                    {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <GapInsight
                  campaign={focus.name}
                  planned={focusContext.planned}
                  delivered={focusContext.delivered}
                  pacing={focusContext.pacing}
                  dateRange={String(dateRange)}
                />
              </div>
              <div className="p-5">
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
                        // This is the only planning surface, so every planned cell
                        // is editable. Freq/CPM show a derived placeholder.
                        const editableHere = true;
                        const stored = (p[m.field] as number | undefined) ?? 0;
                        const pacing = m.plannedEff > 0 ? Math.round((m.deliveredNum / m.plannedEff) * 100) : null;
                        const plannedDisplay =
                          m.kind === "money" ? money(m.plannedEff)
                          : m.kind === "pct" ? fmtPct(m.plannedEff)
                          : m.kind === "decimal" ? fmtX(m.plannedEff)
                          : fmtInt(m.plannedEff);
                        return (
                          <tr key={m.label} className="border-b border-gray-50 last:border-0">
                            <td className="px-3 py-2 font-medium text-gray-700">{m.label}</td>
                            <td className="px-3 py-2 text-right">
                              {editableHere ? (
                                // Fixed-width prefix/suffix slots (always rendered) keep
                                // every input box aligned in one column regardless of ₹ / %.
                                <div className="inline-flex items-center justify-end gap-1">
                                  <span className="w-3 text-right text-[11px] text-gray-400">{m.kind === "money" && currency === "INR" ? "₹" : ""}</span>
                                  <input
                                    type="number" min={0} step={m.step} value={stored || ""}
                                    placeholder={m.placeholder ?? "0"}
                                    onChange={(e) => setPlan(focus.id, { [m.field]: Math.max(0, Number(e.target.value) || 0) })}
                                    className="w-28 px-2 py-1 text-xs text-right border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                                  />
                                  <span className="w-3 text-left text-[11px] text-gray-400">{m.kind === "pct" ? "%" : ""}</span>
                                </div>
                              ) : (
                                <span className="text-gray-600 tabular-nums">{plannedDisplay}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">{m.deliveredStr}</td>
                            <td className="px-3 py-2 text-right">
                              {pacing === null ? <span className="text-gray-300">—</span> : (() => {
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
                  Enter planned targets for each metric; delivered is matched from Meta and pacing is delivered ÷ planned. Click <span className="font-semibold">Explain the gap</span> for a 2-3 line read on <span className="font-medium">{focus.name}</span>.
                </p>
              </div>
            </div>
          );
        })()}
        </>
      )}
    </div>
  );
}
