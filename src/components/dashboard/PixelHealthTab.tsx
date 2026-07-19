import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { Activity, CheckCircle2, AlertCircle, AlertTriangle, Settings2, ExternalLink, Sparkles, Loader2, ArrowRight } from "lucide-react";
import LoadingState from "@/components/shared/LoadingState";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { TermText } from "@/components/shared/Term";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "dv360" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function PixelHealthTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { meta, loading, error } = useAudit(platform, dateRange, customStart, customEnd);
  const { sorted: sortedPixels, sort: pixelSort, toggle: pixelToggle } = useSort(
    (meta?.pixels || []).map(p => ({ ...p, capiPct: p.capi.serverShare })),
    "totalEvents", "desc"
  );
  const { sorted: sortedEvents, sort: eventSort, toggle: eventToggle } = useSort(
    ((meta?.pixels || []).flatMap(p => p.eventBreakdown) || []).map(e => ({ ...e, fired: e.count })),
    "fired", "desc"
  );

  if (loading) {
    return <LoadingState message="Loading pixel data…" />;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
        <p className="font-semibold mb-1">Failed to load pixel data</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const pixels = meta?.pixels || [];
  const activePixels = pixels.filter((p) => p.status === "active").length;
  const totalEvents = pixels.reduce((s, p) => s + p.totalEvents, 0);
  // Browser vs Server (CAPI) totals — sourced from pixel-level capi.browserShare /
  // serverShare which come from aggregation=event_source. Per-event browserCount/
  // serverCount are always 0 (Meta doesn't expose that breakdown), so we compute
  // absolute counts by applying the share percentages to the pixel's totalEvents.
  const totalServer = pixels.reduce(
    (s, p) => s + Math.round((p.capi.serverShare / 100) * p.totalEvents),
    0
  );
  const totalBrowser = pixels.reduce(
    (s, p) => s + Math.round((p.capi.browserShare / 100) * p.totalEvents),
    0
  );
  const capiSharePct = totalEvents > 0 ? Math.round((totalServer / totalEvents) * 100) : 0;

  // Aggregate real event totals per event name across all pixels.
  // browserCount/serverCount are NOT aggregated here — Meta doesn't expose
  // per-event source breakdown. The overall browser/server totals come from
  // capi.browserShare/serverShare and are shown in the KPI cards above.
  const eventMap = new Map<string, number>();
  for (const p of pixels) {
    for (const e of p.eventBreakdown) {
      eventMap.set(e.event, (eventMap.get(e.event) || 0) + e.count);
    }
  }
  // CAPI is active for the whole pixel if any server events were recorded.
  const capiActive = totalServer > 0;
  const eventBreakdown = Array.from(eventMap.entries())
    .map(([event, fired]) => ({ event, fired }))
    .sort((a, b) => b.fired - a.fired);

  return (
    <div className="space-y-6 section-enter">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Activity className="w-8 h-8 text-red-600" /> Pixel Health Monitor
          </h1>
          <p className="text-gray-600 mt-1">Active pixel status, event firing, and deduplication</p>
        </div>
        <AIExecutiveSummary
          tabName="Pixel Health"
          context={{
            pixelCount: pixels.length,
            activePixels,
            totalEvents,
            capiSharePct,
            topEvents: sortedEvents.slice(0, 5).map(e => ({ event: e.event, count: e.count })),
          }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={String(dateRange)}
          inline
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-1">
          <div className="text-sm text-gray-600">Active Pixels</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{activePixels}/{pixels.length}</div>
          <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Healthy
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-2">
          <div className="text-sm text-gray-600">Total Events</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{(totalEvents / 1000).toFixed(1)}K</div>
          <div className="text-xs text-gray-500 mt-1">In selected range</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-3">
          <div className="text-sm text-gray-600"><TermText>Server (CAPI) Events</TermText></div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{(totalServer / 1000).toFixed(1)}K</div>
          <div className="text-xs text-gray-500 mt-1">Browser: {(totalBrowser / 1000).toFixed(1)}K</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-4">
          <div className="text-sm text-gray-600"><TermText>CAPI Share</TermText></div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{capiSharePct}%</div>
          <div className="text-xs text-gray-500 mt-1">Events sent server-side</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Pixel Overview</h2>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="name" sort={pixelSort} onToggle={pixelToggle} className="px-6 py-3"><TermText>Pixel Name</TermText></SortTh>
                <th className="px-6 py-3 text-left font-semibold text-gray-700"><TermText>Pixel ID</TermText></th>
                <SortTh col="status" sort={pixelSort} onToggle={pixelToggle} className="px-6 py-3">Status</SortTh>
                <SortTh col="totalEvents" sort={pixelSort} onToggle={pixelToggle} className="px-6 py-3" align="right">Events</SortTh>
                <SortTh col="capiPct" sort={pixelSort} onToggle={pixelToggle} className="px-6 py-3" align="right"><TermText>CAPI %</TermText></SortTh>
              </tr>
            </thead>
            <tbody>
              {sortedPixels.map((p, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{p.name}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs">{p.pixelId}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${p.status === "active" ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100"}`}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-900">{p.totalEvents.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{p.capi.serverShare}%</td>
                </tr>
              ))}
              {pixels.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No pixel data available. Connect a Meta account to begin auditing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pixel Configuration cards FIRST (moved above Event Breakdown) */}
      <PixelConfigCards pixels={pixels} />

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Event Breakdown — Browser vs Server</h2>
          <p className="text-sm text-gray-600 mt-1">CAPI deduplication and event firing comparison</p>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="event" sort={eventSort} onToggle={eventToggle} className="px-6 py-3">Event</SortTh>
                <SortTh col="fired" sort={eventSort} onToggle={eventToggle} className="px-6 py-3" align="right">Total Fired</SortTh>
                <th className="px-6 py-3 text-center font-semibold text-gray-700">CAPI Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedEvents.map((e, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{e.event}</td>
                  <td className="px-6 py-4 text-right text-gray-900 font-semibold">{e.fired.toLocaleString()}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${capiActive ? "text-green-700 bg-green-100" : "text-yellow-700 bg-yellow-100"}`}>
                      {capiActive ? "CAPI active" : "Browser only"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* OLD location removed — now rendered above Event Breakdown via PixelConfigCards */}
      {false && pixels.map((p) => (
        <div key={`config-${p.pixelId}`} className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-gray-600" />
              <h2 className="text-base font-bold text-gray-900">
                Pixel Configuration — {p.name}
                <span className="ml-2 text-xs font-mono text-gray-400">{p.pixelId}</span>
              </h2>
            </div>
            <a
              href={`https://business.facebook.com/events_manager2/pixel/${p.pixelId}/diagnostics`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold"
            >
              Open in Events Manager <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="p-5 space-y-4">
            {/* Configuration grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: "Status", value: p.config?.isUnavailable ? "Unavailable ⚠" : "Active", good: !p.config?.isUnavailable },
                { label: "Data Use Setting", value: p.config?.dataUseSetting?.replace(/_/g, " ") || "—", good: true },
                { label: "Auto-Matching", value: p.config?.automaticMatchingEnabled ? "Enabled ✓" : "Disabled ✗", good: p.config?.automaticMatchingEnabled },
                { label: "Last Fired", value: p.config?.lastFiredTime ? new Date(p.config.lastFiredTime).toLocaleString() : "—", good: !!p.config?.lastFiredTime },
                { label: "Created", value: p.config?.createdAt ? new Date(p.config.createdAt).toLocaleDateString() : "—", good: true },
                { label: "Owner Business", value: p.config?.ownerBusiness?.name || "—", good: true },
              ].map((row) => (
                <div key={row.label} className="border border-gray-100 rounded p-3">
                  <div className="text-xs text-gray-500 mb-0.5">{row.label}</div>
                  <div className={`text-sm font-semibold ${row.good === false ? "text-red-600" : "text-gray-900"}`}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Auto-matching fields */}
            {p.config?.automaticMatchingEnabled && (p.config.automaticMatchingFields?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1.5">Auto-matched parameters</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.config!.automaticMatchingFields!.map((f: string) => (
                    <span key={f} className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-[11px] font-semibold">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Diagnostics — errors & warnings from /{pixel}/diagnostics */}
            {p.diagnostics.issues.length > 0 ? (
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                  {p.diagnostics.errors > 0 && (
                    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded text-[11px] font-bold">
                      <AlertCircle className="w-3 h-3" /> {p.diagnostics.errors} error{p.diagnostics.errors > 1 ? "s" : ""}
                    </span>
                  )}
                  {p.diagnostics.warnings > 0 && (
                    <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-[11px] font-bold">
                      <AlertTriangle className="w-3 h-3" /> {p.diagnostics.warnings} warning{p.diagnostics.warnings > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-gray-500">from Meta Pixel Diagnostics API</span>
                </div>
                <div className="space-y-2">
                  {p.diagnostics.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2.5 rounded-lg p-3 border ${
                        issue.severity === "error"
                          ? "bg-red-50 border-red-200"
                          : "bg-yellow-50 border-yellow-200"
                      }`}
                    >
                      {issue.severity === "error" ? (
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{issue.message}</div>
                        {issue.affectedEvent && (
                          <div className="text-xs text-gray-500 mt-0.5">Affected event: <span className="font-mono">{issue.affectedEvent}</span></div>
                        )}
                        {issue.code && issue.code !== "unknown" && (
                          <div className="text-[10px] text-gray-400 mt-0.5 font-mono">Code: {issue.code}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                No errors or warnings detected. Pixel diagnostics are clean.
              </div>
            )}
          </div>
        </div>
      ))}

      <TabSummaryFooter
        tabName="Pixel Health"
        lines={[
          ...(platform !== "dv360" ? [
            `${pixels.length} pixel${pixels.length !== 1 ? "s" : ""} found, ${activePixels} active — ${totalEvents.toLocaleString()} total events in the selected window.`,
            `CAPI (server-side) share: ${capiSharePct}% — ${capiSharePct >= 50 ? "good server-side coverage" : capiSharePct > 0 ? "browser events dominate; consider expanding CAPI" : "no server-side events detected — CAPI may not be configured"}.`,
            `${activePixels < pixels.length ? `${pixels.length - activePixels} pixel(s) inactive — verify they are still needed or pause them.` : "All pixels are active and firing."}`,
          ] : []),
        ]}
        context={{
          pixelCount: pixels.length,
          activePixels,
          totalEvents,
          capiSharePct,
          pixels: pixels.map(p => ({
            pixelName: p.name,
            pixelId: p.pixelId,
            status: p.status,
            totalEvents: p.totalEvents,
            capiShare: p.capi.serverShare,
            browserShare: p.capi.browserShare,
            eventBreakdown: p.eventBreakdown.map(e => ({ event: e.event, count: e.count })),
          })),
        }}
        platform={platform === "both" ? "meta" : (platform ?? "meta")}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}

// ---------- PixelConfigCards sub-component ----------
import type { MetaPixelStats } from "@/lib/api-clients/meta";

function PixelConfigCards({ pixels }: { pixels: MetaPixelStats[] }) {
  const { addAiCredits } = useAuthStore(); const [aiStatus, setAiStatus] = useState<Record<string, "idle" | "loading" | "done" | "error">>({});
  const [aiInsight, setAiInsight] = useState<Record<string, string>>({});

  const fetchFix = async (pixelId: string, issue: { code: string; message: string; severity: string; affectedEvent?: string }) => {
    const key = `${pixelId}-${issue.code}-${issue.message.slice(0, 20)}`;
    setAiStatus((s) => ({ ...s, [key]: "loading" }));
    try {
      const r = await fetch("/api/recommendations/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric: issue.code !== "unknown" ? issue.code : "pixel_error",
          value: issue.message,
          status: issue.severity === "error" ? "critical" : "bad",
          platform: "meta",
          threshold: issue.affectedEvent ? `Affected event: ${issue.affectedEvent}` : undefined,
          auditContext: { module: "Pixel Health", siblingMetrics: { "Pixel ID": pixelId, "Error code": issue.code } },
        }),
      });
      const data = await r.json();
      if (r.ok && data.steps?.length > 0) {
        setAiInsight((s) => ({ ...s, [key]: data.steps.slice(0, 3).map((st: { action: string }) => st.action).join(" → ") })); if (data.creditsUsedUsd) addAiCredits(data.creditsUsedUsd);
        setAiStatus((s) => ({ ...s, [key]: "done" }));
      } else {
        setAiInsight((s) => ({ ...s, [key]: data.error || "No insight available." }));
        setAiStatus((s) => ({ ...s, [key]: "error" }));
      }
    } catch {
      setAiStatus((s) => ({ ...s, [key]: "error" }));
    }
  };

  return (
    <>
      {pixels.map((p) => (
        <div key={`config-${p.pixelId}`} className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-gray-600" />
              <h2 className="text-base font-bold text-gray-900">
                Pixel Configuration — {p.name}
                <span className="ml-2 text-xs font-mono text-gray-400">{p.pixelId}</span>
              </h2>
            </div>
            <a
              href={`https://business.facebook.com/events_manager2/pixel/${p.pixelId}/diagnostics`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold"
            >
              Open in Events Manager <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="p-5 space-y-4">
            {/* Config grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: "Status", value: p.config?.isUnavailable ? "Unavailable ⚠" : "Active", good: !p.config?.isUnavailable },
                { label: "Data Use Setting", value: p.config?.dataUseSetting?.replace(/_/g, " ") || "—", good: true },
                { label: "Auto-Matching", value: p.config?.automaticMatchingEnabled ? "Enabled ✓" : "Disabled ✗", good: p.config?.automaticMatchingEnabled },
                { label: "Last Fired", value: p.config?.lastFiredTime ? new Date(p.config.lastFiredTime).toLocaleString() : "—", good: !!p.config?.lastFiredTime },
                { label: "Created", value: p.config?.createdAt ? new Date(p.config.createdAt).toLocaleDateString() : "—", good: true },
                { label: "Owner Business", value: p.config?.ownerBusiness?.name || "—", good: true },
              ].map((row) => (
                <div key={row.label} className="border border-gray-100 rounded p-3">
                  <div className="text-xs text-gray-500 mb-0.5">{row.label}</div>
                  <div className={`text-sm font-semibold ${row.good === false ? "text-red-600" : "text-gray-900"}`}>{row.value}</div>
                </div>
              ))}
            </div>

            {/* Auto-matching fields */}
            {p.config?.automaticMatchingEnabled && (p.config.automaticMatchingFields?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1.5">Auto-matched parameters</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.config!.automaticMatchingFields!.map((f: string) => (
                    <span key={f} className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-[11px] font-semibold">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Diagnostics */}
            {p.diagnostics.issues.length > 0 ? (
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                  {p.diagnostics.errors > 0 && (
                    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded text-[11px] font-bold">
                      <AlertCircle className="w-3 h-3" /> {p.diagnostics.errors} error{p.diagnostics.errors > 1 ? "s" : ""}
                    </span>
                  )}
                  {p.diagnostics.warnings > 0 && (
                    <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-[11px] font-bold">
                      <AlertTriangle className="w-3 h-3" /> {p.diagnostics.warnings} warning{p.diagnostics.warnings > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-gray-500">from Meta Pixel Diagnostics API</span>
                </div>
                <div className="space-y-2">
                  {p.diagnostics.issues.map((issue, i) => {
                    const key = `${p.pixelId}-${issue.code}-${issue.message.slice(0, 20)}`;
                    const status = aiStatus[key] ?? "idle";
                    const insight = aiInsight[key];
                    return (
                      <div
                        key={i}
                        className={`rounded-lg border ${issue.severity === "error" ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}
                      >
                        <div className="flex items-start gap-2.5 p-3">
                          {issue.severity === "error"
                            ? <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-900">{issue.message}</div>
                            {issue.affectedEvent && (
                              <div className="text-xs text-gray-500 mt-0.5">Affected event: <span className="font-mono">{issue.affectedEvent}</span></div>
                            )}
                            {issue.code && issue.code !== "unknown" && (
                              <div className="text-[10px] text-gray-400 mt-0.5 font-mono">Code: {issue.code}</div>
                            )}
                          </div>
                          {/* AI fix button */}
                          {status === "idle" && (
                            <button
                              onClick={() => fetchFix(p.pixelId, issue)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 shrink-0"
                            >
                              <Sparkles className="w-3 h-3" /> How to fix
                            </button>
                          )}
                          {status === "loading" && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 shrink-0">
                              <Loader2 className="w-3 h-3 animate-spin" />
                            </span>
                          )}
                        </div>
                        {/* AI insight shown inline below the error */}
                        {(status === "done" || status === "error") && insight && (
                          <div className={`border-t px-3 py-2 text-xs rounded-b-lg ${status === "done" ? "bg-blue-50 border-blue-200 text-blue-900" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
                            {status === "done" && <span className="font-semibold">How to fix: </span>}
                            {insight}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                No errors or warnings detected. Pixel diagnostics are clean.
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
