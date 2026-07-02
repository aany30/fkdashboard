import type { MetaPixelStats } from "@/lib/api-clients/meta";
import { Activity, AlertCircle, AlertTriangle, Clock } from "lucide-react";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

export default function DiagnosticsPanel({ pixel }: { pixel: MetaPixelStats }) {
  const d = pixel.diagnostics;
  const { sorted: sortedActivity, sort: diagSort, toggle: diagToggle } = useSort(d.recentActivity, "time", "asc");

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-bold text-gray-900">Event Manager Diagnostics</h3>
        </div>
        <div className="flex gap-3 items-center text-xs">
          <span className="text-red-600 font-semibold flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> {d.errors} errors
          </span>
          <span className="text-yellow-600 font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {d.warnings} warnings
          </span>
          <span className="text-gray-600 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {d.dataFreshnessMins}m ago
          </span>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-2">Active Issues</div>
          {d.issues.length === 0 ? (
            <div className="text-sm text-green-700 bg-green-50 rounded p-3">All clear — no diagnostics reported.</div>
          ) : (
            <div className="space-y-2">
              {d.issues.map((issue, idx) => (
                <div key={idx} className={`border rounded p-3 ${issue.severity === "error" ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}>
                  <div className="flex items-start gap-2">
                    {issue.severity === "error" ? (
                      <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900">{issue.code.replace(/_/g, " ")}</div>
                      <div className="text-xs text-gray-700 mt-0.5">{issue.message}</div>
                      {issue.affectedEvent && (
                        <div className="text-xs text-gray-500 mt-1">Event: <span className="font-mono">{issue.affectedEvent}</span></div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 mb-2">Recent Activity</div>
          <div className="overflow-hidden border border-gray-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <SortTh col="time" sort={diagSort} onToggle={diagToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Time</SortTh>
                  <SortTh col="event" sort={diagSort} onToggle={diagToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Event</SortTh>
                  <SortTh col="type" sort={diagSort} onToggle={diagToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Source</SortTh>
                  <SortTh col="status" sort={diagSort} onToggle={diagToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Status</SortTh>
                </tr>
              </thead>
              <tbody>
                {sortedActivity.map((a, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-500">{a.time}</td>
                    <td className="px-3 py-2 font-mono text-gray-900">{a.event}</td>
                    <td className="px-3 py-2 text-gray-700">{a.type}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        a.status === "ok" ? "bg-green-100 text-green-700" :
                        a.status === "warning" ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {d.recentActivity.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-xs">No recent activity</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
