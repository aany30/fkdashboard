import { useAuthStore } from "@/store/auth";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

export default function ActivityTab() {
  const { customBenchmarks } = useAuthStore();

  const STATUS_RANK: Record<string, number> = { Critical: 2, Moderate: 1, Healthy: 0 };
  const eventsRaw = [
    { time: "Just now", event: "Purchase", platform: "Meta", pixel: "Main Pixel", value: "$129.00", match: 9, dedup: "OK", status: "Healthy" },
    { time: "3s ago", event: "AddToCart", platform: "Meta", pixel: "Main Pixel", value: "$59.00", match: 8, dedup: "OK", status: "Healthy" },
    { time: "5s ago", event: "view_item", platform: "Google", pixel: "GA4-DEMO-001", value: "—", match: 7, dedup: "OK", status: "Healthy" },
    { time: "8s ago", event: "InitiateCheckout", platform: "Meta", pixel: "Checkout Pixel", value: "$84.00", match: 8, dedup: "OK", status: "Healthy" },
    { time: "12s ago", event: "PageView", platform: "Meta", pixel: "Main Pixel", value: "—", match: 6, dedup: "OK", status: "Healthy" },
    { time: "14s ago", event: "begin_checkout", platform: "Google", pixel: "GA4-DEMO-001", value: "$42.00", match: 6, dedup: "Warn", status: "Moderate" },
    { time: "18s ago", event: "Purchase", platform: "Meta", pixel: "Main Pixel", value: "$249.00", match: 9, dedup: "OK", status: "Healthy" },
    { time: "22s ago", event: "ViewContent", platform: "Meta", pixel: "Main Pixel", value: "—", match: 7, dedup: "OK", status: "Healthy" },
    { time: "25s ago", event: "add_to_cart", platform: "Google", pixel: "GA4-DEMO-001", value: "$32.00", match: 6, dedup: "OK", status: "Healthy" },
    { time: "28s ago", event: "AddPaymentInfo", platform: "Meta", pixel: "Checkout Pixel", value: "$179.00", match: 5, dedup: "Dup", status: "Critical" },
    { time: "31s ago", event: "PageView", platform: "Meta", pixel: "Main Pixel", value: "—", match: 6, dedup: "OK", status: "Healthy" },
    { time: "34s ago", event: "purchase", platform: "Google", pixel: "GA4-DEMO-001", value: "$199.00", match: 8, dedup: "OK", status: "Healthy" },
  ].map((e) => ({ ...e, statusRank: STATUS_RANK[e.status] ?? 0 }));
  const { sorted: events, sort: actSort, toggle: actToggle } = useSort(eventsRaw, "match", "desc");

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  const dedupColor = (d: string) =>
    d === "OK" ? "text-green-600" : d === "Warn" ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Real-time Activity</h1>
          <p className="text-gray-600 mt-1">Live event stream across Meta and Google tracking</p>
        </div>
        <div className="flex items-center gap-2 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-sm font-semibold text-green-700">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Events / Second</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">12.4</div>
          <div className="text-xs text-green-600 mt-1">↑ steady</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Events / Minute</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">744</div>
          <div className="text-xs text-gray-500 mt-1">Last 60 seconds</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Avg Match Quality</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">7.1</div>
          <div className="text-xs text-yellow-600 mt-1">Below {(customBenchmarks.metaEMQScore * 10).toFixed(1)} target</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Issues Detected</div>
          <div className="text-3xl font-bold text-red-600 mt-1">2</div>
          <div className="text-xs text-gray-500 mt-1">Last 60 seconds</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Live Event Stream</h2>
            <p className="text-sm text-gray-600 mt-1">Most recent events from connected pixels and GA4 properties</p>
          </div>
          <div className="flex gap-2">
            <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white">
              <option>All Platforms</option>
              <option>Meta</option>
              <option>Google</option>
            </select>
            <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white">
              <option>All Events</option>
              <option>Purchase only</option>
              <option>Checkout funnel</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <SortTh col="time" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Time</SortTh>
                <SortTh col="event" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Event</SortTh>
                <SortTh col="platform" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Platform</SortTh>
                <SortTh col="pixel" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Source</SortTh>
                <SortTh col="value" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Value</SortTh>
                <SortTh col="match" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Match</SortTh>
                <SortTh col="dedup" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Dedup</SortTh>
                <SortTh col="statusRank" sort={actSort} onToggle={actToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="right">Status</SortTh>
              </tr>
            </thead>
            <tbody>
              {events.map((e, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-600 text-xs font-mono">{e.time}</td>
                  <td className="px-6 py-3 font-semibold text-gray-900 font-mono text-xs">{e.event}</td>
                  <td className="px-6 py-3 text-gray-700">{e.platform}</td>
                  <td className="px-6 py-3 text-gray-600 text-xs">{e.pixel}</td>
                  <td className="px-6 py-3 text-right text-gray-900 font-semibold">{e.value}</td>
                  <td className="px-6 py-3 text-right text-gray-900">{e.match}/10</td>
                  <td className={`px-6 py-3 text-right font-semibold ${dedupColor(e.dedup)}`}>{e.dedup}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor(e.status)}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TabSummaryFooter
        tabName="Real-time Activity"
        lines={[
          `${events.length} events shown in the live stream — ${events.filter(e => e.status === "Healthy").length} healthy, ${events.filter(e => e.status === "Critical").length} critical.`,
          `${[...new Set(events.map(e => e.event))].length} unique event types across Meta and Google tracking.`,
          `Last event: ${events[0]?.event ?? "—"} (${events[0]?.time ?? "—"}).`,
        ]}
        context={{ eventCount: events.length }}
        platform="meta"
        dateRange="30d"
      />
    </div>
  );
}
