import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { validateCampaignName, getComplianceDetails } from "@/lib/naming/validator";
import type { CampaignData, NamingComplianceResult } from "@/types";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";

interface Props {
  campaigns: CampaignData[];
  loading: boolean;
  onRefresh: () => void;
}

export default function NamingChecker({ campaigns, loading, onRefresh }: Props) {
  const { namingConventions, activeConventionId } = useAuthStore();
  const [results, setResults] = useState<NamingComplianceResult[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "compliant" | "non-compliant">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeConvention = namingConventions.find((c) => c.id === activeConventionId);

  useEffect(() => {
    if (activeConvention && campaigns.length > 0) {
      const validationResults = campaigns.map((campaign) => {
        const result = validateCampaignName(campaign.name, activeConvention);
        return {
          ...result,
          campaignId: campaign.id,
          platform: campaign.platform,
        };
      });
      setResults(validationResults);
    }
  }, [campaigns, activeConvention]);

  const filteredBase = results.filter((r) => {
    if (filterStatus === "all") return true;
    return r.status === filterStatus;
  });
  const { sorted: filtered, sort: namingSort, toggle: namingToggle } = useSort(filteredBase, "campaignName", "asc");

  const compliantCount = results.filter((r) => r.status === "compliant").length;
  const compliancePercentage =
    results.length > 0 ? Math.round((compliantCount / results.length) * 100) : 0;

  const statusColor = (status: string) =>
    status === "compliant" ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100";

  if (!activeConvention) {
    return <div className="text-center text-gray-500">No naming convention selected</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Naming Checker</h2>
          <p className="text-gray-600">Audit campaign names against naming convention</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Total Campaigns</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{results.length}</div>
          <div className="text-xs text-gray-500 mt-1">Audited</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Compliant</div>
          <div className="text-3xl font-bold text-green-600 mt-1">{compliantCount}</div>
          <div className="text-xs text-green-600 mt-1">{compliancePercentage}% compliance</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Non-Compliant</div>
          <div className="text-3xl font-bold text-red-600 mt-1">{results.length - compliantCount}</div>
          <div className="text-xs text-red-600 mt-1">Needs fixing</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(["all", "compliant", "non-compliant"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filterStatus === status
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {status === "all" ? "All" : status === "compliant" ? "✓ Compliant" : "✗ Non-Compliant"}
            {status === "all" && ` (${results.length})`}
            {status === "compliant" && ` (${compliantCount})`}
            {status === "non-compliant" && ` (${results.length - compliantCount})`}
          </button>
        ))}
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="campaignName" sort={namingSort} onToggle={namingToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Campaign Name</SortTh>
                <SortTh col="platform" sort={namingSort} onToggle={namingToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Platform</SortTh>
                <SortTh col="status" sort={namingSort} onToggle={namingToggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600" align="center">Status</SortTh>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    No campaigns found
                  </td>
                </tr>
              ) : (
                filtered.map((result) => (
                  <tbody key={result.campaignId}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-gray-900">{result.campaignName}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{result.platform}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${statusColor(result.status)}`}>
                          {result.status === "compliant" ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Compliant
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              Non-Compliant
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setExpandedId(expandedId === result.campaignId ? null : result.campaignId)}
                          className="text-blue-600 hover:text-blue-700 font-semibold text-sm"
                        >
                          {expandedId === result.campaignId ? "Hide" : "Show"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === result.campaignId && (
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <td colSpan={4} className="px-6 py-4">
                          <div className="space-y-2">
                            {result.components.map((component) => (
                              <div key={component.position} className="text-sm">
                                <div className="font-semibold text-gray-900 flex items-center gap-2">
                                  <span>{component.label}</span>
                                  {component.isValid ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <AlertCircle className="w-4 h-4 text-red-600" />
                                  )}
                                </div>
                                <div className="text-gray-600">
                                  Actual: <code className="bg-white px-2 py-1 rounded">{component.actualValue || "(missing)"}</code>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
