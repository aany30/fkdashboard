/**
 * Campaign → Demographics (doc §9, §10, §11)
 *
 * §9  Age Analysis  — breakdown=age from Meta Insights API
 * §10 Gender        — breakdown=gender
 * §11 Geo           — breakdown=country
 *
 * Reuses the existing /api/reporting/breakdown/meta endpoint (same one used
 * by Reporting → Breakdowns). Each sub-tab fetches its own breakdown.
 */

import { useEffect, useState } from "react";
import { Globe, AlertCircle } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import SortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import { useAuthStore } from "@/store/auth";
import { formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";
import LoadingState from "@/components/shared/LoadingState";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "age",        label: "Age Analysis",  desc: "Spend, revenue, orders, ROAS by age group (§9)" },
  { id: "gender",     label: "Gender",         desc: "Performance split by gender (§10)" },
  { id: "age_gender", label: "Age × Gender",   desc: "Combined age + gender cross-tab" },
  { id: "geo",        label: "Geo",            desc: "Country → region → city → postal code" },
];

interface BreakdownRow {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

function useBreakdown(breakdown: string, platform: string, dateRange: DateRange, customStart?: string, customEnd?: string) {
  const {
    metaAccessToken, metaBusinessId,
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId,
    demoMode,
  } = useAuthStore();
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("INR");

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // ── DV360 branch — Bid Manager breakdown (age/gender/country/device).
    // "country" maps 1:1; Meta's "impression_device" equivalent is "device".
    if (platform === "dv360") {
      const dvBreakdown = breakdown === "impression_device" ? "device" : breakdown;
      const effectiveRefresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
      if (!effectiveRefresh || (!demoMode && (!dv360ClientId || !dv360ClientSecret || !dv360AdvertiserId))) {
        setRows([]);
        return;
      }
      setLoading(true);
      setError(null);
      const fetchDv = (attempt: number) => {
        fetch("/api/reporting/breakdown/dv360", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
            refreshToken: effectiveRefresh,
            advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
            partnerId: dv360PartnerId || undefined,
            breakdown: dvBreakdown,
            startDate,
            endDate,
          }),
        })
          .then(async (r) => {
            if (cancelled) return;
            if (r.status === 202 && attempt < 12) {
              retryTimer = setTimeout(() => fetchDv(attempt + 1), 5_000);
              return;
            }
            const data = await r.json();
            if (data.error) { setError(data.error); setLoading(false); return; }
            setRows(data.rows || []);
            setLoading(false);
          })
          .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
      };
      fetchDv(0);
      return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
    }

    // ── Meta branch (unchanged).
    const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
    const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!effectiveToken || !effectiveBiz) { setRows([]); return; }

    setLoading(true);
    setError(null);

    fetch("/api/reporting/breakdown/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, breakdown, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setRows(data.rows || []);
        if (data.currency) setCurrency(data.currency);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, platform, startDate, endDate, metaAccessToken, metaBusinessId, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, demoMode]);

  return { rows, loading, error, currency };
}

// ─── Shared table ───────────────────────────────────────────────────────────

function DemoTable({
  rows, loading, error, currency, labelHeader, showAov, platform, dateRange,
}: {
  rows: BreakdownRow[];
  loading: boolean;
  error: string | null;
  currency: string;
  labelHeader: string;
  showAov?: boolean;
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
}) {
  const cur = (n: number) => formatMoney(n, currency, 0);
  // Precompute derived metrics so the table can sort by any column.
  const withDerived = rows.map((r) => ({
    ...r,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cpa: r.conversions > 0 ? r.spend / r.conversions : 0,
    aov: r.conversions > 0 ? r.conversionValue / r.conversions : 0,
  }));
  const { sorted, sort, toggle } = useSort(withDerived, "spend", "desc");

  if (loading) return <LoadingState message="Loading demographics…" />;
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
      <AlertCircle className="w-4 h-4 shrink-0" /> {error}
    </div>
  );
  if (!rows.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No breakdown data. Connect a Meta account or widen the date range.
    </div>
  );

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const topByRoas = [...withDerived].filter((r) => r.roas > 0).sort((a, b) => b.roas - a.roas)[0];
  const topBySpend = [...withDerived].sort((a, b) => b.spend - a.spend)[0];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
            <tr>
              <SortTh col="label" sort={sort} onToggle={toggle} className="text-[11px] uppercase">{labelHeader}</SortTh>
              <SortTh col="spend" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Spend</SortTh>
              <SortTh col="conversionValue" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Revenue</SortTh>
              <SortTh col="conversions" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Orders</SortTh>
              <SortTh col="roas" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">ROAS</SortTh>
              <SortTh col="cpa" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">CPA</SortTh>
              {showAov && <SortTh col="aov" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">AOV</SortTh>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.label} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-900 font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{cur(r.conversionValue)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{Math.round(r.conversions).toLocaleString("en-IN")}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{r.roas > 0 ? `${r.roas.toFixed(2)}×` : "—"}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{r.cpa > 0 ? cur(r.cpa) : "—"}</td>
                {showAov && <td className="px-4 py-2.5 text-right text-gray-700">{r.aov > 0 ? cur(r.aov) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TabSummaryFooter
        lines={[
          `${rows.length} ${labelHeader.toLowerCase()} segment${rows.length !== 1 ? "s" : ""} — total spend ${cur(totalSpend)}.`,
          topBySpend ? `Highest spend: "${topBySpend.label}" at ${cur(topBySpend.spend)}${topBySpend.roas > 0 ? ` (${topBySpend.roas.toFixed(2)}× ROAS)` : ""}.` : `No segments with spend found.`,
          topByRoas && topByRoas.label !== topBySpend?.label
            ? `Best ROAS: "${topByRoas.label}" at ${topByRoas.roas.toFixed(2)}× — consider increasing budget here.`
            : `Top spender is also your best performer — budget allocation looks efficient.`,
        ]}
        tabName={`Demographics — ${labelHeader}`}
        context={{
          labelHeader,
          segmentCount: rows.length,
          currency,
          totalSpend: Math.round(totalSpend),
          segments: [...withDerived]
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 25)
            .map((r) => ({
              label: r.label, spend: Math.round(r.spend),
              conversions: Math.round(r.conversions), roas: r.roas > 0 ? +r.roas.toFixed(2) : 0,
              cpa: r.cpa > 0 ? Math.round(r.cpa) : null,
            })),
        }}
        platform={platform === "both" ? "meta" : platform}
        dateRange={String(dateRange)}
      />
    </div>
  );
}

// ─── Sub-tabs ───────────────────────────────────────────────────────────────

function AgeAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("age", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Age Group" showAov platform={platform} dateRange={dateRange} />;
}

function GenderAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("gender", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Gender" platform={platform} dateRange={dateRange} />;
}

// Geo drill levels. Country/Region work on both platforms; City maps to the
// finest cross-tab each platform exposes (Meta: region,city — no standalone city;
// DV360: region,city). Postal code is DV360-only (Meta Insights doesn't expose it).
type GeoLevel = "country" | "region" | "city" | "zip";
const GEO_LEVELS: { id: GeoLevel; label: string; header: string; dv360Only?: boolean; breakdown: (p: string) => string }[] = [
  { id: "country", label: "Country",     header: "Country",       breakdown: () => "country" },
  { id: "region",  label: "Region/State", header: "Region",       breakdown: () => "region" },
  { id: "city",    label: "City",         header: "City · Region", breakdown: () => "region,city" },
  { id: "zip",     label: "Postal Code",  header: "Postal Code",   dv360Only: true, breakdown: () => "zip" },
];

function GeoAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const [level, setLevel] = useState<GeoLevel>("country");
  const levels = GEO_LEVELS.filter((l) => !l.dv360Only || platform === "dv360");
  const active = levels.find((l) => l.id === level) ?? levels[0];
  const { rows, loading, error, currency } = useBreakdown(active.breakdown(platform), platform, dateRange, customStart, customEnd);
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
        {levels.map((l) => (
          <button key={l.id} onClick={() => setLevel(l.id)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition ${level === l.id ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
            {l.label}
          </button>
        ))}
      </div>
      <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader={active.header} showAov platform={platform} dateRange={dateRange} />
    </div>
  );
}

function AgeGenderAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("age,gender", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Age · Gender" showAov platform={platform} dateRange={dateRange} />;
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function DemographicsTab(props: Props) {
  const [active, setActive] = useState("age");

  // Load the active breakdown here too so the top-level AI summary has real
  // segment rows (the breakdown hook is cached, so this shares the child's fetch).
  const breakdownKey =
    active === "gender"     ? "gender"
    : active === "age_gender" ? "age,gender"
    : active === "geo"       ? "country"
    : "age";
  const { rows: activeRows, currency: activeCurrency } = useBreakdown(
    breakdownKey, props.platform, props.dateRange, props.customStart, props.customEnd
  );
  const activeTotalSpend = activeRows.reduce((s, r) => s + r.spend, 0);
  const summaryContext = {
    activeBreakdown: active,
    platform: props.platform,
    currency: activeCurrency,
    segmentCount: activeRows.length,
    totalSpend: Math.round(activeTotalSpend),
    segments: [...activeRows]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 25)
      .map((r) => ({
        label: r.label,
        spend: Math.round(r.spend),
        conversions: Math.round(r.conversions),
        roas: r.spend > 0 ? +(r.conversionValue / r.spend).toFixed(2) : 0,
        cpa: r.conversions > 0 ? Math.round(r.spend / r.conversions) : null,
      })),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Demographics</h1>
            <p className="text-gray-600 mt-1">Age, Gender, and Geo performance breakdowns.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Demographics"
          context={summaryContext}
          platform={props.platform === "both" ? "meta" : props.platform}
          dateRange={String(props.dateRange)}
          inline
        />
      </div>


      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
          </button>
        ))}
      </div>

      {active === "age"        && <AgeAnalysis       {...props} />}
      {active === "gender"     && <GenderAnalysis    {...props} />}
      {active === "age_gender" && <AgeGenderAnalysis {...props} />}
      {active === "geo"        && <GeoAnalysis       {...props} />}

    </div>
  );
}
