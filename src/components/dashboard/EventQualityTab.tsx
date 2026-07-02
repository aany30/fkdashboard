import { useState, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import { Sparkles, Loader2, Wrench, TrendingUp, Pencil, RotateCcw } from "lucide-react";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { Info, ExternalLink, RefreshCw } from "lucide-react";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { TermText } from "@/components/shared/Term";
import EMQBenchmarkTable from "@/components/dashboard/EMQBenchmarkTable";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

// Canonical match-key configuration — the seven keys Meta actually uses for
// EMQ scoring, with recommended benchmark ranges, business impact, and
// actionable recommendations. Each row aggregates multiple raw Meta API keys
// (e.g. `em` and `email` both feed Email Hash).
interface MatchKeyConfig {
  /** Display label shown in the table. */
  label: string;
  /** Raw Meta API keys that should be summed into this row's coverage. */
  apiKeys: string[];
  /** Inclusive benchmark range for Healthy status. */
  benchmarkMin: number;
  benchmarkMax: number;
  /** How much this key contributes to Meta's match quality. */
  impact: "High" | "Medium-High" | "Medium" | "Low";
  /** Plain-English fix for low coverage. */
  recommendation: string;
}

const MATCH_KEY_CONFIG: MatchKeyConfig[] = [
  {
    label: "Email Hash",
    apiKeys: ["em", "email"],
    benchmarkMin: 70,
    benchmarkMax: 90,
    impact: "Medium-High",
    recommendation: "Improve email capture during signup & checkout",
  },
  {
    label: "Phone Number Hash",
    apiKeys: ["ph", "phone"],
    benchmarkMin: 60,
    benchmarkMax: 85,
    impact: "High",
    recommendation: "Optimize phone collection & consent flow",
  },
  {
    label: "External ID",
    apiKeys: ["external_id"],
    benchmarkMin: 70,
    benchmarkMax: 90,
    impact: "Medium",
    recommendation: "Improve CRM / user ID syncing",
  },
  {
    label: "Client IP",
    apiKeys: ["client_ip_address", "client_ip"],
    benchmarkMin: 90,
    benchmarkMax: 100,
    impact: "High",
    recommendation: "Strong network-level signal — no action needed",
  },
  {
    label: "User Agent",
    apiKeys: ["client_user_agent", "user_agent"],
    benchmarkMin: 95,
    benchmarkMax: 100,
    impact: "High",
    recommendation: "Proper browser/device signal coverage",
  },
  {
    label: "FB Click ID (fbc)",
    apiKeys: ["fbc"],
    benchmarkMin: 60,
    benchmarkMax: 80,
    impact: "Medium-High",
    recommendation: "Ensure fbc parameter capture on landing pages",
  },
  {
    label: "FB Browser ID (fbp)",
    apiKeys: ["fbp"],
    benchmarkMin: 85,
    benchmarkMax: 100,
    impact: "High",
    recommendation: "Strong browser-level attribution signal",
  },
];

function statusForCoverage(coverage: number, min: number, max: number): {
  label: "Healthy" | "Moderate" | "Critical" | "Low";
  tone: "good" | "warn" | "bad";
} {
  if (coverage >= min) return { label: "Healthy", tone: "good" };
  if (coverage >= Math.max(0, min - 20)) return { label: "Moderate", tone: "warn" };
  if (coverage <= 5) return { label: "Low", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

// Friendly labels + recommended benchmarks for "extra" raw Meta match-key
// codes that aren't in the canonical seven (Email/Phone/External ID/Client IP/
// User Agent/fbc/fbp). Ranges are industry-standard EMQ guidance based on
// Meta's match-quality documentation — users can override any row inline.
interface ExtraKeyConfig {
  label: string;
  benchmarkMin: number;
  benchmarkMax: number;
  impact: "High" | "Medium-High" | "Medium" | "Low";
  recommendation: string;
}
const EXTRA_KEY_CONFIG: Record<string, ExtraKeyConfig> = {
  fn: { label: "First Name (fn)", benchmarkMin: 60, benchmarkMax: 80, impact: "Medium",
        recommendation: "Capture first name during signup / checkout — strong signal pair with email" },
  ln: { label: "Last Name (ln)", benchmarkMin: 60, benchmarkMax: 80, impact: "Medium",
        recommendation: "Capture last name during signup / checkout — pairs with email for stronger match" },
  ge: { label: "Gender (ge)", benchmarkMin: 30, benchmarkMax: 60, impact: "Low",
        recommendation: "Optional field — only collect if relevant to your product" },
  db: { label: "Date of Birth (db)", benchmarkMin: 30, benchmarkMax: 60, impact: "Medium",
        recommendation: "Collect for age-gated / personalised products; otherwise low priority" },
  ct: { label: "City (ct)", benchmarkMin: 50, benchmarkMax: 75, impact: "Medium",
        recommendation: "Capture at checkout / address form — supplements IP-based location" },
  st: { label: "State (st)", benchmarkMin: 50, benchmarkMax: 75, impact: "Medium",
        recommendation: "Capture at checkout / address form — pairs with city for stronger match" },
  zp: { label: "Zip (zp)", benchmarkMin: 60, benchmarkMax: 85, impact: "Medium-High",
        recommendation: "High-value match signal — capture at checkout and pass with every conversion event" },
  zip: { label: "Zip", benchmarkMin: 60, benchmarkMax: 85, impact: "Medium-High",
         recommendation: "High-value match signal — capture at checkout and pass with every conversion event" },
  country: { label: "Country", benchmarkMin: 90, benchmarkMax: 100, impact: "Medium",
             recommendation: "Should be near-universal — auto-derived from IP or checkout address" },
  fr_cookie: { label: "FR Cookie (fr_cookie)", benchmarkMin: 70, benchmarkMax: 90, impact: "High",
               recommendation: "Meta-set cookie for logged-in users — verify Pixel/CAPI consent settings allow it" },
  true_fr_cookie: { label: "True FR Cookie", benchmarkMin: 70, benchmarkMax: 90, impact: "High",
                    recommendation: "Meta-set cookie — verify consent + cookie policy allows third-party Meta cookies" },
  c_user_cookie: { label: "C-User Cookie", benchmarkMin: 70, benchmarkMax: 90, impact: "High",
                   recommendation: "Meta-set user-identity cookie — confirm cookie consent flow allows it" },
  subscription_id: { label: "Subscription ID", benchmarkMin: 50, benchmarkMax: 80, impact: "Medium-High",
                     recommendation: "For subscription businesses, pass subscription_id with renewal / cancellation events" },
  fb_login_id: { label: "FB Login ID", benchmarkMin: 5, benchmarkMax: 25, impact: "Medium",
                 recommendation: "Only available when users log in via Facebook — coverage naturally low" },
  lead_id: { label: "Lead ID", benchmarkMin: 60, benchmarkMax: 90, impact: "High",
             recommendation: "For lead-gen accounts, pass lead_id with every Meta lead-form conversion event" },
};

// Friendly fallback labels for raw keys that Meta returned but aren't in
// EXTRA_KEY_CONFIG. The benchmark cell will fall back to the global defaults
// (50-70%, Medium impact) until the user edits it.
const RAW_KEY_LABELS: Record<string, string> = {
  em: "Email (em)", email: "Email (email)", ph: "Phone (ph)", phone: "Phone (phone)",
  external_id: "External ID", client_ip: "Client IP", client_ip_address: "Client IP",
  client_user_agent: "User Agent", user_agent: "User Agent",
  fbc: "FB Click ID (fbc)", fbp: "FB Browser ID (fbp)",
  ...Object.fromEntries(Object.entries(EXTRA_KEY_CONFIG).map(([k, c]) => [k, c.label])),
};

// Default benchmarks for any unknown raw key (user can still override).
const DEFAULT_UNKNOWN_BENCHMARK = { min: 50, max: 70, impact: "Medium" as const,
  recommendation: "No standard benchmark — edit to set your team's target." };

// Shape of a Match-Key Coverage row — declared at module scope so the
// top-level `useMemo` and the deeper render branch can both reference it.
const STATUS_RANK: Record<string, number> = { Critical: 3, Low: 2, Moderate: 1, Healthy: 0 };

type MatchKeyRow = {
  label: string;
  coverage: number;
  benchmarkMin: number;
  benchmarkMax: number;
  impact: "High" | "Medium-High" | "Medium" | "Low";
  recommendation: string;
  status: { label: "Healthy" | "Moderate" | "Critical" | "Low"; tone: "good" | "warn" | "bad" };
  statusRank: number;
  isOverride: boolean;
};

export default function EventQualityTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { customBenchmarks, metaAccessToken, addAiCredits, emqKeyBenchmarks, setEmqKeyBenchmark, resetEmqKeyBenchmark } = useAuthStore();
  const { meta, loading, error } = useAudit(platform, dateRange, customStart, customEnd);

  // ALL hooks must run unconditionally on every render — React enforces this.
  // We compute matchKeyRows + run useSort at the TOP of the component, then
  // the render branches below just READ the already-computed values. (Prev bug:
  // useSort was inside `if (isRealMeta)`, after an early-return for `loading`,
  // which crashed in production with React error #310 / minified hook order.)
  const isRealMeta = !!metaAccessToken && !isDemoCredential(metaAccessToken);
  const matchKeyRows = useMemo<MatchKeyRow[]>(() => {
    if (!isRealMeta) return [];
    const pixels = meta?.pixels || [];
    const rawAgg = new Map<string, { sum: number; n: number }>();
    for (const p of pixels) {
      for (const k of p.emq.matchKeys) {
        const cur = rawAgg.get(k.key.toLowerCase()) || { sum: 0, n: 0 };
        cur.sum += k.coverage;
        cur.n += 1;
        rawAgg.set(k.key.toLowerCase(), cur);
      }
    }
    const rawCoverage = (key: string): number => {
      const a = rawAgg.get(key.toLowerCase());
      return a ? a.sum / a.n : 0;
    };
    const resolveBenchmark = (label: string, defaultMin: number, defaultMax: number) => {
      const override = emqKeyBenchmarks[label];
      if (override) return { min: override.min, max: override.max, isOverride: true };
      return { min: defaultMin, max: defaultMax, isOverride: false };
    };
    const canonicalRows: MatchKeyRow[] = MATCH_KEY_CONFIG.map((cfg) => {
      const coverage = Math.round(Math.max(0, ...cfg.apiKeys.map((k) => rawCoverage(k))));
      const b = resolveBenchmark(cfg.label, cfg.benchmarkMin, cfg.benchmarkMax);
      return {
        label: cfg.label, coverage,
        benchmarkMin: b.min, benchmarkMax: b.max,
        impact: cfg.impact, recommendation: cfg.recommendation,
        status: statusForCoverage(coverage, b.min, b.max),
        statusRank: STATUS_RANK[statusForCoverage(coverage, b.min, b.max).label] ?? 0,
        isOverride: b.isOverride,
      };
    });
    const claimedKeys = new Set(MATCH_KEY_CONFIG.flatMap((c) => c.apiKeys.map((k) => k.toLowerCase())));
    const extraRows: MatchKeyRow[] = Array.from(rawAgg.entries())
      .filter(([rawKey]) => !claimedKeys.has(rawKey))
      .map(([rawKey, { sum, n }]) => {
        const coverage = Math.round(n > 0 ? sum / n : 0);
        const cfg = EXTRA_KEY_CONFIG[rawKey];
        const label = cfg?.label || RAW_KEY_LABELS[rawKey] || rawKey;
        const defaultMin = cfg?.benchmarkMin ?? DEFAULT_UNKNOWN_BENCHMARK.min;
        const defaultMax = cfg?.benchmarkMax ?? DEFAULT_UNKNOWN_BENCHMARK.max;
        const b = resolveBenchmark(label, defaultMin, defaultMax);
        const status = statusForCoverage(coverage, b.min, b.max);
        return {
          label, coverage,
          benchmarkMin: b.min, benchmarkMax: b.max,
          impact: cfg?.impact ?? DEFAULT_UNKNOWN_BENCHMARK.impact,
          recommendation: cfg?.recommendation ?? DEFAULT_UNKNOWN_BENCHMARK.recommendation,
          status,
          statusRank: STATUS_RANK[status.label] ?? 0,
          isOverride: b.isOverride,
        };
      })
      .sort((a, b) => b.coverage - a.coverage);
    return [...canonicalRows, ...extraRows];
  }, [isRealMeta, meta, emqKeyBenchmarks]);
  const { sorted: sortedMatchKeys, sort: mkSort, toggle: mkToggle } = useSort(matchKeyRows, "coverage", "asc");

  // Inline-edit state for the Recommended Benchmark column. `editingLabel` is
  // the row currently in edit mode; `draftMin` / `draftMax` hold the in-progress
  // input values before Save persists them to Zustand.
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [draftMin, setDraftMin] = useState<string>("");
  const [draftMax, setDraftMax] = useState<string>("");
  const startEditBenchmark = (label: string, min: number, max: number) => {
    setEditingLabel(label);
    setDraftMin(String(min));
    setDraftMax(String(max));
  };
  const saveBenchmark = (label: string) => {
    const min = Math.max(0, Math.min(100, parseFloat(draftMin) || 0));
    const max = Math.max(min, Math.min(100, parseFloat(draftMax) || 0));
    setEmqKeyBenchmark(label, { min, max });
    setEditingLabel(null);
  };

  // AI recommendations for match-key coverage rows
  const [mkAiStatus, setMkAiStatus] = useState<Record<string, "idle" | "loading" | "done" | "error">>({});
  const [mkAiRec, setMkAiRec] = useState<Record<string, { summary: string; technicalFixes: Array<{step:string;impact:string}>; businessActions: Array<{step:string;impact:string}> }>>({});

  const fetchMkRec = async (
    label: string,
    coverage: number,
    benchmarkMin: number | null,
    benchmarkMax: number | null,
    siblingMetrics: Record<string, string | number>
  ) => {
    setMkAiStatus((s) => ({ ...s, [label]: "loading" }));
    try {
      const r = await fetch("/api/recommendations/emq-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "match_key",
          subject: label,
          currentValue: coverage,
          benchmark: benchmarkMin ?? 70,
          variance: benchmarkMin !== null ? coverage - benchmarkMin : 0,
          tableContext: siblingMetrics,
        }),
      });
      const data = await r.json();
      if (r.ok && data.summary) {
        setMkAiRec((s) => ({ ...s, [label]: data })); if (data.creditsUsedUsd) addAiCredits(data.creditsUsedUsd);;
        setMkAiStatus((s) => ({ ...s, [label]: "done" }));
      } else {
        setMkAiStatus((s) => ({ ...s, [label]: "error" }));
      }
    } catch {
      setMkAiStatus((s) => ({ ...s, [label]: "error" }));
    }
  };

  // Exact EMQ score (0–10) + dedup rate are NOT exposed by Meta's Graph API.
  // But REAL match-key coverage + PII coverage ARE (aggregation=match_keys /
  // had_pii). For a real Meta connection we show that real coverage data; the
  // proprietary EMQ score + dedup rate still point to Events Manager.
  // (isRealMeta + matchKeyRows + useSort moved to the top of the component
  //  above — Rules of Hooks. See comment there.)
  if (isRealMeta) {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-24">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
          <p className="text-gray-600">Loading match-key data…</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <p className="font-semibold mb-1">Failed to load event quality data</p>
          <p className="text-sm">{error}</p>
        </div>
      );
    }

    const pixels = meta?.pixels || [];
    const piiPcts = pixels.map((p) => p.emq.piiCoveragePct ?? 0).filter((v) => v > 0);
    const avgPii = piiPcts.length > 0 ? Math.round(piiPcts.reduce((a, b) => a + b, 0) / piiPcts.length) : 0;
    const avgKeyCoverage =
      matchKeyRows.length > 0
        ? Math.round(matchKeyRows.reduce((s, r) => s + r.coverage, 0) / matchKeyRows.length)
        : 0;

    const toneClass = (tone: "good" | "warn" | "bad") =>
      tone === "good"
        ? "text-green-700 bg-green-100"
        : tone === "warn"
        ? "text-yellow-700 bg-yellow-100"
        : "text-red-700 bg-red-100";

    return (
      <div className="space-y-6 section-enter">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Event Quality (EMQ) Analysis</h1>
          <p className="text-gray-600 mt-1">Real match-key &amp; PII coverage from your pixel (Meta Graph API)</p>
        </div>


        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-1">
            <div className="text-sm text-gray-600"><TermText>Avg. Match-Key Coverage</TermText></div>
            <div className="text-3xl font-bold text-gray-900 mt-1">{avgKeyCoverage}%</div>
            <div className="text-xs text-gray-500 mt-1">Across {matchKeyRows.length} keys</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-2">
            <div className="text-sm text-gray-600">Events with PII / Match Data</div>
            <div className="text-3xl font-bold text-gray-900 mt-1">{avgPii}%</div>
            <div className="text-xs text-gray-500 mt-1">Higher = better matching</div>
          </div>
        </div>

        <EMQBenchmarkTable />

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900"><TermText>Match-Key Coverage</TermText></h2>
            <p className="text-sm text-gray-600 mt-1">% of events that carried each customer-matching parameter — real data from Meta.</p>
          </div>
          <div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <SortTh col="label" sort={mkSort} onToggle={mkToggle} className="px-4 py-3">Match Key</SortTh>
                  <SortTh col="coverage" sort={mkSort} onToggle={mkToggle} className="px-4 py-3">Your Coverage</SortTh>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Recommended Benchmark</th>
                  <SortTh col="statusRank" sort={mkSort} onToggle={mkToggle} className="px-4 py-3">Status</SortTh>
                  <SortTh col="impact" sort={mkSort} onToggle={mkToggle} className="px-4 py-3">Impact on Match Quality</SortTh>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sortedMatchKeys.map((r) => (
                  <tr key={r.label} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{r.label}</td>
                    <td className="px-4 py-3 text-gray-900 font-semibold">{r.coverage}%</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {editingLabel === r.label ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={100}
                            value={draftMin}
                            onChange={(e) => setDraftMin(e.target.value)}
                            className="w-14 px-1.5 py-0.5 border border-blue-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-gray-400 text-xs">–</span>
                          <input
                            type="number" min={0} max={100}
                            value={draftMax}
                            onChange={(e) => setDraftMax(e.target.value)}
                            className="w-14 px-1.5 py-0.5 border border-blue-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-gray-400 text-[10px]">%</span>
                          <button
                            onClick={() => saveBenchmark(r.label)}
                            className="ml-1 px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                          >Save</button>
                          <button
                            onClick={() => setEditingLabel(null)}
                            className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs hover:bg-gray-200"
                          >Cancel</button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 group">
                          <span className={r.isOverride ? "font-semibold text-blue-700" : ""}>
                            {r.benchmarkMin}–{r.benchmarkMax}%
                          </span>
                          {r.isOverride && (
                            <span
                              className="text-[10px] px-1 py-0.5 bg-blue-50 text-blue-700 rounded font-semibold"
                              title="Custom benchmark — edited from default"
                            >custom</span>
                          )}
                          <button
                            onClick={() => startEditBenchmark(r.label, r.benchmarkMin!, r.benchmarkMax!)}
                            className="opacity-30 group-hover:opacity-100 transition text-gray-500 hover:text-blue-600"
                            title="Edit benchmark"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {r.isOverride && (
                            <button
                              onClick={() => resetEmqKeyBenchmark(r.label)}
                              className="opacity-30 group-hover:opacity-100 transition text-gray-500 hover:text-red-600"
                              title="Reset to recommended"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${toneClass(r.status.tone)}`}>
                        {r.status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {r.impact || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const isBelow = r.benchmarkMin !== null && r.coverage < r.benchmarkMin;
                        const status = mkAiStatus[r.label] ?? "idle";
                        const rec = mkAiRec[r.label];
                        const siblingMetrics: Record<string, string | number> = {};
                        matchKeyRows.forEach((mr) => { siblingMetrics[`${mr.label} coverage`] = `${mr.coverage}%`; });

                        if (!isBelow) {
                          return <span className="text-xs text-green-700">✓ Coverage is within benchmark — no action needed</span>;
                        }
                        if (status === "idle") {
                          return (
                            <button
                              onClick={() => fetchMkRec(r.label, r.coverage, r.benchmarkMin, r.benchmarkMax, siblingMetrics)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100"
                            >
                              <Sparkles className="w-3 h-3" /> Get recommendations <span className="text-[10px] opacity-60 ml-0.5">~$0.02</span>
                            </button>
                          );
                        }
                        if (status === "loading") {
                          return <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> Analyzing…</span>;
                        }
                        if (rec) {
                          return (
                            <div className="space-y-2 text-[11px]">
                              <div className="text-gray-700 font-semibold">{rec.summary}</div>
                              {rec.technicalFixes.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1 text-orange-700 font-semibold mb-1"><Wrench className="w-3 h-3" /> Technical fixes</div>
                                  <ul className="space-y-0.5">
                                    {rec.technicalFixes.map((f, i) => (
                                      <li key={i} className="flex gap-1.5 text-gray-700">
                                        <span className={`shrink-0 font-bold ${f.impact === "high" ? "text-red-600" : f.impact === "medium" ? "text-yellow-600" : "text-gray-400"}`}>●</span>
                                        {f.step}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {rec.businessActions.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1 text-blue-700 font-semibold mb-1"><TrendingUp className="w-3 h-3" /> Business actions</div>
                                  <ul className="space-y-0.5">
                                    {rec.businessActions.map((a, i) => (
                                      <li key={i} className="flex gap-1.5 text-gray-700">
                                        <span className={`shrink-0 font-bold ${a.impact === "high" ? "text-red-600" : a.impact === "medium" ? "text-yellow-600" : "text-gray-400"}`}>●</span>
                                        {a.step}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return <span className="text-red-500 text-[11px]">Failed to load — try again</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      <TabSummaryFooter
        tabName="Event Quality (EMQ)"
        lines={[
          `${matchKeyRows.length} match key${matchKeyRows.length !== 1 ? "s" : ""} analysed — average key coverage: ${avgKeyCoverage}%.`,
          `Average PII coverage: ${avgPii}% — ${avgPii >= 80 ? "strong signal quality for Meta's matching algorithm" : avgPii > 0 ? "consider enriching with more PII signals (email, phone)" : "no PII coverage detected — CAPI enrichment recommended"}.`,
          `${pixels.length} pixel${pixels.length !== 1 ? "s" : ""} contributing data to event quality analysis.`,
        ]}
        context={{
          matchKeyCount: matchKeyRows.length,
          avgKeyCoverage,
          avgPii,
          pixelCount: pixels.length,
          matchKeyRows: matchKeyRows.map(r => ({
            label: r.label,
            coverage: r.coverage,
            benchmarkMin: r.benchmarkMin,
            benchmarkMax: r.benchmarkMax,
            status: r.status.label,
            impact: r.impact,
            recommendation: r.recommendation,
          })),
        }}
        platform={platform === "both" ? "meta" : (platform ?? "meta")}
        dateRange={String(dateRange ?? "30d")}
      />
      </div>
    );
  }

  const emqBenchmarks = [
    { event: "PageView", current: 6.8, benchmark: 6.0, status: "Healthy", impact: "+0%" },
    { event: "ViewContent", current: 6.2, benchmark: 6.5, status: "Moderate", impact: "+3%" },
    { event: "AddToCart", current: 6.9, benchmark: 7.0, status: "Moderate", impact: "+4%" },
    { event: "InitiateCheckout", current: 7.8, benchmark: 8.0, status: "Moderate", impact: "+5%" },
    { event: "AddPaymentInfo", current: 7.2, benchmark: 8.5, status: "Critical", impact: "+8%" },
    { event: "Purchase", current: 8.4, benchmark: 9.0, status: "Moderate", impact: "+6%" },
    { event: "Lead", current: 7.9, benchmark: 8.0, status: "Moderate", impact: "+2%" },
  ];

  const matchKeys = [
    { key: "Email Hash", coverage: 65, benchmark: 70, status: "Moderate", gap: -5 },
    { key: "Phone Number Hash", coverage: 45, benchmark: 70, status: "Critical", gap: -25 },
    { key: "External ID", coverage: 78, benchmark: 80, status: "Moderate", gap: -2 },
    { key: "Client IP", coverage: 95, benchmark: 90, status: "Healthy", gap: 5 },
    { key: "User Agent", coverage: 98, benchmark: 90, status: "Healthy", gap: 8 },
    { key: "FB Click ID (fbc)", coverage: 62, benchmark: 70, status: "Moderate", gap: -8 },
    { key: "FB Browser ID (fbp)", coverage: 88, benchmark: 85, status: "Healthy", gap: 3 },
  ];

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  return (
    <div className="space-y-6 section-enter">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Event Quality (EMQ) Analysis</h1>
        <p className="text-gray-600 mt-1">Event Match Quality scores benchmarked against Meta recommendations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-1">
          <div className="text-sm text-gray-600">Overall EMQ Score</div>
          <div className="text-3xl font-bold text-yellow-600 mt-1">7.1 / 10</div>
          <div className="text-xs text-gray-500 mt-1">Target: {(customBenchmarks.metaEMQScore * 10).toFixed(1)}+</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-2">
          <div className="text-sm text-gray-600"><TermText>Avg. Match Key Coverage</TermText></div>
          <div className="text-3xl font-bold text-gray-900 mt-1">75%</div>
          <div className="text-xs text-yellow-600 mt-1">↓ 5% below benchmark</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm animate-fade-in-up stagger-3">
          <div className="text-sm text-gray-600">Est. Lift if Fixed</div>
          <div className="text-3xl font-bold text-green-600 mt-1">+28%</div>
          <div className="text-xs text-gray-500 mt-1">Conversion improvement</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">EMQ Score vs Meta Benchmarks</h2>
          <p className="text-sm text-gray-600 mt-1">Current scores compared against recommended benchmarks per event</p>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Event Type</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Current Score</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Benchmark</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Gap</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Est. Impact</th>
              </tr>
            </thead>
            <tbody>
              {emqBenchmarks.map((e, idx) => {
                const gap = (e.current - e.benchmark).toFixed(1);
                return (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{e.event}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-bold">{e.current.toFixed(1)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{e.benchmark.toFixed(1)}+</td>
                    <td className={`px-6 py-4 text-right font-semibold ${parseFloat(gap) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {parseFloat(gap) >= 0 ? "+" : ""}
                      {gap}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(e.status)}`}>{e.status}</span>
                        {(e.status === "Moderate" || e.status === "Critical") && (
                          <AIRecommendationButton
                            metric={`EMQ ${e.event}`}
                            value={e.current}
                            status={e.status === "Critical" ? "critical" : "warn"}
                            platform="meta"
                            auditContext={{ module: "Event Quality EMQ", siblingMetrics: { event: e.event, current: e.current, benchmark: e.benchmark } }}
                            compact
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-green-600 font-semibold">{e.impact}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900"><TermText>Match Key Coverage</TermText></h2>
          <p className="text-sm text-gray-600 mt-1">Quality of advanced matching parameters passed with each event</p>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Match Key</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Coverage</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Benchmark</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Gap</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {matchKeys.map((m, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{m.key}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${m.coverage >= m.benchmark ? "bg-green-500" : m.coverage >= m.benchmark - 10 ? "bg-yellow-500" : "bg-red-500"}`}
                          style={{ width: `${m.coverage}%` }}
                        ></div>
                      </div>
                      <span className="text-gray-900 font-semibold w-12 text-right">{m.coverage}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-700">{m.benchmark}%+</td>
                  <td className={`px-6 py-4 text-right font-semibold ${m.gap >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {m.gap >= 0 ? "+" : ""}
                    {m.gap}%
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(m.status)}`}>{m.status}</span>
                      {(m.status === "Moderate" || m.status === "Critical") && (
                        <AIRecommendationButton
                          metric={`Match Key: ${m.key} coverage`}
                          value={m.coverage}
                          status={m.status === "Critical" ? "critical" : "warn"}
                          platform="meta"
                          auditContext={{ module: "Event Quality Match Keys", siblingMetrics: { key: m.key, coverage: `${m.coverage}%`, benchmark: `${m.benchmark}%`, gap: m.gap } }}
                          compact
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* EMQ Benchmark table available in demo mode too */}
      <EMQBenchmarkTable />

      <TabSummaryFooter
        tabName="Event Quality (EMQ)"
        lines={[
          `${emqBenchmarks.length} events benchmarked — ${emqBenchmarks.filter(e => e.status === "Healthy").length} healthy, ${emqBenchmarks.filter(e => e.status === "Critical").length} critical.`,
          `Overall EMQ score: 7.1 / 10 — target is ${(customBenchmarks.metaEMQScore * 10).toFixed(1)}+.`,
          "Estimated lift from fixing all event quality issues: +28% conversion improvement.",
        ]}
        context={{
          emqScore: 7.1,
          benchmarkCount: emqBenchmarks.length,
          emqBenchmarks: emqBenchmarks.map(e => ({
            event: e.event,
            current: e.current,
            benchmark: e.benchmark,
            status: e.status,
            impact: e.impact,
          })),
          matchKeys: matchKeys.map(m => ({
            label: m.key,
            coverage: m.coverage,
            benchmarkMin: m.benchmark,
            benchmarkMax: m.benchmark,
            status: m.status,
            gap: m.gap,
          })),
        }}
        platform={platform === "both" ? "meta" : (platform ?? "meta")}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
