import { useState, useEffect, useMemo } from "react";
import { Layers } from "lucide-react";
import { useCampaigns } from "@/hooks/useCampaigns";
import type { CampaignData, DateRange } from "@/types";
import { objectiveMatches } from "./CampaignObjectiveFilter";
import NamingConventionAudit from "./audits/NamingConventionAudit";
import FunnelSeparationAudit from "./audits/FunnelSeparationAudit";
import BudgetAllocationAudit from "./audits/BudgetAllocationAudit";
import LearningPhaseAudit from "./audits/LearningPhaseAudit";
import AboCboAudit from "./audits/AboCboAudit";
import VerificationBanner from "@/components/shared/VerificationBanner";
import LoadingState from "@/components/shared/LoadingState";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

type SubTab = "naming" | "funnel-sep" | "budget" | "learning" | "abo-cbo";

const SUB_TABS: Array<{ id: SubTab; label: string; description: string; metaOnly?: boolean }> = [
  { id: "naming", label: "Naming Convention", description: "Standardized naming Pass/Fail" },
  { id: "funnel-sep", label: "Funnel Separation", description: "TOF/MOF/BOF segmentation" },
  { id: "budget", label: "Budget Allocation", description: "Budget fragmentation %" },
  { id: "learning", label: "Learning Phase", description: "Learning-limited campaigns", metaOnly: true },
  { id: "abo-cbo", label: "ABO vs CBO", description: "Correct structure usage", metaOnly: true },
];

// Map the dashboard's DateRange prop → concrete since/until ISO dates Meta
// understands. Falls back to the last 30 days.
function rangeToDates(range: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

export default function AccountStructureTab({ platform, dateRange, customStart, customEnd, selectedObjectives, setActiveTab }: Props) {
  // Use the shared campaigns hook (same data path as Key Metrics) so DV360
  // creatives — which arrive via an async Bid Manager report that only fills on
  // a *later* fetch — get picked up through its SWR revalidation + cache. The
  // previous one-shot fetch here froze on the first (creative-less) response,
  // which is why the LI → Creative drill level never appeared in this tab.
  const { campaigns, loading, error: fetchError } = useCampaigns(
    platform,
    dateRange as DateRange,
    customStart,
    customEnd
  );
  const [active, setActive] = useState<SubTab>("naming");

  const visibleTabs = useMemo(
    () => SUB_TABS.filter(t => !t.metaOnly || platform !== "dv360"),
    [platform]
  );

  useEffect(() => {
    if (!visibleTabs.some(t => t.id === active)) setActive(visibleTabs[0]?.id ?? "naming");
  }, [visibleTabs, active]);

  const globalRange = rangeToDates(dateRange, customStart, customEnd);
  const winStart = globalRange.startDate;
  const winEnd = globalRange.endDate;

  const filteredCampaigns = useMemo(() => {
    if (!selectedObjectives || selectedObjectives.size === 0) return campaigns;
    return campaigns.filter((c) => objectiveMatches(c.objective, selectedObjectives));
  }, [campaigns, selectedObjectives]);

  // Pass the EFFECTIVE window (override or global) down so sub-audits scope
  // correctly. dateRange="custom" forces sub-components to honor the explicit
  // start/end (their resolveWindow only uses custom dates when range==="custom").
  const auditProps = { campaigns: filteredCampaigns, loading, platform, accountTotal: campaigns.length, dateRange: "custom", customStart: winStart, customEnd: winEnd };
  // ABO/CBO is Meta-only. Learning Phase now handles both Meta and DV360.
  const metaAuditProps = { ...auditProps, campaigns: filteredCampaigns.filter((c) => c.platform === "meta") };

  const windowDays = Math.max(
    1,
    Math.round((new Date(winEnd).getTime() - new Date(winStart).getTime()) / 86_400_000) + 1
  );
  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
  };
  const activeCount = filteredCampaigns.filter((c) => c.status?.toUpperCase() === "ACTIVE" || c.status?.toUpperCase() === "ENABLED").length;
  const pausedCount = filteredCampaigns.length - activeCount;
  const acctCurrency = filteredCampaigns.find((c) => c.currency)?.currency || "USD";

  return (
    <div className="space-y-6 section-enter">
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <span className="font-semibold shrink-0">Error loading campaigns:</span>
          <span>{fetchError}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Layers className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Account Structure Audit</h1>
            <p className="text-gray-600 mt-1">Campaign structure: naming, funnel separation, budget, learning, objective, ABO/CBO</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Account Structure"
          context={{
            activeAudit: active,
            platform,
            windowDays,
            campaignCount: filteredCampaigns.length,
            activeCount,
            pausedCount,
            totals: {
              spend: Math.round(filteredCampaigns.reduce((s, c) => s + (c.spend || 0), 0)),
              impressions: filteredCampaigns.reduce((s, c) => s + (c.impressions || 0), 0),
              clicks: filteredCampaigns.reduce((s, c) => s + (c.clicks || 0), 0),
              conversions: filteredCampaigns.reduce((s, c) => s + (c.conversions || 0), 0),
            },
            zeroConversionSpenders: filteredCampaigns.filter((c) => (c.conversions || 0) === 0 && (c.spend || 0) > 0).map((c) => c.name).slice(0, 15),
            // Per-campaign rows (top 40 by spend) so the LLM cites real names/numbers.
            campaigns: [...filteredCampaigns]
              .sort((a, b) => (b.spend || 0) - (a.spend || 0))
              .slice(0, 40)
              .map((c) => ({
                name: c.name, platform: c.platform, status: c.status, objective: c.objective,
                spend: Math.round(c.spend || 0), impressions: c.impressions || 0,
                clicks: c.clicks || 0, conversions: c.conversions || 0, currency: c.currency,
              })),
          }}
          platform={platform}
          dateRange={dateRange}
          inline
        />
      </div>

      {filteredCampaigns.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-gray-700">
          <span className="font-semibold text-gray-900">{activeCount} active</span>
          {pausedCount > 0 && <span className="text-gray-500">· {pausedCount} paused/archived</span>}
          <span className="text-gray-400">·</span>
          <span>Currency: <span className="font-semibold text-gray-900">{acctCurrency}</span></span>
        </div>
      )}

      {/* Passive auto-verification banner — runs in background, surfaces drift. */}
      {filteredCampaigns.length > 0 && (
        <VerificationBanner campaigns={filteredCampaigns} startDate={winStart} endDate={winEnd} />
      )}

      {selectedObjectives && selectedObjectives.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900">
          Filtered by objective: <span className="font-semibold">{Array.from(selectedObjectives).filter((s) => s !== "__none__").join(", ") || "(none)"}</span>{" "}
          — {filteredCampaigns.length} of {campaigns.length} campaigns
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${
              active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.description}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState message="Loading campaign data…" />
      ) : (
        <>
          {active === "naming" && <NamingConventionAudit {...auditProps} />}
          {active === "funnel-sep" && <FunnelSeparationAudit {...auditProps} />}
          {active === "budget" && <BudgetAllocationAudit {...auditProps} />}
          {active === "learning" && <LearningPhaseAudit {...metaAuditProps} />}
          {active === "abo-cbo" && <AboCboAudit {...metaAuditProps} />}
        </>
      )}

      <TabSummaryFooter
        lines={(() => {
          const base = `${filteredCampaigns.length} campaign${filteredCampaigns.length !== 1 ? "s" : ""} in scope — ${activeCount} active, ${pausedCount} paused or archived.`;
          if (active === "naming") {
            const nonCompliant = filteredCampaigns.filter(c => !c.name?.includes(">>") && !c.name?.includes("|") && !c.name?.includes("_")).length;
            return [
              base,
              `Naming check: ${filteredCampaigns.length - nonCompliant} of ${filteredCampaigns.length} campaigns match a structured separator pattern.`,
              nonCompliant > 0 ? `${nonCompliant} campaign${nonCompliant !== 1 ? "s" : ""} lack a clear naming separator — use Renaming Agent to fix.` : "All campaigns have structured names.",
            ];
          }
          if (active === "budget") {
            const lines: string[] = [base];
            const metaC = filteredCampaigns.filter(c => c.platform === "meta");
            const dv360C = filteredCampaigns.filter(c => c.platform === "dv360");
            const fmtSpend = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
            const platformSummary = (label: string, camps: CampaignData[]) => {
              if (camps.length === 0) return;
              const spend = camps.reduce((s, c) => s + (c.spend || 0), 0);
              const impr = camps.reduce((s, c) => s + (c.impressions || 0), 0);
              const clicks = camps.reduce((s, c) => s + (c.clicks || 0), 0);
              const activeC = camps.filter(c => {
                const st = (c.status || "").toUpperCase();
                return st === "ACTIVE" || st === "ENABLED" || st === "ENTITY_STATUS_ACTIVE" || st === "ENTITY_STATUS_ENABLED";
              });
              const delivering = activeC.filter(c => (c.spend || 0) > 0);
              const noDelivery = activeC.filter(c => (c.spend || 0) === 0);
              const top = [...camps].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
              const zeroCPA = camps.filter(c => (c.conversions || 0) === 0 && (c.spend || 0) > 0).length;
              lines.push(`${label}: ${camps.length} campaigns — ${fmtSpend(spend)} spend · ${Math.round(impr).toLocaleString("en-IN")} impressions · ${clicks.toLocaleString("en-IN")} clicks. ${delivering.length} delivering, ${noDelivery.length} active with no delivery.`);
              if (top && spend > 0) lines.push(`${label} top spender: "${top.name}" at ${fmtSpend(top.spend || 0)} (${(((top.spend || 0) / Math.max(spend, 1)) * 100).toFixed(0)}% of ${label} total).`);
              if (zeroCPA > 0) lines.push(`${label}: ${zeroCPA} campaign${zeroCPA !== 1 ? "s" : ""} spent budget with 0 conversions — review targeting or pause.`);
            };
            if (platform === "both" || platform === "meta") platformSummary("Meta", metaC);
            if (platform === "both" || platform === "dv360") platformSummary("DV360", dv360C);
            if (lines.length === 1) lines.push("No campaign data for the selected platform in this window.");
            return lines;
          }
          if (active === "funnel-sep") {
            const tof = filteredCampaigns.filter(c => ["AWARENESS", "REACH", "VIDEO_VIEWS", "STORE_VISITS", "BRAND_AWARENESS"].includes(c.objective || "")).length;
            const mof = filteredCampaigns.filter(c => ["LINK_CLICKS", "POST_ENGAGEMENT", "PAGE_LIKES", "TRAFFIC", "ENGAGED_USERS"].includes(c.objective || "")).length;
            const bof = filteredCampaigns.filter(c => ["CONVERSIONS", "CATALOG_SALES", "LEAD_GENERATION", "APP_INSTALLS", "PRODUCT_CATALOG_SALES", "OUTCOME_SALES", "OUTCOME_LEADS"].includes(c.objective || "")).length;
            const totalSpend = filteredCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
            const missingStages = [tof === 0 && "TOF", mof === 0 && "MOF", bof === 0 && "BOF"].filter(Boolean).join(", ");
            return [
              `${filteredCampaigns.length} campaign${filteredCampaigns.length !== 1 ? "s" : ""} across TOF: ${tof}, MOF: ${mof}, BOF: ${bof} — ${windowDays}-day window.`,
              totalSpend > 0 ? `Funnel spend split — TOF: ${((filteredCampaigns.filter(c => ["AWARENESS","REACH","VIDEO_VIEWS","STORE_VISITS","BRAND_AWARENESS"].includes(c.objective||"")).reduce((s,c)=>s+(c.spend||0),0)/Math.max(totalSpend,1))*100).toFixed(0)}% · MOF: ${((filteredCampaigns.filter(c=>["LINK_CLICKS","POST_ENGAGEMENT","PAGE_LIKES","TRAFFIC","ENGAGED_USERS"].includes(c.objective||"")).reduce((s,c)=>s+(c.spend||0),0)/Math.max(totalSpend,1))*100).toFixed(0)}% · BOF: ${((filteredCampaigns.filter(c=>["CONVERSIONS","CATALOG_SALES","LEAD_GENERATION","APP_INSTALLS","PRODUCT_CATALOG_SALES","OUTCOME_SALES","OUTCOME_LEADS"].includes(c.objective||"")).reduce((s,c)=>s+(c.spend||0),0)/Math.max(totalSpend,1))*100).toFixed(0)}%.` : "No spend data available for this window.",
              missingStages ? `Missing funnel stages: ${missingStages} — full-funnel coverage improves retargeting and reduces CPAs.` : "All three funnel stages present — healthy full-funnel structure.",
            ];
          }
          if (active === "learning") {
            const learning = filteredCampaigns.filter(c => c.status === "LEARNING" || c.status === "LEARNING_LIMITED");
            return [
              base,
              `${learning.length} campaign${learning.length !== 1 ? "s" : ""} currently in Learning phase.`,
              learning.length > 0 ? "Avoid editing budgets or targeting on learning campaigns — wait for 50 optimisation events." : "No campaigns in Learning phase — account is stable.",
            ];
          }
          return [
            base,
            `Currently viewing the ${visibleTabs.find((t) => t.id === active)?.label ?? active} sub-audit across a ${windowDays}-day window.`,
            filteredCampaigns.length > 0 ? `Account currency: ${acctCurrency}.` : "No campaign data loaded yet — connect your ad account to begin.",
          ];
        })()}
        tabName="Account Structure"
        context={{
          activeAudit: active,
          platform,
          dateRange,
          campaignCount: filteredCampaigns.length,
          activeCount,
          pausedCount,
          currency: acctCurrency,
          totalSpend: filteredCampaigns.reduce((s, c) => s + (c.spend || 0), 0),
          totalConversions: filteredCampaigns.reduce((s, c) => s + (c.conversions || 0), 0),
          campaigns: filteredCampaigns.map(c => ({
            name: c.name,
            platform: c.platform ?? "meta",
            objective: c.objective ?? null,
            status: c.status,
            spend: c.spend ?? 0,
            conversions: c.conversions ?? 0,
            conversionValue: c.conversionValue ?? 0,
            roas: (c.spend ?? 0) > 0 ? (c.conversionValue ?? 0) / (c.spend ?? 1) : 0,
            impressions: c.impressions ?? 0,
            clicks: c.clicks ?? 0,
          })),
          zeroCPACampaigns: filteredCampaigns.filter(c => (c.conversions || 0) === 0 && (c.spend || 0) > 0).map(c => c.name),
        }}
        platform={platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
