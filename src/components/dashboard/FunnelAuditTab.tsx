import { useAuthStore } from "@/store/auth";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { useAudit } from "@/hooks/useAudit";
import { useFloodlight } from "@/hooks/useFloodlight";
import type { DateRange } from "@/components/shared/DateRangePicker";
import FixRecommendation from "@/components/shared/FixRecommendation";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import ConnectCta from "@/components/shared/ConnectCta";
import { TermText } from "@/components/shared/Term";
import BenchmarkSourceSwitcher from "@/components/dashboard/BenchmarkSourceSwitcher";
import { AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";

interface Props {
  platform?: "meta" | "dv360" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function FunnelAuditTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { customBenchmarks, isMetaConnected, isDV360Connected, demoMode, benchmarkSnapshots, activeBenchmarkId } = useAuthStore();
  const { meta, loading: auditLoading, error: auditError } = useAudit(platform, dateRange, customStart, customEnd);
  const metaOn = isMetaConnected() || demoMode;
  const dv360On = isDV360Connected() || demoMode;
  const showMeta = metaOn && (platform === "meta" || platform === "both");
  const showDV360 = dv360On && (platform === "dv360" || platform === "both");
  const activeSnapshot = benchmarkSnapshots.find((s) => s.id === activeBenchmarkId);

  // DV360 conversion funnel is built from Floodlight activities — the real
  // equivalent of Meta's pixel-event funnel. Each activity is a conversion
  // stage; we rank by 14d conversion volume (Floodlight doesn't declare a
  // funnel sequence via API, so order is inferred from volume).
  const { data: floodlight, loading: flLoading } = useFloodlight();
  const dv360Funnel = (() => {
    const acts = (floodlight?.activities || [])
      .map((a) => ({ name: a.name, conversions: a.conversions14d.reduce((s, v) => s + v, 0), servingStatus: a.servingStatus }))
      .filter((a) => a.conversions > 0)
      .sort((a, b) => b.conversions - a.conversions);
    if (acts.length === 0) return [];
    const top = acts[0].conversions;
    return acts.map((a, i) => {
      const prev = i === 0 ? top : acts[i - 1].conversions;
      const rate = +((a.conversions / top) * 100).toFixed(1);
      const dropOff = i === 0 ? 0 : +((1 - a.conversions / prev) * 100).toFixed(1);
      return { stage: a.name, count: a.conversions, rate, dropOff, servingStatus: a.servingStatus };
    });
  })();

  // Resolve a benchmark value for a stage. Falls back to the hardcoded value
  // baked into the funnel data when the active source doesn't define this stage.
  const benchFor = (stage: string, fallback: number): number => {
    const v = activeSnapshot?.values?.[stage];
    return typeof v === "number" ? v : fallback;
  };

  const dropOffThreshold = customBenchmarks.funnelDropOffThreshold * 100;
  const dropOffWarningThreshold = dropOffThreshold * 0.7;

  const getDropOffStatus = (dropOff: number) => {
    if (dropOff === 0) return "Healthy";
    if (dropOff <= dropOffWarningThreshold) return "Healthy";
    if (dropOff <= dropOffThreshold) return "Moderate";
    return "Critical";
  };
  const STATUS_RANK: Record<string, number> = { Critical: 2, Moderate: 1, Healthy: 0 };
  const withRank = (s: string) => STATUS_RANK[s] ?? 0;

  // Derive funnel counts from real pixel data when available (date-scoped via useAudit).
  // Falls back to illustrative demo numbers when no real connection exists.
  const buildMetaFunnel = () => {
    const pixels = meta?.pixels || [];
    if (pixels.length > 0) {
      // Aggregate event counts across all pixels for the selected date window.
      const eventMap: Record<string, number> = {};
      for (const p of pixels) {
        for (const e of p.eventBreakdown) {
          eventMap[e.event] = (eventMap[e.event] || 0) + e.count;
        }
      }
      const stages = [
        { stage: "PageView", defaultBenchmark: 100 },
        { stage: "ViewContent", defaultBenchmark: 80 },
        { stage: "AddToCart", defaultBenchmark: 25 },
        { stage: "InitiateCheckout", defaultBenchmark: 10 },
        { stage: "AddPaymentInfo", defaultBenchmark: 7 },
        { stage: "Purchase", defaultBenchmark: 3 },
      ];
      const topCount = eventMap["PageView"] || 1;
      return stages.map((s, i) => {
        const count = eventMap[s.stage] || 0;
        const rate = topCount > 0 ? +(count / topCount * 100).toFixed(1) : 0;
        const prevCount = i === 0 ? topCount : (eventMap[stages[i - 1].stage] || 1);
        const dropOff = prevCount > 0 ? Math.round((1 - count / prevCount) * 100) : 0;
        const status = getDropOffStatus(dropOff);
        return { stage: s.stage, count, rate, dropOff, benchmark: benchFor(s.stage, s.defaultBenchmark), status, statusRank: withRank(status) };
      });
    }
    // Demo fallback
    return [0, 24, 52, 67, 27, 23].map((dropOff, i) => {
      const stages = [
        { stage: "PageView",          count: 125000, rate: 100,  benchmark: benchFor("PageView", 100) },
        { stage: "ViewContent",       count: 95000,  rate: 76,   benchmark: benchFor("ViewContent", 80) },
        { stage: "AddToCart",         count: 45000,  rate: 36,   benchmark: benchFor("AddToCart", 25) },
        { stage: "InitiateCheckout",  count: 15000,  rate: 12,   benchmark: benchFor("InitiateCheckout", 10) },
        { stage: "AddPaymentInfo",    count: 11000,  rate: 8.8,  benchmark: benchFor("AddPaymentInfo", 7) },
        { stage: "Purchase",          count: 8500,   rate: 6.8,  benchmark: benchFor("Purchase", 3) },
      ][i];
      const status = getDropOffStatus(dropOff);
      return { ...stages, dropOff, status, statusRank: withRank(status) };
    });
  };

  const funnelMeta = buildMetaFunnel();
  const { sorted: sortedMeta, sort: metaSort, toggle: metaToggle } = useSort(funnelMeta, "dropOff", "desc");


  // Build recommendations from REAL funnel data — no hardcoded values.
  // Every Critical/Moderate stage gets an entry with its actual drop-off % and benchmark.
  const siblingMap: Record<string, string | number> = {};
  funnelMeta.forEach((f) => { siblingMap[`${f.stage} drop-off`] = `${f.dropOff}%`; siblingMap[`${f.stage} rate`] = `${f.rate}%`; });

  const recommendations = funnelMeta
    .filter((f) => f.status === "Critical" || f.status === "Moderate")
    .map((f) => ({
      stage: f.stage,
      title: `${f.stage} drop-off is ${f.dropOff}% — benchmark is ${f.benchmark}%`,
      severity: (f.status === "Critical" ? "Critical" : "Medium") as "Critical" | "High" | "Medium",
      impact: f.dropOff > 50 ? "High conversion impact" : "Moderate conversion impact",
      metric: f.dropOff > 30 ? "funnel_leakage_severe" : "capi_low_dedup",
      platform: "meta" as const,
      value: `${f.dropOff}%`,
      siblingMetrics: { Stage: f.stage, "Drop-off": `${f.dropOff}%`, Benchmark: `${f.benchmark}%`, "Conversion Rate": `${f.rate}%`, ...siblingMap },
    }));

  // Per-stage static recommendations — shown inline in the table for non-Healthy rows.
  const STAGE_RECS: Record<string, string> = {
    ViewContent: "Add retargeting audiences for users who viewed but didn't add to cart. Check product page load speed and mobile UX.",
    AddToCart: "Reduce friction at the cart stage: simplify the add-to-cart flow, show trust badges, and verify the AddToCart pixel event fires on all product variants.",
    InitiateCheckout: "Offer a guest checkout option, show progress bar, and verify the InitiateCheckout event fires before any payment gateway redirect.",
    AddPaymentInfo: "Reduce payment form friction: add more payment methods (UPI, wallet), show SSL badge, and pre-fill returning user details.",
    Purchase: "Check that the Purchase event fires on the confirmation page (not just the payment gateway redirect). Verify no duplicate or missing fires.",
    add_to_cart: "Simplify cart UX, check mobile ATC button visibility, verify add_to_cart event fires on all product types.",
    begin_checkout: "Offer guest checkout, show trust signals, verify begin_checkout fires before the payment step.",
    purchase: "Ensure purchase event fires on the order confirmation page. Check for duplicate fires via browser developer tools.",
  };

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : s === "N/A" ? "text-gray-500 bg-gray-100" : "text-red-700 bg-red-100";

  const severityIcon = (severity: "Critical" | "High" | "Medium") => {
    if (severity === "Critical") return { Icon: AlertCircle, ring: "bg-red-100 text-red-600", chip: "bg-red-100 text-red-700" };
    if (severity === "High") return { Icon: AlertTriangle, ring: "bg-orange-100 text-orange-600", chip: "bg-orange-100 text-orange-700" };
    return { Icon: Info, ring: "bg-yellow-100 text-yellow-600", chip: "bg-yellow-100 text-yellow-700" };
  };

  const severityToStatus = (s: "Critical" | "High" | "Medium"): "critical" | "bad" | "warn" => {
    if (s === "Critical") return "critical";
    if (s === "High") return "bad";
    return "warn";
  };

  if (showMeta && auditLoading && !meta) return <LoadingState message="Loading funnel data…" />;

  return (
    <div className="space-y-6 section-enter">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Funnel Audit</h1>
        <p className="text-gray-600 mt-1">Conversion funnel validation and drop-off analysis</p>
      </div>
      {auditError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <span className="font-semibold">Error: </span>{auditError}
        </div>
      )}

      {/* ── Meta Section ─────────────────────────────────────────────────── */}
      {showMeta && (platform === "both") && (
        <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Meta</h2>
          <span className="text-xs text-gray-400 font-medium">Meta Ads</span>
        </div>
      )}

      {showMeta && (() => {
        // Derive all KPI cards from the real funnel data — never hardcode.
        const purchaseRow = funnelMeta.find((f) => f.stage === "Purchase");
        const convRate = purchaseRow ? purchaseRow.rate : 0;

        // Biggest single-step drop-off (skip PageView which has no drop-off).
        const worstRow = funnelMeta.filter((f) => f.dropOff > 0).reduce<typeof funnelMeta[0] | null>(
          (best, f) => (!best || f.dropOff > best.dropOff ? f : best), null
        );
        const stageNames: Record<string, string> = {
          ViewContent: "Page → Content",
          AddToCart: "Content → Cart",
          InitiateCheckout: "Cart → Checkout",
          AddPaymentInfo: "Checkout → Payment",
          Purchase: "Payment → Purchase",
        };
        const worstLabel = worstRow ? (stageNames[worstRow.stage] || worstRow.stage) : "—";

        const criticalCount = funnelMeta.filter((f) => f.status === "Critical").length;
        const healthScore = Math.max(0, Math.round(100 - criticalCount * 15 - (funnelMeta.filter(f => f.status === "Moderate").length * 7)));
        const healthTone = healthScore >= 80 ? "text-green-600" : healthScore >= 60 ? "text-yellow-600" : "text-red-600";
        const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 60 ? "Moderate — needs attention" : "Critical — immediate action needed";

        return (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-1">
              <div className="text-sm text-gray-600">Funnel Health</div>
              <div className={`text-3xl font-bold mt-1 ${healthTone}`}>{healthScore}</div>
              <div className="text-xs text-gray-500 mt-1">{healthLabel}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-2">
              <div className="text-sm text-gray-600">Conversion Rate</div>
              <div className="text-3xl font-bold text-gray-900 mt-1">
                {auditLoading && convRate === 0 ? <span className="text-gray-400 text-xl">Loading…</span> : `${convRate}%`}
              </div>
              <div className="text-xs text-gray-500 mt-1">PageView → Purchase</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-3">
              <div className="text-sm text-gray-600">Biggest Drop-off</div>
              <div className="text-3xl font-bold text-red-600 mt-1">{worstRow ? `${worstRow.dropOff}%` : "—"}</div>
              <div className="text-xs text-gray-500 mt-1">{worstLabel}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-4">
              <div className="text-sm text-gray-600">Critical Issues</div>
              <div className="text-3xl font-bold text-red-600 mt-1">{criticalCount}</div>
              <div className="text-xs text-gray-500 mt-1">{criticalCount > 0 ? "Requires immediate fix" : "No critical issues"}</div>
            </div>
          </div>
        );
      })()}

      {showMeta ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Meta Funnel — Pixel Events</h2>
            <p className="text-sm text-gray-600 mt-1"><TermText>Conversion stages and drop-off rates vs. benchmarks</TermText></p>
          </div>
          <div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <SortTh col="stage" sort={metaSort} onToggle={metaToggle} className="px-6 py-3">Stage</SortTh>
                  <SortTh col="count" sort={metaSort} onToggle={metaToggle} className="px-6 py-3" align="right">Users</SortTh>
                  <SortTh col="rate" sort={metaSort} onToggle={metaToggle} className="px-6 py-3" align="right">Rate</SortTh>
                  <SortTh col="dropOff" sort={metaSort} onToggle={metaToggle} className="px-6 py-3" align="right">Drop-off</SortTh>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">
                    <span className="inline-flex items-center justify-end">
                      Benchmark
                      <BenchmarkSourceSwitcher
                        stages={["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "view_item", "add_to_cart", "begin_checkout", "purchase"]}
                        platform="both"
                      />
                    </span>
                  </th>
                  <SortTh col="statusRank" sort={metaSort} onToggle={metaToggle} className="px-6 py-3" align="center">Status</SortTh>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sortedMeta.map((f, idx) => (
                  <tr key={idx} className={`border-b border-gray-100 hover:bg-gray-50 align-top ${f.status === "Critical" ? "bg-red-50/30" : ""}`}>
                    <td className="px-6 py-4 font-semibold text-gray-900">{f.stage}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{f.count.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-semibold">{f.rate}%</td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {f.dropOff > 0
                        ? <span className={f.status === "Critical" ? "text-red-600" : f.status === "Moderate" ? "text-yellow-600" : "text-gray-500"}>-{f.dropOff}%</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-700">{f.benchmark}%</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(f.status)}`}>{f.status}</span>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      {f.status === "Healthy"
                        ? <span className="text-xs text-green-700">✓ No action needed</span>
                        : <>
                            <p className="text-xs text-gray-700 leading-snug">{STAGE_RECS[f.stage] || "Review drop-off and optimise the user journey at this stage."}</p>
                            <AIRecommendationButton
                              metric={`Funnel ${f.stage} drop-off`}
                              value={f.dropOff}
                              status={f.status === "Critical" ? "critical" : "moderate"}
                              platform="meta"
                              auditContext={{ module: "Funnel Audit", siblingMetrics: { dropOff: f.dropOff, benchmark: f.benchmark, rate: f.rate } }}
                            />
                          </>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : platform !== "dv360" ? (
        <ConnectCta platform="Meta" />
      ) : null}

      {/* ── DV360 Section — Floodlight conversion funnel ─────────────────── */}
      {showDV360 && platform === "both" && (
        <div className="flex items-center gap-3 pt-4 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">DV360</h2>
          <span className="text-xs text-gray-400 font-medium">Floodlight conversion funnel</span>
        </div>
      )}

      {showDV360 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Floodlight Conversion Funnel</h2>
            <p className="text-xs text-gray-500 mt-1">
              Each Floodlight activity is a conversion stage — the DV360 equivalent of a pixel-event funnel.
              Stages are ranked by 14-day conversion volume (Floodlight doesn&apos;t declare a funnel sequence via API, so order is inferred from volume).
            </p>
          </div>

          {flLoading ? (
            <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Floodlight conversion data…
            </div>
          ) : dv360Funnel.length >= 2 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                    <th className="text-left px-6 py-3">Stage (Floodlight activity)</th>
                    <th className="text-right px-6 py-3">Conversions (14d)</th>
                    <th className="text-right px-6 py-3">% of top</th>
                    <th className="text-right px-6 py-3">Drop-off</th>
                    <th className="text-center px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dv360Funnel.map((s, i) => (
                    <tr key={s.stage} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900 max-w-[280px] truncate" title={s.stage}>{s.stage}</td>
                      <td className="px-6 py-3 text-right text-gray-700 tabular-nums">{s.count.toLocaleString("en-IN")}</td>
                      <td className="px-6 py-3 text-right text-gray-700 tabular-nums">{s.rate}%</td>
                      <td className={`px-6 py-3 text-right tabular-nums ${i === 0 ? "text-gray-400" : s.dropOff >= 70 ? "text-red-600" : s.dropOff >= 40 ? "text-amber-600" : "text-gray-700"}`}>
                        {i === 0 ? "—" : `${s.dropOff}%`}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(s.servingStatus === "ENABLED" ? "Healthy" : "Moderate")}`}>
                          {s.servingStatus === "ENABLED" ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : dv360Funnel.length === 1 ? (
            <div className="p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Info className="w-4 h-4 text-blue-500 shrink-0" />
                Only one Floodlight activity has conversions, so a multi-stage funnel can&apos;t be built.
              </div>
              <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-between">
                <span className="font-medium text-gray-900 truncate" title={dv360Funnel[0].stage}>{dv360Funnel[0].stage}</span>
                <span className="text-gray-700 tabular-nums">{dv360Funnel[0].count.toLocaleString("en-IN")} conversions (14d)</span>
              </div>
              <div className="text-xs text-gray-400">
                A full conversion funnel needs multiple Floodlight activities mapped to different stages (e.g. Site Visit → Add to Cart → Purchase). See the <strong>Floodlight Health</strong> tab for full activity detail.
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-gray-500 space-y-1">
              <div>No Floodlight conversions found in the last 14 days.</div>
              <div className="text-xs text-gray-400">
                {floodlight?.note || "Assign Floodlight activities to line items in DV360, or verify conversion tracking. See the Floodlight Health tab for detail."}
              </div>
            </div>
          )}
        </div>
      )}

      {!showMeta && !showDV360 && (
        <ConnectCta platform="Meta" context="to see funnel audit" />
      )}

      <TabSummaryFooter
        tabName="Funnel Audit"
        lines={[
          ...(showMeta ? [
            `${funnelMeta.length}-stage Meta funnel analysed — overall conversion rate: ${funnelMeta.find(f => f.stage === "Purchase")?.rate ?? 0}% (PageView → Purchase).`,
            `${recommendations.filter(r => r.severity === "Critical").length} critical drop-off issue${recommendations.filter(r => r.severity === "Critical").length !== 1 ? "s" : ""} detected — ${recommendations.length} total funnel recommendations.`,
          ] : []),
          ...(showDV360 ? [
            dv360Funnel.length >= 2
              ? `DV360 Floodlight funnel: ${dv360Funnel.length} conversion stages — top "${dv360Funnel[0].stage}" (${dv360Funnel[0].count.toLocaleString("en-IN")} conv, 14d).`
              : dv360Funnel.length === 1
                ? `DV360 Floodlight: 1 activity with conversions ("${dv360Funnel[0].stage}") — multi-stage funnel needs ≥2 activities.`
                : `DV360 Floodlight: no conversions in the last 14 days.`,
          ] : []),
        ]}
        context={{
          stages: funnelMeta.length,
          recommendations: recommendations.length,
          ...(showMeta ? {
            metaFunnel: funnelMeta.map(f => ({
              stage: f.stage,
              count: f.count,
              rate: f.rate,
              dropOff: f.dropOff,
              benchmark: f.benchmark,
              status: f.status,
            })),
            metaRecommendations: recommendations.slice(0, 8).map(r => ({ severity: r.severity, title: r.title })),
          } : {}),
          ...(showDV360 ? {
            dv360Floodlight: {
              window: "last 14 days",
              activitiesWithConversions: dv360Funnel.length,
              stages: dv360Funnel.map(f => ({ stage: f.stage, conversions14d: f.count })),
              note: dv360Funnel.length < 2 ? "Multi-stage funnel needs ≥2 Floodlight activities mapped to stages." : undefined,
            },
          } : {}),
        }}
        platform={platform ?? "meta"}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
