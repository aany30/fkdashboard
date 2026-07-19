import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import { objectiveMatches } from "../CampaignObjectiveFilter";
import { TermText } from "@/components/shared/Term";
import { rangeToDates } from "@/lib/date-range";
import LoadingState from "@/components/shared/LoadingState";

interface Props {
  platform: "meta" | "dv360" | "both";
  /** Dashboard date range — forwarded to /api/naming/campaigns so insights
   * window matches the date picker. Default "30d" if omitted. */
  dateRange?: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** sub-tabs: each gets the filtered campaigns + loading state */
  subTabs: Array<{
    id: string;
    label: string;
    description: string;
    render: (args: { campaigns: CampaignData[]; loading: boolean; platform: "meta" | "dv360" | "both" }) => ReactNode;
  }>;
  defaultSubTab: string;
}

export default function AuditTabShell({
  platform,
  dateRange = "30d",
  customStart,
  customEnd,
  selectedObjectives,
  title,
  description,
  Icon,
  subTabs,
  defaultSubTab,
}: Props) {
  const {
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
  } = useAuthStore();
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string>(defaultSubTab);

  useEffect(() => {
    let cancelled = false;
    const fetchCampaigns = async () => {
      setLoading(true);
      const all: CampaignData[] = [];
      const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
      try {
        if ((platform === "meta" || platform === "both") && metaAccessToken && metaBusinessId) {
          const r = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate, endDate }),
          });
          if (r.ok) all.push(...(await r.json()));
        }
        if (
          (platform === "dv360" || platform === "both") &&
          dv360ClientId && dv360ClientSecret && dv360RefreshToken && dv360AdvertiserId
        ) {
          const r = await fetch("/api/naming/campaigns/dv360", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: dv360ClientId,
              clientSecret: dv360ClientSecret,
              refreshToken: dv360RefreshToken,
              advertiserId: dv360AdvertiserId,
              partnerId: dv360PartnerId || undefined,
              startDate,
              endDate,
            }),
          });
          if (r.ok) all.push(...(await r.json()));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) {
          setCampaigns(all);
          setLoading(false);
        }
      }
    };
    fetchCampaigns();
    return () => {
      cancelled = true;
    };
  }, [
    platform,
    dateRange,
    customStart,
    customEnd,
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
  ]);

  const filteredCampaigns = useMemo(() => {
    if (!selectedObjectives || selectedObjectives.size === 0) return campaigns;
    return campaigns.filter((c) => objectiveMatches(c.objective, selectedObjectives));
  }, [campaigns, selectedObjectives]);

  const activeSub = subTabs.find((t) => t.id === active) || subTabs[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-600 mt-1"><TermText>{description}</TermText></p>
        </div>
      </div>

      {selectedObjectives && selectedObjectives.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900">
          Filtered by objective:{" "}
          <span className="font-semibold">
            {Array.from(selectedObjectives).filter((s) => s !== "__none__").join(", ") || "(none)"}
          </span>{" "}
          — {filteredCampaigns.length} of {campaigns.length} campaigns
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${
              active === t.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.description}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState message="Loading campaign data…" />
      ) : (
        activeSub.render({ campaigns: filteredCampaigns, loading, platform })
      )}
    </div>
  );
}
