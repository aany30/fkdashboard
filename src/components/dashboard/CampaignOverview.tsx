import { Layers, Users, Image as ImageIcon, Globe, Briefcase } from "lucide-react";
import SectionOverview from "./SectionOverview";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  setActiveTab: (id: string) => void;
}

export default function CampaignOverview({ platform, setActiveTab }: Props) {
  return (
    <div className="space-y-6">
      <SectionOverview
        title="Campaign"
        description="Account structure, audience, creative, naming and per-platform campaign audits"
        Icon={Briefcase}
        onTileClick={setActiveTab}
        tiles={[
          {
            id: "account-structure",
            label: "Account Structure",
            description: "Naming, funnel separation, budget, learning, ABO vs CBO",
            Icon: Layers,
            tone: "neutral",
          },
          {
            id: "audience-audit",
            label: "Audience Audit",
            description: "Overlap %, intent, saturation, audience quality, wasted spend",
            Icon: Users,
            tone: "neutral",
          },
          {
            id: "creative-audit",
            label: "Creative Audit",
            description: "Creative funnel mapping, demographic analysis, creative strategy",
            Icon: ImageIcon,
            tone: "neutral",
          },
          {
            id: "platform-audit",
            label: "Platform Audit",
            description: "Meta (Pixel, CAPI, Advantage+) and Google (Search, PMax, RSA)",
            Icon: Globe,
            tone: "neutral",
          },
        ]}
      />
      <TabSummaryFooter
        lines={[
          "4 campaign audit modules available: Account Structure, Audience, Creative, and Platform.",
          "Select any tile above to drill into naming conventions, audience quality, creative funnel mapping, or platform-specific checks.",
          "Each module pulls live data from your connected ad accounts for the selected date range.",
        ]}
        tabName="Campaign Overview"
        context={{ platform, sections: ["account-structure", "audience-audit", "creative-audit", "platform-audit"] }}
        platform={platform === "both" ? "meta" : platform}
        dateRange="30d"
      />
    </div>
  );
}
