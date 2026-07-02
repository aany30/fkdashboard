import { Users } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import IntentAnalysisAudit from "./audits/IntentAnalysisAudit";
import AudienceQualityAudit from "./audits/AudienceQualityAudit";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function AudienceAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  return (
    <div className="space-y-6">
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
      <TabSummaryFooter
        lines={[
          "Audience audit covers intent classification (Cold/Warm/Hot) and quality scoring derived from live campaign data.",
          "Use Intent Analysis to identify funnel stage distribution — TOF, MOF, BOF mix signals budget alignment.",
          "Audience Quality sub-tab highlights high-intent share and flags audiences with low engagement or saturation risk.",
        ]}
        tabName="Audience Audit"
        context={{ platform, dateRange, subTabs: ["intent", "quality"] }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
