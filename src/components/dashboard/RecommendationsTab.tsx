import { useAudit } from "@/hooks/useAudit";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { useState, useMemo } from "react";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { Recommendation } from "@/lib/recommendations/engine";
import { RefreshCw, Bot, Filter, TrendingUp, Users, Image as ImageIcon, BarChart2, Target } from "lucide-react";
import AnimatedNumber from "@/components/shared/AnimatedNumber";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

// ─── Data-driven recommendation generators ───────────────────────────────────

function pubRecs(pubRows: any[]): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!pubRows.length) return recs;

  const totalSpend = pubRows.reduce((s, r) => s + r.spend, 0);
  const avgRoas = pubRows.reduce((s, r) => s + (r.spend > 0 ? r.conversionValue / r.spend : 0), 0) / pubRows.length;

  for (const row of pubRows) {
    const roas = row.spend > 0 ? row.conversionValue / row.spend : 0;
    const shareOfSpend = row.spend / totalSpend;

    if (roas > avgRoas * 2 && shareOfSpend < 0.2) {
      recs.push({
        id: `pub-underinvest-${row.label}`, priority: "High", platform: "Meta", category: "Attribution",
        issue: `Underinvesting in ${row.label}`,
        details: `${row.label} delivers ${roas.toFixed(2)}× ROAS — ${Math.round(roas / avgRoas)}× the account average — but receives only ${(shareOfSpend * 100).toFixed(0)}% of spend. Reallocating budget here likely improves overall ROAS.`,
        action: `Increase ${row.label} budget allocation. Test 5–10% incremental budget shifts and monitor efficiency curve.`,
        impact: 5.5, effort: "Quick", confidence: 82,
      });
    }

    if (roas < avgRoas * 0.4 && shareOfSpend > 0.1) {
      recs.push({
        id: `pub-overinvest-${row.label}`, priority: "High", platform: "Meta", category: "Attribution",
        issue: `${row.label} is significantly underperforming`,
        details: `${row.label} ROAS ${roas.toFixed(2)}× vs account average ${avgRoas.toFixed(2)}×, but consumes ${(shareOfSpend * 100).toFixed(0)}% of spend. Budget would generate more return elsewhere.`,
        action: `Reduce or pause ${row.label} placement. Redirect budget to higher-ROAS publishers.`,
        impact: 4.5, effort: "Quick", confidence: 80,
      });
    }

    if (row.label === "audience_network" && shareOfSpend > 0.05 && roas < 1.5) {
      recs.push({
        id: `pub-audience-network`, priority: "Medium", platform: "Meta", category: "Pixel Health",
        issue: "Audience Network spend may be wasted",
        details: `Audience Network ROAS ${roas.toFixed(2)}× is below typical conversion efficiency. This placement is prone to fraudulent clicks from third-party apps.`,
        action: "Consider excluding Audience Network in ad set placement settings. Monitor conversion quality with advanced matching.",
        impact: 3, effort: "Quick", confidence: 75,
      });
    }
  }
  return recs;
}

function ageRecs(ageRows: any[]): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!ageRows.length) return recs;

  const totalSpend = ageRows.reduce((s, r) => s + r.spend, 0);
  const avgCpa = (() => {
    const totalConv = ageRows.reduce((s, r) => s + r.conversions, 0);
    const sp = totalSpend;
    return totalConv > 0 ? sp / totalConv : 0;
  })();

  for (const row of ageRows) {
    const cpa = row.conversions > 0 ? row.spend / row.conversions : 0;
    const roas = row.spend > 0 ? row.conversionValue / row.spend : 0;
    const shareOfSpend = row.spend / totalSpend;

    if (cpa > 0 && avgCpa > 0 && cpa < avgCpa * 0.6 && shareOfSpend < 0.15) {
      recs.push({
        id: `age-underinvest-${row.label}`, priority: "High", platform: "Meta", category: "Anomaly",
        issue: `Age group ${row.label} is highly efficient but underfunded`,
        details: `CPA ₹${cpa.toFixed(0)} vs account avg ₹${avgCpa.toFixed(0)} — ${Math.round((1 - cpa / avgCpa) * 100)}% cheaper — yet receives only ${(shareOfSpend * 100).toFixed(0)}% of spend.`,
        action: `Create a dedicated ad set targeting ${row.label} with increased budget. Bid aggressively on this segment.`,
        impact: 4.5, effort: "Medium", confidence: 78,
      });
    }

    if (cpa > avgCpa * 2 && shareOfSpend > 0.15) {
      recs.push({
        id: `age-expensive-${row.label}`, priority: "Medium", platform: "Meta", category: "Anomaly",
        issue: `Age group ${row.label} has very high CPA`,
        details: `${row.label} CPA ₹${cpa.toFixed(0)} is ${Math.round(cpa / avgCpa)}× the account average. This segment consumes ${(shareOfSpend * 100).toFixed(0)}% of budget inefficiently.`,
        action: `Test reducing bids for ${row.label}. Split test creative messaging tailored to this demographic.`,
        impact: 3.5, effort: "Medium", confidence: 76,
      });
    }

    if (roas > 0 && row.label === "18-24" && roas < 1.5) {
      recs.push({
        id: `age-1824-roas`, priority: "Medium", platform: "Meta", category: "EMQ",
        issue: "18-24 age group showing low return",
        details: `18-24 ROAS ${roas.toFixed(2)}×. This demographic often has lower purchase intent. Consider shifting budget to 25-44 which typically converts better for most product categories.`,
        action: "Evaluate 18-24 creative messaging. If CPM is high and CVR low, shift budget to 25-34 and 35-44 ad sets.",
        impact: 2.5, effort: "Quick", confidence: 72,
      });
    }
  }
  return recs;
}

function genderRecs(genderRows: any[]): Recommendation[] {
  const recs: Recommendation[] = [];
  if (genderRows.length < 2) return recs;

  const female = genderRows.find(r => r.label === "female");
  const male   = genderRows.find(r => r.label === "male");
  if (!female || !male) return recs;

  const fRoas = female.spend > 0 ? female.conversionValue / female.spend : 0;
  const mRoas = male.spend   > 0 ? male.conversionValue   / male.spend   : 0;
  const totalSpend = genderRows.reduce((s, r) => s + r.spend, 0);
  const fShare = female.spend / totalSpend;
  const mShare = male.spend   / totalSpend;

  if (fRoas > mRoas * 1.5 && fShare < 0.55) {
    recs.push({
      id: `gender-female-underweight`, priority: "Medium", platform: "Meta", category: "Attribution",
      issue: "Female audience delivers better ROAS but is underfunded",
      details: `Female ROAS ${fRoas.toFixed(2)}× vs Male ${mRoas.toFixed(2)}×. Yet females receive only ${(fShare * 100).toFixed(0)}% of spend. Shifting 5-10% spend to female audiences should lift overall ROAS.`,
      action: "Create female-specific ad sets or apply gender targeting to your best-performing campaigns.",
      impact: 3, effort: "Quick", confidence: 74,
    });
  } else if (mRoas > fRoas * 1.5 && mShare < 0.55) {
    recs.push({
      id: `gender-male-underweight`, priority: "Medium", platform: "Meta", category: "Attribution",
      issue: "Male audience delivers better ROAS but is underfunded",
      details: `Male ROAS ${mRoas.toFixed(2)}× vs Female ${fRoas.toFixed(2)}×. Males receive only ${(mShare * 100).toFixed(0)}% of spend.`,
      action: "Create male-specific ad sets or bias targeting towards male audiences in high-ROAS campaigns.",
      impact: 3, effort: "Quick", confidence: 74,
    });
  }
  return recs;
}

function campaignRecs(campaigns: any[]): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!campaigns.length) return recs;

  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const avgRoas = (() => {
    const withRoas = campaigns.filter(c => c.spend > 0 && c.conversionValue > 0);
    if (!withRoas.length) return 0;
    return withRoas.reduce((s, c) => s + (c.conversionValue / c.spend), 0) / withRoas.length;
  })();

  // Budget concentration risk
  const top = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
  if (top && top.spend / totalSpend > 0.6) {
    recs.push({
      id: `camp-concentration`, priority: "High", platform: "Meta", category: "Funnel",
      issue: "Over 60% of budget concentrated in one campaign",
      details: `"${top.name}" consumes ${((top.spend / totalSpend) * 100).toFixed(0)}% of total spend. This creates single-point-of-failure risk — if this campaign fatigues or audience saturates, the entire account underperforms.`,
      action: "Diversify by launching at least 2-3 complementary campaigns: retargeting, lookalike, or new audience tests.",
      impact: 4, effort: "Medium", confidence: 80,
    });
  }

  // Zero-conversion campaigns with significant spend
  const zeroCvCamps = campaigns.filter(c => (c.conversions || 0) === 0 && (c.spend || 0) > totalSpend * 0.05);
  if (zeroCvCamps.length > 0) {
    recs.push({
      id: `camp-zero-conversions`, priority: "High", platform: "Meta", category: "Funnel",
      issue: `${zeroCvCamps.length} campaign(s) spending with zero conversions`,
      details: `Campaigns with no conversions: ${zeroCvCamps.slice(0, 3).map(c => `"${c.name}"`).join(", ")}${zeroCvCamps.length > 3 ? ` +${zeroCvCamps.length - 3} more` : ""}. These account for ${((zeroCvCamps.reduce((s, c) => s + c.spend, 0) / totalSpend) * 100).toFixed(0)}% of total spend.`,
      action: "Review conversion tracking for these campaigns. If tracking is correct, pause and reallocate budget to converting campaigns.",
      impact: 5, effort: "Quick", confidence: 85,
    });
  }

  // High-ROAS campaigns that are budget-constrained (low spend share but top roas)
  const highRoas = campaigns.filter(c => c.spend > 0 && c.conversionValue > 0 && (c.conversionValue / c.spend) > avgRoas * 1.8 && c.spend / totalSpend < 0.1);
  if (highRoas.length > 0) {
    recs.push({
      id: `camp-high-roas-underfunded`, priority: "High", platform: "Meta", category: "Attribution",
      issue: `${highRoas.length} high-ROAS campaign(s) receiving too little budget`,
      details: `${highRoas.slice(0, 2).map(c => `"${c.name}" (${(c.conversionValue / c.spend).toFixed(2)}× ROAS)`).join(", ")} each deliver ${Math.round(1.8)}× the account ROAS but get less than 10% of budget combined.`,
      action: "Scale budget on these campaigns by 20-30% weekly while monitoring performance. Use Campaign Budget Optimization (CBO) to let Meta auto-allocate.",
      impact: 5.5, effort: "Quick", confidence: 82,
    });
  }

  // High CPA campaign warning
  const avgCpa = (() => {
    const conv = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
    return conv > 0 ? totalSpend / conv : 0;
  })();
  const highCpa = campaigns.filter(c => c.conversions > 0 && c.spend / c.conversions > avgCpa * 2.5 && c.spend / totalSpend > 0.05);
  if (highCpa.length > 0) {
    recs.push({
      id: `camp-high-cpa`, priority: "Medium", platform: "Meta", category: "Funnel",
      issue: `${highCpa.length} campaign(s) have CPA more than 2.5× the account average`,
      details: `${highCpa.slice(0, 2).map(c => `"${c.name}" (CPA ${(c.spend / c.conversions).toFixed(0)})`).join(", ")}. Account avg CPA: ${avgCpa.toFixed(0)}.`,
      action: "Audit creative and audience targeting. Consider refreshing creative, narrowing audience, or switching attribution window.",
      impact: 3.5, effort: "Medium", confidence: 76,
    });
  }

  return recs;
}

function attributionRecs(campaigns: any[]): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!campaigns.length) return recs;

  const withValue = campaigns.filter(c => c.conversionValue > 0 && c.spend > 0);
  if (!withValue.length) return recs;

  const roasValues = withValue.map(c => c.conversionValue / c.spend);
  const maxRoas = Math.max(...roasValues);
  const minRoas = Math.min(...roasValues);
  const spread = maxRoas - minRoas;

  if (spread > 4) {
    recs.push({
      id: `attr-roas-spread`, priority: "Medium", platform: "Meta", category: "Attribution",
      issue: "High ROAS variance across campaigns — attribution model may be misleading",
      details: `ROAS ranges from ${minRoas.toFixed(2)}× to ${maxRoas.toFixed(2)}× across campaigns. Such wide variance often indicates a last-click attribution bias where top-of-funnel campaigns are undercredited.`,
      action: "Switch to Data-Driven Attribution in Meta to give fair credit to upper-funnel touchpoints. Review 7-day click vs 1-day click windows.",
      impact: 3.5, effort: "Quick", confidence: 74,
    });
  }

  const offlineCamps = campaigns.filter(c => (c.objective || "").toLowerCase().includes("offline") || (c.effectiveAttribution || "").includes("offline"));
  if (offlineCamps.length > 0) {
    recs.push({
      id: `attr-offline-value`, priority: "Low", platform: "Meta", category: "Attribution",
      issue: "Offline conversion campaigns detected",
      details: `${offlineCamps.length} campaign(s) reference offline conversions. Ensure offline events are uploaded within 48 hours to maintain attribution accuracy.`,
      action: "Review offline event upload frequency in Events Manager. Use Meta's Offline Conversions API for real-time uploads.",
      impact: 2, effort: "Medium", confidence: 70,
    });
  }

  return recs;
}

// ─── Component ────────────────────────────────────────────────────────────────

const CATEGORY_GROUPS: { label: string; icon: any; cats: string[] }[] = [
  { label: "Tracking & Pixel", icon: BarChart2, cats: ["Pixel Health", "EMQ", "CAPI", "Event Manager", "GTM", "Enhanced Conversions", "Consent"] },
  { label: "Funnel & Attribution", icon: Target,   cats: ["Funnel", "Attribution", "GA4", "Ecommerce", "UTM", "Cross-Domain"] },
  { label: "Audience & Placement", icon: Users,    cats: ["Anomaly", "Google Ads"] },
  { label: "Budget & Creative",    icon: ImageIcon, cats: [] }, // catches everything else
];

export default function RecommendationsTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { meta, google, loading: auditLoading } = useAudit(platform, dateRange, customStart, customEnd);
  const isMetaEnabled = platform !== "google";
  const { campaigns, loading: campsLoading } = useCampaigns(platform, dateRange, customStart, customEnd);
  const { rows: pubRows,    loading: pubLoading }    = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, isMetaEnabled);
  const { rows: ageRows,    loading: ageLoading }    = useMetaBreakdown("age",    dateRange, customStart, customEnd, isMetaEnabled);
  const { rows: genderRows, loading: genderLoading } = useMetaBreakdown("gender", dateRange, customStart, customEnd, isMetaEnabled);

  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [groupFilter, setGroupFilter]       = useState<string>("All");

  // Only block on the audit — extra data-driven recs append when their hooks resolve
  const loading = auditLoading;
  const dataLoading = campsLoading || pubLoading || ageLoading || genderLoading;

  const allRecs = useMemo<Recommendation[]>(() => {
    const base = [...(meta?.recommendations || []), ...(google?.recommendations || [])];
    const extra = [
      ...pubRecs(pubRows),
      ...ageRecs(ageRows),
      ...genderRecs(genderRows),
      ...campaignRecs(campaigns),
      ...attributionRecs(campaigns),
    ];
    // dedupe by id
    const seen = new Set(base.map(r => r.id));
    const unique = extra.filter(r => !seen.has(r.id));
    return [...base, ...unique];
  }, [meta, google, pubRows, ageRows, genderRows, campaigns]);

  const groupOf = (cat: string): string => {
    for (const g of CATEGORY_GROUPS) {
      if (g.cats.includes(cat)) return g.label;
    }
    return "Budget & Creative";
  };

  const filtered = useMemo(() => allRecs.filter(r =>
    (priorityFilter === "All" || r.priority === priorityFilter) &&
    (groupFilter    === "All" || groupOf(r.category) === groupFilter)
  ), [allRecs, priorityFilter, groupFilter]);

  const { sorted: sortedRecs, sort: recSort, toggle: recToggle } = useSort(filtered, "priority", "asc");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
        <p className="text-gray-600">Generating recommendations…</p>
      </div>
    );
  }

  const priorityColor = (p: string) =>
    p === "Critical" ? "bg-red-100 text-red-700 border-red-300" :
    p === "High"     ? "bg-orange-100 text-orange-700 border-orange-300" :
    p === "Medium"   ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
    "bg-blue-100 text-blue-700 border-blue-300";

  const effortColor = (e: string) =>
    e === "Quick" ? "text-green-700 bg-green-100" : e === "Medium" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  const groupColor: Record<string, string> = {
    "Tracking & Pixel":   "bg-purple-100 text-purple-700",
    "Funnel & Attribution":"bg-blue-100 text-blue-700",
    "Audience & Placement":"bg-teal-100 text-teal-700",
    "Budget & Creative":   "bg-orange-100 text-orange-700",
  };

  const totalLift    = allRecs.reduce((s, r) => s + r.impact, 0).toFixed(1);
  const avgConfidence = allRecs.length > 0
    ? Math.round(allRecs.reduce((s, r) => s + r.confidence, 0) / allRecs.length)
    : 0;

  // Group summary counts for the insight strip
  const groupCounts = CATEGORY_GROUPS.map(g => ({
    ...g,
    count: allRecs.filter(r => groupOf(r.category) === g.label).length,
    critical: allRecs.filter(r => groupOf(r.category) === g.label && r.priority === "Critical").length,
  }));

  return (
    <div className="space-y-6 section-enter">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Bot className="w-8 h-8 text-purple-600 float-element" /> AI Recommendations
          </h1>
          <p className="text-gray-600 mt-1">Prioritized fixes ranked by impact × confidence ÷ effort — tracking, audience, budget &amp; creative</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="animate-fade-in-up stagger-1 bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Total Recommendations</div>
          <div className="text-3xl font-bold text-gray-900 mt-1"><AnimatedNumber value={allRecs.length} /></div>
          <div className="text-xs text-gray-500 mt-1">Tracking + data-driven</div>
        </div>
        <div className="animate-fade-in-up stagger-2 bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Critical Issues</div>
          <div className="text-3xl font-bold text-red-600 mt-1"><AnimatedNumber value={allRecs.filter(r => r.priority === "Critical").length} /></div>
          <div className="text-xs text-gray-500 mt-1">Fix immediately</div>
        </div>
        <div className="animate-fade-in-up stagger-3 bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Avg Confidence</div>
          <div className="text-3xl font-bold text-blue-600 mt-1"><AnimatedNumber value={avgConfidence} suffix="%" /></div>
          <div className="text-xs text-gray-500 mt-1">Engine certainty</div>
        </div>
        <div className="animate-fade-in-up stagger-4 bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Potential Lift</div>
          <div className="text-3xl font-bold text-green-600 mt-1">+<AnimatedNumber value={parseFloat(totalLift)} decimals={1} />%</div>
          <div className="text-xs text-gray-500 mt-1">If all fixed</div>
        </div>
      </div>

      {/* Category insight strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {groupCounts.map(g => (
          <button
            key={g.label}
            onClick={() => setGroupFilter(prev => prev === g.label ? "All" : g.label)}
            className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition ${
              groupFilter === g.label
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <g.icon className="w-5 h-5 text-gray-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-500 truncate">{g.label}</p>
              <p className="text-xl font-bold text-gray-900">{g.count}</p>
              {g.critical > 0 && (
                <p className="text-xs text-red-600 font-semibold">{g.critical} critical</p>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Prioritized Recommendations</h2>
            <p className="text-sm text-gray-600 mt-1">Tracking health + publisher, audience &amp; campaign performance analysis</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white"
            >
              <option>All</option>
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white"
            >
              <option value="All">All Areas</option>
              {CATEGORY_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
            </select>
            {(priorityFilter !== "All" || groupFilter !== "All") && (
              <button
                onClick={() => { setPriorityFilter("All"); setGroupFilter("All"); }}
                className="px-3 py-2 text-xs text-blue-600 font-semibold border border-blue-300 rounded-lg hover:bg-blue-50"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="priority"   sort={recSort} onToggle={recToggle} className="px-5 py-3">Priority</SortTh>
                <SortTh col="platform"   sort={recSort} onToggle={recToggle} className="px-5 py-3">Platform</SortTh>
                <th className="px-5 py-3 text-left font-semibold text-gray-700">Recommendation</th>
                <th className="px-5 py-3 text-left font-semibold text-gray-700">Area</th>
                <SortTh col="effort"     sort={recSort} onToggle={recToggle} className="px-5 py-3" align="right">Effort</SortTh>
                <SortTh col="confidence" sort={recSort} onToggle={recToggle} className="px-5 py-3" align="right">Confidence</SortTh>
                <SortTh col="impact"     sort={recSort} onToggle={recToggle} className="px-5 py-3" align="right">Impact</SortTh>
              </tr>
            </thead>
            <tbody>
              {sortedRecs.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${priorityColor(r.priority)}`}>{r.priority}</span>
                  </td>
                  <td className="px-5 py-4 text-gray-700 font-medium text-xs">{r.platform}</td>
                  <td className="px-5 py-4 max-w-sm">
                    <div className="font-semibold text-gray-900 text-sm">{r.issue}</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">{r.details}</div>
                    <div className="text-xs text-blue-600 mt-1.5 font-medium">→ {r.action}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${groupColor[groupOf(r.category)] || "bg-gray-100 text-gray-700"}`}>
                      {groupOf(r.category).split(" ")[0]}
                    </span>
                    <div className="text-xs text-gray-400 mt-0.5">{r.category}</div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${effortColor(r.effort)}`}>{r.effort}</span>
                  </td>
                  <td className="px-5 py-4 text-right text-blue-600 font-semibold text-sm">{r.confidence}%</td>
                  <td className="px-5 py-4 text-right text-green-600 font-bold text-sm">+{r.impact.toFixed(1)}%</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No recommendations match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 flex items-center gap-2">
          <span>Showing {filtered.length} of {allRecs.length} recommendations · Tracking + audience &amp; campaign analysis</span>
          {dataLoading && <span className="flex items-center gap-1 text-blue-500"><RefreshCw className="w-3 h-3 animate-spin" /> Loading audience &amp; campaign insights…</span>}
        </div>
      </div>

      <TabSummaryFooter
        tabName="Recommendations"
        lines={[
          `${allRecs.length} recommendation${allRecs.length !== 1 ? "s" : ""} generated — ${allRecs.filter(r => r.priority === "Critical").length} critical, ${allRecs.filter(r => r.priority === "High").length} high priority.`,
          `Potential total lift: ${totalLift}% — average confidence: ${avgConfidence}%.`,
          `${filtered.length} recommendation${filtered.length !== 1 ? "s" : ""} match current filters.`,
        ]}
        context={{ totalRecs: allRecs.length, filtered: filtered.length, totalLift, avgConfidence }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
