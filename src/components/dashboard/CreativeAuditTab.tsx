import { Image as ImageIcon } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import CreativeFunnelMappingAudit from "./audits/CreativeFunnelMappingAudit";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function CreativeAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  return (
    <div className="space-y-6">
      <AuditTabShell
        platform={platform}
        dateRange={dateRange}
        customStart={customStart}
        customEnd={customEnd}
        selectedObjectives={selectedObjectives}
        title="Creative Audit"
        description="Creative funnel mapping derived from campaign objectives"
        Icon={ImageIcon}
        defaultSubTab="funnel-mapping"
        subTabs={[
          { id: "funnel-mapping", label: "Creative Funnel Mapping", description: "TOF/MOF/BOF coverage", render: (p) => <CreativeFunnelMappingAudit {...p} /> },
        ]}
      />
      <TabSummaryFooter
        lines={[
          "Creative Funnel Mapping classifies creatives into TOF (awareness), MOF (consideration), and BOF (conversion) stages by campaign objective.",
          "Gaps in funnel stage coverage indicate creatives are concentrated at one stage — balance across TOF/MOF/BOF improves overall funnel health.",
          "Connect your ad account to see live creative-to-objective mapping for the selected date range.",
        ]}
        tabName="Creative Audit"
        context={{ platform, dateRange, subTabs: ["funnel-mapping"] }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
