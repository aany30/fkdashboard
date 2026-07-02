import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/router";
import PixelHealthTab from "@/components/dashboard/PixelHealthTab";
import EventQualityTab from "@/components/dashboard/EventQualityTab";
import FunnelAuditTab from "@/components/dashboard/FunnelAuditTab";
import AttributionTab from "@/components/dashboard/AttributionTab";
import RecommendationsTab from "@/components/dashboard/RecommendationsTab";
import AccountStructureTab from "@/components/dashboard/AccountStructureTab";
import AudienceOverlapTab from "@/components/dashboard/tabs/AudienceOverlapTab";
import AudiencePerformanceTab from "@/components/dashboard/tabs/AudiencePerformanceTab";
import AudienceQualityTab from "@/components/dashboard/tabs/AudienceQualityTab";
import AudienceSaturationTab from "@/components/dashboard/tabs/AudienceSaturationTab";
import SearchIntentTab from "@/components/dashboard/tabs/SearchIntentTab";
import ConversionMonitoringTab from "@/components/dashboard/tabs/ConversionMonitoringTab";
import CampaignOverview from "@/components/dashboard/CampaignOverview";
import ReportingOverview from "@/components/dashboard/reports/ReportingOverview";
import KeyMetricAnalysisReport from "@/components/dashboard/reports/KeyMetricAnalysisReport";
import AudienceAnalysisReport from "@/components/dashboard/reports/AudienceAnalysisReport";
import CreativeReport from "@/components/dashboard/reports/CreativeReport";
import PlacementReport from "@/components/dashboard/reports/PlacementReport";
import AttributionReport from "@/components/dashboard/reports/AttributionReport";
import PlanningReport from "@/components/dashboard/reports/PlanningReport";
import ExportReport from "@/components/dashboard/reports/ExportReport";
import GenerateReport from "@/components/dashboard/reports/GenerateReport";
import AskAITab from "@/components/dashboard/tabs/AskAITab";
import AccountSelector from "@/components/dashboard/AccountSelector";
import CampaignObjectiveFilter from "@/components/dashboard/CampaignObjectiveFilter";
import PlatformFilter, { PlatformValue, toLegacyPlatform } from "@/components/dashboard/PlatformFilter";
import DateRangePicker, { DateRange } from "@/components/shared/DateRangePicker";
import {
  BarChart3,
  Activity,
  TrendingUp,
  Target,
  Settings2,
  Bot,
  LogOut,
  Layers,
  Users,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Mail,
  Check,
  FileText,
  BarChart2,
  Star,
  Zap,
  Search,
  Megaphone,
  Sparkles,
  Image as ImageIcon,
  Map as MapIcon,
  GitBranch,
  Download,
  ShieldCheck,
  Monitor,
  LineChart,
  Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SubTab {
  id: string;
  label: string;
  Icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  Icon: LucideIcon;
  children?: SubTab[];
}

const NAV: NavGroup[] = [
  {
    id: "audit",
    label: "Audit",
    Icon: ShieldCheck,
    children: [
      { id: "pixel-health",  label: "Pixel Health",       Icon: Activity  },
      { id: "event-quality", label: "Event Quality",      Icon: TrendingUp },
      { id: "funnel",        label: "Funnel Audit",       Icon: Target    },
      { id: "attribution",   label: "Attribution Audit",  Icon: Settings2 },
      { id: "aud-overlap",   label: "Audience Overlap",   Icon: Users     },
    ],
  },
  {
    id: "tracking",
    label: "Tracking",
    Icon: Monitor,
    children: [
      { id: "account-structure",      label: "Account Structure",      Icon: Layers    },
      { id: "aud-performance",        label: "Audience Performance",   Icon: BarChart2 },
      { id: "aud-saturation",         label: "Saturation",             Icon: Zap       },
      { id: "search-intent",          label: "Search Intent",          Icon: Search    },
      { id: "conversion-monitoring",  label: "Conversion Monitoring",  Icon: LineChart },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    Icon: FileText,
    children: [
      { id: "rep-overview",    label: "Overview",            Icon: BarChart3 },
      { id: "rep-key-metric",  label: "Key Metrics",         Icon: Megaphone },
      { id: "rep-audience",    label: "Audience Analysis",   Icon: Sparkles  },
      { id: "rep-creative",    label: "Creative Analysis",   Icon: ImageIcon },
      { id: "rep-placement",   label: "Placement Analysis",  Icon: MapIcon   },
      { id: "rep-attribution", label: "Attribution Report",  Icon: GitBranch },
      { id: "rep-planning",    label: "Planning",            Icon: Briefcase },
      { id: "rep-generate",    label: "Generate Report",     Icon: Download  },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    Icon: Lightbulb,
    children: [
      { id: "recommendations", label: "AI Recommendations", Icon: Bot },
      { id: "ask-ai",          label: "Ask AI",             Icon: Sparkles  },
    ],
  },
];

export default function Dashboard() {
  const router = useRouter();
  const {
    isMetaConnected,
    isGoogleConnected,
    clearAllCredentials,
    setMetaCredentials,
    setMetaPixelList,
    setGoogleCredentials,
    setGoogleAccountsList,
    totalAiCreditsUsd,
    alertEmail,
    setAlertEmail,
    demoMode,
    enterDemoMode,
    exitDemoMode,
  } = useAuthStore();
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [emailSavedFlash, setEmailSavedFlash] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("pixel-health");
  const [platformFilter, setPlatformFilter] = useState<PlatformValue>("all");
  const platform = toLegacyPlatform(platformFilter);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [customStart, setCustomStart] = useState<string | undefined>();
  const [customEnd, setCustomEnd] = useState<string | undefined>();
  const [selectedObjectives, setSelectedObjectives] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["audit", "tracking", "reporting", "insights"]));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle OAuth redirects
  useEffect(() => {
    if (!router.isReady) return;

    const {
      meta_token,
      business_id,
      pixel_ids,
      pixel_names,
      google_token,
      customer_id,
      property_id,
      container_id,
    } = router.query;

    // Handle Meta OAuth
    if (meta_token && business_id && pixel_ids) {
      const pixelIdArray = (pixel_ids as string).split(",");
      const nameArray = pixel_names ? (pixel_names as string).split("|") : pixelIdArray;

      setMetaCredentials(
        meta_token as string,
        business_id as string,
        pixelIdArray
      );

      const pixelList = pixelIdArray.map((id, idx) => ({
        id: id.trim(),
        name: nameArray[idx] || `Pixel ${id.trim()}`,
      }));

      setMetaPixelList(pixelList);

      // Clean up URL
      router.replace("/app/dashboard");
    }

    // Handle Google OAuth
    if (google_token && customer_id) {
      setGoogleCredentials(
        google_token as string,
        customer_id as string,
        property_id as string || "",
        container_id as string || ""
      );

      const accounts = [
        {
          customerId: customer_id as string,
          name: "Google Account",
          properties: property_id
            ? [{ id: property_id as string, name: "GA4 Property" }]
            : [],
          containers: container_id
            ? [{ id: container_id as string, name: "GTM Container" }]
            : [],
        },
      ];

      setGoogleAccountsList(accounts);

      // Clean up URL
      router.replace("/app/dashboard");
    }
  }, [router.isReady, router.query, setMetaCredentials, setMetaPixelList, setGoogleCredentials, setGoogleAccountsList, router]);

  // Hydrate demo mode from ?demo=1 — survives refresh / back-button within the
  // tab without leaking into localStorage.
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.demo === "1" && !demoMode) enterDemoMode();
  }, [router.isReady, router.query.demo, demoMode, enterDemoMode]);

  // Route guard — block /app/dashboard for unconnected, non-demo visitors.
  useEffect(() => {
    if (!mounted || !router.isReady) return;
    if (router.query.demo === "1") return; // grace period while demoMode hydrates
    if (!isMetaConnected() && !isGoogleConnected() && !demoMode) {
      router.replace("/");
    }
  }, [mounted, router.isReady, router.query.demo, isMetaConnected, isGoogleConnected, demoMode, router]);

  const handleLogout = () => {
    clearAllCredentials();
    router.push("/");
  };

  const handleDateChange = (range: DateRange, start?: string, end?: string) => {
    setDateRange(range);
    setCustomStart(start);
    setCustomEnd(end);
  };

  const renderTabContent = () => {
    const props = { platform, dateRange, customStart, customEnd };
    const ctx = { ...props, selectedObjectives, setActiveTab };
    switch (activeTab) {
      // Audit
      case "pixel-health":
        return <PixelHealthTab {...props} />;
      case "event-quality":
        return <EventQualityTab {...props} />;
      case "funnel":
        return <FunnelAuditTab {...props} />;
      case "attribution":
        return <AttributionTab {...props} />;
      case "aud-overlap":
        return <AudienceOverlapTab {...ctx} />;
      case "aud-quality":
        return <AudienceQualityTab {...ctx} />;
      // Tracking
      case "account-structure":
        return <AccountStructureTab {...ctx} />;
      case "camp-performance":
        return <CampaignOverview platform={platform} setActiveTab={setActiveTab} />;
      case "aud-performance":
        return <AudiencePerformanceTab {...ctx} />;
      case "aud-saturation":
        return <AudienceSaturationTab {...ctx} />;
      case "search-intent":
        return <SearchIntentTab {...ctx} />;
      case "conversion-monitoring":
        return <ConversionMonitoringTab {...props} />;
      // Reporting
      case "reporting":
      case "rep-overview":
        return <ReportingOverview {...props} setActiveTab={setActiveTab} />;
      case "rep-key-metric":
        return <KeyMetricAnalysisReport {...props} />;
      case "rep-audience":
        return <AudienceAnalysisReport {...props} />;
      case "rep-creative":
        return <CreativeReport {...props} />;
      case "rep-placement":
        return <PlacementReport {...props} />;
      case "rep-attribution":
        return <AttributionReport {...props} />;
      case "rep-planning":
        return <PlanningReport {...props} />;
      case "rep-export":
        return <ExportReport {...props} />;
      case "rep-generate":
        return <GenerateReport {...props} />;
      // Insights
      case "recommendations":
        return <RecommendationsTab {...props} />;
      case "ask-ai":
        return <AskAITab {...props} />;
      default:
        return <PixelHealthTab {...props} />;
    }
  };

  const handleGroupClick = (groupId: string, hasChildren: boolean, firstChildId?: string) => {
    if (hasChildren && firstChildId) {
      setActiveTab(firstChildId);
    } else {
      setActiveTab(groupId);
    }
    if (hasChildren) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
    }
  };

  const toggleGroup = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {demoMode && (
        <div className="sticky top-0 z-50 bg-yellow-50 border-b border-yellow-300 text-yellow-900 text-sm">
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠</span>
              <span><span className="font-bold">Demo Mode</span> — you&apos;re viewing sample data, not a real ad account.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { exitDemoMode(); router.push("/"); }}
                className="px-3 py-1 rounded bg-yellow-200 hover:bg-yellow-300 text-yellow-900 text-xs font-bold transition"
              >
                Connect your account
              </button>
              <button
                onClick={() => { exitDemoMode(); router.push("/"); }}
                className="px-3 py-1 rounded text-yellow-800 hover:bg-yellow-100 text-xs font-semibold transition"
              >
                Exit demo
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center gap-4">
          {/* Left: Logo + Filters (Platform · Objectives · Calendar) */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 pr-4 border-r border-gray-200">
              <BarChart3 className="w-7 h-7 text-blue-600" strokeWidth={2.5} />
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                Auditor
              </span>
            </div>

            {/* Platform Filter Dropdown */}
            <PlatformFilter value={platformFilter} onChange={setPlatformFilter} />

            {/* Campaign Objective Filter */}
            <CampaignObjectiveFilter
              selected={selectedObjectives}
              onChange={setSelectedObjectives}
            />

            {/* Date Range Picker */}
            <DateRangePicker
              range={dateRange}
              startDate={customStart}
              endDate={customEnd}
              onChange={handleDateChange}
            />
          </div>

          {/* Right: Account Selector + AI Credits counter + Logout */}
          <div className="flex items-center gap-3">
            <AccountSelector />

            {/* Running AI credit counter — accumulates the product-priced cost of every AI call this session */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-800"
              title="Total AI credits used this session. Resets on logout."
            >
              <span>✦ AI Credits</span>
              <span className="font-mono">{totalAiCreditsUsd.toFixed(2)}</span>
            </div>

            {/* Alert-email icon — when set, critical Budget Allocation issues
                auto-email this address. Click to add/edit. */}
            <div className="relative">
              <button
                onClick={() => { setEmailDraft(alertEmail || ""); setEmailPopoverOpen((v) => !v); }}
                className={`relative p-2 rounded-lg transition flex items-center gap-1.5 text-sm font-semibold ${
                  alertEmail
                    ? "bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                    : "bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200"
                }`}
                title={alertEmail ? `Critical-issue alerts → ${alertEmail}` : "Add alert email"}
              >
                <Mail className="w-4 h-4" />
                {alertEmail && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full ring-2 ring-white" />}
              </button>
              {emailPopoverOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">Critical-issue alerts</h3>
                  <p className="text-[11px] text-gray-500 mb-3">
                    We&apos;ll email this address when Budget Allocation detects a budget spike (&gt;25% week-over-week) or a campaign stops delivering.
                  </p>
                  <input
                    type="email"
                    placeholder="you@email.com"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-3 gap-2">
                    <button
                      onClick={() => { setAlertEmail(null); setEmailDraft(""); setEmailPopoverOpen(false); }}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEmailPopoverOpen(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          const v = emailDraft.trim();
                          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
                          setAlertEmail(v);
                          setEmailSavedFlash(true);
                          setTimeout(() => setEmailSavedFlash(false), 1500);
                          setTimeout(() => setEmailPopoverOpen(false), 600);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-1"
                      >
                        {emailSavedFlash ? <><Check className="w-3 h-3" /> Saved</> : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="space-y-1 p-4">
            {NAV.map((group) => {
              const hasChildren = !!group.children?.length;
              const isExpanded = expandedGroups.has(group.id);
              const isActiveGroup = activeTab === group.id;
              const isActiveChild = hasChildren && group.children!.some((c) => c.id === activeTab);

              return (
                <div key={group.id}>
                  <button
                    onClick={() => handleGroupClick(group.id, hasChildren, group.children?.[0]?.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg font-semibold transition flex items-center gap-3 text-sm ${
                      isActiveGroup
                        ? "bg-blue-600 text-white"
                        : isActiveChild
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <group.Icon className="w-5 h-5" />
                    <span className="flex-1">{group.label}</span>
                    {hasChildren && (
                      <span
                        onClick={(e) => toggleGroup(e, group.id)}
                        className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
                        role="button"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                    )}
                  </button>

                  {hasChildren && isExpanded && (
                    <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-2">
                      {group.children!.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => setActiveTab(child.id)}
                          className={`w-full text-left px-3 py-2 rounded-md font-medium transition flex items-center gap-2 text-sm ${
                            activeTab === child.id
                              ? "bg-blue-100 text-blue-700 font-semibold"
                              : "text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          <child.Icon className="w-4 h-4" />
                          <span>{child.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto bg-gray-50">
          <div className="p-8">{renderTabContent()}</div>
        </main>
      </div>

    </div>
  );
}
