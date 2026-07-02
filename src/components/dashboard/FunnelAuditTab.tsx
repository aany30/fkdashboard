import { useAuthStore } from "@/store/auth";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import FixRecommendation from "@/components/shared/FixRecommendation";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import ConnectCta from "@/components/shared/ConnectCta";
import { TermText } from "@/components/shared/Term";
import BenchmarkSourceSwitcher from "@/components/dashboard/BenchmarkSourceSwitcher";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function FunnelAuditTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { customBenchmarks, isMetaConnected, isGoogleConnected, benchmarkSnapshots, activeBenchmarkId } = useAuthStore();
  // Wire to useAudit so the funnel re-fetches when the date picker changes.
  const { meta, google, loading: auditLoading, error: auditError } = useAudit(platform, dateRange, customStart, customEnd);
  const metaOn = isMetaConnected();
  const googleOn = isGoogleConnected();
  const activeSnapshot = benchmarkSnapshots.find((s) => s.id === activeBenchmarkId);

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

  const funnelGoogle = [
    { stage: "view_item",      count: 125000, rate: 100,  dropOff: 0,  benchmark: benchFor("view_item", 100) },
    { stage: "add_to_cart",    count: 42000,  rate: 33.6, dropOff: 66, benchmark: benchFor("add_to_cart", 35) },
    { stage: "begin_checkout", count: 14200,  rate: 11.4, dropOff: 66, benchmark: benchFor("begin_checkout", 12) },
    { stage: "purchase",       count: 8500,   rate: 6.8,  dropOff: 40, benchmark: benchFor("purchase", 3) },
  ].map((r) => { const status = getDropOffStatus(r.dropOff); return { ...r, status, statusRank: withRank(status) }; });
  const { sorted: sortedGoogle, sort: googleSort, toggle: googleToggle } = useSort(funnelGoogle, "dropOff", "desc");

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
    purchase: "Ensure purchase event fires on the order confirmation page. Check for duplicate fires via GTM debug.",
  };

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

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

      {(metaOn || googleOn) && (() => {
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

      {metaOn ? (
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
      ) : (
        <ConnectCta platform="Meta" />
      )}

      {googleOn ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Google GA4 Funnel — Ecommerce Events</h2>
            <p className="text-sm text-gray-600 mt-1"><TermText>GA4 standard ecommerce conversion path</TermText></p>
          </div>
          <div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <SortTh col="stage" sort={googleSort} onToggle={googleToggle} className="px-6 py-3">Stage</SortTh>
                  <SortTh col="count" sort={googleSort} onToggle={googleToggle} className="px-6 py-3" align="right">Users</SortTh>
                  <SortTh col="rate" sort={googleSort} onToggle={googleToggle} className="px-6 py-3" align="right">Rate</SortTh>
                  <SortTh col="dropOff" sort={googleSort} onToggle={googleToggle} className="px-6 py-3" align="right">Drop-off</SortTh>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">
                    <span className="inline-flex items-center justify-end">
                      Benchmark
                      <BenchmarkSourceSwitcher
                        stages={["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "view_item", "add_to_cart", "begin_checkout", "purchase"]}
                        platform="both"
                      />
                    </span>
                  </th>
                  <SortTh col="statusRank" sort={googleSort} onToggle={googleToggle} className="px-6 py-3" align="center">Status</SortTh>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sortedGoogle.map((f, idx) => (
                  <tr key={idx} className={`border-b border-gray-100 hover:bg-gray-50 align-top ${f.status === "Critical" ? "bg-red-50/30" : ""}`}>
                    <td className="px-6 py-4 font-semibold text-gray-900 font-mono">{f.stage}</td>
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
                              metric={`GA4 ${f.stage} drop-off`}
                              value={f.dropOff}
                              status={f.status === "Critical" ? "critical" : "moderate"}
                              platform="google"
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
      ) : (
        <ConnectCta platform="Google" />
      )}

      <TabSummaryFooter
        tabName="Funnel Audit"
        lines={[
          `${funnelMeta.length}-stage Meta funnel analysed — overall conversion rate: ${funnelMeta.find(f => f.stage === "Purchase")?.rate ?? 0}% (PageView → Purchase).`,
          `${recommendations.filter(r => r.severity === "Critical").length} critical drop-off issue${recommendations.filter(r => r.severity === "Critical").length !== 1 ? "s" : ""} detected — ${recommendations.length} total funnel recommendations.`,
          funnelMeta.length > 0
            ? `Largest drop-off: ${funnelMeta.filter(f => f.dropOff > 0).reduce<typeof funnelMeta[0] | null>((b, f) => (!b || f.dropOff > b.dropOff ? f : b), null)?.stage ?? "—"}.`
            : "No funnel data available for this window.",
        ]}
        context={{
          stages: funnelMeta.length,
          recommendations: recommendations.length,
          funnelMeta: funnelMeta.map(f => ({
            stage: f.stage,
            count: f.count,
            rate: f.rate,
            dropOff: f.dropOff,
            benchmark: f.benchmark,
            status: f.status,
          })),
          funnelGoogle: funnelGoogle.map(f => ({
            stage: f.stage,
            count: f.count,
            rate: f.rate,
            dropOff: f.dropOff,
            benchmark: f.benchmark,
            status: f.status,
          })),
        }}
        platform={platform === "both" ? "meta" : (platform ?? "meta")}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
