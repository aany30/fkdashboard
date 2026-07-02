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
} from "lucide-react";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import { detectCurrency, formatMoney } from "@/lib/currency";
import { toCSV, downloadCSV } from "@/lib/csv-export";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";
import type { PdfReportPagesProps } from "./PdfReportPages";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

type Format = "excel" | "pdf";

const pct = (a: number, b: number) => b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "—";
const fmtBig = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : Math.round(n).toLocaleString("en-IN");

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
      c.name, c.platform === "meta" ? "Meta" : "Google", c.status || "—", (c.objective || "—").replace(/OUTCOME_/, ""),
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
  const enabled = platform !== "google";
  const pubBreak     = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, enabled);
  const ageBreak     = useMetaBreakdown("age",                dateRange, customStart, customEnd, enabled);
  const genBreak     = useMetaBreakdown("gender",             dateRange, customStart, customEnd, enabled);
  const countryBreak = useMetaBreakdown("country",            dateRange, customStart, customEnd, enabled);
  const deviceBreak  = useMetaBreakdown("impression_device",  dateRange, customStart, customEnd, enabled);
  const dailyBreak   = useMetaBreakdown("daily",              dateRange, customStart, customEnd, enabled);
  const regionBreak  = useMetaBreakdown("region",             dateRange, customStart, customEnd, enabled);

  // Ad-level creative insights (mirrors CreativeReport's fetch)
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [adRows, setAdRows] = useState<AdInsightRow[]>([]);
  useEffect(() => {
    if (platform === "google") { setAdRows([]); return; }
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

  const currency = detectCurrency(campaigns);
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

  const commonOpts = () => ({
    startDate, endDate, currency, platform,
    campaigns,
    pubRows:     pubBreak.rows,
    ageRows:     ageBreak.rows,
    genderRows:  genBreak.rows,
    countryRows: countryBreak.rows,
    deviceRows:  deviceBreak.rows,
    dailyRows:   dailyBreak.rows,
    regionRows:  regionBreak.rows,
    adRows,
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
          return [c.name, c.platform==="meta"?"Meta":"Google", c.status||"—",
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

  const handlePDFDownload = async () => {
    if (loading || campaigns.length === 0) return;
    setGenPDF(true);
    setFlash(null); setFlashErr(null);
    try {
      await generatePdf(commonOpts());
      showFlash("Report opened — choose “Save as PDF” in the print dialog (landscape, background graphics on).");
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
            const onGenerate = f.id === "excel" ? handleExcelDownload : handlePDFDownload;
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
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {isLoading
                    ? f.id === "pdf" ? "Rendering PDF…" : "Generating…"
                    : `Download ${f.title}`}
                </button>
              </div>
            );
          })}
        </div>

        <AIExecutiveSummary
          tabName="Generate Report"
          context={{
            campaigns: campaigns.length,
            totalSpend: kpis.spend,
            roas: kpis.roas,
            conversions: kpis.conv,
            cpa: kpis.cpa,
            ctr: kpis.ctr,
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
    </>
  );
}
