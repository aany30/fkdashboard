import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/router";
import PixelHealthTab from "@/components/dashboard/PixelHealthTab";
import EventQualityTab from "@/components/dashboard/EventQualityTab";
import FunnelAuditTab from "@/components/dashboard/FunnelAuditTab";
import AttributionTab from "@/components/dashboard/AttributionTab";
import FloodlightHealthTab from "@/components/dashboard/FloodlightHealthTab";
import RecommendationsTab from "@/components/dashboard/RecommendationsTab";
import AccountStructureTab from "@/components/dashboard/AccountStructureTab";
import AudienceOverlapTab from "@/components/dashboard/tabs/AudienceOverlapTab";
import AudiencePerformanceTab from "@/components/dashboard/tabs/AudiencePerformanceTab";
import AudienceQualityTab from "@/components/dashboard/tabs/AudienceQualityTab";
import AudienceSaturationTab from "@/components/dashboard/tabs/AudienceSaturationTab";
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
  Flame,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SubTab {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Platforms this tab has meaningful data for. Absent = both. */
  platforms?: Array<"meta" | "dv360">;
}

interface NavGroup {
  id: string;
  label: string;
  Icon: LucideIcon;
  children?: SubTab[];
}

// `platforms` tags which platforms a tab actually shows data for. When the
// selected platform is DV360, tabs marked ["meta"] are hidden so the user
// doesn't hit empty "N/A for DV360" states — and vice versa.
const NAV: NavGroup[] = [
  {
    id: "audit",
    label: "Audit",
    Icon: ShieldCheck,
    children: [
      { id: "pixel-health",  label: "Pixel Health",       Icon: Activity,   platforms: ["meta"] },
      { id: "event-quality", label: "Event Quality",      Icon: TrendingUp, platforms: ["meta"] },
      { id: "funnel",        label: "Funnel Audit",       Icon: Target,     platforms: ["meta"] },
      { id: "attribution",   label: "Attribution Audit",  Icon: Settings2   },
      { id: "aud-overlap",   label: "Audience Overlap",   Icon: Users,      platforms: ["meta"] },
      { id: "floodlight",    label: "Floodlight",         Icon: Flame,      platforms: ["dv360"] },
    ],
  },
  {
    id: "tracking",
    label: "Tracking",
    Icon: Monitor,
    children: [
      { id: "account-structure",      label: "Account Structure",      Icon: Layers    },
      { id: "aud-performance",        label: "Audience Performance",   Icon: BarChart2, platforms: ["meta"] },
      { id: "aud-saturation",         label: "Saturation",             Icon: Zap       },
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
      { id: "rep-placement",   label: "Placement Analysis",  Icon: MapIcon,    platforms: ["meta"] },
      { id: "rep-attribution", label: "Attribution Report",  Icon: GitBranch,  platforms: ["meta"] },
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

/** True when the tab has meaningful data for the selected platform. */
function isTabVisible(tab: SubTab, platform: "meta" | "dv360" | "both"): boolean {
  if (!tab.platforms) return true;         // no restriction = both
  if (platform === "both") return true;    // "All" shows everything
  return tab.platforms.includes(platform);
}

export default function Dashboard() {
  const router = useRouter();
  const {
    isMetaConnected,
    isDV360Connected,
    dv360RefreshToken,
    dv360AdvertiserId,
    clearAllCredentials,
    clearMetaCredentials,
    clearDV360Credentials,
    setMetaCredentials,
    setMetaPixelList,
    setDV360Credentials,
    totalAiCreditsUsd,
    alertEmail,
    loginEmail,
    setAlertEmail,
    setLoginEmail,
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
  const [dv360AdvOptions, setDv360AdvOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [dv360NeedsAdvertiser, setDv360NeedsAdvertiser] = useState(false);
  const [logoutMenuOpen, setLogoutMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // NAV filtered to tabs that have real data for the currently-selected
  // platform — groups whose children all get hidden are dropped too.
  const visibleNav = useMemo(() => {
    return NAV
      .map((g) => ({ ...g, children: g.children?.filter((c) => isTabVisible(c, platform)) }))
      .filter((g) => !g.children || g.children.length > 0);
  }, [platform]);

  // If the currently-active tab isn't visible for the selected platform,
  // jump to the first visible tab so the user isn't stuck on a hidden view.
  useEffect(() => {
    const allVisibleIds = visibleNav.flatMap((g) => g.children?.map((c) => c.id) ?? [g.id]);
    if (!allVisibleIds.includes(activeTab)) {
      const first = allVisibleIds[0];
      if (first) setActiveTab(first);
    }
  }, [platform, visibleNav, activeTab]);

  // Handle OAuth redirects
  useEffect(() => {
    if (!router.isReady) return;

    const {
      meta_token,
      business_id,
      pixel_ids,
      pixel_names,
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
      router.replace("/app/dashboard");
    }

    // Handle DV360 OAuth
    const {
      dv360_refresh,
      dv360_client_id,
      dv360_client_secret,
      dv360_adv_ids,
      dv360_adv_names,
      login_email,
    } = router.query;

    // Capture the Google sign-in email so alerts default to it (no manual entry).
    if (login_email) setLoginEmail(login_email as string);

    if (dv360_refresh && dv360_client_id && dv360_client_secret) {
      const advIds = dv360_adv_ids ? (dv360_adv_ids as string).split(",") : [];
      const advNames = dv360_adv_names ? (dv360_adv_names as string).split("|") : [];

      if (advIds.length > 0) {
        // Store first advertiser; if multiple, user picks via DV360AdvertiserPicker
        setDV360Credentials({
          clientId: dv360_client_id as string,
          clientSecret: dv360_client_secret as string,
          refreshToken: dv360_refresh as string,
          advertiserId: advIds[0],
        });

        if (advIds.length > 1) {
          setDv360AdvOptions(advIds.map((id, i) => ({ id, name: advNames[i] || id })));
        }
      } else {
        // No advertisers found — save creds without advertiser ID, user pastes manually
        setDV360Credentials({
          clientId: dv360_client_id as string,
          clientSecret: dv360_client_secret as string,
          refreshToken: dv360_refresh as string,
          advertiserId: "",
        });
        setDv360NeedsAdvertiser(true);
      }

      router.replace("/app/dashboard");
    }

  }, [router.isReady, router.query, setMetaCredentials, setMetaPixelList, setDV360Credentials, setLoginEmail, router]);

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
    // A DV360 refresh token present but no advertiser yet = mid-connection
    // (OAuth found no advertisers, user must paste the ID). Don't bounce them
    // back to landing — let the "Paste your Advertiser ID" prompt show.
    const dv360Pending = !!dv360RefreshToken;
    if (!isMetaConnected() && !isDV360Connected() && !dv360Pending && !demoMode) {
      router.replace("/");
    }
  }, [mounted, router.isReady, router.query.demo, isMetaConnected, isDV360Connected, dv360RefreshToken, demoMode, router]);

  const handleLogout = () => {
    clearAllCredentials();
    router.push("/");
  };

  // Disconnect one platform, keep the session alive if the other remains.
  const handleDisconnect = (which: "meta" | "dv360") => {
    if (which === "meta") clearMetaCredentials();
    else clearDV360Credentials();
    setLogoutMenuOpen(false);
    const stillConnected = which === "meta" ? isDV360Connected() : isMetaConnected();
    if (!stillConnected && !demoMode) router.push("/");
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
      case "floodlight":
        return <FloodlightHealthTab {...props} />;
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

            {/* Running AI credit counter — accumulates the product-priced cost of every AI call, saved per account */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-800"
              title="Total AI credits used by this account. Saved per login email — restored when you log back in."
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
                    {alertEmail && alertEmail === loginEmail && <span className="block mt-1 text-gray-400">Defaulted to your signed-in Google account — edit if you&apos;d like alerts elsewhere.</span>}
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

            <div className="relative">
              <button
                onClick={() => setLogoutMenuOpen((v) => !v)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
                <ChevronDown className={`w-3.5 h-3.5 transition ${logoutMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {logoutMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                  {mounted && isMetaConnected() && (
                    <button
                      onClick={() => handleDisconnect("meta")}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Disconnect Meta only
                    </button>
                  )}
                  {mounted && isDV360Connected() && (
                    <button
                      onClick={() => handleDisconnect("dv360")}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Disconnect DV360 only
                    </button>
                  )}
                  {mounted && !isDV360Connected() && (
                    <a
                      href="/api/auth/google/start"
                      className="w-full text-left px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2 border-t border-gray-100"
                      onClick={() => setLogoutMenuOpen(false)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      Connect DV360
                    </a>
                  )}
                  {mounted && isDV360Connected() && (
                    <a
                      href="/api/auth/google/start"
                      className="w-full text-left px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2"
                      onClick={() => setLogoutMenuOpen(false)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      Reconnect DV360
                    </a>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100"
                  >
                    Logout (disconnect all)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="space-y-1 p-4">
            {visibleNav.map((group) => {
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
          {/* DV360 Advertiser picker — shown when OAuth returned multiple advertisers */}
          {dv360AdvOptions && (
            <div className="bg-blue-50 border-b border-blue-200 px-8 py-4">
              <p className="text-sm font-semibold text-blue-900 mb-2">Select a DV360 advertiser</p>
              <div className="flex flex-wrap gap-2">
                {dv360AdvOptions.map((adv) => (
                  <button
                    key={adv.id}
                    onClick={() => {
                      setDV360Credentials({
                        clientId: useAuthStore.getState().dv360ClientId!,
                        clientSecret: useAuthStore.getState().dv360ClientSecret!,
                        refreshToken: useAuthStore.getState().dv360RefreshToken!,
                        advertiserId: adv.id,
                      });
                      setDv360AdvOptions(null);
                    }}
                    className="px-3 py-1.5 bg-white border border-blue-300 rounded-lg text-sm text-blue-900 hover:bg-blue-100 transition-colors"
                  >
                    {adv.name} <span className="text-blue-400 text-xs ml-1">({adv.id})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* DV360 needs advertiser ID — OAuth didn't find any advertisers, or
              creds persisted (e.g. after reload) without an advertiser yet. */}
          {(dv360NeedsAdvertiser || (dv360RefreshToken && !dv360AdvertiserId)) && (
            <div className="bg-amber-50 border-b border-amber-200 px-8 py-4">
              <p className="text-sm font-semibold text-amber-900 mb-1">Paste your DV360 Advertiser ID</p>
              <p className="text-xs text-amber-700 mb-2">
                Open <a href="https://displayvideo.google.com" target="_blank" rel="noreferrer" className="underline">displayvideo.google.com</a> — the number after <code className="text-xs">/a/</code> in the URL is your Advertiser ID.
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.target as HTMLFormElement).elements.namedItem("advId") as HTMLInputElement;
                  if (input.value.trim()) {
                    setDV360Credentials({
                      clientId: useAuthStore.getState().dv360ClientId!,
                      clientSecret: useAuthStore.getState().dv360ClientSecret!,
                      refreshToken: useAuthStore.getState().dv360RefreshToken!,
                      advertiserId: input.value.trim(),
                    });
                    setDv360NeedsAdvertiser(false);
                  }
                }}
              >
                <input name="advId" placeholder="e.g. 1234567890" className="px-3 py-1.5 border border-amber-300 rounded-lg text-sm bg-white w-48 focus:outline-none focus:ring-2 focus:ring-amber-200" />
                <button type="submit" className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700">
                  Save
                </button>
              </form>
            </div>
          )}

          <div className="p-8">{renderTabContent()}</div>
        </main>
      </div>

    </div>
  );
}
