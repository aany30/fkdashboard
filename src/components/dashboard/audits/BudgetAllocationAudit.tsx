import { useState, useMemo, useEffect } from "react";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import CampaignDrillTree from "./CampaignDrillTree";
import AttributionInfo from "@/components/shared/AttributionInfo";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { currencyFor, formatMoney } from "@/lib/currency";
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Sparkles, Loader2 } from "lucide-react";
import { toDisplayCredits } from "@/lib/ai-cost";
import { isDemoCredential } from "@/lib/demo-data";

function fmtInt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

const ACTIVE_STATUSES = new Set(["ACTIVE", "ENABLED", "ENTITY_STATUS_ACTIVE", "ENTITY_STATUS_ENABLED"]);
const isActive = (c: CampaignData) => ACTIVE_STATUSES.has((c.status || "").toUpperCase());

const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE:                { label: "Active",   color: "bg-green-100 text-green-700" },
  ENABLED:               { label: "Enabled",  color: "bg-blue-100 text-blue-700" },
  PAUSED:                { label: "Paused",   color: "bg-gray-100 text-gray-500" },
  ENTITY_STATUS_ACTIVE:  { label: "Active",   color: "bg-green-100 text-green-700" },
  ENTITY_STATUS_ENABLED: { label: "Enabled",  color: "bg-blue-100 text-blue-700" },
  ENTITY_STATUS_PAUSED:  { label: "Paused",   color: "bg-yellow-100 text-yellow-700" },
  ENTITY_STATUS_ARCHIVED:{ label: "Archived", color: "bg-gray-100 text-gray-500" },
  ENTITY_STATUS_DRAFT:   { label: "Draft",    color: "bg-gray-100 text-gray-500" },
};

function statusBadge(status: string) {
  const s = (status || "").toUpperCase();
  const m = STATUS_META[s];
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${m?.color || "bg-gray-100 text-gray-500"}`}>
      {m?.label || status || "—"}
    </span>
  );
}

// ── Per-row AI recommendation ────────────────────────────────────────────────
const AI_RECO_ESTIMATE = `~${toDisplayCredits(0.0018).toFixed(2)}`;

interface RowAiRecoProps {
  campaignContext: Record<string, unknown>;
  findingLabel: string;
  findingDetail: string;
  isDemo: boolean;
  platform: string;
}

function RowAiReco({ campaignContext, findingLabel, findingDetail, isDemo, platform }: RowAiRecoProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addAiCredits } = useAuthStore();

  const ask = async () => {
    if (answer || loading) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const question = `Finding: ${findingLabel} — ${findingDetail}\n\nGive me 2–4 specific next steps for THIS campaign only. Reference the campaign's actual numbers. Each step on its own line starting with "•". Skip generic advice.`;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: campaignContext, platform, isDemo }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setAnswer(json.answer || "(no response)");
      if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      {!open && (
        <button
          onClick={ask}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 hover:text-violet-900 hover:underline"
        >
          <Sparkles className="w-3 h-3" />
          Ask AI for next steps
          <span className="text-gray-400 font-normal">{AI_RECO_ESTIMATE}</span>
        </button>
      )}
      {open && (
        <div className="mt-1.5 rounded-md border border-violet-200 bg-violet-50/50 p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">
              <Sparkles className="w-3 h-3" /> AI recommendation
            </span>
            <button onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-gray-600">close</button>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <Loader2 className="w-3 h-3 animate-spin text-violet-600" />
              Analyzing this campaign…
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-700">Couldn&apos;t generate: {error}</div>
          )}
          {answer && !loading && (
            <div className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{answer}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tip (recommendation) per row
// ─────────────────────────────────────────────────────────────────────────────
type TipKind = "spike" | "noDelivery" | "overPacing" | "underPacing" | "healthy" | "paused" | "adSetLevel" | "noBudgetTrail";
type Tip = {
  kind: TipKind;
  severity: "high" | "medium" | "info" | "good";
  label: string;
  detail: string;
  isSpike: boolean;
  sevRank: number;
};

function computeMetaTip(
  c: CampaignData,
  trail: Record<string, { avg7d: number; avg14d: number; avg28d: number }>,
  currency: string,
): Tip {
  if (!isActive(c)) {
    return { kind: "paused", severity: "info", label: "Paused", detail: "Campaign is not currently delivering.", isSpike: false, sevRank: 1 };
  }
  const t = trail[c.id];
  if (!t) {
    return { kind: "noBudgetTrail", severity: "info", label: "Loading…", detail: "Fetching last 28 days of daily spend.", isSpike: false, sevRank: 1 };
  }
  const { avg7d, avg14d, avg28d } = t;
  if (avg14d > 0 && avg7d / avg14d > 1.25) {
    const pct = ((avg7d - avg14d) / avg14d) * 100;
    return { kind: "spike", severity: "high", label: "Budget spike", detail: `${formatMoney(avg7d, currency, 0)}/day this week vs ${formatMoney(avg14d, currency, 0)}/day prior · +${Math.round(pct)}%. Verify this was intentional.`, isSpike: true, sevRank: 3 };
  }
  if (avg7d === 0 && avg28d > 0) {
    return { kind: "noDelivery", severity: "high", label: "No delivery", detail: "Active but zero spend in the last 7 days. Check ad approvals, audience, or pixel firing.", isSpike: false, sevRank: 3 };
  }
  if (!c.dailyBudget || c.dailyBudget <= 0) {
    return { kind: "adSetLevel", severity: "info", label: "Ad-set budgets", detail: `Budget is set at the ad-set level (ABO). Currently averaging ${formatMoney(avg7d, currency, 0)}/day across all ad sets.`, isSpike: false, sevRank: 1 };
  }
  if (avg7d / c.dailyBudget > 1.10) {
    const pct = ((avg7d - c.dailyBudget) / c.dailyBudget) * 100;
    return { kind: "overPacing", severity: "medium", label: "Over-pacing", detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · +${Math.round(pct)}%. Within Meta tolerance — watch trend.`, isSpike: false, sevRank: 2 };
  }
  if (avg7d > 0 && avg7d < c.dailyBudget * 0.70) {
    const pct = (avg7d / c.dailyBudget) * 100;
    return { kind: "underPacing", severity: "medium", label: "Under-pacing", detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · ${Math.round(pct)}% of cap. Consider lowering budget or check delivery limits.`, isSpike: false, sevRank: 2 };
  }
  const pct = c.dailyBudget > 0 ? (avg7d / c.dailyBudget) * 100 : 100;
  return { kind: "healthy", severity: "good", label: "On pace", detail: `Spending ${formatMoney(avg7d, currency, 0)}/day · ${Math.round(pct)}% of the ${formatMoney(c.dailyBudget, currency, 0)}/day budget. No action needed.`, isSpike: false, sevRank: 0 };
}

function fmtFlightDate(iso?: string): string | null {
  if (!iso) return null;
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function computeDV360Tip(c: CampaignData, currency: string, win?: { startDate: string; endDate: string }): Tip {
  if (!isActive(c)) {
    return { kind: "paused", severity: "info", label: "Paused", detail: "Campaign is not currently delivering.", isSpike: false, sevRank: 1 };
  }
  const spend = c.spend || 0;
  if (spend === 0) {
    // Line-item status (DV360 delivers at the line-item level, NOT the campaign
    // level — a campaign can be "Active" while every line item is paused/ended).
    const lineItems = (c.adSets ?? []).flatMap((io) => io.ads ?? []);
    const activeLis = lineItems.filter((li) => {
      const st = (li.status || "").toUpperCase();
      return st.includes("ACTIVE") || st.includes("ENABLED");
    }).length;
    const liNote = lineItems.length > 0
      ? ` ${activeLis} of ${lineItems.length} line item${lineItems.length === 1 ? "" : "s"} active` +
        (activeLis === 0 ? " — every line item is paused/ended, which is why the campaign isn't delivering despite showing Active." : " — active line items exist but recorded no spend in this window (check budget pacing or creative approvals).")
      : "";

    // Explain WHY an active campaign has zero delivery using its planned flight
    // window vs the selected date range — a flight that ended before (or starts
    // after) the window is the most common, benign cause.
    let detail = `Active but zero spend in the selected window.${liNote || " Check insertion order flight dates and line item status."}`;
    if (win) {
      const winLabel = `${fmtFlightDate(win.startDate)} – ${fmtFlightDate(win.endDate)}`;
      if (c.flightEnd && c.flightEnd < win.startDate) {
        detail = `Flight ended ${fmtFlightDate(c.flightEnd)}, before your selected window (${winLabel}) — so zero delivery here is expected. Widen the date range to its flight period to see its spend.`;
      } else if (c.flightStart && c.flightStart > win.endDate) {
        detail = `Flight starts ${fmtFlightDate(c.flightStart)}, after your selected window (${winLabel}) — it hasn't begun delivering yet.`;
      } else if (c.flightStart || c.flightEnd) {
        const fl = `${fmtFlightDate(c.flightStart) ?? "—"} → ${fmtFlightDate(c.flightEnd) ?? "ongoing"}`;
        detail = `Active with a flight of ${fl} that overlaps your window, but zero spend.${liNote || " Check line-item status, budget pacing, or creative approvals."}`;
      }
    }
    return { kind: "noDelivery", severity: "high", label: "No delivery", detail, isSpike: false, sevRank: 3 };
  }
  if (c.dailyBudget && c.dailyBudget > 0) {
    const days = 7;
    const avgDaily = spend / days;
    if (avgDaily / c.dailyBudget > 1.10) {
      const pct = ((avgDaily - c.dailyBudget) / c.dailyBudget) * 100;
      return { kind: "overPacing", severity: "medium", label: "Over-pacing", detail: `~${formatMoney(avgDaily, currency, 0)}/day avg vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · +${Math.round(pct)}%.`, isSpike: false, sevRank: 2 };
    }
    if (avgDaily < c.dailyBudget * 0.70) {
      const pct = (avgDaily / c.dailyBudget) * 100;
      return { kind: "underPacing", severity: "medium", label: "Under-pacing", detail: `~${formatMoney(avgDaily, currency, 0)}/day avg vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · ${Math.round(pct)}% utilisation.`, isSpike: false, sevRank: 2 };
    }
    return { kind: "healthy", severity: "good", label: "On pace", detail: `Spending ~${formatMoney(avgDaily, currency, 0)}/day · within budget tolerance.`, isSpike: false, sevRank: 0 };
  }
  return { kind: "adSetLevel", severity: "info", label: "IO-level budget", detail: `Spend managed at insertion-order level. Total: ${formatMoney(spend, currency, 0)} in window.`, isSpike: false, sevRank: 1 };
}

function TipCell({ tip, campaignContext, isDemo, platform }: { tip: Tip; campaignContext: Record<string, unknown>; isDemo: boolean; platform: string }) {
  const styles = {
    high:   { ring: "ring-red-200 bg-red-50",       pill: "bg-red-100 text-red-700",       Icon: AlertCircle,   iconClass: "text-red-600" },
    medium: { ring: "ring-yellow-200 bg-yellow-50", pill: "bg-yellow-100 text-yellow-700", Icon: tip.kind === "overPacing" ? TrendingUp : TrendingDown, iconClass: "text-yellow-600" },
    good:   { ring: "ring-green-200 bg-green-50",   pill: "bg-green-100 text-green-700",   Icon: CheckCircle2,  iconClass: "text-green-600" },
    info:   { ring: "ring-gray-200 bg-gray-50",     pill: "bg-gray-100 text-gray-600",     Icon: AlertCircle,   iconClass: "text-gray-400" },
  }[tip.severity];
  const { Icon } = styles;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ring-1 ${styles.ring}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${styles.iconClass}`} strokeWidth={2.2} />
      <div className="min-w-0 flex-1">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles.pill}`}>
          {tip.label}
        </span>
        <div className="text-[11px] text-gray-600 leading-snug mt-1">{tip.detail}</div>
        {tip.severity !== "info" && (
          <RowAiReco isDemo={isDemo} findingLabel={tip.label} findingDetail={tip.detail} campaignContext={campaignContext} platform={platform} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spend table — shared between Meta and DV360 sections
// ─────────────────────────────────────────────────────────────────────────────
interface SpendTableProps {
  rows: Array<{
    c: CampaignData;
    name: string;
    status: string;
    statusOrder: number;
    objective: string;
    budget: number;
    budgetType: string;
    spend: number;
    impressions: number;
    clicks: number;
    tip: Tip;
    tipSeverity: number;
  }>;
  currency: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalCount: number;
  isDemo: boolean;
  platform: string;
  spikeNotice?: string | null;
  subtitle: string;
}

function SpendTable({ rows, currency, totalSpend, totalImpressions, totalClicks, totalCount, isDemo, platform, spikeNotice, subtitle }: SpendTableProps) {
  const { sorted, sort, toggle } = useSort(rows, "statusOrder", "asc");
  const finalSorted = useMemo(() => {
    if (sort.col !== "statusOrder") return sorted;
    return [...rows].sort((a, b) =>
      a.statusOrder !== b.statusOrder
        ? (sort.dir === "asc" ? a.statusOrder - b.statusOrder : b.statusOrder - a.statusOrder)
        : b.spend - a.spend
    );
  }, [sorted, rows, sort.col, sort.dir]);

  const cur = (n: number) => formatMoney(n, currency, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-900">Spend by campaign</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>
        {spikeNotice && (
          <div className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11px] font-semibold ${
            spikeNotice.startsWith("⚠") ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"
          }`}>
            {spikeNotice}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="name" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[200px]">Campaign</SortTh>
              <SortTh col="statusOrder" sort={sort} onToggle={toggle} className="px-4 py-2" align="center">Status</SortTh>
              <SortTh col="objective" sort={sort} onToggle={toggle} className="px-4 py-2">Objective</SortTh>
              <SortTh col="budget" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Budget (setting)</SortTh>
              <SortTh col="spend" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Spend</SortTh>
              <SortTh col="impressions" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Impressions</SortTh>
              <SortTh col="clicks" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Clicks</SortTh>
              <SortTh col="tipSeverity" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[300px]">Recommend</SortTh>
            </tr>
          </thead>
          <tbody>
            {finalSorted.map((r) => (
              <tr key={`${r.c.platform}-${r.c.id}`} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-4 py-2.5 font-mono text-gray-900 break-words max-w-[280px]" title={r.name}>{r.name}</td>
                <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                <td className="px-4 py-2.5 text-gray-700 text-xs">{r.objective}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                  {r.budgetType === "none" ? <span className="text-gray-400">—</span> : (
                    <>{cur(r.budget)}<span className="text-[10px] text-gray-400">/{r.budgetType === "daily" ? "day" : "life"}</span></>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{cur(r.spend)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtInt(r.impressions)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtInt(r.clicks)}</td>
                <td className="px-4 py-2.5">
                  <TipCell
                    tip={r.tip}
                    isDemo={isDemo}
                    platform={platform}
                    campaignContext={{
                      name: r.name, status: r.status, objective: r.objective,
                      dailyBudget: r.budget, budgetType: r.budgetType,
                      // Current-window figures (what the picker shows).
                      window: { spend: r.spend, impressions: r.c.impressions ?? 0, clicks: r.c.clicks ?? 0, conversions: r.c.conversions ?? 0 },
                      spend: r.spend, impressions: r.c.impressions ?? 0,
                      clicks: r.c.clicks ?? 0, conversions: r.c.conversions ?? 0,
                      conversionValue: r.c.conversionValue ?? 0, currency,
                      ...(r.c.flightStart ? { flightStart: r.c.flightStart } : {}),
                      ...(r.c.flightEnd ? { flightEnd: r.c.flightEnd } : {}),
                      // Full campaign history (date-range independent) — recommendations
                      // must be based on THIS so advice stays stable across 7d/30d/90d.
                      ...(platform === "dv360" && (r.c.allTimeImpressions !== undefined || r.c.allTimeSpend !== undefined) ? {
                        fullHistory: {
                          note: "All-time delivery over the campaign's full flight (independent of the selected date range). Base the recommendation on this, not the current window.",
                          flightStart: r.c.flightStart, flightEnd: r.c.flightEnd,
                          spend: Math.round(r.c.allTimeSpend ?? 0),
                          impressions: r.c.allTimeImpressions ?? 0,
                          clicks: r.c.allTimeClicks ?? 0,
                          conversions: r.c.allTimeConversions ?? 0,
                          lifetimeBudget: r.c.lifetimeBudget ?? null,
                        },
                      } : {}),
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
            <tr className="font-bold text-gray-900">
              <td className="px-4 py-2.5" colSpan={4}>Total ({totalCount} campaigns)</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{cur(totalSpend)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{fmtInt(totalImpressions)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{fmtInt(totalClicks)}</td>
              <td className="px-4 py-2.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// META section — full pacing, daily trail, 6m avg, today's live spend
// ─────────────────────────────────────────────────────────────────────────────
function MetaBudgetSection({ campaigns, dateRange, currency }: { campaigns: CampaignData[]; dateRange?: string; currency: string }) {
  const { alertEmail, setAlertEmail, metaAccessToken, metaBusinessId } = useAuthStore();
  const isDemo = !metaAccessToken || isDemoCredential(metaAccessToken);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  // ── Rolling daily-spend trail → real 7d / 4w averages (pacing strip) ──────
  const [trail, setTrail] = useState<Record<string, { avg7d: number; avg14d: number; avg28d: number }>>({});
  useEffect(() => {
    if (!metaAccessToken) return;
    const ids = campaigns.filter((c) => c.platform === "meta" && !(c.id in trail)).map((c) => c.id);
    if (ids.length === 0) return;
    fetch("/api/naming/campaigns/daily-trail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: ids, businessId: metaBusinessId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.trails) return;
        const trailMap = data.trails as Record<string, Array<{ date: string; spend: number }>>;
        const dayMs = 86_400_000;
        let anchor: string | null = null;
        for (const days of Object.values(trailMap)) for (const d of days) if (!anchor || d.date > anchor) anchor = d.date;
        const derived: Record<string, { avg7d: number; avg14d: number; avg28d: number }> = {};
        for (const [id, days] of Object.entries(trailMap)) {
          const sumWindow = (startOff: number, endOff: number) => {
            if (!anchor) return 0;
            const a = new Date(`${anchor}T00:00:00Z`).getTime();
            const start = a - startOff * dayMs, end = a - endOff * dayMs;
            return days.reduce((s, d) => {
              const t = new Date(`${d.date}T00:00:00Z`).getTime();
              return t >= end && t <= start ? s + d.spend : s;
            }, 0);
          };
          derived[id] = { avg7d: sumWindow(0, 6) / 7, avg14d: sumWindow(7, 13) / 7, avg28d: sumWindow(0, 27) / 28 };
        }
        setTrail((prev) => ({ ...prev, ...derived }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId, campaigns.map((c) => c.id).join(",")]);

  // ── 6-month total spend → avg per month ─────────────────────────────────────
  const [spend6m, setSpend6m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setDate(today.getDate() - 182);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: sixMonthsAgo.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpend6m(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  const avg6mPerMonth = spend6m !== null ? spend6m / 6 : null;

  // ── Today's spend so far ────────────────────────────────────────────────────
  const [spendToday, setSpendToday] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date().toISOString().slice(0, 10);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: today, endDate: today }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpendToday(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  // ── Last 3 months ──────────────────────────────────────────────────────────
  const [spend3m, setSpend3m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setDate(today.getDate() - 91);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: threeMonthsAgo.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpend3m(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0;
    for (const c of visible) { spend += c.spend || 0; impressions += c.impressions || 0; clicks += c.clicks || 0; }
    return { spend, impressions, clicks };
  }, [visible]);

  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  const pacing = useMemo(() => {
    const activeCampaigns = visible.filter(isActive);
    let avg7d = 0, avg14d = 0, avg28d = 0;
    for (const c of activeCampaigns) {
      const t = trail[c.id];
      if (t) { avg7d += t.avg7d; avg14d += t.avg14d; avg28d += t.avg28d; }
    }
    const pacePct = budgetSetting.daily > 0 ? (avg7d / budgetSetting.daily) * 100 : null;
    const hasTrail = activeCampaigns.some((c) => c.id in trail);
    return { avg7d, avg14d, avg28d, pacePct, hasTrail };
  }, [visible, trail, budgetSetting.daily]);

  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const tip = computeMetaTip(c, trail, currency);
      return {
        c, name: c.name, status: c.status || "—",
        statusOrder: isActive(c) ? 0 : 1,
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions: c.impressions || 0, clicks: c.clicks || 0, tip, tipSeverity: tip.sevRank,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, trail, currency]
  );

  // Auto-send budget-spike emails
  const [spikeNotice, setSpikeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!alertEmail) return;
    const spikes = rows.filter((r) => r.tip.isSpike);
    if (spikes.length === 0) return;
    const now = new Date();
    const yr = now.getUTCFullYear();
    const startOfYear = Date.UTC(yr, 0, 1);
    const wk = Math.ceil(((now.getTime() - startOfYear) / 86_400_000 + new Date(startOfYear).getUTCDay() + 1) / 7);
    const weekKey = `${yr}-W${String(wk).padStart(2, "0")}`;
    const toSend: typeof spikes = [];
    const dedupKeys: string[] = [];
    for (const r of spikes) {
      const k = `spike:${r.c.id}:${weekKey}`;
      try { if (localStorage.getItem(k)) continue; } catch {}
      toSend.push(r);
      dedupKeys.push(k);
    }
    if (toSend.length === 0) return;
    fetch("/api/alerts/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: alertEmail,
        periodLabel: "Budget spike alert",
        campaigns: toSend.map((r) => {
          const t = trail[r.c.id];
          const avg7 = t?.avg7d ?? 0;
          const avg14 = t?.avg14d ?? 0;
          const pct = avg14 > 0 ? Math.round(((avg7 - avg14) / avg14) * 100) : 0;
          return { name: r.c.name, objective: r.c.objective, budget: avg14, spend: avg7, spendPct: pct + 100, currency, status: `Budget spike (+${pct}%)` };
        }),
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, data }) => {
        if (ok && data?.sent) {
          for (const k of dedupKeys) { try { localStorage.setItem(k, "1"); } catch {} }
          setSpikeNotice(`✓ Sent budget-spike alert for ${toSend.length} campaign(s) to ${alertEmail}`);
          setTimeout(() => setSpikeNotice(null), 8000);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, alertEmail]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200">
          {(["all", "active"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend matches Ads Manager for the window <AttributionInfo compact />
        </span>
      </div>

      {/* Spend card */}
      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500">Spend</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{cur(totals.spend)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">Real, for the selected window</div>
        </div>
      </div>

      {/* Pacing strip */}
      {pacing.hasTrail && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm font-bold text-gray-900">Spend pacing</span>
            <span className="text-[11px] text-gray-400">· rolling 7 / 28-day, anchored to today</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <div className="text-[11px] text-gray-500">Today (so far)</div>
              {spendToday !== null ? (
                <>
                  <div className="text-xl font-bold text-blue-600">{cur(spendToday)}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">live · {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                </>
              ) : <div className="text-sm text-gray-400 mt-1">Loading…</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Last 7-day avg</div>
              <div className="text-xl font-bold text-gray-900">{cur(pacing.avg7d)}<span className="text-xs text-gray-400 font-normal">/day</span></div>
              {pacing.avg14d > 0 && <div className="text-[10px] text-gray-400 mt-0.5">prev 7d: {cur(pacing.avg14d)}/day</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Last 4-week avg</div>
              <div className="text-xl font-bold text-gray-900">{cur(pacing.avg28d * 7)}<span className="text-xs text-gray-400 font-normal">/wk</span></div>
              <div className="text-[10px] text-gray-400 mt-0.5">{cur(pacing.avg28d)}/day avg</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">6-month avg</div>
              {avg6mPerMonth !== null ? (
                <>
                  <div className="text-xl font-bold text-gray-900">{cur(avg6mPerMonth)}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
                  <div className="text-[10px] text-gray-400 mt-0.5">total spend last 182 days ÷ 6</div>
                </>
              ) : <div className="text-sm text-gray-400 mt-1">Loading…</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Weekly budget (setting)</div>
              <div className="text-xl font-bold text-gray-900">
                {budgetSetting.daily > 0 ? <>{cur(budgetSetting.daily * 7)}<span className="text-xs text-gray-400 font-normal">/wk</span></> : <span className="text-gray-400 text-sm">ad-set level</span>}
              </div>
              <div className="text-[10px] text-gray-400">live config × 7</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Pace (7d vs budget)</div>
              {pacing.pacePct !== null ? (
                <>
                  <div className={`text-xl font-bold ${pacing.pacePct > 110 ? "text-red-600" : pacing.pacePct < 70 ? "text-yellow-600" : "text-green-600"}`}>
                    {Math.round(pacing.pacePct)}%
                  </div>
                  <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    pacing.pacePct > 110 ? "bg-red-100 text-red-700" : pacing.pacePct < 70 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"
                  }`}>
                    {pacing.pacePct > 110 ? "Over budget" : pacing.pacePct < 70 ? "Under-pacing" : "On budget"}
                  </span>
                </>
              ) : <div className="text-sm text-gray-400">— no daily budget</div>}
            </div>
          </div>
        </div>
      )}

      {/* Budget setting reference */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">Current budget setting</span> (live config, not date-scoped):{" "}
        {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
        {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
        {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
        {budgetSetting.daily === 0 && budgetSetting.lifetime === 0 && <span className="text-gray-400">— budgets set at ad-set level</span>}
        <span className="text-gray-400"> · across active campaigns. This is the configured budget, not spend.</span>
      </div>

      {/* Spend table */}
      <SpendTable
        rows={rows}
        currency={currency}
        totalSpend={totals.spend}
        totalImpressions={totals.impressions}
        totalClicks={totals.clicks}
        totalCount={visible.length}
        isDemo={isDemo}
        platform="meta"
        spikeNotice={spikeNotice}
        subtitle="Real per-campaign delivery for the window — mirrors a Meta Ads Manager export."
      />

      {/* Drill tree */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → ad sets → ads</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        This is a spend report — every figure is real data Meta returns for the selected window (spend, impressions, clicks, results via the Insights API). The &ldquo;Budget (setting)&rdquo; column is the live configured budget, not a projection.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DV360 section — spend totals + campaign table (no daily trail API)
// ─────────────────────────────────────────────────────────────────────────────
function resolveDvWindow(range?: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

function DV360BudgetSection({ campaigns, currency, dateRange, customStart, customEnd }: { campaigns: CampaignData[]; currency: string; dateRange?: string; customStart?: string; customEnd?: string }) {
  const { dv360RefreshToken } = useAuthStore();
  const isDemo = !dv360RefreshToken || isDemoCredential(dv360RefreshToken);
  const cur = (n: number) => formatMoney(n, currency, 0);
  const dvWindow = useMemo(() => resolveDvWindow(dateRange, customStart, customEnd), [dateRange, customStart, customEnd]);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0, conversions = 0;
    for (const c of visible) {
      spend += c.spend || 0;
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      conversions += c.conversions || 0;
    }
    return { spend, impressions, clicks, conversions };
  }, [visible]);

  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const tip = computeDV360Tip(c, currency, dvWindow);
      return {
        c, name: c.name, status: c.status || "—",
        statusOrder: isActive(c) ? 0 : 1,
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions: c.impressions || 0, clicks: c.clicks || 0, tip, tipSeverity: tip.sevRank,
      };
    }),
    [visible, currency, dvWindow]
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200">
          {(["all", "active"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend from Bid Manager report for the selected window
        </span>
      </div>

      {/* Spend card */}
      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500">Spend</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{cur(totals.spend)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">Real, for the selected window</div>
        </div>
      </div>

      {/* Budget setting reference */}
      {(budgetSetting.daily > 0 || budgetSetting.lifetime > 0) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
          <span className="font-semibold text-gray-700">Current budget setting</span> (live config):{" "}
          {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
          {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
          {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
          <span className="text-gray-400"> · across active campaigns.</span>
        </div>
      )}

      {/* Spend table */}
      <SpendTable
        rows={rows}
        currency={currency}
        totalSpend={totals.spend}
        totalImpressions={totals.impressions}
        totalClicks={totals.clicks}
        totalCount={visible.length}
        isDemo={isDemo}
        platform="dv360"
        subtitle="Real per-campaign delivery from Bid Manager for the selected window."
      />

      {/* Drill tree */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → insertion orders → line items</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        Every figure is real data from the DV360 Bid Manager API for the selected window. Daily-spend pacing is not available for DV360 — use the DV360 UI for intraday pacing.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — renders per-platform sections
// ─────────────────────────────────────────────────────────────────────────────
export default function BudgetAllocationAudit({ campaigns, dateRange, customStart, customEnd, platform = "meta" }: AuditProps) {
  const metaCampaigns = campaigns.filter((c) => c.platform === "meta");
  const dv360Campaigns = campaigns.filter((c) => c.platform === "dv360");
  const metaCurrency = currencyFor(campaigns, "meta");
  const dv360Currency = currencyFor(campaigns, "dv360");

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        No campaigns in this window. Adjust the date range above, or connect an ad account.
      </div>
    );
  }

  const showMeta = (platform === "meta" || platform === "both") && metaCampaigns.length > 0;
  const showDV360 = (platform === "dv360" || platform === "both") && dv360Campaigns.length > 0;

  return (
    <div className="space-y-8">
      {showMeta && (
        <section>
          {showDV360 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-blue-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">Meta — Budget Allocation</h2>
            </div>
          )}
          <MetaBudgetSection campaigns={metaCampaigns} dateRange={dateRange} currency={metaCurrency} />
        </section>
      )}

      {showMeta && showDV360 && <hr className="border-gray-200" />}

      {showDV360 && (
        <section>
          {showMeta && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-emerald-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">DV360 — Budget Allocation</h2>
            </div>
          )}
          {!showMeta && platform === "dv360" && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-emerald-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">DV360 — Budget Allocation</h2>
            </div>
          )}
          <DV360BudgetSection campaigns={dv360Campaigns} currency={dv360Currency} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
        </section>
      )}
    </div>
  );
}
