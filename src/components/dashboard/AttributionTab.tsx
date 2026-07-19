import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import ConnectCta from "@/components/shared/ConnectCta";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, Zap, Link2, MousePointerClick, Eye } from "lucide-react";
import AttributionInfo from "@/components/shared/AttributionInfo";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "dv360" | "both";
  dateRange?: string;
  customStart?: string;
  customEnd?: string;
}

/** Three states: real auto-detection, fetched from Meta. */
type CheckState = { status: "pass"; detail: string } | { status: "fail"; detail: string } | { status: "loading" } | { status: "unknown"; detail: string };

interface FetchableCheck {
  name: string;
  what: string;
  state: CheckState;
  verifyAt: string;
  url: string;
}

interface ManualCheck {
  name: string;
  what: string;
  why: string;  // why it can't be auto-detected
  verifyAt: string;
  url: string;
}

export default function AttributionTab({ platform, dateRange, customStart, customEnd }: Props) {
  const { isMetaConnected, isDV360Connected, demoMode, metaAccessToken, metaBusinessId,
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId } = useAuthStore();
  const { meta } = useAudit(platform || "both", (dateRange || "30d") as DateRange, customStart, customEnd);
  const metaOn = isMetaConnected() || demoMode;
  const dv360On = isDV360Connected() || demoMode;
  const showDV360 = dv360On && (platform === "dv360" || platform === "both");
  const showMeta = metaOn && (platform === "meta" || platform === "both");

  // ─── Fetch the real attribution-readiness signals Meta exposes ────────────
  const [checks, setChecks] = useState<{
    verifiedDomains: Array<{ businessId: string; businessName: string; domains: string[] }>;
    attributionSpec: Array<{ event_type: string; window_days: number }> | null;
    aem: Record<string, Array<{ event_name: string; priority: number }>>;
    loading: boolean;
    error?: string;
  }>({ verifiedDomains: [], attributionSpec: null, aem: {}, loading: true });

  // ─── DV360 attribution fetch ──────────────────────────────────────────────
  const [dv360Attr, setDv360Attr] = useState<{
    loading: boolean;
    cm360Linked?: boolean;
    configType?: "cm360_hybrid" | "third_party" | "unknown";
    floodlightGroupId?: string | null;
    postClickViewAvailable?: boolean;
    activities?: Array<{ id: string; name: string; clickLookbackDays: number; viewLookbackDays: number; servingStatus: string }>;
    conversionSplit?: Array<{ campaign: string; totalConversions: number; postClick: number; postView: number }>;
    totals?: { totalConversions: number; postClick: number; postView: number };
    error?: string;
  }>({ loading: false });

  useEffect(() => {
    const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!showDV360 || (!demoMode && (!dv360RefreshToken || !dv360AdvertiserId))) return;
    let cancelled = false;
    setDv360Attr({ loading: true });
    fetch("/api/audit/dv360-attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: demoMode ? "demo-client" : dv360ClientId,
        clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
        refreshToken: effectiveRefresh,
        advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
        partnerId: dv360PartnerId || undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setDv360Attr({ loading: false, error: data.error });
        else setDv360Attr({ loading: false, ...data });
      })
      .catch(() => { if (!cancelled) setDv360Attr({ loading: false, error: "Network error" }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDV360, demoMode, dv360RefreshToken, dv360AdvertiserId]);

  const pixelIdsKey = (meta?.pixels || []).map((p) => p.pixelId).join(",");
  useEffect(() => {
    if (!metaAccessToken) { setChecks((s) => ({ ...s, loading: false })); return; }
    let cancelled = false;
    setChecks((s) => ({ ...s, loading: true }));
    const pixelIds = pixelIdsKey ? pixelIdsKey.split(",").filter(Boolean) : [];
    fetch("/api/audit/attribution-checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, pixelIds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setChecks({ verifiedDomains: [], attributionSpec: null, aem: {}, loading: false, error: data.error });
        else setChecks({
          verifiedDomains: data.verifiedDomains || [],
          attributionSpec: data.attributionSpec || null,
          aem: data.aem || {},
          loading: false,
        });
      })
      .catch(() => { if (!cancelled) setChecks((s) => ({ ...s, loading: false, error: "Network error" })); });
    return () => { cancelled = true; };
  }, [metaAccessToken, metaBusinessId, pixelIdsKey]);

  // ─── Derive the real Meta checks from fetched data + existing pixel audit ─

  // 1. Domain Verification — fetched real
  const allDomains = checks.verifiedDomains.flatMap((b) => b.domains);
  const domainState: CheckState = checks.loading
    ? { status: "loading" }
    : checks.error
      ? { status: "unknown", detail: `Couldn't read businesses: ${checks.error}` }
      : allDomains.length > 0
        ? { status: "pass", detail: `${allDomains.length} verified: ${allDomains.slice(0, 3).join(", ")}${allDomains.length > 3 ? "…" : ""}` }
        : { status: "fail", detail: "No verified domains found across your Businesses. AEM and iOS 14.5+ attribution require at least one." };

  // 2. CAPI status — from existing pixel audit
  const pixels = meta?.pixels || [];
  const totalServerEvents = pixels.reduce((s, p) => s + (p.capi?.serverShare ?? 0) * (p.totalEvents ?? 0) / 100, 0);
  const totalEvents = pixels.reduce((s, p) => s + (p.totalEvents ?? 0), 0);
  const overallServerShare = totalEvents > 0 ? Math.round((totalServerEvents / totalEvents) * 100) : 0;
  const capiState: CheckState = pixels.length === 0
    ? { status: "unknown", detail: "No pixel data loaded yet — open Pixel Health tab" }
    : totalServerEvents > 0
      ? { status: "pass", detail: `Server-side events firing (${overallServerShare}% of all events)` }
      : { status: "fail", detail: "Zero server-side events detected. CAPI is either not set up or not firing." };

  // 3. Default attribution spec — fetched real
  const attrState: CheckState = checks.loading
    ? { status: "loading" }
    : checks.attributionSpec && checks.attributionSpec.length > 0
      ? {
          status: "pass",
          detail: checks.attributionSpec.map((s) => `${s.window_days}d ${s.event_type.replace(/_/g, " ")}`).join(" + ") + " (account default)",
        }
      : { status: "pass", detail: "Using Meta's platform default: 7-day click + 1-day view (no account override)" };

  // 4. Pixel Automatic Matching — from existing pixel audit config
  const matchingEnabled = pixels.some((p) => p.config?.automaticMatchingEnabled);
  const matchingFields = pixels.flatMap((p) => p.config?.automaticMatchingFields || []);
  const uniqueMatchingFields = Array.from(new Set(matchingFields));
  const matchingState: CheckState = pixels.length === 0
    ? { status: "unknown", detail: "No pixel data loaded yet" }
    : matchingEnabled
      ? { status: "pass", detail: uniqueMatchingFields.length > 0 ? `Enabled — matching on: ${uniqueMatchingFields.join(", ")}` : "Enabled" }
      : { status: "fail", detail: "Automatic Advanced Matching is OFF — turn on for better match quality." };

  // 5. Aggregated Event Measurement (AEM) — fetched per-pixel
  const aemConfigured = Object.values(checks.aem || {}).flat();
  const aemState: CheckState = checks.loading
    ? { status: "loading" }
    : pixels.length === 0
      ? { status: "unknown", detail: "No pixels loaded — open Pixel Health first" }
      : aemConfigured.length > 0
        ? { status: "pass", detail: `${aemConfigured.length} priority event${aemConfigured.length === 1 ? "" : "s"} configured: ${aemConfigured.slice(0, 4).map((e) => e.event_name).join(", ")}${aemConfigured.length > 4 ? "…" : ""}` }
        : { status: "fail", detail: "No AEM priority events configured. iOS 14.5+ users won't be attributed correctly." };

  const metaFetchable: FetchableCheck[] = [
    {
      name: "Aggregated Event Measurement (AEM)",
      what: "Are your iOS 14.5+ priority events configured? (Up to 8 per domain)",
      state: aemState,
      verifyAt: "Events Manager → Pixel → Aggregated Event Measurement",
      url: "https://business.facebook.com/events_manager2/list/pixel",
    },
    {
      name: "Domain Verification",
      what: "Is your domain DNS-verified so AEM events are accepted?",
      state: domainState,
      verifyAt: "Business Settings → Brand Safety → Domains",
      url: "https://business.facebook.com/settings/owned-domains",
    },
    {
      name: "Conversions API (CAPI) status",
      what: "Is CAPI sending server-side events to dedupe with the pixel?",
      state: capiState,
      verifyAt: "Pixel Health tab → CAPI Share %",
      url: "",
    },
    {
      name: "Default Attribution Window",
      what: "What attribution window does the ad account use for conversions?",
      state: attrState,
      verifyAt: "Ads Manager → Account → Attribution Settings",
      url: "https://business.facebook.com/adsmanager/manage/accounts",
    },
    {
      name: "Pixel Advanced Matching",
      what: "Does the pixel hash & send customer-matching parameters (em, ph, fn, ln)?",
      state: matchingState,
      verifyAt: "Events Manager → Pixel → Settings → Automatic Advanced Matching",
      url: "https://business.facebook.com/events_manager2",
    },
  ];

  const metaManual: ManualCheck[] = [
    {
      name: "Consent Mode / GDPR signals",
      what: "Are EU users' consent flags (ad_user_data, ad_personalization) passed correctly?",
      why: "Consent Mode state is client-side at the pixel-fire level — not exposed by API.",
      verifyAt: "Events Manager → Settings → Data Sources → Consent",
      url: "https://business.facebook.com/events_manager2",
    },
    {
      name: "iOS SKAdNetwork (SKAN)",
      what: "Is your app's SKAN schema configured for iOS 14.5+ attribution?",
      why: "App SKAN configuration is in App Settings, not exposed via Graph API.",
      verifyAt: "Events Manager → App Events → SKAdNetwork",
      url: "https://business.facebook.com/events_manager2",
    },
  ];

  if (!metaOn && !dv360On) {
    return (
      <div className="space-y-6 section-enter">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Attribution Readiness</h1>
          <p className="text-gray-600 mt-1">Auto-detected what Meta exposes; manual links for the rest.</p>
        </div>
        <ConnectCta platform="Meta" context="to see attribution checks" />
      </div>
    );
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  const StatePill = ({ state }: { state: CheckState }) => {
    if (state.status === "loading") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600"><Loader2 className="w-3 h-3 animate-spin" /> Checking…</span>;
    if (state.status === "pass") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3" /> Pass</span>;
    if (state.status === "fail") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700"><AlertCircle className="w-3 h-3" /> Action needed</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">—</span>;
  };

  return (
    <div className="space-y-6 section-enter">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Attribution Readiness</h1>
          <p className="text-gray-600 mt-1">
            Top section <strong>auto-detected</strong> from real Meta API. Bottom section <strong>manual verify</strong> — Meta doesn&apos;t expose these via API.
          </p>
        </div>
        <AttributionInfo prefix="Conversion attribution" />
      </div>

      {showMeta && (platform === "both") && (
        <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Meta</h2>
          <span className="text-xs text-gray-400 font-medium">Meta Ads</span>
        </div>
      )}

      {showMeta && (
        <>
          {/* Auto-detected real checks */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Auto-detected</h2>
              <p className="text-xs text-gray-500 mt-1">Real status pulled from Meta&apos;s Graph API.</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {metaFetchable.map((c) => (
                <li key={c.name} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{c.what}</div>
                      {c.state.status !== "loading" && "detail" in c.state && (
                        <div className={`text-xs mt-1 ${c.state.status === "pass" ? "text-green-700" : c.state.status === "fail" ? "text-red-700" : "text-gray-500"}`}>
                          {c.state.detail}
                        </div>
                      )}
                      <div className="text-[11px] text-gray-500 mt-1">
                        Verify at: <span className="font-mono">{c.verifyAt}</span>
                      </div>
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-blue-700 hover:text-blue-900">
                          Open in Meta <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {c.state.status === "fail" && (
                        <AIRecommendationButton
                          metric={c.name}
                          value={"detail" in c.state ? c.state.detail : "failed"}
                          status="critical"
                          platform="meta"
                          auditContext={{ module: "Attribution Readiness", siblingMetrics: { check: c.name } }}
                        />
                      )}
                    </div>
                    <StatePill state={c.state} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Manual verify checks — Meta doesn't expose these */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Manual verification</h2>
              <p className="text-xs text-gray-500 mt-1">Meta deliberately doesn&apos;t expose these via API. Open each link to verify.</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {metaManual.map((c) => (
                <li key={c.name} className="p-4">
                  <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{c.what}</div>
                  <div className="text-[11px] text-gray-400 italic mt-1">{c.why}</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    Verify at: <span className="font-mono">{c.verifyAt}</span>
                  </div>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-blue-700 hover:text-blue-900">
                      Open in Meta <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* ── DV360 Attribution Section ──────────────────────────────────────── */}
      {showDV360 && (platform === "both") && (
        <div className="flex items-center gap-3 pt-4 pb-1 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">DV360</h2>
          <span className="text-xs text-gray-400 font-medium">Display &amp; Video 360</span>
        </div>
      )}

      {showDV360 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900">Attribution (CM360 / Floodlight)</h2>
          </div>

          {dv360Attr.loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading DV360 attribution data…
            </div>
          )}

          {dv360Attr.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{dv360Attr.error}</div>
          )}

          {!dv360Attr.loading && !dv360Attr.error && (
            <div className="space-y-4">
              {/* CM360 link status */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3">
                <Link2 className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">
                    {dv360Attr.configType === "cm360_hybrid"
                      ? "CM360 Integration"
                      : dv360Attr.configType === "third_party"
                        ? "Ad Server: Third-Party"
                        : "Conversion Tracking"}
                  </div>
                  {dv360Attr.cm360Linked ? (
                    // adServerConfig.cmHybridConfig present — genuine CM360 hybrid link.
                    <div className="flex items-center gap-1.5 mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-xs text-green-700">
                        CM360 hybrid linked — Floodlight group {dv360Attr.floodlightGroupId}
                      </span>
                    </div>
                  ) : dv360Attr.configType === "third_party" && (dv360Attr.activities?.length ?? 0) > 0 ? (
                    // thirdPartyOnlyConfig present — explicitly NOT CM360.
                    <div className="space-y-1 mt-1">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-xs text-green-700">
                          Third-party ad server — {dv360Attr.activities!.length} Floodlight activit{dv360Attr.activities!.length === 1 ? "y" : "ies"} discovered via line-item tracking.
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        This advertiser uses a third-party ad server config (not CM360). Post-click vs post-view split requires direct CM360 API access and is not available here.
                      </div>
                    </div>
                  ) : (dv360Attr.activities?.length ?? 0) > 0 ? (
                    // Neither config block readable — activities found only by scanning
                    // line items, which can't distinguish CM360 from a third-party server.
                    <div className="space-y-1 mt-1">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-xs text-green-700">
                          Floodlight active — {dv360Attr.activities!.length} activit{dv360Attr.activities!.length === 1 ? "y" : "ies"} detected via line-item conversion tracking.
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Ad-server config (CM360 vs third-party) is not exposed via the DV360 API for this advertiser, so the source of these activities can&apos;t be confirmed. Post-click vs post-view split requires direct CM360 API access.
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mt-1">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-xs text-amber-700">
                        No Floodlight activities found on any line item. If Floodlight is configured, verify it is assigned to active line items in DV360.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Floodlight activity lookback windows */}
              {(dv360Attr.activities?.length ?? 0) > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-100">
                    <div className="font-semibold text-sm text-gray-900">Floodlight Activities — Attribution Windows</div>
                    <div className="text-xs text-gray-500 mt-0.5">Click and view-through lookback configured per activity.</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                          <th className="text-left px-4 py-2">Activity</th>
                          <th className="text-center px-4 py-2">Click Lookback</th>
                          <th className="text-center px-4 py-2">View Lookback</th>
                          <th className="text-center px-4 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dv360Attr.activities!.map((a) => (
                          <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-medium text-gray-900">{a.name}</td>
                            <td className="px-4 py-2.5 text-center text-gray-700">{a.clickLookbackDays}d</td>
                            <td className="px-4 py-2.5 text-center text-gray-700">{a.viewLookbackDays}d</td>
                            <td className="px-4 py-2.5 text-center">
                              {a.servingStatus === "ENABLED"
                                ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full"><CheckCircle2 className="w-2.5 h-2.5" />Active</span>
                                : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">Inactive</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Post-click vs post-view split (CM360 hybrid) OR total conversions per campaign */}
              {(dv360Attr.totals?.totalConversions ?? 0) > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-100">
                    {dv360Attr.postClickViewAvailable ? (
                      <>
                        <div className="font-semibold text-sm text-gray-900">Post-Click vs Post-View Conversions (30d)</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Total: <strong>{dv360Attr.totals!.totalConversions.toLocaleString("en-IN")}</strong> —
                          {" "}<span className="text-blue-700">{Math.round((dv360Attr.totals!.postClick / dv360Attr.totals!.totalConversions) * 100)}% click-through</span>
                          {" / "}
                          <span className="text-purple-700">{Math.round((dv360Attr.totals!.postView / dv360Attr.totals!.totalConversions) * 100)}% view-through</span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          How this is calculated: each row is one campaign&apos;s Floodlight conversions from a Bid Manager
                          report (metrics <code className="bg-gray-100 px-1 rounded">METRIC_TOTAL_CONVERSIONS</code> / post-click /
                          post-view, grouped by campaign) for the selected window. <strong>Total</strong> is the sum of all rows.
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-sm text-gray-900">Per-Campaign Conversions (30d)</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Total: <strong>{dv360Attr.totals!.totalConversions.toLocaleString("en-IN")}</strong> conversions.
                          Post-click vs post-view breakdown is not available via API for third-party ad server configs.
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          How this is calculated: each row is one campaign&apos;s Floodlight conversions from a Bid Manager
                          report (metric <code className="bg-gray-100 px-1 rounded">METRIC_TOTAL_CONVERSIONS</code>, grouped by
                          campaign) for the selected window. <strong>Total</strong> is the sum of all rows ({dv360Attr.conversionSplit!.length} campaign{dv360Attr.conversionSplit!.length === 1 ? "" : "s"} with conversions).
                        </div>
                      </>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                          <th className="text-left px-4 py-2">Campaign</th>
                          <th className="text-right px-4 py-2">Total Conv.</th>
                          {dv360Attr.postClickViewAvailable && (
                            <>
                              <th className="text-right px-4 py-2 flex items-center justify-end gap-1"><MousePointerClick className="w-3 h-3" />Post-Click</th>
                              <th className="text-right px-4 py-2"><span className="flex items-center justify-end gap-1"><Eye className="w-3 h-3" />Post-View</span></th>
                              <th className="text-right px-4 py-2">VTA %</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dv360Attr.conversionSplit!.map((row) => {
                          const vta = row.totalConversions > 0 ? Math.round((row.postView / row.totalConversions) * 100) : 0;
                          return (
                            <tr key={row.campaign} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[260px] truncate" title={row.campaign}>{row.campaign}</td>
                              <td className="px-4 py-2.5 text-right text-gray-700">{row.totalConversions.toLocaleString("en-IN")}</td>
                              {dv360Attr.postClickViewAvailable && (
                                <>
                                  <td className="px-4 py-2.5 text-right text-blue-700">{row.postClick.toLocaleString("en-IN")}</td>
                                  <td className="px-4 py-2.5 text-right text-purple-700">{row.postView.toLocaleString("en-IN")}</td>
                                  <td className={`px-4 py-2.5 text-right font-semibold ${vta > 50 ? "text-amber-600" : "text-gray-700"}`}>
                                    {vta}%{vta > 50 && " ⚠"}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {dv360Attr.postClickViewAvailable && dv360Attr.conversionSplit!.some((r) => r.totalConversions > 0 && r.postView / r.totalConversions > 0.5) && (
                    <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                      ⚠ One or more campaigns have &gt;50% view-through conversions. Consider tightening the view lookback window in CM360 if brand-lift campaigns are inflating attributed conversions.
                    </div>
                  )}
                </div>
              )}

              {(dv360Attr.activities?.length ?? 0) === 0 && (dv360Attr.totals?.totalConversions ?? 0) === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-1">
                  <div className="font-semibold">No Floodlight activities detected</div>
                  <div className="text-xs">
                    {dv360Attr.cm360Linked
                      ? "CM360 is linked but no Floodlight activities were found. Verify Floodlight configuration in CM360."
                      : "No CM360 hybrid link and no Floodlight activities found on any line item. If this advertiser uses Floodlight, check DV360 → Advertiser Settings → Ad server config, or assign Floodlight activities to line items."}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <TabSummaryFooter
        lines={[
          ...(showMeta ? [
            attrState.status !== "loading" && "detail" in attrState
              ? `Meta attribution window: ${attrState.detail}.`
              : "Meta attribution window: loading…",
            "detail" in capiState
              ? `Meta CAPI: ${capiState.detail}`
              : `Meta CAPI: ${pixels.length} pixel${pixels.length !== 1 ? "s" : ""} detected${overallServerShare > 0 ? ` — ${overallServerShare}% server-side share` : " — no server-side events detected"}.`,
            domainState.status !== "loading" && "detail" in domainState
              ? `Meta domain verification: ${domainState.detail}`
              : "Meta domain verification: loading…",
          ] : []),
          ...(showDV360 ? [
            dv360Attr.loading
              ? "DV360 attribution: loading…"
              : dv360Attr.cm360Linked
                ? `DV360 CM360 hybrid linked — Floodlight group ${dv360Attr.floodlightGroupId}. ${dv360Attr.activities?.length ?? 0} activit${(dv360Attr.activities?.length ?? 0) === 1 ? "y" : "ies"} found.`
                : dv360Attr.configType === "third_party" && (dv360Attr.activities?.length ?? 0) > 0
                  ? `DV360 third-party ad server (not CM360) — ${dv360Attr.activities!.length} Floodlight activit${dv360Attr.activities!.length === 1 ? "y" : "ies"} detected via line-item scan.`
                  : (dv360Attr.activities?.length ?? 0) > 0
                    ? `DV360 — ${dv360Attr.activities!.length} Floodlight activit${dv360Attr.activities!.length === 1 ? "y" : "ies"} detected via line-item scan; ad-server config (CM360 vs third-party) not exposed via API.`
                    : "DV360: no Floodlight activities detected — verify advertiser ad server config.",
            dv360Attr.totals && dv360Attr.totals.totalConversions > 0
              ? dv360Attr.postClickViewAvailable
                ? `DV360 30d conversions: ${dv360Attr.totals.totalConversions.toLocaleString("en-IN")} total — ${Math.round((dv360Attr.totals.postClick / dv360Attr.totals.totalConversions) * 100)}% post-click, ${Math.round((dv360Attr.totals.postView / dv360Attr.totals.totalConversions) * 100)}% post-view.`
                : `DV360 30d conversions: ${dv360Attr.totals.totalConversions.toLocaleString("en-IN")} total. Post-click/view split not available via API.`
              : "DV360 conversions: no data available for this period.",
          ] : []),
        ].filter(Boolean) as string[]}
        tabName="Attribution Readiness"
        context={{
          platform,
          capiServerShare: overallServerShare,
          pixelCount: pixels.length,
          verifiedDomains: checks.verifiedDomains.length,
          aemEvents: Object.values(checks.aem || {}).flat().length,
          dv360Cm360Linked: dv360Attr.cm360Linked,
          dv360Activities: dv360Attr.activities?.length ?? 0,
          dv360TotalConversions: dv360Attr.totals?.totalConversions ?? 0,
          dateRange,
        }}
        platform={(platform ?? "meta") === "both" ? "meta" : (platform ?? "meta") as "meta" | "dv360"}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
