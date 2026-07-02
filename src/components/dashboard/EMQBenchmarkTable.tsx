/**
 * EMQ Benchmark Table for the Event Quality tab.
 *
 * Columns:
 *   Event | EMQ Benchmark (fixed) | Current EMQ (user-input 1–10) |
 *   Variance | Alert | Recco (AI insight when below benchmark)
 *
 * EMQ Benchmark values are industry-standard targets; user will supply the
 * exact numbers — placeholders used until confirmed.
 * Current EMQ is entered by the user and persisted in Zustand / localStorage.
 * Variance = Current – Benchmark.
 * Alert: "Improve" when variance < 0; blank otherwise.
 * Recco: AI-generated insight (via /api/recommendations/fix) when variance < 0;
 *        "Good ✓" when at/above benchmark; blank when not entered.
 */

import { useState, useMemo } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, Loader2, Wrench, TrendingUp } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

interface EMQEvent {
  id: string;
  label: string;
  /** Industry-standard EMQ benchmark (1–10). Placeholder until confirmed. */
  benchmark: number | null;
}

// Fixed event list + benchmarks (user to confirm exact values).
// Format: Score / 10 where Meta's EMQ scale goes 0–10.
const EMQ_EVENTS: EMQEvent[] = [
  { id: "pageView",         label: "Page View",            benchmark: 6.0 },
  { id: "viewContent",      label: "View Content",         benchmark: 6.5 },
  { id: "addToCart",        label: "Add to Cart",          benchmark: 7.5 },
  { id: "initiateCheckout", label: "Initiate Checkout",    benchmark: 8.0 },
  { id: "addPaymentInfo",   label: "Add Payment Info",     benchmark: 8.0 },
  { id: "purchase",         label: "Purchase",             benchmark: 9.0 },
];

type AiStatus = "idle" | "loading" | "done" | "error";
interface RecData { summary: string; technicalFixes: Array<{step:string;impact:string}>; businessActions: Array<{step:string;impact:string}> }

export default function EMQBenchmarkTable() {
  const { emqInputs, setEmqInput, metaAccessToken, addAiCredits } = useAuthStore();
  const isReal = !!metaAccessToken && !isDemoCredential(metaAccessToken);

  const [aiStatus, setAiStatus] = useState<Record<string, AiStatus>>({});
  const [aiRec, setAiRec] = useState<Record<string, RecData>>({});

  const enrichedEmqRows = useMemo(() =>
    EMQ_EVENTS.map((event) => {
      const current = emqInputs[event.id] ?? null;
      const benchmark = event.benchmark;
      const variance = current !== null && benchmark !== null ? +(current - benchmark).toFixed(1) : null;
      return { ...event, current, variance };
    }),
    [emqInputs]
  );
  const { sorted: emqSorted, sort: emqSort, toggle: emqToggle } = useSort(enrichedEmqRows, "label", "asc");

  const fetchInsight = async (event: EMQEvent, currentEmq: number) => {
    if (!event.benchmark) return;
    const variance = currentEmq - event.benchmark;
    if (variance >= 0) return;

    setAiStatus((s) => ({ ...s, [event.id]: "loading" }));

    // Full table context so AI sees the whole picture
    const siblingMetrics: Record<string, string | number> = {};
    for (const e of EMQ_EVENTS) {
      const v = emqInputs[e.id];
      if (v !== null && v !== undefined) {
        siblingMetrics[`${e.label} EMQ`] = v;
        if (e.benchmark) siblingMetrics[`${e.label} benchmark`] = e.benchmark;
      }
    }

    try {
      const r = await fetch("/api/recommendations/emq-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "emq",
          subject: event.label,
          currentValue: currentEmq,
          benchmark: event.benchmark,
          variance,
          tableContext: siblingMetrics,
        }),
      });
      const data = await r.json();
      if (r.ok && data.summary) {
        setAiRec((s) => ({ ...s, [event.id]: data })); if (data.creditsUsedUsd) addAiCredits(data.creditsUsedUsd);
        setAiStatus((s) => ({ ...s, [event.id]: "done" }));
      } else {
        setAiStatus((s) => ({ ...s, [event.id]: "error" }));
      }
    } catch {
      setAiStatus((s) => ({ ...s, [event.id]: "error" }));
    }
  };

  // Fetch insights for ALL events that are below benchmark at once.
  const fetchAllInsights = async () => {
    for (const event of EMQ_EVENTS) {
      const v = emqInputs[event.id];
      if (v === null || v === undefined || !event.benchmark) continue;
      if (v < event.benchmark && aiStatus[event.id] !== "loading" && aiStatus[event.id] !== "done") {
        fetchInsight(event, v);
      }
    }
  };

  const allEntered = EMQ_EVENTS.every((e) => emqInputs[e.id] !== null && emqInputs[e.id] !== undefined);
  const anyBelowBenchmark = EMQ_EVENTS.some((e) => {
    const v = emqInputs[e.id];
    return v !== null && v !== undefined && e.benchmark !== null && v < e.benchmark;
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">EMQ Benchmark Analysis</h2>
            <p className="text-sm text-gray-600 mt-1">
              Enter your current EMQ scores (1–10) from Meta Events Manager. The table calculates variance vs industry benchmarks and flags events that need improvement.
            </p>
          </div>
          {anyBelowBenchmark && (
            <button
              onClick={fetchAllInsights}
              disabled={Object.values(aiStatus).some((s) => s === "loading")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              {Object.values(aiStatus).some((s) => s === "loading") ? "Analyzing…" : "Get AI Insights"}
            </button>
          )}
        </div>
      </div>

      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="label" sort={emqSort} onToggle={emqToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Event</SortTh>
              <SortTh col="benchmark" sort={emqSort} onToggle={emqToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="center">EMQ Benchmark</SortTh>
              <SortTh col="current" sort={emqSort} onToggle={emqToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="center">Current EMQ</SortTh>
              <SortTh col="variance" sort={emqSort} onToggle={emqToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="center">Variance</SortTh>
              <th className="px-4 py-3 text-center font-semibold text-gray-700">Alert</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {emqSorted.map((event) => {
              const current = event.current;
              const benchmark = event.benchmark;
              const variance = event.variance;
              const isBelow = variance !== null && variance < 0;
              const isGood = variance !== null && variance >= 0;
              const status = aiStatus[event.id] ?? "idle";

              return (
                <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  {/* Event */}
                  <td className="px-4 py-3 font-semibold text-gray-900">{event.label}</td>

                  {/* EMQ Benchmark */}
                  <td className="px-4 py-3 text-center text-gray-700">
                    {benchmark !== null ? (
                      <span className="font-mono">{benchmark.toFixed(1)}</span>
                    ) : (
                      <span className="text-gray-400 italic text-[11px]">TBD</span>
                    )}
                  </td>

                  {/* Current EMQ — editable input */}
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      placeholder="0–10"
                      value={current !== null && current !== undefined ? current : ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Math.min(10, Math.max(0, parseFloat(e.target.value)));
                        setEmqInput(event.id, v);
                        // Clear old AI insight when value changes
                        setAiStatus((s) => ({ ...s, [event.id]: "idle" }));
                        setAiRec((prev) => { const { [event.id]: _, ...rest } = prev; return rest; });
                      }}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mx-auto block"
                    />
                  </td>

                  {/* Variance */}
                  <td className="px-4 py-3 text-center font-mono font-semibold">
                    {variance !== null ? (
                      <span className={isBelow ? "text-red-600" : "text-green-700"}>
                        {variance >= 0 ? "+" : ""}{variance.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>

                  {/* Alert */}
                  <td className="px-4 py-3 text-center">
                    {isBelow && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                        <AlertTriangle className="w-3 h-3" /> Improve
                      </span>
                    )}
                    {isGood && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">
                        <CheckCircle2 className="w-3 h-3" /> Good
                      </span>
                    )}
                    {variance === null && <span className="text-gray-300 text-[11px]">—</span>}
                  </td>

                  {/* Recommendation */}
                  <td className="px-4 py-3 max-w-xs">
                    {isGood && (
                      <span className="text-[11px] text-green-700">✓ Above benchmark — no action needed</span>
                    )}
                    {isBelow && status === "idle" && (
                      <button
                        onClick={() => fetchInsight(event, current!)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100"
                      >
                        <Sparkles className="w-3 h-3" /> Get recommendations <span className="text-[10px] opacity-60 ml-0.5">~$0.02</span>
                      </button>
                    )}
                    {isBelow && status === "loading" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" /> Analyzing…
                      </span>
                    )}
                    {isBelow && status === "done" && aiRec[event.id] && (() => {
                      const rec = aiRec[event.id];
                      return (
                        <div className="space-y-2 text-[11px]">
                          <div className="font-semibold text-gray-700">{rec.summary}</div>
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
                    })()}
                    {isBelow && status === "error" && (
                      <span className="text-[11px] text-red-600">Failed to load — try again</span>
                    )}
                    {variance === null && (
                      <span className="text-gray-300 text-[11px]">Enter Current EMQ above</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
