import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { Sparkles, AlertCircle, CheckCircle2, AlertTriangle, Target } from "lucide-react";
import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import FunnelStagePerformance from "./FunnelStagePerformance";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";

// Common industries — quick-pick options for the AI funnel-mix analysis.
const INDUSTRY_SUGGESTIONS = [
  "E-commerce — Apparel",
  "E-commerce — Beauty & Skincare",
  "E-commerce — Consumer Electronics",
  "E-commerce — Home & Furniture",
  "DTC — Food & Beverage",
  "B2B SaaS",
  "B2C Mobile App",
  "Lead Generation — Finance",
  "Lead Generation — Insurance",
  "Lead Generation — Real Estate",
  "EdTech",
  "HealthTech",
  "Travel & Hospitality",
  "Marketplace",
];

interface FunnelMixAI {
  verdict: "healthy" | "warn" | "critical";
  summary: string;
  idealMix: { tof: number; mof: number; bof: number };
  stages: {
    tof: { status: "healthy" | "warn" | "critical"; note: string };
    mof: { status: "healthy" | "warn" | "critical"; note: string };
    bof: { status: "healthy" | "warn" | "critical"; note: string };
  };
  focusActions: Array<{ priority: number; action: string }>;
}

// Heuristic: bucket campaigns into TOF / MOF / BOF based on objective keywords
function bucket(objective?: string): "TOF" | "MOF" | "BOF" | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video") || o.includes("store")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration") || o.includes("link_click") || o.includes("link click") || o === "link_clicks") return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog") || o.includes("app")) return "BOF";
  return "Unknown";
}

// Friendly label + color for each Meta campaign status.
const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE:     { label: "Active",   color: "bg-green-100 text-green-700 border-green-300" },
  ENABLED:    { label: "Enabled",  color: "bg-blue-100 text-blue-700 border-blue-300" },
  PAUSED:     { label: "Paused",   color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  ARCHIVED:   { label: "Archived", color: "bg-gray-100 text-gray-500 border-gray-300" },
  DELETED:    { label: "Deleted",  color: "bg-red-100 text-red-600 border-red-300" },
  IN_PROCESS: { label: "In Process", color: "bg-purple-100 text-purple-700 border-purple-300" },
  WITH_ISSUES:{ label: "With Issues", color: "bg-orange-100 text-orange-700 border-orange-300" },
};

// The statuses we treat as "currently serving". Default scope across audits.
const ACTIVE_STATUSES = new Set(["ACTIVE", "ENABLED"]);

export default function FunnelSeparationAudit({ campaigns, accountTotal, dateRange, customStart, customEnd }: AuditProps) {
  // Detect distinct statuses present in this account's campaigns
  const availableStatuses = [...new Set(campaigns.map((c) => c.status?.toUpperCase()).filter(Boolean))].sort() as string[];

  // Default scope: ACTIVE + ENABLED only — matches the user's "what's running
  // right now" mental model. Power users can still tick PAUSED/ARCHIVED in the
  // filter UI to expand scope; that choice is sticky (no longer reset by
  // date-range changes, see the useEffect below).
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(() => {
    const activeAvailable = availableStatuses.filter((s) => ACTIVE_STATUSES.has(s));
    return new Set(activeAvailable.length > 0 ? activeAvailable : availableStatuses);
  });

  // When campaigns reload (e.g. date range changes), the set of AVAILABLE
  // statuses may shift — but the user's CHOICE must be preserved. Only ADD
  // brand-new active statuses we haven't seen; don't blow away existing picks.
  useEffect(() => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      // If the user has filtered down to specific statuses, leave them alone.
      // Only auto-add an active status if the entire current selection is the
      // default-on-load active set (i.e. user hasn't customised yet).
      const isDefaultActive =
        prev.size === 0 || ([...prev].every((s) => ACTIVE_STATUSES.has(s)) && prev.size > 0);
      if (isDefaultActive) {
        for (const s of availableStatuses) {
          if (ACTIVE_STATUSES.has(s)) next.add(s);
        }
      }
      // Drop statuses that no longer exist in the data so the filter stays valid.
      for (const s of prev) {
        if (!availableStatuses.includes(s)) next.delete(s);
      }
      return next;
    });
  }, [campaigns.map(c => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStatus = (s: string) =>
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  // Filter campaigns by selected statuses before counting
  const visibleCampaigns = selectedStatuses.size === 0 || selectedStatuses.size === availableStatuses.length
    ? campaigns
    : campaigns.filter((c) => selectedStatuses.has(c.status?.toUpperCase() ?? ""));

  const counts = { TOF: 0, MOF: 0, BOF: 0, Unknown: 0 };
  for (const c of visibleCampaigns) counts[bucket(c.objective)]++;

  // Denominator is the overall ad-account campaign count, not the filtered
  // subset — so each stage reads as "N of <all account campaigns>".
  const total = accountTotal ?? visibleCampaigns.length;
  const present = Number(counts.TOF > 0) + Number(counts.MOF > 0) + Number(counts.BOF > 0);
  const segScore = total === 0 ? 0 : Math.round((present / 3) * 100);

  // ---------- AI funnel-mix analysis ----------
  // Opt-in: the panel starts collapsed as a CTA so the dashboard isn't cluttered
  // with an AI form for users who don't care about industry benchmarking.
  const { addAiCredits } = useAuthStore(); const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [industry, setIndustry] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<FunnelMixAI | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Compute per-stage spend / impression shares from the loaded campaigns so
  // the AI has more than just count distributions to reason about.
  const stageStats = (() => {
    const init = { campaigns: 0, spend: 0, impressions: 0 };
    const buckets: Record<"TOF" | "MOF" | "BOF" | "Unknown", typeof init> = {
      TOF: { ...init }, MOF: { ...init }, BOF: { ...init }, Unknown: { ...init },
    };
    let totalSpend = 0, totalImpr = 0;
    for (const c of campaigns) {
      const b = bucket(c.objective);
      buckets[b].campaigns += 1;
      buckets[b].spend += c.spend || 0;
      buckets[b].impressions += c.impressions || 0;
      totalSpend += c.spend || 0;
      totalImpr += c.impressions || 0;
    }
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
    const toStats = (k: "TOF" | "MOF" | "BOF") => ({
      campaignCount: buckets[k].campaigns,
      campaignPct: pct(buckets[k].campaigns, total),
      spendPct: pct(buckets[k].spend, totalSpend),
      impressionPct: pct(buckets[k].impressions, totalImpr),
    });
    return { tof: toStats("TOF"), mof: toStats("MOF"), bof: toStats("BOF") };
  })();

  const runAiAnalysis = async () => {
    if (!industry.trim()) {
      setAiError("Please enter your industry first.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const r = await fetch("/api/recommendations/funnel-mix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: industry.trim(),
          totalCampaigns: total,
          unclassifiedPct: total > 0 ? Math.round((counts.Unknown / total) * 100) : 0,
          tof: stageStats.tof,
          mof: stageStats.mof,
          bof: stageStats.bof,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setAiError(data.error || `HTTP ${r.status}`);
      } else {
        setAiResult(data as FunnelMixAI); if (data.creditsUsedUsd) addAiCredits(data.creditsUsedUsd);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAiLoading(false);
    }
  };

  const verdictTone = (v: "healthy" | "warn" | "critical") =>
    v === "healthy"
      ? { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", chip: "bg-green-100 text-green-800", Icon: CheckCircle2 }
      : v === "warn"
      ? { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", chip: "bg-yellow-100 text-yellow-800", Icon: AlertTriangle }
      : { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", chip: "bg-red-100 text-red-800", Icon: AlertCircle };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Segmentation Score"
          value={`${segScore}%`}
          subLabel="3 funnel stages represented"
          tone={segScore >= 66 ? "good" : segScore >= 33 ? "warn" : "bad"}
        />
        <KpiCard label="TOF / MOF / BOF" value={`${counts.TOF} / ${counts.MOF} / ${counts.BOF}`} subLabel="Campaign counts" />
        {/* Unclassified KPI removed — only TOF/MOF/BOF shown */}
      </div>

      <AuditCard
        title="Funnel Separation"
        description={`TOF/MOF/BOF segmentation across ${total} total campaign${total === 1 ? "" : "s"}`}
        badge={{ text: `Score ${segScore}`, color: segScore >= 66 ? "green" : segScore >= 33 ? "yellow" : "red" }}
      >
        {/* How we classify campaigns into funnel stages */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-gray-700 leading-relaxed">
          <div className="font-semibold text-blue-900 mb-1">How campaigns are bucketed</div>
          <TermText>
            Stages are defined by the bid-type the platform uses to charge you, which mirrors how
            far down the customer journey the user is:
          </TermText>
          <ul className="mt-1.5 space-y-0.5">
            <li>
              <span className="font-semibold text-gray-900">TOF</span> (Top of Funnel) ·{" "}
              <TermText>Awareness, Reach, Video Views, Store Visits — billed by CPM or CPV / CPCV.</TermText>
            </li>
            <li>
              <span className="font-semibold text-gray-900">MOF</span> (Middle of Funnel) ·{" "}
              <TermText>Engagement, Traffic, Consideration — billed by CPC or CPE.</TermText>
            </li>
            <li>
              <span className="font-semibold text-gray-900">BOF</span> (Bottom of Funnel) ·{" "}
              <TermText>Sales, Conversions, Lead Generation, Catalog Sales, App Installs — billed by CPL, CPS, or CPA.</TermText>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["TOF", "MOF", "BOF"] as const).map((stage) => {
            const count = counts[stage];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const stageLabel = stage === "TOF" ? "Top of Funnel" : stage === "MOF" ? "Middle of Funnel" : "Bottom of Funnel";
            return (
              <div key={stage} className="border border-gray-200 rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase">{stage}</div>
                <div className="text-[10px] text-gray-400 -mt-0.5">{stageLabel}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {count} of {total} <span className="text-gray-400">({pct}%)</span>
                </div>
                {/* progress bar — visual share of the total */}
                <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full ${count > 0 ? "bg-blue-500" : "bg-gray-200"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2">
                  <StatusBadge status={count > 0 ? "pass" : "fail"} label={count > 0 ? "Present" : "Missing"} />
                </div>
              </div>
            );
          })}
          {/* 4th column — campaign status filter checklist */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Filter by Status</div>
            <div className="text-[10px] text-gray-400 -mt-1 mb-3">Campaign delivery status</div>
            <div className="space-y-1.5">
              {availableStatuses.length === 0 ? (
                <div className="text-[11px] text-gray-400 italic">No campaigns loaded</div>
              ) : availableStatuses.map((s) => {
                const meta = STATUS_META[s] || { label: s, color: "bg-gray-100 text-gray-600 border-gray-300" };
                const checked = selectedStatuses.has(s);
                const countForStatus = campaigns.filter(c => c.status?.toUpperCase() === s).length;
                return (
                  <label key={s} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStatus(s)}
                      className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
                    />
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto">{countForStatus}</span>
                  </label>
                );
              })}
            </div>
            {selectedStatuses.size < availableStatuses.length && (
              <button
                onClick={() => setSelectedStatuses(new Set(availableStatuses))}
                className="mt-2 text-[10px] text-blue-600 hover:text-blue-800 font-semibold"
              >
                Select all
              </button>
            )}
          </div>
        </div>

        {/* Single-line summary at the bottom — total breakdown */}
        <div className="mt-4 pt-3 border-t border-gray-100 text-sm text-gray-700">
          <span className="font-semibold">Breakdown:</span>{" "}
          <span className="font-mono">{counts.TOF}</span> TOF
          {" · "}
          <span className="font-mono">{counts.MOF}</span> MOF
          {" · "}
          <span className="font-mono">{counts.BOF}</span> BOF
          {" "}
          <span className="text-gray-500">out of {total} total campaigns</span>
        </div>
      </AuditCard>

      {/* AI funnel-mix analysis — OPTIONAL. Starts as a small CTA; expands
          on click into the full industry input + analyze workflow. */}
      {!aiPanelOpen ? (
        <button
          onClick={() => setAiPanelOpen(true)}
          className="w-full text-left bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-sm transition group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition">
              <Sparkles className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-bold text-gray-900">Want to check your mix against industry standards?</span>
                <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">Optional · AI</span>
              </div>
              <p className="text-xs text-gray-600">
                Pick your niche (apparel, B2B SaaS, lead-gen finance…) and Claude will judge your TOF/MOF/BOF split,
                show the ideal mix for your industry, and rank what to focus on first.
              </p>
            </div>
            <span className="text-blue-600 font-bold shrink-0 self-center group-hover:translate-x-0.5 transition">→</span>
          </div>
        </button>
      ) : (
      <AuditCard
        title="AI Funnel Mix Analysis"
        description="Tell us your industry — Claude scores your TOF/MOF/BOF split and tells you what to focus on."
        badge={{ text: "AI · Haiku 4.5", color: "blue" }}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => { setAiPanelOpen(false); setAiResult(null); setAiError(null); }}
            className="text-xs text-gray-500 hover:text-gray-700"
            title="Collapse"
          >
            ← back
          </button>
          <input
            list="industry-suggestions"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. E-commerce — Apparel, B2B SaaS, Lead Gen — Finance…"
            className="flex-1 min-w-[260px] px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <datalist id="industry-suggestions">
            {INDUSTRY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>
          <button
            onClick={runAiAnalysis}
            disabled={aiLoading || !industry.trim()}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold ${
              aiLoading || !industry.trim()
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <>{aiLoading ? "Analyzing…" : "Analyze with AI"}{!aiLoading && !aiResult && <span className="text-[10px] opacity-60 ml-1">~$0.02</span>}</>
          </button>
        </div>

        {aiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm flex items-start gap-2 mb-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{aiError}</span>
          </div>
        )}

        {aiResult && (() => {
          const tone = verdictTone(aiResult.verdict);
          return (
            <div className="space-y-3">
              {/* Overall verdict */}
              <div className={`${tone.bg} ${tone.border} border rounded-lg p-3 flex items-start gap-2`}>
                <tone.Icon className={`w-5 h-5 shrink-0 mt-0.5 ${tone.text}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${tone.chip}`}>{aiResult.verdict}</span>
                    <span className="text-xs text-gray-500">{industry}</span>
                  </div>
                  <div className={`text-sm font-semibold ${tone.text}`}>{aiResult.summary}</div>
                </div>
              </div>

              {/* Ideal vs actual mix */}
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Ideal mix for your industry vs your current</div>
                <div className="grid grid-cols-3 gap-3">
                  {(["tof", "mof", "bof"] as const).map((s) => {
                    const ideal = aiResult.idealMix[s];
                    const current = stageStats[s].campaignPct;
                    const diff = current - ideal;
                    const upper = s.toUpperCase() as "TOF" | "MOF" | "BOF";
                    return (
                      <div key={s} className="text-center">
                        <div className="text-xs font-semibold text-gray-500">{upper}</div>
                        <div className="text-2xl font-bold text-gray-900 mt-0.5">{ideal}%</div>
                        <div className="text-[11px] text-gray-500">ideal</div>
                        <div className={`text-xs font-semibold mt-1 ${Math.abs(diff) <= 5 ? "text-green-700" : diff > 0 ? "text-red-700" : "text-yellow-700"}`}>
                          You: {current}% ({diff >= 0 ? "+" : ""}{diff}pp)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Per-stage diagnosis */}
              <div className="space-y-2">
                {(["tof", "mof", "bof"] as const).map((s) => {
                  const stage = aiResult.stages[s];
                  const t = verdictTone(stage.status);
                  const upper = s.toUpperCase() as "TOF" | "MOF" | "BOF";
                  return (
                    <div key={s} className={`${t.bg} ${t.border} border rounded-lg p-3 flex items-start gap-2`}>
                      <t.Icon className={`w-4 h-4 shrink-0 mt-0.5 ${t.text}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-bold text-gray-900">{upper}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${t.chip}`}>{stage.status}</span>
                        </div>
                        <div className="text-xs text-gray-700">{stage.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ranked focus actions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-blue-700" />
                  <span className="text-sm font-bold text-blue-900">What to focus on first</span>
                </div>
                <ol className="space-y-1.5">
                  {aiResult.focusActions
                    .sort((a, b) => a.priority - b.priority)
                    .map((a) => (
                      <li key={a.priority} className="flex gap-2 text-sm text-gray-800">
                        <span className="font-bold text-blue-700 shrink-0">{a.priority}.</span>
                        <span>{a.action}</span>
                      </li>
                    ))}
                </ol>
              </div>
            </div>
          );
        })()}

        {!aiResult && !aiError && (
          <p className="text-xs text-gray-500">
            Enter your industry → click <strong>Analyze</strong>. The AI compares your current mix against typical
            paid-media patterns for your niche and gives prioritized actions.
          </p>
        )}
      </AuditCard>
      )}

      {/* TOF/MOF/BOF distribution + dual-axis performance chart */}
      <FunnelStagePerformance campaigns={visibleCampaigns} accountTotal={total} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
    </div>
  );
}
