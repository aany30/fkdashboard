/**
 * Reporting → Generate Report
 * Two formats:
 *   • Excel — 8-sheet workbook
 *   • PDF   — real vector PDF rendered server-side (Puppeteer) from the
 *             agency-style HTML design. Crisp, selectable text — not screenshots.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileSpreadsheet, FileText, Download,
  CheckCircle2, Loader2, TrendingUp, BarChart2,
  Users, Map as MapIcon, GitBranch, Bot,
  Eye, Target, MousePointer, Sparkles, X as XIcon,
} from "lucide-react";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { useDV360Breakdown } from "@/hooks/useDV360Breakdown";
import { useDV360Creatives } from "@/hooks/useDV360Creatives";
import { useAudit } from "@/hooks/useAudit";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import { currencyFor, formatMoney } from "@/lib/currency";
import { toDisplayCredits } from "@/lib/ai-cost";
import { toCSV, downloadCSV } from "@/lib/csv-export";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";
import type { PdfReportPagesProps, ReportObjective, ReportLength, ReportNarrative, TrackingSnapshot } from "./PdfReportPages";
import type { DateRange } from "@/components/shared/DateRangePicker";

// Objective presets for the customize modal.
const OBJECTIVES: { id: ReportObjective; label: string; desc: string; icon: typeof Eye }[] = [
  { id: "awareness", label: "Awareness / Branding", desc: "Impressions, reach, frequency, CPM, CTR, views", icon: Eye },
  { id: "sales",     label: "Sales / Conversions",  desc: "ROAS, conversions, revenue, CPA, AOV, CVR",   icon: Target },
  { id: "traffic",   label: "Traffic / Engagement", desc: "Clicks, CTR, CPC, landing views",              icon: MousePointer },
  { id: "lead",      label: "Lead Generation",      desc: "Leads, cost-per-lead, conversion rate",        icon: Users },
];
const LENGTHS: { id: ReportLength; label: string; pages: string }[] = [
  { id: "concise",  label: "Concise",  pages: "~3–4 pages" },
  { id: "standard", label: "Standard", pages: "~6–7 pages" },
  { id: "detailed", label: "Detailed", pages: "~10+ pages" },
];
// The report is organized by the 3 sidebar areas. Picking an area pulls ALL of
// that area's tabs into the PDF and focuses the AI analysis on it. Default = all.
const AREAS: { id: string; label: string; tabs: string; sections: string[] }[] = [
  { id: "reporting", label: "Reporting", tabs: "Overview, Key Metrics, Audience Analysis, Creative, Placement, Budget trend + AI analysis", sections: ["ai", "campaigns", "audience", "creative", "placement", "budget"] },
  { id: "audit",     label: "Audit",     tabs: "Pixel Health, Event Quality (EMQ), Funnel, Attribution & Floodlight", sections: ["funnel", "tracking"] },
  { id: "tracking",  label: "Tracking",  tabs: "Account Structure, CAPI, Saturation / Frequency, Conversion Monitoring", sections: ["tracking"] },
];
const ALL_AREA_IDS = AREAS.map(a => a.id);
const areasToSections = (areaIds: Set<string>): string[] =>
  [...new Set(AREAS.filter(a => areaIds.has(a.id)).flatMap(a => a.sections))];
// Documented raw-USD token estimates per length (input+output for Haiku); shown
// as credits via toDisplayCredits (raw × 60) — same math as the rest of the app.
const RAW_EST: Record<ReportLength, number> = { concise: 0.006, standard: 0.011, detailed: 0.02 };

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

type Format = "excel" | "pdf";

const pct = (a: number, b: number) => b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "—";
const fmtBig = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : Math.round(n).toLocaleString("en-IN");

// ── Merge Meta + DV360 breakdown rows into one series (for "both" reports) ────
type Row = { label: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number };
const _countryNamer = (() => { try { const dn = new Intl.DisplayNames(["en"], { type: "region" }); return (v: string) => /^[A-Za-z]{2}$/.test(v) ? (dn.of(v.toUpperCase()) || v) : v; } catch { return (v: string) => v; } })();
function mergeRows<T extends Row>(a: T[], b: T[], normalizeLabel?: (l: string) => string): T[] {
  const norm = normalizeLabel ?? ((l: string) => l);
  const m = new Map<string, T>();
  for (const r of [...a, ...b]) {
    const key = norm(r.label);
    const cur = m.get(key);
    if (cur) {
      cur.spend += r.spend || 0; cur.impressions += r.impressions || 0; cur.clicks += r.clicks || 0;
      cur.conversions += r.conversions || 0; cur.conversionValue += r.conversionValue || 0;
    } else {
      m.set(key, { ...r, label: key });
    }
  }
  return [...m.values()].sort((x, y) => (y.spend || 0) - (x.spend || 0));
}

// ─── Excel (.xlsx) ─────────────────────────────────────────────────────────────

async function generateExcel(opts: {
  startDate: string; endDate: string; currency: string; platform: string;
  campaigns: any[]; pubRows: any[]; ageRows: any[]; genderRows: any[];
  countryRows: any[]; deviceRows: any[];
}) {
  const XLSX = (await import("xlsx")).default;
  const cur = (n: number) => formatMoney(n, opts.currency, 2);
  const cur0 = (n: number) => formatMoney(n, opts.currency, 0);
  const sorted = [...opts.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const metaCampaigns = sorted.filter(c => c.platform === "meta");

  const totalSpend  = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr   = sorted.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = sorted.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalConv   = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalRev    = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Summary
  const summaryData = [
    ["Ad Performance Report", ""],
    [`Period: ${opts.startDate} → ${opts.endDate}`, ""],
    [`Platform: ${opts.platform}`, ""],
    [`Generated: ${new Date().toLocaleDateString("en-IN")}`, ""],
    ["", ""],
    ["KPI", "Value"],
    ["Total Spend", cur(totalSpend)],
    ["Impressions", fmtBig(totalImpr)],
    ["Clicks", totalClicks.toLocaleString()],
    ["CTR", pct(totalClicks, totalImpr)],
    ["Conversions", Math.round(totalConv).toLocaleString()],
    ["Conversion Value", cur(totalRev)],
    ["ROAS", totalSpend > 0 && totalRev > 0 ? `${(totalRev / totalSpend).toFixed(2)}×` : "—"],
    ["CPA", totalConv > 0 ? cur0(totalSpend / totalConv) : "—"],
    ["CPM", totalImpr > 0 ? cur(totalSpend / totalImpr * 1000) : "—"],
    ["CPC", totalClicks > 0 ? cur(totalSpend / totalClicks) : "—"],
    ["Campaigns", sorted.length.toString()],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
  wsSum["!cols"] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Executive Summary");

  // Sheet 2: Campaign Performance
  const campHeaders = ["Campaign", "Platform", "Status", "Objective", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS", "CPM", "CPC", "CPA", "Attribution Window"];
  const campRows = sorted.map(c => {
    const sp = c.spend || 0, im = c.impressions || 0, cl = c.clicks || 0, cv = c.conversions || 0, rev = c.conversionValue || 0;
    return [
      c.name, c.platform === "meta" ? "Meta" : "DV360", c.status || "—", (c.objective || "—").replace(/OUTCOME_/, ""),
      +sp.toFixed(2), im, cl, pct(cl, im), Math.round(cv), +rev.toFixed(2),
      sp > 0 && rev > 0 ? +(rev / sp).toFixed(2) : "—",
      im > 0 ? +(sp / im * 1000).toFixed(2) : "—",
      cl > 0 ? +(sp / cl).toFixed(2) : "—",
      cv > 0 ? +(sp / cv).toFixed(2) : "—",
      (c as any).effectiveAttribution || "—",
    ];
  });
  const wsCamp = XLSX.utils.aoa_to_sheet([campHeaders, ...campRows]);
  wsCamp["!cols"] = [{ wch: 44 }, ...campHeaders.slice(1).map(() => ({ wch: 15 }))];
  XLSX.utils.book_append_sheet(wb, wsCamp, "Campaign Performance");

  // Sheet 3: Placement
  if (opts.pubRows.length > 0) {
    const h = ["Publisher", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS", "CPA", "CPM"];
    const rows = opts.pubRows.map(r => [
      r.label.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      +r.spend.toFixed(2), r.impressions, r.clicks, pct(r.clicks, r.impressions),
      Math.round(r.conversions), +r.conversionValue.toFixed(2),
      r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
      r.conversions > 0 ? +(r.spend / r.conversions).toFixed(2) : "—",
      r.impressions > 0 ? +(r.spend / r.impressions * 1000).toFixed(2) : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 30 }, ...h.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Placement Breakdown");
  }

  // Sheet 4: Age
  if (opts.ageRows.length > 0) {
    const h = ["Age Group", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"];
    const tot = opts.ageRows.reduce((s: number, r: any) => s + r.spend, 0);
    const rows = [...opts.ageRows].sort((a: any, b: any) => b.spend - a.spend).map((r: any) => [
      r.label, +r.spend.toFixed(2),
      tot > 0 ? `${((r.spend / tot) * 100).toFixed(1)}%` : "—",
      r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions),
      r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
      r.conversions > 0 ? +(r.spend / r.conversions).toFixed(2) : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 16 }, ...h.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Age Demographics");
  }

  // Sheet 5: Gender
  if (opts.genderRows.length > 0) {
    const h = ["Gender", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"];
    const tot = opts.genderRows.reduce((s: number, r: any) => s + r.spend, 0);
    const rows = [...opts.genderRows as any[]].sort((a, b) => b.spend - a.spend).map((r: any) => [
      r.label.charAt(0).toUpperCase() + r.label.slice(1), +r.spend.toFixed(2),
      tot > 0 ? `${((r.spend / tot) * 100).toFixed(1)}%` : "—",
      r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions),
      r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
      r.conversions > 0 ? +(r.spend / r.conversions).toFixed(2) : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 14 }, ...h.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Gender Demographics");
  }

  // Sheet 6: Country
  if (opts.countryRows.length > 0) {
    const h = ["Country/Region", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"];
    const tot = opts.countryRows.reduce((s: number, r: any) => s + r.spend, 0);
    const rows = [...opts.countryRows].sort((a: any, b: any) => b.spend - a.spend).map((r: any) => [
      r.label, +r.spend.toFixed(2),
      tot > 0 ? `${((r.spend / tot) * 100).toFixed(1)}%` : "—",
      r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions),
      r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
      r.conversions > 0 ? +(r.spend / r.conversions).toFixed(2) : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 24 }, ...h.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Country Breakdown");
  }

  // Sheet 7: Device
  if (opts.deviceRows.length > 0) {
    const h = ["Device", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"];
    const tot = opts.deviceRows.reduce((s: number, r: any) => s + r.spend, 0);
    const rows = [...opts.deviceRows].sort((a: any, b: any) => b.spend - a.spend).map((r: any) => [
      r.label, +r.spend.toFixed(2),
      tot > 0 ? `${((r.spend / tot) * 100).toFixed(1)}%` : "—",
      r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions),
      r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
      r.conversions > 0 ? +(r.spend / r.conversions).toFixed(2) : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 20 }, ...h.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Device Breakdown");
  }

  // Sheet 8: Attribution Windows
  const attrCampaigns = metaCampaigns.filter(c =>
    (c as any).conv1dClick !== undefined || (c as any).conv7dClick !== undefined
  );
  if (attrCampaigns.length > 0) {
    const h = ["Campaign", "Reported Conv.", "1d Click", "7d Click", "1d View", "7d/1d Ratio", "Attribution Window", "ROAS"];
    const rows = attrCampaigns.map(c => {
      const c1 = (c as any).conv1dClick ?? 0;
      const c7 = (c as any).conv7dClick ?? 0;
      const cv = (c as any).conv1dView ?? 0;
      const roas = (c.spend || 0) > 0 && (c.conversionValue || 0) > 0 ? +((c.conversionValue || 0) / (c.spend || 1)).toFixed(2) : "—";
      return [c.name, Math.round(c.conversions || 0), c1, c7, cv, c1 > 0 ? +(c7 / c1).toFixed(2) : "—", (c as any).effectiveAttribution || "Account default", roas];
    });
    const t1 = attrCampaigns.reduce((s, c) => s + ((c as any).conv1dClick ?? 0), 0);
    const t7 = attrCampaigns.reduce((s, c) => s + ((c as any).conv7dClick ?? 0), 0);
    const tv = attrCampaigns.reduce((s, c) => s + ((c as any).conv1dView ?? 0), 0);
    const tr = attrCampaigns.reduce((s, c) => s + (c.conversions || 0), 0);
    rows.push(["TOTAL", Math.round(tr), t1, t7, tv, t1 > 0 ? +(t7 / t1).toFixed(2) : "—", "", ""]);
    const ws = XLSX.utils.aoa_to_sheet([h, ...rows]);
    ws["!cols"] = [{ wch: 44 }, ...h.slice(1).map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, ws, "Attribution Windows");
  }

  XLSX.writeFile(wb, `auditor-report-${opts.startDate}-${opts.endDate}.xlsx`);
}

// ─── PDF — client-side render via html2canvas → jsPDF (direct file download) ─
// Renders <PdfReportPages> into an off-screen 1280×720 container, snapshots each
// page to a canvas, and assembles a multi-page landscape PDF. Saves directly to
// disk — no print dialog, no Puppeteer, deploys anywhere.

async function generatePdf(opts: PdfReportPagesProps) {
  const [{ createRoot }, React, { default: PdfReportPages }, { default: jsPDF }, html2canvasMod] = await Promise.all([
    import("react-dom/client"),
    import("react"),
    import("./PdfReportPages"),
    import("jspdf"),
    import("html2canvas"),
  ]);
  const html2canvas = (html2canvasMod as { default: typeof import("html2canvas").default }).default;

  // Off-screen host — positioned far off-viewport so it renders without affecting layout
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:1280px;background:#EEF1F6;";
  document.body.appendChild(host);

  try {
    const root = createRoot(host);
    root.render(React.createElement(PdfReportPages, opts));
    // Wait for React + Recharts to mount and lay out
    await new Promise<void>((r) => setTimeout(r, 800));

    const pageEls = Array.from(host.children[0]?.children ?? []) as HTMLElement[];
    if (pageEls.length === 0) throw new Error("Could not find any report pages to render.");

    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720], hotfixes: ["px_scaling"] });

    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i];
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#EEF1F6", logging: false, width: 1280, height: 720 });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      if (i > 0) pdf.addPage([1280, 720], "landscape");
      pdf.addImage(dataUrl, "JPEG", 0, 0, 1280, 720, undefined, "FAST");
    }

    pdf.save(`auditor-report-${opts.startDate}-${opts.endDate}.pdf`);
    root.unmount();
  } finally {
    document.body.removeChild(host);
  }
}

// ─── Format cards ─────────────────────────────────────────────────────────────

const FORMATS = [
  {
    id: "excel" as Format,
    icon: FileSpreadsheet,
    title: "Excel",
    ext: ".xlsx",
    description: "8-sheet workbook: Executive Summary, Campaign Performance, Placement, Age, Gender, Country, Device, and Attribution Windows. Pivot-ready.",
    tags: ["8 sheets", "All reporting data", "Pivot-ready"],
  },
  {
    id: "pdf" as Format,
    icon: FileText,
    title: "PDF",
    ext: ".pdf",
    description: "Landscape agency deck (16:9): dark cover with KPI cards, then light slide pages — budget trend, campaign performance, funnel, audience, creative, weekly platform metrics, and executive summary. Real Meta data only.",
    tags: ["Landscape slides", "Charts & callouts", "Client-ready"],
  },
];

const INCLUDED = [
  { icon: TrendingUp, label: "KPIs",             desc: "Spend, ROAS, CPA, CPM, CTR, Conversions, Revenue" },
  { icon: BarChart2,  label: "Campaigns",         desc: "Full campaign table sorted by spend, with objectives and attribution windows" },
  { icon: Users,      label: "Audience",          desc: "Age, gender, country, and device breakdowns" },
  { icon: MapIcon,    label: "Placement",         desc: "Publisher platform spend and performance (Meta)" },
  { icon: GitBranch,  label: "Attribution",       desc: "Window-in-use per campaign + 1d/7d/view comparison" },
  { icon: Bot,        label: "Executive Summary", desc: "Top wins, key challenges, and 4 recommended actions (PDF)" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function GenerateReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const enabled = platform !== "dv360";
  const pubBreak     = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, enabled);
  const ageBreak     = useMetaBreakdown("age",                dateRange, customStart, customEnd, enabled);
  const genBreak     = useMetaBreakdown("gender",             dateRange, customStart, customEnd, enabled);
  const countryBreak = useMetaBreakdown("country",            dateRange, customStart, customEnd, enabled);
  const deviceBreak  = useMetaBreakdown("impression_device",  dateRange, customStart, customEnd, enabled);
  const dailyBreak   = useMetaBreakdown("daily",              dateRange, customStart, customEnd, enabled);
  const regionBreak  = useMetaBreakdown("region",             dateRange, customStart, customEnd, enabled);

  // ── DV360 breakdowns + creatives (merged into the deck so the report covers
  // both platforms, matching what the tabs show). Async BM reports — included
  // as they arrive; geo/device/daily/creative are real, age/gender usually N/A. ──
  const dvEnabled = platform === "dv360" || platform === "both";
  const dvCountry  = useDV360Breakdown("country",     dateRange, customStart, customEnd, dvEnabled);
  const dvDevice   = useDV360Breakdown("device",      dateRange, customStart, customEnd, dvEnabled);
  const dvDaily    = useDV360Breakdown("daily",       dateRange, customStart, customEnd, dvEnabled);
  const dvRegion   = useDV360Breakdown("region",      dateRange, customStart, customEnd, dvEnabled);
  const dvCity     = useDV360Breakdown("region,city", dateRange, customStart, customEnd, dvEnabled);
  const dvAge      = useDV360Breakdown("age",         dateRange, customStart, customEnd, dvEnabled);
  const dvGender   = useDV360Breakdown("gender",      dateRange, customStart, customEnd, dvEnabled);
  const { creatives: dvCreatives } = useDV360Creatives(dateRange, customStart, customEnd, dvEnabled);

  // Meta tracking snapshot (pixel health / CAPI) for the Tracking & Data Quality page.
  const { meta: auditMeta } = useAudit(platform, dateRange, customStart, customEnd);

  // Ad-level creative insights (mirrors CreativeReport's fetch)
  const {
    metaAccessToken, metaBusinessId, demoMode, addAiCredits,
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, dv360PartnerId,
  } = useAuthStore();

  // DV360 Floodlight lookback windows (Audit → Attribution equivalent for DV360).
  const [floodlight, setFloodlight] = useState<Array<{ name: string; clickLookbackDays: number; viewLookbackDays: number }>>([]);
  useEffect(() => {
    const dv = platform === "dv360" || platform === "both";
    const refresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;
    if (!dv || !refresh) { setFloodlight([]); return; }
    let cancelled = false;
    fetch("/api/audit/dv360-attribution", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: demoMode ? "demo-client" : dv360ClientId,
        clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
        refreshToken: refresh,
        advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId,
        partnerId: dv360PartnerId || undefined,
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.activities)) setFloodlight(d.activities.map((a: { name: string; clickLookbackDays: number; viewLookbackDays: number }) => ({ name: a.name, clickLookbackDays: a.clickLookbackDays, viewLookbackDays: a.viewLookbackDays }))); })
      .catch(() => { if (!cancelled) setFloodlight([]); });
    return () => { cancelled = true; };
  }, [platform, demoMode, dv360RefreshToken, dv360ClientId, dv360ClientSecret, dv360AdvertiserId, dv360PartnerId]);
  const [adRows, setAdRows] = useState<AdInsightRow[]>([]);
  useEffect(() => {
    if (platform === "dv360") { setAdRows([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setAdRows([]); return; }
    const { startDate: s, endDate: e } = rangeToDates(dateRange, customStart, customEnd);
    let cancelled = false;
    fetch("/api/reporting/ad-insights/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, startDate: s, endDate: e, limit: 50 }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ads) setAdRows(d.ads); })
      .catch(() => { if (!cancelled) setAdRows([]); });
    return () => { cancelled = true; };
  }, [platform, dateRange, customStart, customEnd, metaAccessToken, metaBusinessId, demoMode]);

  const currency = currencyFor(campaigns, platform === "dv360" ? "dv360" : "meta");
  const cur0 = (n: number) => formatMoney(n, currency, 0);

  const [selected, setSelected] = useState<Format>("excel");
  const [genExcel, setGenExcel] = useState(false);
  const [genPDF, setGenPDF]     = useState(false);
  const [flash, setFlash]       = useState<string | null>(null);
  const [flashErr, setFlashErr] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const spend  = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const impr   = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
    const clicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
    const conv   = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
    const rev    = campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
    return {
      spend, impr, clicks, conv, rev,
      roas: spend > 0 && rev > 0 ? (rev / spend).toFixed(2) : "—",
      cpa:  conv  > 0 ? cur0(spend / conv) : "—",
      ctr:  impr  > 0 ? ((clicks / impr) * 100).toFixed(2) + "%" : "—",
    };
  }, [campaigns]);

  // DV360 creatives mapped into the shared ad-row shape (type → creativeType).
  const dvAdRows: AdInsightRow[] = useMemo(
    () => (dvCreatives || []).map((c) => ({
      id: c.id, name: c.name, creativeType: c.type || "",
      spend: c.spend || 0, impressions: c.impressions || 0, clicks: c.clicks || 0,
      conversions: 0, conversionValue: 0,
    })),
    [dvCreatives],
  );

  // Merged rows (Meta + DV360). Country is normalized (Meta ISO "IN" → "India")
  // so it aligns with DV360's country names instead of double-counting.
  const mergedRows = useMemo(() => ({
    country: mergeRows(countryBreak.rows, dvCountry.rows, _countryNamer),
    device:  mergeRows(deviceBreak.rows, dvDevice.rows),
    daily:   mergeRows(dailyBreak.rows, dvDaily.rows),
    region:  mergeRows(regionBreak.rows, [...dvRegion.rows, ...dvCity.rows]),
    age:     mergeRows(ageBreak.rows, dvAge.rows),
    gender:  mergeRows(genBreak.rows, dvGender.rows),
    ads:     [...adRows, ...dvAdRows],
  }), [countryBreak.rows, dvCountry.rows, deviceBreak.rows, dvDevice.rows, dailyBreak.rows, dvDaily.rows, regionBreak.rows, dvRegion.rows, dvCity.rows, ageBreak.rows, dvAge.rows, genBreak.rows, dvGender.rows, adRows, dvAdRows]);

  const commonOpts = () => ({
    startDate, endDate, currency, platform,
    campaigns,
    pubRows:     pubBreak.rows,
    ageRows:     mergedRows.age,
    genderRows:  mergedRows.gender,
    countryRows: mergedRows.country,
    deviceRows:  mergedRows.device,
    dailyRows:   mergedRows.daily,
    regionRows:  mergedRows.region,
    adRows:      mergedRows.ads,
  });

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 6000); };
  const showErr   = (msg: string) => { setFlashErr(msg); setTimeout(() => setFlashErr(null), 8000); };

  const handleExcelDownload = async () => {
    if (loading || campaigns.length === 0) return;
    setGenExcel(true);
    setFlash(null); setFlashErr(null);
    try {
      await generateExcel(commonOpts());
      showFlash("Excel workbook downloaded — 8 sheets covering all reporting data");
    } catch (err) {
      try {
        const sorted = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
        const headers = ["Campaign","Platform","Status","Spend","Impressions","Clicks","CTR (%)","Conv.","Conv. Value","ROAS","CPA","Currency"];
        const rows = sorted.map(c => {
          const sp=c.spend||0, im=c.impressions||0, cl=c.clicks||0, cv=c.conversions||0, rev=c.conversionValue||0;
          return [c.name, c.platform==="meta"?"Meta":"DV360", c.status||"—",
            sp.toFixed(2), im, cl, im>0?((cl/im)*100).toFixed(2):"", Math.round(cv), rev.toFixed(2),
            sp>0&&rev>0?(rev/sp).toFixed(2):"", cv>0?(sp/cv).toFixed(2):"", c.currency||currency];
        });
        downloadCSV(`auditor-campaigns-${startDate}-${endDate}.csv`, toCSV(headers, rows));
        showFlash("Downloaded as CSV (xlsx not available in this browser)");
      } catch {
        showErr(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setGenExcel(false);
    }
  };

  // ── Customize-PDF modal state ──────────────────────────────────────────────
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [objective, setObjective] = useState<ReportObjective>("sales");
  const [reportLength, setReportLength] = useState<ReportLength>("standard");
  const [customPrompt, setCustomPrompt] = useState("");
  const [brandName, setBrandName] = useState("");
  const [areas, setAreas] = useState<Set<string>>(new Set(ALL_AREA_IDS));
  const toggleArea = (id: string) => setAreas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); if (n.size === 0) n.add(id); return n; });
  const estCredits = toDisplayCredits(RAW_EST[reportLength]).toFixed(2);

  // Build the tracking snapshot (Meta pixel/CAPI + funnel from real totals).
  const buildTracking = (): TrackingSnapshot => {
    const pixels = auditMeta?.pixels ?? [];
    const totalEvents = pixels.reduce((s, p) => s + (p.totalEvents || 0), 0);
    const totalServer = pixels.reduce((s, p) => s + Math.round(((p.capi?.serverShare || 0) / 100) * (p.totalEvents || 0)), 0);
    const emqScores = pixels.map(p => p.emq?.overallScore).filter((n): n is number => typeof n === "number" && n > 0);
    const totalReach = campaigns.reduce((s, c) => s + (c.reach || 0), 0);
    const adSets = campaigns.reduce((s, c) => s + (c.adSets?.length || 0), 0);
    return {
      activePixels: pixels.length ? `${pixels.filter(p => p.status === "active").length}/${pixels.length}` : undefined,
      capiSharePct: totalEvents > 0 ? Math.round((totalServer / totalEvents) * 100) : undefined,
      emqScore: emqScores.length ? Math.round(emqScores.reduce((s, n) => s + n, 0) / emqScores.length) : undefined,
      totalEvents: totalEvents || undefined,
      avgFrequency: totalReach > 0 ? +(kpis.impr / totalReach).toFixed(2) : undefined,
      accountStructure: { campaigns: campaigns.length, adSets },
      attribution: floodlight.length ? floodlight : undefined,
      funnel: [
        { stage: "Impressions", value: kpis.impr },
        { stage: "Clicks", value: kpis.clicks },
        { stage: "Conversions", value: kpis.conv },
      ].filter(f => f.value > 0),
    };
  };

  // Assemble the AI-narrative request payload from real data.
  const buildNarrativeRequest = () => {
    const totals = {
      spend: kpis.spend, impressions: kpis.impr, clicks: kpis.clicks,
      reach: campaigns.reduce((s, c) => s + (c.reach || 0), 0),
      videoViews: campaigns.reduce((s, c) => s + (c.videoViews || 0), 0),
      conversions: kpis.conv, conversionValue: kpis.rev,
    };
    const camps = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 40).map(c => {
      const sp = c.spend || 0, im = c.impressions || 0, cl = c.clicks || 0, cv = c.conversions || 0, rev = c.conversionValue || 0, rc = c.reach || 0, vv = c.videoViews || 0;
      return {
        name: c.name, platform: c.platform, spend: sp, impressions: im, clicks: cl, reach: rc, videoViews: vv,
        conversions: cv, conversionValue: rev,
        ctr: im > 0 ? (cl / im) * 100 : 0, cpm: im > 0 ? (sp / im) * 1000 : 0,
        frequency: rc > 0 ? im / rc : 0, vtr: im > 0 ? (vv / im) * 100 : 0,
        roas: sp > 0 ? rev / sp : 0, cpa: cv > 0 ? sp / cv : 0,
      };
    });
    const num = (n?: number) => Number(n) || 0;
    return {
      objective, length: reportLength, customInstructions: customPrompt.trim() || undefined,
      focusAreas: [...areas],
      brandName: brandName.trim() || undefined, platform, currency,
      dateRange: `${startDate} – ${endDate}`, totals, campaigns: camps,
      publishers: pubBreak.rows.slice(0, 8).map(r => ({ name: r.label, impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend) })),
      ageRows: mergedRows.age.slice(0, 8).map(r => ({ age: r.label, impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend) })),
      genderRows: mergedRows.gender.slice(0, 5).map(r => ({ gender: r.label, impressions: num(r.impressions), clicks: num(r.clicks) })),
      countryRows: mergedRows.country.slice(0, 8).map(r => ({ country: r.label, impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend) })),
      tracking: buildTracking(),
      isDemo: demoMode,
    };
  };

  const handleGeneratePdf = async () => {
    if (loading || campaigns.length === 0) return;
    setGenPDF(true);
    setFlash(null); setFlashErr(null);
    let narrative: ReportNarrative | null = null;
    try {
      // 1. AI narrative (Haiku) — objective-aware, custom-prompted. Fails soft.
      try {
        const r = await fetch("/api/ai/report-narrative", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildNarrativeRequest()),
        });
        const j = await r.json();
        if (r.ok) {
          narrative = { execSummary: j.execSummary, highlights: j.highlights, sectionInsights: j.sectionInsights, recommendations: j.recommendations };
          if (j.creditsUsedUsd) addAiCredits(j.creditsUsedUsd);
        }
      } catch { /* narrative optional — deck still renders from real data */ }

      // 2. Render the PDF deck with the customization applied.
      await generatePdf({ ...commonOpts(), objective, length: reportLength, narrative, tracking: buildTracking(), sections: areasToSections(areas) });
      setShowPdfModal(false);
      showFlash(`PDF downloaded — ${OBJECTIVES.find(o => o.id === objective)?.label} report${narrative ? " with AI analysis" : " (data only — AI unavailable)"}.`);
    } catch (err) {
      showErr(`PDF failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenPDF(false);
    }
  };

  return (
    <>
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Generate client-ready reports for the current advertiser and date range.</p>
        </div>

        {flash && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            {flash}
          </div>
        )}
        {flashErr && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{flashErr}</div>
        )}

        {campaigns.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Spend",       value: cur0(kpis.spend) },
              { label: "ROAS",        value: kpis.roas !== "—" ? `${kpis.roas}×` : "—" },
              { label: "Conversions", value: Math.round(kpis.conv).toLocaleString() },
              { label: "CPA",         value: kpis.cpa },
            ].map((k) => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="text-[11px] text-gray-500 uppercase tracking-wide">{k.label}</div>
                <div className="text-xl font-bold text-gray-900 mt-0.5">{loading ? "—" : k.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FORMATS.map((f) => {
            const isLoading = f.id === "excel" ? genExcel : genPDF;
            const dataLoading = loading || campaigns.length === 0;
            const onGenerate = f.id === "excel" ? handleExcelDownload : () => setShowPdfModal(true);
            return (
              <div
                key={f.id}
                onClick={() => setSelected(f.id)}
                className={`flex flex-col rounded-2xl border-2 p-6 cursor-pointer transition ${
                  selected === f.id
                    ? "border-indigo-500 bg-indigo-50 shadow-md"
                    : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${selected === f.id ? "bg-indigo-600" : "bg-gray-100"}`}>
                  <f.icon className={`w-6 h-6 ${selected === f.id ? "text-white" : "text-gray-500"}`} />
                </div>
                <div className={`text-lg font-bold mb-0.5 ${selected === f.id ? "text-indigo-900" : "text-gray-900"}`}>{f.title}</div>
                <div className={`text-xs font-mono mb-3 ${selected === f.id ? "text-indigo-500" : "text-gray-400"}`}>{f.ext}</div>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{f.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
                  {f.tags.map((t) => (
                    <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${selected === f.id ? "bg-indigo-200 text-indigo-800" : "bg-gray-100 text-gray-600"}`}>
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onGenerate(); }}
                  disabled={isLoading || loading || campaigns.length === 0}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    selected === f.id
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {(isLoading || dataLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {isLoading
                    ? f.id === "pdf" ? "Rendering PDF…" : "Generating…"
                    : dataLoading
                      ? "Loading data…"
                      : `Download ${f.title}`}
                </button>
              </div>
            );
          })}
        </div>

        <AIExecutiveSummary
          tabName="Generate Report"
          context={{
            campaignCount: campaigns.length,
            totals: { spend: kpis.spend, roas: kpis.roas, conversions: kpis.conv, cpa: kpis.cpa, ctr: kpis.ctr },
            topCampaigns: [...campaigns]
              .sort((a, b) => (b.spend || 0) - (a.spend || 0))
              .slice(0, 20)
              .map((c) => ({
                name: c.name, platform: c.platform, spend: Math.round(c.spend || 0),
                impressions: c.impressions || 0, conversions: c.conversions || 0,
                roas: (c.spend || 0) > 0 ? +(((c.conversionValue || 0) / (c.spend || 1))).toFixed(2) : 0,
              })),
          }}
          dateRange={typeof dateRange === "string" ? dateRange : "custom"}
          platform={platform}
        />

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="text-base font-bold text-gray-900 mb-1">What&apos;s included</h3>
          <p className="text-sm text-gray-500 mb-5">Both formats cover the full reporting tab — respects current date range and advertiser.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
            {INCLUDED.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-indigo-600" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-900">{label}:</span>{" "}
                  <span className="text-sm text-gray-600">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Customize PDF modal ─────────────────────────────────────────────── */}
      {showPdfModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !genPDF && setShowPdfModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-gray-900">Customize your PDF</h3>
              </div>
              <button onClick={() => !genPDF && setShowPdfModal(false)} className="text-gray-400 hover:text-gray-700" disabled={genPDF}>
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Q1 — Objective */}
              <div>
                <div className="text-sm font-semibold text-gray-900 mb-1">1. What is this campaign/account optimized for?</div>
                <p className="text-xs text-gray-500 mb-3">Sets which KPIs the report leads with and how the AI writes the analysis.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {OBJECTIVES.map((o) => {
                    const on = objective === o.id;
                    return (
                      <button key={o.id} onClick={() => setObjective(o.id)}
                        className={`flex items-start gap-3 text-left rounded-xl border-2 p-3 transition ${on ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-300"}`}>
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${on ? "bg-indigo-600" : "bg-gray-100"}`}>
                          <o.icon className={`w-4.5 h-4.5 ${on ? "text-white" : "text-gray-500"}`} />
                        </div>
                        <div>
                          <div className={`text-sm font-bold ${on ? "text-indigo-900" : "text-gray-900"}`}>{o.label}</div>
                          <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{o.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Q2 — Length */}
              <div>
                <div className="text-sm font-semibold text-gray-900 mb-3">2. How long should the report be?</div>
                <div className="grid grid-cols-3 gap-2.5">
                  {LENGTHS.map((l) => {
                    const on = reportLength === l.id;
                    return (
                      <button key={l.id} onClick={() => setReportLength(l.id)}
                        className={`rounded-xl border-2 p-3 text-center transition ${on ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-300"}`}>
                        <div className={`text-sm font-bold ${on ? "text-indigo-900" : "text-gray-900"}`}>{l.label}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{l.pages}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Q3 — Areas */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold text-gray-900">3. Which areas to include?</div>
                  <button onClick={() => setAreas(new Set(ALL_AREA_IDS))} className="text-[11px] text-indigo-600 font-semibold hover:underline">Select all</button>
                </div>
                <p className="text-xs text-gray-500 mb-3">Each area pulls in all its tabs and focuses the analysis there. All on by default.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {AREAS.map((a) => {
                    const on = areas.has(a.id);
                    return (
                      <button key={a.id} onClick={() => toggleArea(a.id)}
                        className={`flex flex-col text-left rounded-xl border-2 p-3 transition ${on ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-300"}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? "bg-indigo-600" : "border border-gray-300 bg-white"}`}>
                            {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                          </span>
                          <span className={`text-sm font-bold ${on ? "text-indigo-900" : "text-gray-900"}`}>{a.label}</span>
                        </div>
                        <span className="text-[10.5px] text-gray-500 leading-snug">{a.tabs}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Q4 — Custom prompt */}
              <div>
                <div className="text-sm font-semibold text-gray-900 mb-1">4. Anything specific to focus on? <span className="font-normal text-gray-400">(optional)</span></div>
                <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={3}
                  placeholder='e.g. "Compare Q3 vs Q2 spend", "call out wasted budget", "focus on the retargeting campaigns"'
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-none" />
                <div className="mt-2">
                  <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Brand / client name for the cover (optional)"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                </div>
              </div>

              {/* Cost estimate */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <Bot className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  This will use about <span className="font-bold">~{estCredits} credits</span> of AI to write the analysis (Claude Haiku).
                  The actual cost is added to your session total after generating. All numbers in the PDF come from your real data — the AI only writes the commentary.
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={() => setShowPdfModal(false)} disabled={genPDF}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40">Cancel</button>
              <button onClick={handleGeneratePdf} disabled={genPDF || loading || campaigns.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {genPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {genPDF ? "Generating…" : `Generate PDF (~${estCredits} credits)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
