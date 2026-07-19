import type { MetaPixelStats } from "@/lib/api-clients/meta";
import type { Recommendation } from "@/lib/recommendations/engine";
import { ShieldAlert, TrendingDown, Target, AlertOctagon } from "lucide-react";

interface Props {
  metaPixels: MetaPixelStats[];
  recommendations: Recommendation[];
}

export default function RiskAnalysisPanel({ metaPixels, recommendations }: Props) {
  // Compute estimated total data loss
  const dataLoss = recommendations.reduce((s, r) => s + (r.estimatedDataLoss || 0), 0);
  const cappedLoss = Math.min(50, dataLoss);

  // Risk dimensions
  const risks = [
    {
      name: "Conversion data loss",
      icon: TrendingDown,
      value: `${cappedLoss}%`,
      level: cappedLoss > 25 ? "Critical" : cappedLoss > 10 ? "High" : cappedLoss > 0 ? "Medium" : "Low",
      desc: "Estimated % of conversions not being captured",
    },
    {
      name: "Attribution accuracy",
      icon: Target,
      value: metaPixels.length > 0
        ? `${Math.max(0, 100 - Math.round(metaPixels[0]?.funnelIntegrity.brokenAttributionChains / 10))}%`
        : "—",
      level: metaPixels[0]?.funnelIntegrity.brokenAttributionChains > 100 ? "High" : "Low",
      desc: "Quality of campaign-to-conversion attribution",
    },
    {
      name: "Signal completeness",
      icon: ShieldAlert,
      value: metaPixels.length > 0 && metaPixels[0]?.emq?.overallScore
        ? `${metaPixels[0].emq.overallScore.toFixed(1)}/10`
        : "—",
      level: (metaPixels[0]?.emq?.overallScore ?? 10) < 6 ? "High" : "Low",
      desc: "Event Match Quality of the primary pixel",
    },
    {
      name: "Anomalies detected",
      icon: AlertOctagon,
      value: String(metaPixels.reduce((s, p) => s + p.anomalies.length, 0)),
      level: metaPixels.reduce((s, p) => s + p.anomalies.length, 0) > 0 ? "High" : "Low",
      desc: "Sudden drops/spikes in last 24h",
    },
  ];

  const levelColor = (l: string) =>
    l === "Critical" ? "bg-red-100 text-red-700 border-red-300" :
    l === "High" ? "bg-orange-100 text-orange-700 border-orange-300" :
    l === "Medium" ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
    "bg-green-100 text-green-700 border-green-300";

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-bold text-gray-900">Risk Analysis</h3>
        </div>
        <span className="text-xs text-gray-500">Across all connected platforms</span>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {risks.map((r) => (
          <div key={r.name} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <r.icon className="w-4 h-4 text-gray-600" />
                <div className="text-sm font-semibold text-gray-900">{r.name}</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${levelColor(r.level)}`}>
                {r.level}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{r.value}</div>
            <div className="text-xs text-gray-500 mt-1">{r.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
