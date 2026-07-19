/**
 * Wrapper that adapts TargetingInsightsAudit (which expects AuditProps)
 * for the Reporting section route. Fetches the campaign list for currency
 * detection and forwards the right props down.
 */

import { Target } from "lucide-react";
import { useCampaigns } from "@/hooks/useCampaigns";
import TargetingInsightsAudit from "@/components/dashboard/audits/TargetingInsightsAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function TargetingInsightsReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading } = useCampaigns(platform, dateRange, customStart, customEnd);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Targeting Insights</h1>
            <p className="text-gray-600 mt-1">
              Where to focus your Meta ad spend — demographics, places, devices and placements that convert best.
            </p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Targeting Insights"
          context={{
            campaignCount: campaigns.length,
            totalSpend: Math.round(campaigns.reduce((s, c) => s + (c.spend || 0), 0)),
            totalConversions: campaigns.reduce((s, c) => s + (c.conversions || 0), 0),
            topCampaigns: [...campaigns]
              .sort((a, b) => (b.spend || 0) - (a.spend || 0))
              .slice(0, 20)
              .map((c) => ({
                name: c.name, platform: c.platform, objective: c.objective,
                spend: Math.round(c.spend || 0), conversions: c.conversions || 0,
                roas: (c.spend || 0) > 0 ? +(((c.conversionValue || 0) / (c.spend || 1))).toFixed(2) : 0,
              })),
          }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={String(dateRange)}
          inline
        />
      </div>
      <TargetingInsightsAudit
        campaigns={campaigns}
        loading={loading}
        platform={platform}
        dateRange={dateRange}
        customStart={customStart}
        customEnd={customEnd}
      />
    </div>
  );
}
