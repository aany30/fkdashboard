import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import AuditTabShell from "./audits/AuditTabShell";
import MetaPlatformAudit from "./audits/MetaPlatformAudit";
import ConnectCta from "@/components/shared/ConnectCta";
import type { CampaignData } from "@/types";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function PlatformAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  const { isMetaConnected } = useAuthStore();
  const metaOn = isMetaConnected();

  // Build sub-tab list only from connected platforms.
  // (A DV360-specific platform audit lands with the Floodlight work.)
  const subTabs: Array<{
    id: string;
    label: string;
    description: string;
    render: (p: { campaigns: CampaignData[]; loading: boolean; platform: "meta" | "dv360" | "both" }) => ReactNode;
  }> = [];

  if (metaOn) {
    subTabs.push({
      id: "meta",
      label: "Meta",
      description: "Pixel, CAPI, Advantage+, placements",
      render: (p) => <MetaPlatformAudit {...p} />,
    });
  }

  // Nothing connected → show CTA, skip the shell entirely.
  if (subTabs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Platform Audit</h1>
            <p className="text-gray-600 mt-1">Platform-specific checks</p>
          </div>
        </div>
        <ConnectCta platform="a platform" context="to see platform-specific audits (Meta or DV360)" />
      </div>
    );
  }

  return (
    <AuditTabShell
      platform={platform}
      dateRange={dateRange}
      customStart={customStart}
      customEnd={customEnd}
      selectedObjectives={selectedObjectives}
      title="Platform Audit"
      description="Meta and DV360 platform-specific checks"
      Icon={Globe}
      defaultSubTab={subTabs[0].id}
      subTabs={subTabs}
    />
  );
}
