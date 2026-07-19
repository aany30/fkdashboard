import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { META_BENCHMARKS, type BenchmarkSnapshot } from "@/lib/funnel-benchmarks";
import {
  Settings as SettingsIcon,
  Check,
  Loader2,
  Sparkles,
  Building2,
  History,
  X,
} from "lucide-react";

interface Props {
  /** Stage names this audit cares about — sent to the AI so it returns matching values. */
  stages: string[];
  /** Platform context for the AI prompt. */
  platform?: "meta" | "dv360" | "both";
}

type Tab = "meta" | "industry" | "past";

export default function BenchmarkSourceSwitcher({ stages, platform = "both" }: Props) {
  const {
    benchmarkSnapshots,
    activeBenchmarkId,
    addBenchmarkSnapshot,
    setActiveBenchmark,
    removeBenchmarkSnapshot, addAiCredits,
  } = useAuthStore();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("meta");
  const [industryInput, setIndustryInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Manual-benchmark editor state (My Past tab). Sliders 0-100 per stage.
  const [manualLabel, setManualLabel] = useState("");
  const [manualValues, setManualValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(stages.map((s) => [s, 50]))
  );
  const [manualNotice, setManualNotice] = useState<string | null>(null);

  // Click-outside close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setError(null);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  const pastSnapshots = benchmarkSnapshots.filter(
    (s) => s.source !== "meta" || s.id !== META_BENCHMARKS.id
  );
  const activeSnapshot = benchmarkSnapshots.find((s) => s.id === activeBenchmarkId);

  // Whenever the popover opens, pre-fill the Industry input with whatever the
  // user previously activated — so they instantly see what's currently in use
  // and can tweak rather than retype from scratch.
  useEffect(() => {
    if (open && activeSnapshot?.source === "industry" && activeSnapshot.industry) {
      setIndustryInput(activeSnapshot.industry);
    }
  }, [open, activeSnapshot]);

  const handleSelectMeta = () => {
    // Make sure Meta default exists in store; activate it.
    if (!benchmarkSnapshots.find((s) => s.id === META_BENCHMARKS.id)) {
      addBenchmarkSnapshot(META_BENCHMARKS);
    } else {
      setActiveBenchmark(META_BENCHMARKS.id);
    }
    setOpen(false);
  };

  const handleSelectPast = (id: string) => {
    setActiveBenchmark(id);
    setOpen(false);
  };

  const handleFetchIndustry = async () => {
    const trimmed = industryInput.trim();
    if (!trimmed) {
      setError("Enter an industry first (e.g. 'DTC apparel', 'B2B SaaS').");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry: trimmed, stages, platform }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { industry: string; values: Record<string, number>; rationale?: string; creditsUsedUsd?: number };
      const snapshot: BenchmarkSnapshot = {
        id: `industry-${Date.now()}`,
        label: json.industry,
        source: "industry",
        industry: json.industry,
        fetchedAt: new Date().toISOString(),
        values: json.values,
        notes: json.rationale,
      };
      addBenchmarkSnapshot(snapshot); if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
      setIndustryInput("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch industry benchmarks");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Benchmark source: ${activeSnapshot?.label || "Meta default"}`}
        className="ml-1.5 p-1 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition inline-flex items-center gap-1"
      >
        <SettingsIcon className="w-3.5 h-3.5" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">Source</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 normal-case text-left">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {(
              [
                { id: "meta", label: "Meta", Icon: Building2 },
                { id: "industry", label: "Industry", Icon: Sparkles },
                { id: "past", label: "My Past", Icon: History },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition flex items-center justify-center gap-1 ${
                  tab === t.id
                    ? "text-blue-700 border-b-2 border-blue-600 bg-blue-50"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <t.Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-3">
            {tab === "meta" && (
              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-1">{META_BENCHMARKS.label}</h4>
                <p className="text-xs text-gray-600 mb-3">
                  Industry-standard e-commerce funnel rates from Meta Industry Reports + Shopify
                  Benchmarks 2024. Conservative medians.
                </p>
                <div className="space-y-1 text-xs mb-3 max-h-40 overflow-y-auto">
                  {Object.entries(META_BENCHMARKS.values).map(([stage, val]) => (
                    <div key={stage} className="flex justify-between border-b border-gray-100 py-1">
                      <span className="font-mono text-gray-700">{stage}</span>
                      <span className="font-semibold text-gray-900">{val}%</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleSelectMeta}
                  className="w-full px-3 py-2 bg-blue-600 text-white rounded font-semibold text-sm hover:bg-blue-700 transition flex items-center justify-center gap-1.5"
                >
                  {activeBenchmarkId === META_BENCHMARKS.id ? (
                    <>
                      <Check className="w-4 h-4" /> Currently active
                    </>
                  ) : (
                    "Use Meta benchmarks"
                  )}
                </button>
              </div>
            )}

            {tab === "industry" && (
              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-1">Industry-specific (AI)</h4>
                <p className="text-xs text-gray-600 mb-3">
                  Type your industry. Claude generates recent benchmark medians from published industry reports.
                </p>
                <input
                  type="text"
                  value={industryInput}
                  onChange={(e) => setIndustryInput(e.target.value)}
                  placeholder="e.g. DTC apparel, B2B SaaS, fintech, food delivery"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleFetchIndustry()}
                  disabled={loading}
                />
                {error && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-2">
                    {error}
                  </div>
                )}
                <button
                  onClick={handleFetchIndustry}
                  disabled={loading || !industryInput.trim()}
                  className="w-full px-3 py-2 bg-blue-600 text-white rounded font-semibold text-sm hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Fetching from AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Generate
                    </>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 italic mt-2">
                  Requires ANTHROPIC_API_KEY in .env.local
                </p>
              </div>
            )}

            {tab === "past" && (
              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-1">Your benchmarks</h4>
                <p className="text-xs text-gray-600 mb-3">
                  Set custom benchmark percentages (0–100) per funnel stage, or pick a previously saved set.
                </p>

                {/* Manual benchmark editor — sliders for each stage */}
                <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-3 space-y-2">
                  <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Set manually</div>
                  {stages.map((stage) => {
                    const v = manualValues[stage] ?? 50;
                    return (
                      <div key={stage} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-gray-700">{stage}</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={v}
                            onChange={(e) => {
                              const n = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                              setManualValues((m) => ({ ...m, [stage]: n }));
                            }}
                            className="w-14 px-1.5 py-0.5 border border-gray-300 rounded text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-gray-400 ml-0.5">%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={v}
                          onChange={(e) =>
                            setManualValues((m) => ({ ...m, [stage]: parseInt(e.target.value, 10) }))
                          }
                          className="w-full h-1 accent-blue-600 cursor-pointer"
                        />
                      </div>
                    );
                  })}
                  <input
                    type="text"
                    placeholder="Label (e.g. 'Q2 2026 target')"
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      const label = manualLabel.trim() || `Custom — ${new Date().toLocaleDateString()}`;
                      const snap: BenchmarkSnapshot = {
                        id: `manual-${Date.now()}`,
                        label,
                        source: "past",
                        fetchedAt: new Date().toISOString(),
                        values: { ...manualValues },
                      };
                      addBenchmarkSnapshot(snap);
                      setActiveBenchmark(snap.id);
                      setManualLabel("");
                      setManualNotice(`Saved & activated: ${label}`);
                      setTimeout(() => setManualNotice(null), 2500);
                    }}
                    className="w-full px-3 py-1.5 bg-blue-600 text-white rounded font-semibold text-xs hover:bg-blue-700 transition"
                  >
                    Save &amp; use these values
                  </button>
                  {manualNotice && (
                    <div className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                      ✓ {manualNotice}
                    </div>
                  )}
                </div>

                <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-1.5">Saved sets</div>
                {pastSnapshots.length === 0 ? (
                  <div className="text-xs text-gray-500 text-center py-3">
                    No saved sets yet. Use the manual editor above, or the <strong>Industry</strong> tab to generate one.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {pastSnapshots.map((s) => {
                      const isActive = s.id === activeBenchmarkId;
                      return (
                        <div
                          key={s.id}
                          className={`group flex items-center gap-2 p-2 rounded border ${
                            isActive ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <button
                            onClick={() => handleSelectPast(s.id)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1">
                              {isActive && <Check className="w-3 h-3 text-blue-600" />}
                              {s.label}
                            </div>
                            <div className="text-[10px] text-gray-500">
                              {new Date(s.fetchedAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}{" "}
                              · {s.source === "industry" ? "AI" : s.source}
                            </div>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeBenchmarkSnapshot(s.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                            title="Delete this snapshot"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {activeSnapshot && (
            <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500 bg-gray-50 rounded-b-lg">
              Active: <strong className="text-gray-700">{activeSnapshot.label}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
