import { useState, useMemo, useEffect } from "react";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import CampaignDrillTree from "./CampaignDrillTree";
import AttributionInfo from "@/components/shared/AttributionInfo";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { detectCurrency, formatMoney } from "@/lib/currency";
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Sparkles, Loader2 } from "lucide-react";
import { toDisplayCredits } from "@/lib/ai-cost";
import { isDemoCredential } from "@/lib/demo-data";
/**
 * Budget Allocation = honest, date-range-scoped SPEND REPORT (Meta-export style).
 *
 * Shows ONLY data Meta actually returns for the selected window — real spend +
 * delivery metrics per campaign — plus the current budget SETTING as a labelled
 * reference. No projected "allocated" number, no Forecast, no Efficiency/Scaling
 * scores (all dropped — they weren't directly retrievable from Meta).
 *
 * The window is owned by the parent (AccountStructureTab's editable date range);
 * the `campaigns` prop already carries spend/impressions/clicks/conversions
 * scoped to that window via the reliable Insights edge.
 */

function fmtInt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Per-row AI recommendation ────────────────────────────────────────────────
// Calls /api/ai/chat with this campaign's real snapshot + the static finding
// already on the row. Returns 2–4 concrete next steps tailored to THIS campaign.
const AI_RECO_ESTIMATE = `~${toDisplayCredits(0.0018).toFixed(2)}`;

interface RowAiRecoProps {
  campaignContext: Record<string, unknown>;
  findingLabel: string;
  findingDetail: string;
  isDemo: boolean;
}

function RowAiReco({ campaignContext, findingLabel, findingDetail, isDemo }: RowAiRecoProps) {
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
        body: JSON.stringify({ question, context: campaignContext, platform: "meta", isDemo }),
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

export default function BudgetAllocationAudit({ campaigns, dateRange, platform = "meta" }: AuditProps) {
  const { alertEmail, setAlertEmail, monthlyBudget, setMonthlyBudget, metaAccessToken, metaBusinessId } = useAuthStore();
  const currency = detectCurrency(campaigns);
  const isDemo = !metaAccessToken || isDemoCredential(metaAccessToken);

  // ── Rolling daily-spend trail → real 7d / 4w averages (pacing strip) ──────
  // Reliable account-level Insights edge (level=campaign&time_increment=1) via
  // the daily-trail endpoint. Averages use a GLOBAL anchor (max date across all
  // campaigns) so paused campaigns don't leak old spend into recent windows.
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
      .catch(() => { /* silent — pacing strip shows "—" */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId, campaigns.map((c) => c.id).join(",")]);

  // ── 6-month total spend → avg per month ─────────────────────────────────────
  // One call to /api/naming/campaigns/meta with a fixed 182-day window (≈6 months).
  // Each campaign's c.spend sums to its 6-month total; divide by 6 for avg/month.
  const [spend6m, setSpend6m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setDate(today.getDate() - 182);
    const startDate = sixMonthsAgo.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => {
        if (!Array.isArray(data)) return;
        const total = data.reduce((s, c) => s + (c.spend || 0), 0);
        setSpend6m(total);
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  const avg6mPerMonth = spend6m !== null ? spend6m / 6 : null;

  // ── Today's spend so far — live partial-day total from Meta ────────────────
  // The daily trail uses date_preset=last_28d which EXCLUDES today, so the 7-day
  // avg only covers completed days. This tile shows what's been spent so far
  // today across all active campaigns, refreshed alongside the page.
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
      .then((data: CampaignData[]) => {
        if (!Array.isArray(data)) return;
        setSpendToday(data.reduce((s, c) => s + (c.spend || 0), 0));
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  // ── Last-3-month fetch → derive "prev 3 months" without an extra call ───────
  // recent3m = last 91 days spend; prior3m = 6m total − recent3m (days 92–182).
  const [spend3m, setSpend3m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setDate(today.getDate() - 91);
    const startDate = threeMonthsAgo.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => {
        if (!Array.isArray(data)) return;
        setSpend3m(data.reduce((s, c) => s + (c.spend || 0), 0));
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  // Month-over-month: last 3m avg vs prior 3m avg (from the same 6m total).
  // Guard: only show when prior 3m had meaningful spend (≥ ₹10k) — otherwise
  // if the account was new/inactive in months 4-6, the % becomes absurdly large
  // (e.g. prior spend ₹100 → +157793%) which misleads rather than informs.
  const mom3m = useMemo(() => {
    if (spend3m === null || spend6m === null || spend6m <= 0) return null;
    const recent3mAvg = spend3m / 3;
    const prior3mTotal = spend6m - spend3m;
    if (prior3mTotal < 10_000) return null; // prior 3m too low to give meaningful %
    const prior3mAvg = prior3mTotal / 3;
    const delta = ((recent3mAvg - prior3mAvg) / prior3mAvg) * 100;
    // Also cap at ±999% — if it's still that extreme, something is off
    if (Math.abs(delta) > 999) return null;
    return { delta, recent3mAvg, prior3mAvg };
  }, [spend3m, spend6m]);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [budgetDraft, setBudgetDraft] = useState<string>(monthlyBudget ? String(monthlyBudget) : "");
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState("");

  const isActive = (c: CampaignData) => {
    const s = (c.status || "").toUpperCase();
    return s === "ACTIVE" || s === "ENABLED";
  };

  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  // ── Real window totals (everything below is straight from Meta Insights) ──
  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0;
    for (const c of visible) {
      spend += c.spend || 0;
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      conversions += c.conversions || 0;
      convValue += c.conversionValue || 0;
    }
    return {
      spend, impressions, clicks, conversions, convValue,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpr: conversions > 0 ? spend / conversions : 0,
    };
  }, [visible]);

  // Current budget SETTING (config snapshot, NOT date-scoped, NOT projected).
  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  // Account-level pacing — ACTIVE campaigns only so numerator and denominator
  // cover the same set. Inactive campaigns that had recent spend must not inflate
  // avg7d while their budgets are absent from budgetSetting.daily.
  const pacing = useMemo(() => {
    const activeCampaigns = visible.filter(isActive);
    let avg7d = 0, avg14d = 0, avg28d = 0;
    for (const c of activeCampaigns) {
      const t = trail[c.id];
      if (t) { avg7d += t.avg7d; avg14d += t.avg14d; avg28d += t.avg28d; }
    }
    // wow = current 7d vs prior 7d — both windows come directly from Meta daily trail
    const wow = avg14d > 0 ? ((avg7d - avg14d) / avg14d) * 100 : null;
    const pacePct = budgetSetting.daily > 0 ? (avg7d / budgetSetting.daily) * 100 : null;
    const hasTrail = activeCampaigns.some((c) => c.id in trail);
    return { avg7d, avg14d, avg28d, wow, pacePct, hasTrail };
  }, [visible, trail, budgetSetting.daily]);

  // Month-over-month proxy from the 28-day trail — no extra API call.
  // Split 28d into two 14-day halves and compare as monthly-rate equivalents.
  const mom = useMemo(() => {
    let recent14Sum = 0, prior14Sum = 0, count = 0;
    for (const c of visible) {
      const t = trail[c.id];
      if (!t) continue;
      recent14Sum += t.avg7d * 7 + t.avg14d * 7;
      prior14Sum += t.avg28d * 28 - (t.avg7d * 7 + t.avg14d * 7);
      count++;
    }
    if (count === 0 || prior14Sum <= 0) return null;
    const recentMonthly = (recent14Sum / 14) * 30;
    const priorMonthly = (prior14Sum / 14) * 30;
    const delta = ((recentMonthly - priorMonthly) / priorMonthly) * 100;
    return { delta };
  }, [visible, trail]);

  // Per-campaign tip computation — every row gets a tip (no empty cells).
  // Derived from the existing trail (avg7d, avg14d, avg28d) + dailyBudget setting.
  type TipKind = "spike" | "noDelivery" | "overPacing" | "underPacing" | "healthy" | "paused" | "adSetLevel" | "noBudgetTrail";
  type Tip = {
    kind: TipKind;
    severity: "high" | "medium" | "info" | "good";
    label: string;
    detail: string;
    isSpike: boolean;
    sevRank: number; // 3=high, 2=med, 1=info, 0=good (sort desc → critical on top)
  };
  const computeTip = (c: CampaignData): Tip => {
    const active = isActive(c);

    // Paused / non-Meta short-circuits get a friendly status tip rather than "—".
    if (!active) {
      return {
        kind: "paused",
        severity: "info",
        label: "Paused",
        detail: "Campaign is not currently delivering. No live spend to assess.",
        isSpike: false,
        sevRank: 1,
      };
    }
    if (c.platform !== "meta") {
      return {
        kind: "noBudgetTrail",
        severity: "info",
        label: "—",
        detail: "Daily-spend trail isn't available for this platform.",
        isSpike: false,
        sevRank: 1,
      };
    }
    const t = trail[c.id];
    if (!t) {
      return {
        kind: "noBudgetTrail",
        severity: "info",
        label: "Loading…",
        detail: "Fetching last 28 days of daily spend.",
        isSpike: false,
        sevRank: 1,
      };
    }
    const { avg7d, avg14d, avg28d } = t;

    // 1. Budget spike — last 7d > 25% above prior 7d
    if (avg14d > 0 && avg7d / avg14d > 1.25) {
      const pct = ((avg7d - avg14d) / avg14d) * 100;
      return {
        kind: "spike",
        severity: "high",
        label: "Budget spike",
        detail: `${formatMoney(avg7d, currency, 0)}/day this week vs ${formatMoney(avg14d, currency, 0)}/day prior · +${Math.round(pct)}%. Verify this was intentional.`,
        isSpike: true,
        sevRank: 3,
      };
    }

    // 2. Zero delivery on active campaign
    if (avg7d === 0 && avg28d > 0) {
      return {
        kind: "noDelivery",
        severity: "high",
        label: "No delivery",
        detail: "Active but zero spend in the last 7 days. Check ad approvals, audience, or pixel firing.",
        isSpike: false,
        sevRank: 3,
      };
    }

    // 3. Ad-set-level budget — no campaign budget to compare against
    if (!c.dailyBudget || c.dailyBudget <= 0) {
      return {
        kind: "adSetLevel",
        severity: "info",
        label: "Ad-set budgets",
        detail: `Budget is set at the ad-set level (ABO). Currently averaging ${formatMoney(avg7d, currency, 0)}/day across all ad sets.`,
        isSpike: false,
        sevRank: 1,
      };
    }

    // 4. Over-pacing — spending >10% above daily budget
    if (avg7d / c.dailyBudget > 1.10) {
      const pct = ((avg7d - c.dailyBudget) / c.dailyBudget) * 100;
      return {
        kind: "overPacing",
        severity: "medium",
        label: "Over-pacing",
        detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · +${Math.round(pct)}%. Within Meta tolerance — watch trend.`,
        isSpike: false,
        sevRank: 2,
      };
    }

    // 5. Under-pacing — spending <70% of daily budget
    if (avg7d > 0 && avg7d < c.dailyBudget * 0.70) {
      const pct = (avg7d / c.dailyBudget) * 100;
      return {
        kind: "underPacing",
        severity: "medium",
        label: "Under-pacing",
        detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · ${Math.round(pct)}% of cap. Consider lowering budget or check delivery limits.`,
        isSpike: false,
        sevRank: 2,
      };
    }

    // 6. Healthy — on-pace, no issues. The good-news bucket.
    const pct = c.dailyBudget > 0 ? (avg7d / c.dailyBudget) * 100 : 100;
    return {
      kind: "healthy",
      severity: "good",
      label: "On pace",
      detail: `Spending ${formatMoney(avg7d, currency, 0)}/day · ${Math.round(pct)}% of the ${formatMoney(c.dailyBudget, currency, 0)}/day budget. No action needed.`,
      isSpike: false,
      sevRank: 0,
    };
  };

  // Per-campaign rows for the Meta-export table.
  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const impressions = c.impressions || 0;
      const clicks = c.clicks || 0;
      const conversions = c.conversions || 0;
      const active = isActive(c);
      const tip = computeTip(c);
      return {
        c,
        name: c.name,
        status: c.status || "—",
        // statusOrder: 0 = active first, 1 = paused/other — primary sort key
        statusOrder: active ? 0 : 1,
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions, clicks, conversions,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        results: conversions,
        cpr: conversions > 0 ? spend / conversions : 0,
        tip,
        tipSeverity: tip.sevRank,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, trail, currency]
  );
  // Auto-send budget-spike emails — once per campaign per ISO week.
  const [spikeNotice, setSpikeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!alertEmail) return;
    const spikes = rows.filter((r) => r.tip.isSpike);
    if (spikes.length === 0) return;
    // ISO year-week key — naturally rolls over weekly so persistent spikes
    // re-fire next week at most once.
    const now = new Date();
    const yr = now.getUTCFullYear();
    const startOfYear = Date.UTC(yr, 0, 1);
    const wk = Math.ceil(((now.getTime() - startOfYear) / 86_400_000 + new Date(startOfYear).getUTCDay() + 1) / 7);
    const weekKey = `${yr}-W${String(wk).padStart(2, "0")}`;
    const toSend: typeof spikes = [];
    const dedupKeys: string[] = [];
    for (const r of spikes) {
      const k = `spike:${r.c.id}:${weekKey}`;
      try {
        if (localStorage.getItem(k)) continue;
      } catch { /* ignore */ }
      toSend.push(r);
      dedupKeys.push(k);
    }
    if (toSend.length === 0) return;
    // Format as CriticalCampaign entries for the existing /api/alerts/budget endpoint.
    const payload = {
      recipient: alertEmail,
      periodLabel: "Budget spike alert",
      campaigns: toSend.map((r) => {
        const t = trail[r.c.id];
        const avg7 = t?.avg7d ?? 0;
        const avg14 = t?.avg14d ?? 0;
        const pct = avg14 > 0 ? Math.round(((avg7 - avg14) / avg14) * 100) : 0;
        return {
          name: r.c.name,
          objective: r.c.objective,
          budget: avg14, // prior-week daily avg, as the "baseline"
          spend: avg7,   // this-week daily avg, as the "current"
          spendPct: pct + 100, // express as "% of prior" for the email column
          currency,
          status: `Budget spike (+${pct}%)`,
        };
      }),
    };
    fetch("/api/alerts/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, status, data }) => {
        if (ok && data?.sent) {
          // Mark dedup ONLY on successful send — failures stay re-tryable.
          for (const k of dedupKeys) {
            try { localStorage.setItem(k, "1"); } catch { /* ignore */ }
          }
          setSpikeNotice(`✓ Sent budget-spike alert for ${toSend.length} campaign(s) to ${alertEmail}`);
          setTimeout(() => setSpikeNotice(null), 8000);
        } else {
          // Surface the actual error so the user knows why no email arrived.
          const msg = data?.error || `HTTP ${status}`;
          setSpikeNotice(`⚠ Couldn't send alert: ${msg}`);
          setTimeout(() => setSpikeNotice(null), 12000);
        }
      })
      .catch((e) => {
        setSpikeNotice(`⚠ Couldn't send alert: ${e instanceof Error ? e.message : "network error"}`);
        setTimeout(() => setSpikeNotice(null), 12000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, alertEmail]);

  // Default: active campaigns first, then paused, within each group by spend desc.
  const { sorted: rawSorted, sort, toggle } = useSort(rows, "statusOrder", "asc");
  // When sorting by status, keep the status grouping with spend as the in-group
  // tiebreaker. For every other column, respect the user's chosen sort as-is.
  const sorted = useMemo(() => {
    if (sort.col !== "statusOrder") return rawSorted;
    return [...rows].sort((a, b) =>
      a.statusOrder !== b.statusOrder
        ? (sort.dir === "asc" ? a.statusOrder - b.statusOrder : b.statusOrder - a.statusOrder)
        : b.spend - a.spend
    );
  }, [rawSorted, rows, sort.col, sort.dir]);

  const cur = (n: number) => formatMoney(n, currency, 0);

  // ── Email the spend summary (top spenders) via the existing alerts endpoint ──
  const handleSend = async () => {
    const email = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSendStatus("error"); setSendMessage("Enter a valid email address.");
      return;
    }
    const spenders = [...rows].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
    if (spenders.length === 0) {
      setSendStatus("error"); setSendMessage("No spend in this window to report.");
      return;
    }
    setAlertEmail(email);
    setSendStatus("sending"); setSendMessage("");
    try {
      const r = await fetch("/api/alerts/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: email,
          periodLabel: "Spend report",
          campaigns: spenders.map((s) => ({
            name: s.name, objective: s.objective,
            budget: s.budget, spend: s.spend,
            spendPct: s.budget > 0 ? Math.round((s.spend / s.budget) * 100) : 0,
            currency: s.c.currency || currency,
            status: s.status,
          })),
        }),
      });
      const data = await r.json();
      if (r.ok && data.sent) { setSendStatus("sent"); setSendMessage(`Sent to ${email}.`); }
      else { setSendStatus("error"); setSendMessage(data.error || `HTTP ${r.status}`); }
    } catch (e) {
      setSendStatus("error"); setSendMessage(e instanceof Error ? e.message : String(e));
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        No campaigns in this window. Adjust the date range above, or connect an ad account.
      </div>
    );
  }

  // Summary metric tiles — Spend only per user request; delivery columns in table below.
  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Spend", value: cur(totals.spend), sub: "Real, for the selected window" },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar: status filter + attribution chip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200">
          {(["all", "active"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend matches Ads Manager for the window <AttributionInfo compact />
        </span>
      </div>

      {/* Summary row — real window totals */}
      <div className="grid grid-cols-1 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-[11px] text-gray-500">{t.label}</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{t.value}</div>
            {t.sub && <div className="text-[10px] text-gray-400 mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Pacing strip — REAL rolling averages from the daily-spend trail */}
      {pacing.hasTrail && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm font-bold text-gray-900">Spend pacing</span>
            <span className="text-[11px] text-gray-400">· rolling 7 / 28-day, anchored to today</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">

            {/* Today (so far) — live partial-day spend, separate from rolling avgs */}
            <div>
              <div className="text-[11px] text-gray-500">Today (so far)</div>
              {spendToday !== null ? (
                <>
                  <div className="text-xl font-bold text-blue-600">{cur(spendToday)}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">live · {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                </>
              ) : (
                <div className="text-sm text-gray-400 mt-1">Loading…</div>
              )}
            </div>

            {/* Last 7-day avg — per day, with comparison badge */}
            <div>
              <div className="text-[11px] text-gray-500">Last 7-day avg</div>
              <div className="text-xl font-bold text-gray-900">
                {cur(pacing.avg7d)}
                <span className="text-xs text-gray-400 font-normal">/day</span>
              </div>
              {pacing.avg14d > 0 && (
                <div className="text-[10px] text-gray-400 mt-0.5">prev 7d: {cur(pacing.avg14d)}/day</div>
              )}
            </div>

            {/* Last 4-week avg — shown as /week */}
            <div>
              <div className="text-[11px] text-gray-500">Last 4-week avg</div>
              <div className="text-xl font-bold text-gray-900">
                {cur(pacing.avg28d * 7)}
                <span className="text-xs text-gray-400 font-normal">/wk</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{cur(pacing.avg28d)}/day avg</div>
            </div>

            {/* 6-month avg — per month, with badge vs last-month estimate */}
            <div>
              <div className="text-[11px] text-gray-500">6-month avg</div>
              {avg6mPerMonth !== null ? (
                <>
                  <div className="text-xl font-bold text-gray-900">
                    {cur(avg6mPerMonth)}
                    <span className="text-xs text-gray-400 font-normal">/mo</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">total spend last 182 days ÷ 6</div>
                </>
              ) : (
                <div className="text-sm text-gray-400 mt-1">Loading…</div>
              )}
            </div>

            {/* Weekly budget setting */}
            <div>
              <div className="text-[11px] text-gray-500">Weekly budget (setting)</div>
              <div className="text-xl font-bold text-gray-900">
                {budgetSetting.daily > 0
                  ? <>{cur(budgetSetting.daily * 7)}<span className="text-xs text-gray-400 font-normal">/wk</span></>
                  : <span className="text-gray-400 text-sm">ad-set level</span>}
              </div>
              <div className="text-[10px] text-gray-400">live config × 7</div>
            </div>

            {/* Pace badge */}
            <div>
              <div className="text-[11px] text-gray-500">Pace (7d vs budget)</div>
              {pacing.pacePct !== null ? (
                <>
                  <div className={`text-xl font-bold ${pacing.pacePct > 110 ? "text-red-600" : pacing.pacePct < 70 ? "text-yellow-600" : "text-green-600"}`}>
                    {Math.round(pacing.pacePct)}%
                  </div>
                  <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    pacing.pacePct > 110 ? "bg-red-100 text-red-700"
                    : pacing.pacePct < 70 ? "bg-yellow-100 text-yellow-700"
                    : "bg-green-100 text-green-700"
                  }`}>
                    {pacing.pacePct > 110 ? "Over budget" : pacing.pacePct < 70 ? "Under-pacing" : "On budget"}
                  </span>
                </>
              ) : <div className="text-sm text-gray-400">— no daily budget</div>}
            </div>

          </div>
        </div>
      )}

      {/* Budget SETTING reference — explicitly NOT a projection */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">Current budget setting</span> (live config, not date-scoped):{" "}
        {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
        {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
        {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
        {budgetSetting.daily === 0 && budgetSetting.lifetime === 0 && <span className="text-gray-400">— budgets set at ad-set level</span>}
        <span className="text-gray-400"> · across active campaigns. This is the configured budget, not spend.</span>
      </div>

      {/* Per-campaign Meta-export table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Spend by campaign</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Real per-campaign delivery for the window — mirrors a Meta Ads Manager export.</p>
          {spikeNotice && (
            <div className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11px] font-semibold ${
              spikeNotice.startsWith("⚠")
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-green-50 border-green-200 text-green-700"
            }`}>
              {spikeNotice}
            </div>
          )}
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="name" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[200px]">Campaign</SortTh>
                <SortTh col="statusOrder" sort={sort} onToggle={toggle} className="px-4 py-2" align="center">Status</SortTh>
                <SortTh col="objective" sort={sort} onToggle={toggle} className="px-4 py-2">Objective</SortTh>
                <SortTh col="budget" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Budget (setting)</SortTh>
                <SortTh col="spend" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Spend</SortTh>
                <SortTh col="tipSeverity" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[300px]">Recommend</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.c.platform}-${r.c.id}`} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5 font-mono text-gray-900 break-words max-w-[280px]" title={r.name}>{r.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${isActive(r.c) ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {isActive(r.c) ? "Active" : r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 text-xs">{r.objective}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {r.budgetType === "none" ? <span className="text-gray-400">ad-set</span> : (
                      <>{cur(r.budget)}<span className="text-[10px] text-gray-400">/{r.budgetType === "daily" ? "day" : "life"}</span></>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{cur(r.spend)}</td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const t = r.tip;
                      // Visual tokens per severity
                      const styles = {
                        high:   { ring: "ring-red-200 bg-red-50",        pill: "bg-red-100 text-red-700",        Icon: AlertCircle,    iconClass: "text-red-600" },
                        medium: { ring: "ring-yellow-200 bg-yellow-50",  pill: "bg-yellow-100 text-yellow-700",  Icon: t.kind === "overPacing" ? TrendingUp : TrendingDown, iconClass: "text-yellow-600" },
                        good:   { ring: "ring-green-200 bg-green-50",    pill: "bg-green-100 text-green-700",    Icon: CheckCircle2,   iconClass: "text-green-600" },
                        info:   { ring: "ring-gray-200 bg-gray-50",      pill: "bg-gray-100 text-gray-600",      Icon: AlertCircle,    iconClass: "text-gray-400" },
                      }[t.severity];
                      const { Icon } = styles;
                      return (
                        <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ring-1 ${styles.ring}`}>
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${styles.iconClass}`} strokeWidth={2.2} />
                          <div className="min-w-0 flex-1">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles.pill}`}>
                              {t.label}
                            </span>
                            <div className="text-[11px] text-gray-600 leading-snug mt-1">{t.detail}</div>
                            {t.severity !== "info" && (
                              <RowAiReco
                                isDemo={isDemo}
                                findingLabel={t.label}
                                findingDetail={t.detail}
                                campaignContext={{
                                  name: r.name,
                                  status: r.status,
                                  objective: r.objective,
                                  dailyBudget: r.budget,
                                  budgetType: r.budgetType,
                                  spend: r.spend,
                                  impressions: r.c.impressions ?? 0,
                                  clicks: r.c.clicks ?? 0,
                                  conversions: r.c.conversions ?? 0,
                                  conversionValue: r.c.conversionValue ?? 0,
                                  ctr: (r.c.impressions ?? 0) > 0 ? ((r.c.clicks ?? 0) / (r.c.impressions ?? 1)) * 100 : null,
                                  cpa: (r.c.conversions ?? 0) > 0 ? r.spend / (r.c.conversions as number) : null,
                                  roas: r.spend > 0 ? (r.c.conversionValue ?? 0) / r.spend : null,
                                  avg7dSpendPerDay: trail[r.c.id]?.avg7d ?? null,
                                  avg14dSpendPerDay: trail[r.c.id]?.avg14d ?? null,
                                  avg28dSpendPerDay: trail[r.c.id]?.avg28d ?? null,
                                  currency,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr className="font-bold text-gray-900">
                <td className="px-4 py-2.5" colSpan={4}>Total ({visible.length} campaigns)</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{cur(totals.spend)}</td>
                <td className="px-4 py-2.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Campaign → ad set → ad drill (real hierarchy) */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → ad sets → ads</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      {/* Honest footer */}
      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        This is a spend report — every figure is real data Meta returns for the selected window{dateRange === "custom" ? "" : ""} (spend, impressions, clicks, results via the Insights API). The &ldquo;Budget (setting)&rdquo; column is the live configured budget, not a projection. Projected &ldquo;allocated&rdquo;, forecast, efficiency and scaling scores were removed because Meta doesn&apos;t return them directly.
      </p>

    </div>
  );
}
