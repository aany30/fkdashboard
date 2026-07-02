import HealthScoreCard from "./HealthScoreCard";
import CapiHealthCard from "./CapiHealthCard";
import DiagnosticsPanel from "./DiagnosticsPanel";
import RiskAnalysisPanel from "./RiskAnalysisPanel";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import SourceBadge from "@/components/shared/SourceBadge";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import { CheckCircle2, AlertCircle, Activity, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

interface OverviewTabProps {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab?: (id: string) => void;
}

function getHealthScore(emqOverall?: number, dedup?: number) {
  if (!emqOverall) return 0;
  const emqWeighted = (emqOverall / 10) * 60;
  const dedupWeighted = ((dedup || 0) / 100) * 40;
  return Math.round(emqWeighted + dedupWeighted);
}

const priorityColor = (p: string) =>
  p === "Critical" ? "bg-red-100 text-red-700 border-red-300" :
  p === "High" ? "bg-orange-100 text-orange-700 border-orange-300" :
  p === "Medium" ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
  "bg-blue-100 text-blue-700 border-blue-300";

export default function OverviewTab({ platform, dateRange, customStart, customEnd, setActiveTab }: OverviewTabProps) {
  const { meta, google, loading, source, refresh } = useAudit(platform, dateRange, customStart, customEnd);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
        <p className="text-gray-600">Auditing your tracking setup...</p>
      </div>
    );
  }

  // Aggregate stats
  const metaPixels = meta?.pixels || [];
  const totalMetaEvents = metaPixels.reduce((s, p) => s + p.totalEvents, 0);
  const avgEmq = metaPixels.length > 0
    ? metaPixels.reduce((s, p) => s + p.emq.overallScore, 0) / metaPixels.length
    : 0;
  const avgDedup = metaPixels.length > 0
    ? metaPixels.reduce((s, p) => s + p.capi.avgDedupRate, 0) / metaPixels.length
    : 0;
  const metaHealth = getHealthScore(avgEmq, avgDedup);

  const googleAudit = google?.audit;
  const googleHealth = googleAudit
    ? Math.round(
        (googleAudit.ads.enhancedConversions.overallMatchRate / 100) * 50 +
          (googleAudit.ga4.ecommerceConfigured ? 25 : 0) +
          (googleAudit.ads.enhancedConversions.enabled ? 25 : 0)
      )
    : 0;

  const allRecs = [...(meta?.recommendations || []), ...(google?.recommendations || [])];
  const rawTopRecs = allRecs.slice(0, 5);
  const { sorted: topRecs, sort: recSort, toggle: recToggle } = useSort(rawTopRecs, "impact", "desc");
  const criticalCount = allRecs.filter((r) => r.priority === "Critical").length;
  const totalLift = allRecs.reduce((s, r) => s + r.impact, 0).toFixed(1);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard Overview</h1>
          <p className="text-gray-600">Real-time tracking health and recommendations</p>
        </div>
        <div className="flex items-center gap-3">
          <SourceBadge source={source} size="md" />
          <button
            onClick={refresh}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:border-gray-400 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {(meta?.errors?.length || 0) > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="font-semibold text-yellow-900 text-sm mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Live API issues — falling back to demo for affected platforms
          </div>
          <ul className="text-xs text-yellow-800 space-y-1">
            {meta?.errors.map((e, i) => (
              <li key={i} className="font-mono">{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {meta && (
          <HealthScoreCard title="Meta Health" score={metaHealth} trend={0} lastUpdated={new Date()} />
        )}
        {google && (
          <HealthScoreCard title="Google Health" score={googleHealth} trend={0} lastUpdated={new Date()} />
        )}
        <HealthScoreCard title="Total Recommendations" score={Math.min(100, allRecs.length * 10)} trend={0} lastUpdated={new Date()} />
        <HealthScoreCard title="Potential Lift" score={Math.min(100, parseFloat(totalLift) * 2)} trend={0} lastUpdated={new Date()} />
      </div>

      {/* Anomalies banner */}
      {metaPixels.some((p) => p.anomalies.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="font-semibold text-red-900 text-sm mb-2 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" /> Anomalies detected (last 24h vs 7d baseline)
          </div>
          <div className="space-y-1">
            {metaPixels.flatMap((p) =>
              p.anomalies.map((a, i) => (
                <div key={`${p.pixelId}-${i}`} className="text-sm text-red-800 flex items-center gap-2">
                  {a.type === "drop" ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                  <span className="font-mono">{a.event}</span>
                  <span>{a.type === "drop" ? "down" : "up"}</span>
                  <span className="font-semibold">{a.deviation > 0 ? "+" : ""}{a.deviation}%</span>
                  <span className="text-red-600">({a.currentValue.toLocaleString()} vs {a.baseline.toLocaleString()} baseline)</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* CAPI Health + Diagnostics for each pixel */}
      {metaPixels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {metaPixels.slice(0, 1).map((p) => (
            <CapiHealthCard key={p.pixelId} pixel={p} />
          ))}
          {metaPixels.slice(0, 1).map((p) => (
            <DiagnosticsPanel key={p.pixelId} pixel={p} />
          ))}
        </div>
      )}

      {/* Risk Analysis */}
      <RiskAnalysisPanel
        metaPixels={metaPixels}
        google={googleAudit || null}
        recommendations={allRecs}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Top AI Recommendations</h2>
            <p className="text-sm text-gray-600 mt-1">Highest-impact fixes ranked by impact × confidence ÷ effort</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <SortTh col="priority" sort={recSort} onToggle={recToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Priority</SortTh>
                  <SortTh col="platform" sort={recSort} onToggle={recToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Platform</SortTh>
                  <SortTh col="issue" sort={recSort} onToggle={recToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Issue</SortTh>
                  <SortTh col="confidence" sort={recSort} onToggle={recToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Confidence</SortTh>
                  <SortTh col="impact" sort={recSort} onToggle={recToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Impact</SortTh>
                </tr>
              </thead>
              <tbody>
                {topRecs.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${priorityColor(r.priority)}`}>
                          {r.priority}
                        </span>
                        {(r.priority === "Critical" || r.priority === "High" || r.priority === "Medium") && (
                          <AIRecommendationButton
                            metric={r.issue}
                            value={r.impact}
                            status={r.priority === "Critical" ? "critical" : r.priority === "High" ? "critical" : "warn"}
                            platform={r.platform?.toLowerCase() as "meta" | "google"}
                            auditContext={{ module: "Overview", siblingMetrics: { priority: r.priority, confidence: r.confidence, impact: r.impact } }}
                            compact
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700">{r.platform}</td>
                    <td className="px-6 py-4 max-w-md">
                      <div className="font-semibold text-gray-900">{r.issue}</div>
                      <div className="text-xs text-gray-600 mt-1">{r.details.slice(0, 120)}{r.details.length > 120 ? "…" : ""}</div>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900">{r.confidence}%</td>
                    <td className="px-6 py-4 text-right text-green-600 font-bold">+{r.impact.toFixed(1)}%</td>
                  </tr>
                ))}
                {topRecs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No recommendations — all clear!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Audit Summary</h2>
          </div>
          <div className="p-6 space-y-4 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Total Recommendations</span>
              <span className="font-bold text-gray-900">{allRecs.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Critical Issues</span>
              <span className="font-bold text-red-600">{criticalCount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Quick Wins</span>
              <span className="font-bold text-green-600">{allRecs.filter((r) => r.effort === "Quick").length}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-gray-200">
              <span className="text-gray-600">Estimated Lift</span>
              <span className="font-bold text-green-600 text-lg">+{totalLift}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200 max-w-md">
          <div className="text-sm text-gray-600 mb-1">Events Tracked</div>
          <div className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            {(totalMetaEvents + (googleAudit?.ga4.totalEvents || 0)).toLocaleString()}
          </div>
          <p className="text-xs text-gray-500 mt-2">In current date range — real pixel/GA4 count</p>
        </div>
      </div>

      <TabSummaryFooter
        tabName="Overview"
        lines={[
          `${allRecs.length} recommendation${allRecs.length !== 1 ? "s" : ""} found — ${criticalCount} critical issue${criticalCount !== 1 ? "s" : ""} requiring immediate attention.`,
          `Meta tracking health score: ${metaHealth}${googleHealth > 0 ? ` · Google: ${googleHealth}` : ""}.`,
          `Potential lift from addressing all recommendations: ${totalLift}%.`,
        ]}
        context={{ metaHealth, googleHealth, criticalCount, totalRecs: allRecs.length, totalLift }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
