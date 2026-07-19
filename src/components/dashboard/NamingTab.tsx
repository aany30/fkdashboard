import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import { BookOpen } from "lucide-react";
import NamingMaker from "./NamingMaker";
import NamingChecker from "./NamingChecker";
import RenamingAgent from "./RenamingAgent";
import { objectiveMatches } from "./CampaignObjectiveFilter";
import { rangeToDates } from "@/lib/date-range";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
}

type TabType = "maker" | "checker" | "agent";

export default function NamingTab({ platform, dateRange = "30d", customStart, customEnd, selectedObjectives }: Props) {
  const {
    metaAccessToken,
    metaBusinessId,
    metaPixelIds,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
  } = useAuthStore();

  const [activeTab, setActiveTab] = useState<TabType>("maker");
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch campaigns from Meta and DV360 APIs
  useEffect(() => {
    const fetchCampaigns = async () => {
      setLoading(true);
      const allCampaigns: CampaignData[] = [];
      const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

      try {
        // Fetch Meta campaigns
        if (
          (platform === "meta" || platform === "both") &&
          metaAccessToken &&
          metaBusinessId &&
          metaPixelIds.length > 0
        ) {
          const response = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: metaAccessToken,
              businessId: metaBusinessId,
              startDate,
              endDate,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            allCampaigns.push(...data);
          }
        }

        // Fetch DV360 campaigns
        if (
          (platform === "dv360" || platform === "both") &&
          dv360ClientId && dv360ClientSecret && dv360RefreshToken && dv360AdvertiserId
        ) {
          const response = await fetch("/api/naming/campaigns/dv360", {
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

          if (response.ok) {
            const data = await response.json();
            allCampaigns.push(...data);
          }
        }

        setCampaigns(allCampaigns);
      } catch (error) {
        console.error("Failed to fetch campaigns:", error);
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    };

    // Fetch campaigns when component mounts, platform changes, or date range changes
    fetchCampaigns();
  }, [
    platform,
    dateRange,
    customStart,
    customEnd,
    metaAccessToken,
    metaBusinessId,
    metaPixelIds,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
  ]);

  const handleRefresh = () => {
    // Re-fetch campaigns
    const fetchCampaigns = async () => {
      setLoading(true);
      const allCampaigns: CampaignData[] = [];
      const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

      try {
        if (
          (platform === "meta" || platform === "both") &&
          metaAccessToken &&
          metaBusinessId
        ) {
          const response = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: metaAccessToken,
              businessId: metaBusinessId,
              startDate,
              endDate,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            allCampaigns.push(...data);
          }
        }

        if (
          (platform === "dv360" || platform === "both") &&
          dv360ClientId && dv360ClientSecret && dv360RefreshToken && dv360AdvertiserId
        ) {
          const response = await fetch("/api/naming/campaigns/dv360", {
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

          if (response.ok) {
            const data = await response.json();
            allCampaigns.push(...data);
          }
        }

        setCampaigns(allCampaigns);
      } catch (error) {
        console.error("Failed to refresh campaigns:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  };

  const NAMING_TABS = [
    { id: "maker" as TabType, label: "Naming Maker", description: "Generate standardized campaign names" },
    { id: "checker" as TabType, label: "Naming Checker", description: "Audit campaign compliance" },
    { id: "agent" as TabType, label: "Renaming Agent", description: "Get correction suggestions" },
  ];

  // Apply objective filter from the navbar dropdown
  const filteredCampaigns = useMemo(() => {
    if (!selectedObjectives || selectedObjectives.size === 0) return campaigns;
    return campaigns.filter((c) => objectiveMatches(c.objective, selectedObjectives));
  }, [campaigns, selectedObjectives]);

  if (loading && campaigns.length === 0) return <LoadingState message="Loading campaign data…" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Campaign Naming Conventions</h1>
            <p className="text-gray-600 mt-1">Manage, audit, and optimize your campaign naming strategy</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200">
        {NAMING_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 font-semibold border-b-2 transition ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <div>{tab.label}</div>
            <div className="text-xs text-gray-500 font-normal">{tab.description}</div>
          </button>
        ))}
      </div>

      {/* Filter status banner */}
      {selectedObjectives && selectedObjectives.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900">
          Filtered by objective: <span className="font-semibold">{Array.from(selectedObjectives).filter((s) => s !== "__none__").join(", ") || "(none)"}</span> — showing {filteredCampaigns.length} of {campaigns.length} campaigns
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "maker" && <NamingMaker />}
      {activeTab === "checker" && (
        <NamingChecker campaigns={filteredCampaigns} loading={loading} onRefresh={handleRefresh} />
      )}
      {activeTab === "agent" && <RenamingAgent campaigns={filteredCampaigns} loading={loading} />}

      <TabSummaryFooter
        lines={[
          `${filteredCampaigns.length} campaign${filteredCampaigns.length !== 1 ? "s" : ""} loaded for naming audit${selectedObjectives && selectedObjectives.size > 0 ? ` (filtered from ${campaigns.length} total)` : ""}.`,
          `Currently in the ${NAMING_TABS.find((t) => t.id === activeTab)?.label ?? activeTab} tool — ${NAMING_TABS.find((t) => t.id === activeTab)?.description ?? ""}.`,
          "Use Naming Checker to audit compliance against your convention, and Renaming Agent to get AI-powered correction suggestions.",
        ]}
        tabName="Campaign Naming Conventions"
        context={{ platform, dateRange, campaignCount: filteredCampaigns.length, activeTab }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}
