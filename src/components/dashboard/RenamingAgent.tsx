import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { suggestCorrectedNames } from "@/lib/naming/suggester";
import type { CampaignData } from "@/types";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

interface Props {
  campaigns: CampaignData[];
  loading: boolean;
}

export default function RenamingAgent({ campaigns, loading }: Props) {
  const { namingConventions, activeConventionId } = useAuthStore();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeConvention = namingConventions.find((c) => c.id === activeConventionId);
  const { sorted: sortedSuggestions, sort: renameSort, toggle: renameToggle } = useSort(suggestions, "currentName", "asc");

  useEffect(() => {
    if (activeConvention && campaigns.length > 0) {
      const nonCompliantCampaigns = campaigns; // In real scenario, filter by compliance
      const generatedSuggestions = suggestCorrectedNames(nonCompliantCampaigns, activeConvention);
      setSuggestions(generatedSuggestions);
    }
  }, [campaigns, activeConvention]);

  const handleCopy = (suggestion: any) => {
    navigator.clipboard.writeText(suggestion.suggestedName);
    setCopiedId(suggestion.currentName);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSelectToggle = (currentName: string) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(currentName)) {
      newSelected.delete(currentName);
    } else {
      newSelected.add(currentName);
    }
    setSelectedSuggestions(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSuggestions.size === suggestions.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(suggestions.map((s) => s.currentName)));
    }
  };

  if (!activeConvention) {
    return <div className="text-center text-gray-500">No naming convention selected</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Renaming Agent</h2>
        <p className="text-gray-600">Suggest corrected names for non-compliant campaigns</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Suggestions Available</div>
          <div className="text-3xl font-bold text-blue-600 mt-1">{suggestions.length}</div>
          <div className="text-xs text-gray-500 mt-1">Ready to rename</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Selected</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{selectedSuggestions.size}</div>
          <div className="text-xs text-gray-500 mt-1">For bulk rename</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Avg. Confidence</div>
          <div className="text-3xl font-bold text-green-600 mt-1">
            {suggestions.length > 0
              ? Math.round(suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length)
              : 0}
            %
          </div>
          <div className="text-xs text-green-600 mt-1">Suggestion quality</div>
        </div>
      </div>

      {/* Suggestions Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.size === suggestions.length && suggestions.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4"
                  />
                </th>
                <SortTh col="currentName" sort={renameSort} onToggle={renameToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Current Name</SortTh>
                <SortTh col="suggestedName" sort={renameSort} onToggle={renameToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Suggested Name</SortTh>
                <SortTh col="confidence" sort={renameSort} onToggle={renameToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="center">Confidence</SortTh>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    {loading ? "Loading suggestions..." : "No suggestions available"}
                  </td>
                </tr>
              ) : (
                sortedSuggestions.map((suggestion) => (
                  <tr key={suggestion.currentName} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.has(suggestion.currentName)}
                        onChange={() => handleSelectToggle(suggestion.currentName)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-gray-900">{suggestion.currentName}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono font-semibold text-blue-600">{suggestion.suggestedName}</div>
                      {suggestion.reasons.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {suggestion.reasons.map((r: string, i: number) => (
                            <div key={i}>{r}</div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {suggestion.confidence >= 80 ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-yellow-600" />
                        )}
                        <span className="font-semibold">{suggestion.confidence}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleCopy(suggestion)}
                        className={`px-3 py-1 rounded font-semibold text-sm transition flex items-center gap-1 ml-auto ${
                          copiedId === suggestion.currentName
                            ? "bg-green-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {copiedId === suggestion.currentName ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSuggestions.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900 font-semibold mb-2">
            {selectedSuggestions.size} campaign(s) selected for rename
          </p>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
            Apply Renames (Coming Soon)
          </button>
        </div>
      )}
    </div>
  );
}
