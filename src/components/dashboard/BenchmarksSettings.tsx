import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { X, RotateCcw } from "lucide-react";

interface BenchmarkField {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  category: "meta" | "dv360" | "funnel" | "general";
}

const BENCHMARK_FIELDS: BenchmarkField[] = [
  // Meta Benchmarks
  {
    key: "metaEMQScore",
    label: "EMQ Score Target",
    description: "Expected Event Match Quality score",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "meta",
  },
  {
    key: "metaDedupRate",
    label: "Deduplication Rate Target",
    description: "Expected deduplication rate for server-side events",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "meta",
  },
  {
    key: "metaCAPIHealthScore",
    label: "CAPI Health Score Target",
    description: "Expected Conversions API health score",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "meta",
  },
  {
    key: "metaPayloadCompleteness",
    label: "Payload Completeness Target",
    description: "Expected data completeness in event payloads",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "meta",
  },
  {
    key: "metaEventLatencyMs",
    label: "Event Latency Threshold",
    description: "Maximum acceptable event latency",
    min: 0,
    max: 10000,
    step: 100,
    unit: "ms",
    category: "meta",
  },

  // Funnel Benchmarks
  {
    key: "funnelConversionRate",
    label: "Expected Conversion Rate",
    description: "Typical conversion rate for your funnel",
    min: 0,
    max: 1,
    step: 0.001,
    unit: "",
    category: "funnel",
  },
  {
    key: "funnelDropOffThreshold",
    label: "Maximum Drop-off Rate",
    description: "Alert threshold for funnel stage drop-off",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "funnel",
  },

  // General
  {
    key: "eventFiringHealthThreshold",
    label: "Event Firing Health Threshold",
    description: "Minimum acceptable event firing rate",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    category: "general",
  },
];

interface Props {
  onClose: () => void;
}

export default function BenchmarksSettings({ onClose }: Props) {
  const { customBenchmarks, updateBenchmark, resetBenchmarksToDefault } = useAuthStore();
  const [changed, setChanged] = useState(false);

  const handleChange = (key: string, value: number) => {
    updateBenchmark(key as any, value);
    setChanged(true);
  };

  const handleReset = () => {
    if (confirm("Reset all benchmarks to defaults?")) {
      resetBenchmarksToDefault();
      setChanged(false);
    }
  };

  const categories = ["meta", "funnel", "general"] as const;
  const categoryLabels = {
    meta: "Meta Benchmarks",
    funnel: "Funnel Benchmarks",
    general: "General Settings",
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Custom Benchmarks</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8">
          {categories.map((category) => {
            const fields = BENCHMARK_FIELDS.filter((f) => f.category === category);
            if (fields.length === 0) return null;

            return (
              <div key={category}>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {categoryLabels[category]}
                </h3>
                <div className="space-y-4">
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-start justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <label className="block font-medium text-gray-900">
                          {field.label}
                        </label>
                        <p className="text-sm text-gray-600 mt-1">{field.description}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <input
                          type="range"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={
                            customBenchmarks[field.key as keyof typeof customBenchmarks]
                          }
                          onChange={(e) =>
                            handleChange(field.key, parseFloat(e.target.value))
                          }
                          className="w-32"
                        />
                        <div className="flex items-baseline gap-1 min-w-16">
                          <span className="font-semibold text-gray-900">
                            {(
                              customBenchmarks[
                                field.key as keyof typeof customBenchmarks
                              ] * (field.key.includes("Latency") ? 1 : 100)
                            ).toFixed(field.key.includes("Latency") ? 0 : 1)}
                          </span>
                          <span className="text-sm text-gray-600">
                            {field.key.includes("Latency") ? field.unit : "%"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Defaults
          </button>
          <button
            onClick={onClose}
            className={`px-6 py-2 rounded-lg font-semibold transition ${
              changed
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-700 cursor-not-allowed"
            }`}
            disabled={!changed}
          >
            {changed ? "Saved" : "No Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
