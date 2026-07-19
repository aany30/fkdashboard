import { useState, useEffect, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { buildAccountContext, type AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { currencyFor, formatMoney } from "@/lib/currency";

// ─── date + formatting helpers ──────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function daysAgo(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Days since the most recent significant edit (the event that restarts
 * Meta's 7-day learning window). Reads `last_sig_edit_ts` from the real
 * `learning_stage_info` field on each ad set, falling back to `updated_time`.
 */
function daysSinceLastSigEdit(c: CampaignData): number | null {
  const adSets = c.adSets || [];
  let mostRecent = 0;
  for (const a of adSets) {
    if (a.lastSigEditTs && a.lastSigEditTs > mostRecent) mostRecent = a.lastSigEditTs;
  }
  let ms = mostRecent ? mostRecent * 1000 : 0;
  if (!ms && c.updatedTime) ms = new Date(c.updatedTime).getTime();
  if (!ms) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

// ─── classification ─────────────────────────────────────────────────────────

type Structure = "CBO" | "ABO" | "Unknown";

function classifyStructure(c: CampaignData): Structure {
  if (c.platform !== "meta") return "Unknown";
  if (c.budgetLevel === "campaign") return "CBO";
  if (c.budgetLevel === "adset") return "ABO";
  const hasAdSets = (c.adSets || []).some(
    (a) => a.status !== "DELETED" && a.status !== "ARCHIVED"
  );
  if (hasAdSets) return "ABO";
  if ((c.dailyBudget ?? 0) > 0 || (c.lifetimeBudget ?? 0) > 0) return "CBO";
  return "Unknown";
}

type LearningPhase = "Learning" | "Limited" | "Exited" | "ExitedLowSignal" | "Unknown";
type PhaseSource = "meta" | "inferred" | "unknown";

interface PhaseResult { phase: LearningPhase; source: PhaseSource; }

/**
 * Learning-phase classification with a real-data fallback.
 *
 * Path 1 (Meta-reported) — use `learning_stage_info` when present.
 *   LEARNING_LIMITED → Limited
 *   LEARNING         → Learning
 *   SUCCESS + <50/7d → Exited (low signal)  [client's "core question"]
 *   SUCCESS + ≥50/7d → Exited
 *
 * Path 2 (inferred) — when Meta omits `learning_stage_info`, derive from
 * the actual 7-day conversion count and how long the learning window has
 * been open (min of campaign age and days-since-last-significant-edit).
 *   ≥50 events                       → Exited      (hit the bar regardless)
 *   <50 events AND window < 7 days   → Learning   (window still open)
 *   <50 events AND window ≥ 7 days   → Limited    (window elapsed, didn't hit 50)
 *
 * Returns "Unknown" only when we genuinely have no signal at all
 * (no Meta status AND no 7d conversion data).
 */
function classifyLearningPhase(
  c: CampaignData,
  conversions7d: number | null,
  daysActive: number | null,
  daysSinceEdit: number | null
): PhaseResult {
  const liveAdSets = (c.adSets || []).filter(
    (a) => a.status !== "DELETED" && a.status !== "ARCHIVED" && a.status !== "PAUSED"
  );
  if (liveAdSets.length === 0) return { phase: "Unknown", source: "unknown" };

  // Path 1 — Meta-reported (most authoritative).
  const withStatus = liveAdSets.filter((a) => !!a.learningStatus);
  if (withStatus.length > 0) {
    const statuses = withStatus.map((a) => a.learningStatus);
    if (statuses.includes("LEARNING_LIMITED")) return { phase: "Limited", source: "meta" };
    if (statuses.includes("LEARNING")) return { phase: "Learning", source: "meta" };
    if (statuses.every((s) => s === "SUCCESS")) {
      if (conversions7d !== null && conversions7d < 50) return { phase: "ExitedLowSignal", source: "meta" };
      return { phase: "Exited", source: "meta" };
    }
    return { phase: "Unknown", source: "unknown" };
  }

  // Path 2 — inferred from 7d events + window age.
  if (conversions7d === null) return { phase: "Unknown", source: "unknown" };

  if (conversions7d >= 50) return { phase: "Exited", source: "inferred" };

  // The 7-day window starts at whichever is more recent: campaign launch or
  // last significant edit (which restarts the window). Use min of the two.
  const a = daysActive ?? Number.POSITIVE_INFINITY;
  const e = daysSinceEdit ?? Number.POSITIVE_INFINITY;
  const windowAge = Math.min(a, e);

  if (windowAge < 7) return { phase: "Learning", source: "inferred" };
  return { phase: "Limited", source: "inferred" };
}

const PHASE_LABEL: Record<LearningPhase, string> = {
  Learning: "Learning",
  Limited: "Limited",
  Exited: "Exited",
  ExitedLowSignal: "Exited (low signal)",
  Unknown: "—",
};

const PHASE_TONE: Record<LearningPhase, "pass" | "warn" | "info" | "fail"> = {
  Learning: "info",
  Limited: "warn",
  Exited: "pass",
  ExitedLowSignal: "warn",
  Unknown: "info",
};

// Meta optimization_goal → friendly event name + plain-English description.
const OPT_GOAL_LABEL: Record<string, string> = {
  OFFSITE_CONVERSIONS: "Conversion",
  CONVERSIONS: "Conversion",
  VALUE: "Purchase value",
  LEAD_GENERATION: "Lead",
  QUALITY_LEAD: "Quality lead",
  LINK_CLICKS: "Link click",
  LANDING_PAGE_VIEWS: "Landing-page view",
  APP_INSTALLS: "App install",
  REACH: "Reach",
  IMPRESSIONS: "Impression",
  THRUPLAY: "ThruPlay (video)",
  POST_ENGAGEMENT: "Post engagement",
  PAGE_LIKES: "Page like",
  EVENT_RESPONSES: "Event response",
  MESSAGING_PURCHASE_CONVERSION: "Messaging purchase",
  MESSAGING_APPOINTMENT_CONVERSION: "Messaging appointment",
  CONVERSATIONS: "Messaging conversation",
  AD_RECALL_LIFT: "Ad recall lift",
  VIDEO_VIEWS: "Video view",
};

/** Worst optimization_goal among live ad sets — defines what's being counted toward 50. */
function campaignOptimizationGoal(c: CampaignData): string | null {
  const live = (c.adSets || []).filter((a) => a.status === "ACTIVE" || a.status === "ENABLED");
  const goals = Array.from(new Set(live.map((a) => a.optimizationGoal).filter(Boolean) as string[]));
  if (goals.length === 0) return null;
  // If multiple, show the first — most campaigns have one consistent goal.
  return goals[0];
}

/** Most-restrictive bid cap among live ad sets (null if no manual cap). */
function campaignCostCap(c: CampaignData): { strategy: string; cap: number } | null {
  for (const a of c.adSets || []) {
    if (a.status !== "ACTIVE" && a.status !== "ENABLED") continue;
    const s = a.bidStrategy;
    if (!s) continue;
    if (s === "COST_CAP" || s === "BID_CAP" || s === "LOWEST_COST_WITH_BID_CAP") {
      if (a.bidAmount && a.bidAmount > 0) return { strategy: s, cap: a.bidAmount };
    }
  }
  return null;
}

// ─── stuck-reason logic — returns ALL applicable reasons from REAL data ────

interface Reason { severity: "high" | "medium"; text: string; }

interface Signals7d {
  conversions7d: number | null;
  reach7d: number | null;       // unique people reached in last 7 days
  frequency7d: number | null;   // impressions ÷ reach in last 7 days
  impressions7d: number | null;
  spend7d: number | null;
}

/** Compact integer formatter for unique-reach counts. */
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function whyStuck(
  c: CampaignData,
  signals: Signals7d,
  currency: string
): Reason[] {
  const reasons: Reason[] = [];
  const daysSinceEdit = daysSinceLastSigEdit(c);
  const daysActive = daysAgo(c.createdTime);
  const conv7d = signals.conversions7d;

  // Real signals — computed up front so the events bullet can name the cause.
  const reach = signals.reach7d ?? 0;
  const freq = signals.frequency7d ?? 0;
  const impr = signals.impressions7d ?? 0;
  const spent7d = signals.spend7d ?? 0;
  const cap0 = campaignCostCap(c);
  const spendW = c.spend ?? 0;
  const convW = c.conversions ?? 0;
  const cpa0 = convW > 0 ? spendW / convW : null;
  const daily0 = c.dailyBudget;
  const requiredWeekly0 = cpa0 !== null ? cpa0 * 50 : null;

  /** Best single explanation for WHY events are below 50, from the data we have. */
  const likelyCause = (): string => {
    if (freq >= 3.5 && reach > 0)
      return `likely the audience is too small — frequency ${freq.toFixed(1)}× on only ${fmtCount(reach)} unique reach, so Meta keeps re-showing the same people. Broaden targeting or add lookalikes.`;
    if (cap0 && cpa0 !== null && cap0.cap < cpa0 * 0.9)
      return `likely the ${cap0.strategy === "COST_CAP" ? "cost cap" : "bid cap"} ${formatMoney(cap0.cap, currency)} is below the real CPA of ${formatMoney(cpa0, currency)} — raise it or switch to "Lowest cost".`;
    if (cpa0 !== null && daily0 && daily0 > 0 && daily0 * 7 < (requiredWeekly0 ?? 0) * 0.9)
      return `likely the budget is too low — at the current ${formatMoney(cpa0, currency)} CPA you'd need ~${formatMoney(requiredWeekly0!, currency)}/week (${formatMoney(Math.ceil((requiredWeekly0!) / 7), currency)}/day) to reach 50.`;
    if (reach > 0 && reach < 20_000)
      return `likely the audience is narrow — only ${fmtCount(reach)} people reached in 7 days. Broaden targeting to give Meta more room.`;
    return `likely audience size, budget, or bid cap is limiting delivery — check the ad-set's audience definition and budget.`;
  };

  // 1. Recent edit (highest priority — wipes prior learning progress)
  if (daysSinceEdit !== null && daysSinceEdit < 7) {
    const when = daysSinceEdit === 0 ? "today" : `${daysSinceEdit} day${daysSinceEdit === 1 ? "" : "s"} ago`;
    const left = 7 - daysSinceEdit;
    reasons.push({
      severity: "high",
      text: `A significant edit ${when} restarted the 7-day learning window — that reset progress toward the 50 events. Avoid editing budget (>20%), audience, bid strategy, or creative for the next ${left} day${left === 1 ? "" : "s"} so it can re-stabilise.`,
    });
  }

  // 2. Conversion count signals — ALWAYS name the probable cause.
  if (conv7d === 0 && (daysActive ?? 0) >= 3) {
    reasons.push({
      severity: "high",
      text: `Zero conversion events in the last 7 days — ${likelyCause()} Also verify the pixel/CAPI is firing this event.`,
    });
  } else if (conv7d !== null && conv7d > 0 && conv7d < 50) {
    reasons.push({
      severity: "high",
      text: `Only ${Math.round(conv7d)} / 50 events in the last 7 days (Meta needs 50 to exit learning) — ${likelyCause()}`,
    });
  }

  if (freq >= 5 && reach > 0) {
    reasons.push({
      severity: "high",
      text: `Audience too small — frequency ${freq.toFixed(1)}× over 7 days (each user saw the ad ~${freq.toFixed(1)} times). Reach was only ${fmtCount(reach)} unique people. Broaden targeting (remove narrow interest/age filters) or add lookalikes.`,
    });
  } else if (freq >= 3.5 && reach > 0 && reach < 50_000) {
    reasons.push({
      severity: "medium",
      text: `Audience saturating — frequency ${freq.toFixed(1)}× on ${fmtCount(reach)} unique reach in 7 days. Consider broadening targeting before fatigue sets in.`,
    });
  }

  // 4. DELIVERY THROTTLED — high spend but low reach = Meta can't find users.
  //    If spend > 0 but daily-impression rate is very low for the spend,
  //    targeting is likely impossibly narrow.
  if (spent7d > 0 && impr > 0) {
    const dailyImpr = impr / 7;
    // Rough heuristic — at industry-typical ₹50–₹500 CPM, ₹X spend should
    // produce roughly X×2 to X×20 impressions per day. If daily impressions
    // are < 1% of weekly spend, Meta is struggling to deliver.
    const expectedDailyMin = (spent7d / 7) * 2; // ₹500 CPM = 2 impr/₹
    if (dailyImpr < expectedDailyMin * 0.1 && spent7d > 1000) {
      reasons.push({
        severity: "high",
        text: `Delivery throttled — only ${fmtCount(dailyImpr)} impressions/day on ${formatMoney(spent7d / 7, currency)}/day spend. Meta isn't finding enough matching users — audience definition is likely too narrow.`,
      });
    }
  }

  // 5. Cost / bid cap too tight vs actual CPA
  const cap = campaignCostCap(c);
  const spend = c.spend ?? 0;
  const conv = c.conversions ?? 0;
  const currentCpa = conv > 0 ? spend / conv : null;
  if (cap && currentCpa !== null && cap.cap < currentCpa * 0.9) {
    reasons.push({
      severity: "high",
      text: `${cap.strategy === "COST_CAP" ? "Cost cap" : "Bid cap"} ${formatMoney(cap.cap, currency)} is below the actual CPA of ${formatMoney(currentCpa, currency)} — Meta can't deliver enough at that price. Raise the cap or switch to "Lowest cost without cap".`,
    });
  }

  // 6. Daily budget too tight to ever hit 50/week at current CPA
  const daily = c.dailyBudget;
  if (currentCpa !== null && daily && daily > 0) {
    const weeklyBudget = daily * 7;
    const required = currentCpa * 50;
    if (weeklyBudget < required * 0.9) {
      reasons.push({
        severity: "medium",
        text: `Weekly budget ${formatMoney(weeklyBudget, currency)} is below the ${formatMoney(required, currency)} needed to hit 50 events at the current CPA (${formatMoney(currentCpa, currency)}). Raise daily budget to at least ${formatMoney(Math.ceil(required / 7), currency)}.`,
      });
    }
  }

  return reasons;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function LearningPhaseAudit({ campaigns }: AuditProps) {
  const { metaAccessToken } = useAuthStore();
  const currency = currencyFor(campaigns, "meta");

  // Active-only filter (client pointer #9).
  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => {
      const s = (c.status ?? "").toUpperCase();
      return s === "ACTIVE" || s === "ENABLED";
    }),
    [campaigns]
  );

  // Fetch real 7-day signals (conversions + reach + frequency) for the active
  // Meta campaigns. Reach/frequency power the "audience too small" diagnostics.
  const [last7d, setLast7d] = useState<Record<string, {
    conversions7d: number;
    conversionValue7d: number;
    reach7d: number;
    frequency7d: number;
    impressions7d: number;
    spend7d: number;
  }>>({});
  const [last7dLoading, setLast7dLoading] = useState(false);
  useEffect(() => {
    if (!metaAccessToken) return;
    const ids = activeCampaigns.filter((c) => c.platform === "meta" && !(c.id in last7d)).map((c) => c.id);
    if (ids.length === 0) return;
    setLast7dLoading(true);
    fetch("/api/naming/campaigns/last7d-conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: ids }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.conversions) setLast7d((prev) => ({ ...prev, ...data.conversions }));
      })
      .catch(() => { /* silent — table just shows "—" for missing rows */ })
      .finally(() => setLast7dLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, activeCampaigns.map((c) => c.id).join(",")]);

  // Per-campaign rows
  const rows = useMemo(() => {
    return activeCampaigns.map((c) => {
      const sig = last7d[c.id];
      const conv7d = sig?.conversions7d ?? null;
      const signals: Signals7d = {
        conversions7d: conv7d,
        reach7d: sig?.reach7d ?? null,
        frequency7d: sig?.frequency7d ?? null,
        impressions7d: sig?.impressions7d ?? null,
        spend7d: sig?.spend7d ?? null,
      };
      const daysSinceEdit = daysSinceLastSigEdit(c);
      const daysActive = daysAgo(c.createdTime);
      const { phase, source } = classifyLearningPhase(c, conv7d, daysActive, daysSinceEdit);
      return {
        campaign: c,
        phase,
        phaseSource: source,
        structure: classifyStructure(c),
        daysSinceEdit,
        daysActive,
        startDate: c.createdTime || "",
        conv7d,
        reach7d: sig?.reach7d ?? null,
        frequency7d: sig?.frequency7d ?? null,
        optGoal: campaignOptimizationGoal(c),
        reasons: whyStuck(c, signals, currency),
        // sort keys
        phaseOrder: { Limited: 0, ExitedLowSignal: 1, Learning: 2, Exited: 3, Unknown: 4 }[phase],
        conv7dSort: conv7d ?? -1,
      };
    });
  }, [activeCampaigns, last7d, currency]);

  const { sorted: sortedRows, sort: lpSort, toggle: lpToggle } = useSort(rows, "phaseOrder", "asc");

  // KPI summary
  const learningCount = rows.filter((r) => r.phase === "Learning").length;
  const limitedCount = rows.filter((r) => r.phase === "Limited" || r.phase === "ExitedLowSignal").length;
  const exitedCount = rows.filter((r) => r.phase === "Exited").length;

  // CBO / ABO summary row
  const cboRows = rows.filter((r) => r.structure === "CBO");
  const aboRows = rows.filter((r) => r.structure === "ABO");
  const phaseBreakdown = (subset: typeof rows) => ({
    learning: subset.filter((r) => r.phase === "Learning").length,
    limited: subset.filter((r) => r.phase === "Limited" || r.phase === "ExitedLowSignal").length,
    exited: subset.filter((r) => r.phase === "Exited").length,
  });
  const cboBreakdown = phaseBreakdown(cboRows);
  const aboBreakdown = phaseBreakdown(aboRows);

  // Activity Log deep link (campaign-level). Falls back to ad accounts list.
  const activityLogUrl = "https://business.facebook.com/adsmanager/audit_log";

  return (
    <div className="space-y-4">
      {/* Active-only header */}
      <div className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{activeCampaigns.length}</span> of{" "}
        <span className="font-semibold text-gray-900">{campaigns.length}</span> campaigns currently serving
        {campaigns.length > activeCampaigns.length && (
          <span className="text-gray-500"> · {campaigns.length - activeCampaigns.length} paused/archived hidden</span>
        )}
      </div>

      {/* KPIs — exactly 3, no "Out of learning" */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="In Learning" value={learningCount} subLabel="Still inside Meta's 7-day window" />
        <KpiCard
          label="Limited / Stuck"
          value={limitedCount}
          subLabel="Below 50 events / 7 days or capped exit"
          tone={limitedCount > 0 ? "warn" : "good"}
          fixContext={{
            metric: "learning_limited",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Learning Phase",
              siblingMetrics: { "In Learning": learningCount, Limited: limitedCount, Exited: exitedCount, CBO: cboRows.length, ABO: aboRows.length },
            },
          }}
        />
        <KpiCard label="Exited" value={exitedCount} subLabel="Hit 50 events — algorithm stabilised" tone={exitedCount > 0 ? "good" : "default"} />
      </div>

      {/* CBO/ABO compact summary */}
      {(cboRows.length > 0 || aboRows.length > 0) && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-xs">
          <div className="font-semibold text-gray-700 mb-2">Structure breakdown (currently serving)</div>
          <div className="space-y-1">
            {cboRows.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[11px]">CBO</span>
                <span className="text-gray-700">{cboRows.length} campaigns</span>
                <span className="text-gray-400">·</span>
                <span className="text-blue-700">Learning: {cboBreakdown.learning}</span>
                <span className="text-yellow-700">Limited: {cboBreakdown.limited}</span>
                <span className="text-green-700">Exited: {cboBreakdown.exited}</span>
              </div>
            )}
            {aboRows.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-bold text-[11px]">ABO</span>
                <span className="text-gray-700">{aboRows.length} campaigns ({aboRows.reduce((s, r) => s + (r.campaign.adSets?.length ?? 0), 0)} ad sets)</span>
                <span className="text-gray-400">·</span>
                <span className="text-blue-700">Learning: {aboBreakdown.learning}</span>
                <span className="text-yellow-700">Limited: {aboBreakdown.limited}</span>
                <span className="text-green-700">Exited: {aboBreakdown.exited}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <AuditCard
        title="Per Campaign — currently serving only"
        description="Active campaigns scored against Meta's 50-events / 7-day rule. Reasons + budget targets are derived from live Insights data."
      >
        {last7dLoading && rows.some((r) => r.conv7d === null) && (
          <div className="text-[11px] text-gray-500 mb-2 px-1">Loading 7-day conversion counts from Meta…</div>
        )}
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="campaign" sort={lpSort} onToggle={lpToggle} className="px-3 py-2 min-w-[200px]">Campaign</SortTh>
                <SortTh col="structure" sort={lpSort} onToggle={lpToggle} className="px-3 py-2" align="center">Structure</SortTh>
                <SortTh col="optGoal" sort={lpSort} onToggle={lpToggle} className="px-3 py-2">Optimisation goal</SortTh>
                <SortTh col="startDate" sort={lpSort} onToggle={lpToggle} className="px-3 py-2 whitespace-nowrap">Started</SortTh>
                <SortTh col="daysSinceEdit" sort={lpSort} onToggle={lpToggle} className="px-3 py-2 whitespace-nowrap" align="center">Days since edit</SortTh>
                <SortTh col="conv7dSort" sort={lpSort} onToggle={lpToggle} className="px-3 py-2 whitespace-nowrap" align="center">Events 7d / 50</SortTh>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">Budget (week)</th>
                <SortTh col="phaseOrder" sort={lpSort} onToggle={lpToggle} className="px-3 py-2" align="center">Phase</SortTh>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 min-w-[280px]">Why &amp; Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No currently-serving campaigns. Paused/archived campaigns are hidden from this audit.
                  </td>
                </tr>
              ) : (
                sortedRows.slice(0, 50).map(({ campaign: c, phase, phaseSource, structure, daysSinceEdit, daysActive, conv7d, optGoal, reasons }) => {
                  // 50-event progress bar
                  const conv = conv7d ?? 0;
                  const progressPct = Math.min(100, Math.round((conv / 50) * 100));
                  const progressColor = conv >= 50 ? "bg-green-500" : conv >= 25 ? "bg-yellow-400" : "bg-red-400";
                  // Budget math
                  const daily = c.dailyBudget;
                  const spend = c.spend ?? 0;
                  const cConv = c.conversions ?? 0;
                  const cpa = cConv > 0 ? spend / cConv : null;
                  const weeklyBudget = daily ? daily * 7 : null;
                  const requiredWeekly = cpa !== null ? cpa * 50 : null;
                  const goalLabel = optGoal ? (OPT_GOAL_LABEL[optGoal] ?? optGoal) : "—";

                  return (
                    <tr
                      key={`${c.platform}-${c.id}`}
                      className={`border-b border-gray-100 hover:bg-gray-50 align-top ${
                        phase === "Limited" || phase === "ExitedLowSignal" ? "bg-yellow-50/40" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-gray-900 break-words max-w-[280px]" title={c.name}>{c.name}</td>

                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          structure === "CBO" ? "bg-blue-100 text-blue-700"
                            : structure === "ABO" ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>{structure}</span>
                      </td>

                      <td className="px-3 py-2.5 text-gray-700 text-xs">
                        {goalLabel}
                        {optGoal && optGoal !== goalLabel && (
                          <span className="block text-[10px] text-gray-400 font-mono">{optGoal}</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-gray-700 text-xs whitespace-nowrap">
                        {fmtDate(c.createdTime)}
                        {daysActive !== null && (
                          <span className="block text-[10px] text-gray-400">{daysActive} day{daysActive === 1 ? "" : "s"} ago</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-center text-xs">
                        {daysSinceEdit === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold ${
                              daysSinceEdit < 7 ? "bg-red-100 text-red-700"
                                : daysSinceEdit < 14 ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                            title={
                              daysSinceEdit < 7
                                ? "Edited within the last 7 days — learning window has restarted"
                                : "No recent significant edit"
                            }
                          >
                            {daysSinceEdit}d
                          </span>
                        )}
                      </td>

                      {/* Events 7d / 50 with progress bar */}
                      <td className="px-3 py-2.5 text-center">
                        {conv7d === null ? (
                          <span className="text-[11px] text-gray-400">—</span>
                        ) : (
                          <div className="inline-block min-w-[80px]">
                            <div className="text-[11px] font-semibold text-gray-900">{Math.round(conv7d)} / 50</div>
                            <div className="w-full h-1.5 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                              <div className={`h-full ${progressColor}`} style={{ width: `${progressPct}%` }} />
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Budget — actual weekly + required to hit 50 */}
                      <td className="px-3 py-2.5 text-xs">
                        {weeklyBudget !== null ? (
                          <div>
                            <div className="text-gray-700">
                              Actual: <span className="font-semibold">{formatMoney(weeklyBudget, currency)}</span>
                            </div>
                            {requiredWeekly !== null ? (
                              <div className={`text-[11px] ${weeklyBudget >= requiredWeekly * 0.9 ? "text-green-700" : "text-yellow-700"}`}>
                                {weeklyBudget >= requiredWeekly * 0.9 ? "✓" : "⚠"} Need:{" "}
                                <span className="font-semibold">{formatMoney(requiredWeekly, currency)}</span>
                                <span className="text-gray-400"> (CPA × 50)</span>
                              </div>
                            ) : (
                              <div className="text-[11px] text-gray-400">CPA unknown</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-center">
                        <StatusBadge status={PHASE_TONE[phase]} label={PHASE_LABEL[phase]} />
                        {phaseSource === "inferred" && phase !== "Unknown" && (
                          <div
                            className="text-[10px] text-gray-400 mt-0.5 italic"
                            title="Meta didn't return learning_stage_info — phase inferred from real 7-day event count + window age."
                          >
                            inferred
                          </div>
                        )}
                      </td>

                      {/* Reasons — ALL applicable, severity-ordered */}
                      <td className="px-3 py-2.5">
                        {phase === "Exited" ? (
                          <span className="text-xs text-green-700">✓ Exited learning — algorithm has stabilised.</span>
                        ) : phase === "Learning" && reasons.length === 0 ? (
                          <span className="text-xs text-gray-600">In learning — give it 7 days + ≥50 events before judging. Avoid significant edits until then.</span>
                        ) : phase === "Unknown" ? (
                          <span className="text-xs text-gray-500">Meta did not return <code className="font-mono text-[10px]">learning_stage_info</code> for this campaign&apos;s ad sets.</span>
                        ) : reasons.length === 0 ? (
                          <span className="text-xs text-gray-500">No specific blocker detected — check audience size in Ads Manager.</span>
                        ) : (
                          <ul className="space-y-1">
                            {reasons.map((r, i) => (
                              <li key={i} className="flex gap-1.5 text-xs leading-snug">
                                <span className={`shrink-0 font-bold ${r.severity === "high" ? "text-red-600" : "text-yellow-600"}`}>●</span>
                                <span className={r.severity === "high" ? "text-gray-800" : "text-gray-700"}>{r.text}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 50 && (
          <p className="text-xs text-gray-500 mt-2 px-4">Showing first 50 of {rows.length} active campaigns.</p>
        )}

        {/* Honest footer */}
        <div className="mt-4 px-4 pb-1 space-y-2 border-t border-gray-100 pt-3">
          <p className="text-[11px] text-gray-600 leading-relaxed">
            <strong>How this works —</strong> Meta exits a campaign from learning when an ad set hits <strong>50 optimisation events</strong>
            (of the type shown under &ldquo;Optimisation goal&rdquo;) in a rolling 7-day window. Events come from Meta&apos;s Insights API at
            <code className="font-mono text-[10px] mx-1">date_preset=last_7d</code> with the account&apos;s default attribution window.
          </p>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            <strong>Edit history —</strong> Meta exposes only the most-recent significant-edit timestamp via API
            (the &ldquo;Days since edit&rdquo; column). For the full change log, open your account&apos;s Activity Log:
            <a
              href={activityLogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 ml-1 text-blue-700 hover:text-blue-900 font-semibold"
            >
              Open Activity Log in Ads Manager <ExternalLink className="w-3 h-3" />
            </a>
          </p>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            <strong>Audience-size signals —</strong> derived from real Meta data: 7-day <em>frequency</em> (impressions ÷ reach)
            and unique <em>reach</em>. High frequency (≥3.5× over 7 days) on small reach = audience saturating;
            high frequency (≥5×) = audience clearly too small. Low daily impressions vs daily spend = delivery throttled
            (Meta can&apos;t find enough matching users). For the actual targeting spec, open the ad set in Ads Manager.
          </p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <strong>Phase marked &ldquo;inferred&rdquo; —</strong> Meta didn&apos;t return <code className="font-mono">learning_stage_info</code> for that campaign&apos;s ad sets,
            so the phase is derived from the real 7-day event count + days since the learning window started (whichever is more recent:
            campaign launch, or last significant edit). Logic: ≥50 events → Exited · &lt;50 events with window &lt;7 days → Learning · &lt;50 events with window ≥7 days → Limited.
          </p>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Phase shows &ldquo;—&rdquo; only when BOTH <code className="font-mono">learning_stage_info</code> AND 7-day event data are missing (rare — usually means token permissions issue or a brand-new campaign).
          </p>
        </div>
      </AuditCard>

    </div>
  );
}
