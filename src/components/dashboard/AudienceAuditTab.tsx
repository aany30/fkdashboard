import { Users, Loader2, Info } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import AuditTabShell from "./audits/AuditTabShell";
import IntentAnalysisAudit from "./audits/IntentAnalysisAudit";
import AudienceQualityAudit from "./audits/AudienceQualityAudit";
import { useDV360Audiences } from "@/hooks/useDV360Audiences";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function AudienceAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  const { isMetaConnected, isDV360Connected, demoMode } = useAuthStore();
  const metaOn = isMetaConnected() || demoMode;
  const dv360On = isDV360Connected() || demoMode;
  const showMeta = metaOn && (platform === "meta" || platform === "both");
  const showDV360 = dv360On && (platform === "dv360" || platform === "both");

  const { audiences, loading: audLoading, error: audError } = useDV360Audiences(showDV360);
  const { sorted: sortedAudiences, sort: audSort, toggle: audToggle } = useSort(audiences, "name", "asc");

  const firstParty = audiences.filter((a) => a.type === "First Party");
  const thirdParty = audiences.filter((a) => a.type === "Third Party");

  return (
    <div className="space-y-6">
      {/* ── Meta Section ─────────────────────────────────────────────── */}
      {showMeta && platform === "both" && (
        <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Meta</h2>
          <span className="text-xs text-gray-400 font-medium">Meta Ads</span>
        </div>
      )}

      {showMeta && (
        <AuditTabShell
          platform={platform}
          dateRange={dateRange}
          customStart={customStart}
          customEnd={customEnd}
          selectedObjectives={selectedObjectives}
          title="Audience Audit"
          description="Intent classification + audience quality from real campaign data"
          Icon={Users}
          defaultSubTab="intent"
          subTabs={[
            { id: "intent", label: "Intent Analysis", description: "Cold/Warm/Hot mix", render: (p) => <IntentAnalysisAudit {...p} /> },
            { id: "quality", label: "Audience Quality", description: "High-intent share", render: (p) => <AudienceQualityAudit {...p} /> },
          ]}
        />
      )}

      {/* ── DV360 Section ────────────────────────────────────────────── */}
      {showDV360 && platform === "both" && (
        <div className="flex items-center gap-3 pt-4 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">DV360</h2>
          <span className="text-xs text-gray-400 font-medium">Display &amp; Video 360</span>
        </div>
      )}

      {showDV360 && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600">Total Audiences</div>
              <div className="text-3xl font-bold text-gray-900 mt-1">
                {audLoading ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : audiences.length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Accessible to this advertiser</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600">First-Party</div>
              <div className="text-3xl font-bold text-blue-600 mt-1">{firstParty.length}</div>
              <div className="text-xs text-gray-500 mt-1">Activity-based, Customer Match, etc.</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600">Third-Party / Google</div>
              <div className="text-3xl font-bold text-purple-600 mt-1">{thirdParty.length}</div>
              <div className="text-xs text-gray-500 mt-1">In-market, affinity, custom intent</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600">Customer Match</div>
              <div className="text-3xl font-bold text-green-600 mt-1">
                {audiences.filter((a) => a.source.toLowerCase().includes("customer match")).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">CRM list uploads</div>
            </div>
          </div>

          {audError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{audError}</div>
          )}

          {/* Audience inventory table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">DV360 Audience Inventory</h2>
              <p className="text-sm text-gray-600 mt-1">All first-party and third-party audiences accessible to this advertiser</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                  <tr>
                    <SortTh col="name" sort={audSort} onToggle={audToggle} className="px-6 py-3">Audience Name</SortTh>
                    <SortTh col="type" sort={audSort} onToggle={audToggle} className="px-6 py-3">Type</SortTh>
                    <SortTh col="source" sort={audSort} onToggle={audToggle} className="px-6 py-3">Source</SortTh>
                    <SortTh col="activeSize" sort={audSort} onToggle={audToggle} className="px-6 py-3" align="right">Active Size</SortTh>
                    <SortTh col="membershipDays" sort={audSort} onToggle={audToggle} className="px-6 py-3" align="right">Membership</SortTh>
                    <th className="px-6 py-3 text-left font-semibold text-gray-700">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {audLoading ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading audiences…</td></tr>
                  ) : audiences.length === 0 ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No audiences found for this advertiser</td></tr>
                  ) : sortedAudiences.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900 max-w-[250px] truncate">{a.name}</td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          a.type === "First Party" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>{a.type}</span>
                      </td>
                      <td className="px-6 py-3 text-gray-700 text-xs">{a.source}</td>
                      <td className="px-6 py-3 text-right text-gray-900 font-medium">{a.activeSize}</td>
                      <td className="px-6 py-3 text-right text-gray-700">{a.membershipDays ? `${a.membershipDays}d` : "—"}</td>
                      <td className="px-6 py-3 text-gray-500 text-xs max-w-[200px] truncate">{a.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Info notes */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800 space-y-1">
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>Audience overlap analysis is not available via the DV360 API.</strong> To check audience overlap, use the DV360 UI: Audiences → Audience Insights → Overlap Report.
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                Audience sizes shown are approximate ranges provided by Google — exact counts are not exposed via API. Sizes update daily.
              </div>
            </div>
          </div>
        </>
      )}

      <TabSummaryFooter
        lines={[
          ...(showMeta ? [
            "Meta audience audit covers intent classification (Cold/Warm/Hot) and quality scoring derived from live campaign data.",
            "Use Intent Analysis to identify funnel stage distribution — TOF, MOF, BOF mix signals budget alignment.",
          ] : []),
          ...(showDV360 ? [
            `DV360 audience inventory: ${audiences.length} total audiences — ${firstParty.length} first-party, ${thirdParty.length} third-party/Google.`,
            "Audience overlap analysis is not available via the DV360 API — use the DV360 UI for overlap reports.",
          ] : []),
        ]}
        tabName="Audience Audit"
        context={{ platform, dateRange, subTabs: ["intent", "quality"], dv360Audiences: audiences.length }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
