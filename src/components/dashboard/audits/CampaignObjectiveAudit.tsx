import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import type { AuditProps } from "./types";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

// Detect "objective mismatch" — campaigns whose name suggests a different goal
// than the configured objective. Lightweight heuristic on keywords.
const KEYWORD_TO_OBJECTIVE: Array<{ keywords: string[]; objective: string }> = [
  { keywords: ["awareness", "brand"], objective: "Awareness" },
  { keywords: ["traffic", "click"], objective: "Traffic" },
  { keywords: ["lead", "form"], objective: "Lead Generation" },
  { keywords: ["sale", "purchase", "conv"], objective: "Sales" },
  { keywords: ["engage", "like", "comment"], objective: "Engagement" },
  { keywords: ["video", "view"], objective: "Video Views" },
];

function inferFromName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const { keywords, objective } of KEYWORD_TO_OBJECTIVE) {
    if (keywords.some((k) => lower.includes(k))) return objective;
  }
  return null;
}

export default function CampaignObjectiveAudit({ campaigns }: AuditProps) {
  const mismatches = campaigns.map((c) => {
    const inferred = inferFromName(c.name);
    const set = c.objective || "—";
    const mismatch =
      inferred && c.objective &&
      !c.objective.toLowerCase().includes(inferred.toLowerCase()) &&
      !inferred.toLowerCase().includes(c.objective.toLowerCase());
    return { campaign: c, inferred, set, mismatch: !!mismatch };
  });

  const mismatchCount = mismatches.filter((m) => m.mismatch).length;
  const total = campaigns.length;
  const okPct = total > 0 ? Math.round(((total - mismatchCount) / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Objective Alignment" value={`${okPct}%`} subLabel="Set objective matches name intent" tone={okPct >= 80 ? "good" : okPct >= 50 ? "warn" : "bad"} />
        <KpiCard label="Mismatches" value={mismatchCount} subLabel="Campaigns flagged" tone={mismatchCount > 0 ? "bad" : "good"} />
        <KpiCard label="Total Campaigns" value={total} />
      </div>

      <AuditCard
        title="Campaign Objective"
        description="Flags campaigns whose set objective doesn't match the goal implied by their name"
        badge={{ text: mismatchCount === 0 ? "No issues" : `${mismatchCount} mismatch`, color: mismatchCount === 0 ? "green" : "red" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Campaign</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Set Objective</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Inferred</th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">No campaigns to analyse.</td>
                </tr>
              ) : (
                mismatches.slice(0, 15).map(({ campaign, inferred, set, mismatch }) => (
                  <tr key={`${campaign.platform}-${campaign.id}`} className="border-b border-gray-100">
                    <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-xs">{campaign.name}</td>
                    <td className="px-4 py-2.5 text-gray-700">{set}</td>
                    <td className="px-4 py-2.5 text-gray-700">{inferred || "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge status={mismatch ? "fail" : "pass"} label={mismatch ? "Mismatch" : "OK"} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AuditCard>

      <TabSummaryFooter
        tabName="Campaign Objective Audit"
        lines={[
          `${total} campaign${total !== 1 ? "s" : ""} audited — ${okPct}% objective alignment.`,
          `${mismatchCount} mismatch${mismatchCount !== 1 ? "es" : ""} detected where the set objective doesn't match the campaign name intent.`,
          mismatchCount === 0 ? "All campaigns have consistent objectives and naming." : "Review mismatched campaigns and update their objectives or names.",
        ]}
        context={{ total, mismatchCount, okPct }}
        platform="meta"
        dateRange="30d"
      />
    </div>
  );
}
