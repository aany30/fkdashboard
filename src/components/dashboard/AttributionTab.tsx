import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import ConnectCta from "@/components/shared/ConnectCta";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import AttributionInfo from "@/components/shared/AttributionInfo";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform?: "meta" | "google" | "both";
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
  const { isMetaConnected, isGoogleConnected, metaAccessToken, metaBusinessId } = useAuthStore();
  const { meta } = useAudit(platform || "both", (dateRange || "30d") as DateRange, customStart, customEnd);
  const metaOn = isMetaConnected();
  const googleOn = isGoogleConnected();

  // ─── Fetch the real attribution-readiness signals Meta exposes ────────────
  const [checks, setChecks] = useState<{
    verifiedDomains: Array<{ businessId: string; businessName: string; domains: string[] }>;
    attributionSpec: Array<{ event_type: string; window_days: number }> | null;
    aem: Record<string, Array<{ event_name: string; priority: number }>>;
    loading: boolean;
    error?: string;
  }>({ verifiedDomains: [], attributionSpec: null, aem: {}, loading: true });

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

  const googleManual: ManualCheck[] = [
    {
      name: "Enhanced Conversions",
      what: "Is hashed email/phone being sent with conversion uploads?",
      why: "Google Ads API doesn't expose Enhanced Conversions config state for read.",
      verifyAt: "Google Ads → Tools → Conversions → [your action] → Enhanced conversions",
      url: "https://ads.google.com/aw/conversions",
    },
    {
      name: "Consent Mode v2",
      what: "Are ad_user_data + ad_personalization consent flags passed?",
      why: "Consent state lives in client-side tags, not in Ads/GA4 API.",
      verifyAt: "Tag Manager → Consent Configuration",
      url: "https://tagmanager.google.com",
    },
    {
      name: "Attribution Model",
      what: "Is the conversion action set to Data-Driven attribution?",
      why: "Visible in UI but not consistently exposed across Ads API versions.",
      verifyAt: "Google Ads → Tools → Conversions → [action] → Attribution model",
      url: "https://ads.google.com/aw/conversions",
    },
    {
      name: "Cross-Domain Tracking",
      what: "Is the GA4 linker configured across your subdomains / cart provider?",
      why: "Linker config is in client-side gtag/GTM tags, not in GA4 Admin API.",
      verifyAt: "GA4 → Admin → Data Streams → Configure tag settings",
      url: "https://analytics.google.com",
    },
    {
      name: "Referral Exclusions",
      what: "Are payment-gateway domains excluded from referral attribution?",
      why: "Referral-exclusion list isn't exposed by GA4 Admin API.",
      verifyAt: "GA4 → Admin → Data Streams → Configure tag settings → List unwanted referrals",
      url: "https://analytics.google.com",
    },
  ];

  if (!metaOn && !googleOn) {
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
            Top section <strong>auto-detected</strong> from real Meta API. Bottom section <strong>manual verify</strong> — Meta &amp; Google don&apos;t expose these via API.
          </p>
        </div>
        <AttributionInfo prefix="Conversion attribution" />
      </div>

      {metaOn && (
        <>
          {/* Auto-detected real checks */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Meta — Auto-detected</h2>
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
              <h2 className="text-lg font-bold text-gray-900">Meta — Manual verification</h2>
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

      {googleOn && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Google — Manual verification</h2>
            <p className="text-xs text-gray-500 mt-1">Google Ads &amp; GA4 APIs don&apos;t expose these config flags. Open each link to verify.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {googleManual.map((c) => (
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
                    Open in Google <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TabSummaryFooter
        lines={[
          attrState.status !== "loading" && "detail" in attrState
            ? `Attribution window: ${attrState.detail}.`
            : "Attribution window: loading…",
          "detail" in capiState
            ? `CAPI status: ${capiState.detail}`
            : `CAPI: ${pixels.length} pixel${pixels.length !== 1 ? "s" : ""} detected${overallServerShare > 0 ? ` — ${overallServerShare}% server-side share` : " — no server-side events detected"}.`,
          domainState.status !== "loading" && "detail" in domainState
            ? `Domain verification: ${domainState.detail}`
            : "Domain verification status loading…",
        ]}
        tabName="Attribution Readiness"
        context={{
          platform,
          capiServerShare: overallServerShare,
          pixelCount: pixels.length,
          verifiedDomains: checks.verifiedDomains.length,
          aemEvents: Object.values(checks.aem || {}).flat().length,
          dateRange,
        }}
        platform={(platform ?? "meta") === "both" ? "meta" : (platform ?? "meta") as "meta" | "google"}
        dateRange={String(dateRange ?? "30d")}
      />
    </div>
  );
}
