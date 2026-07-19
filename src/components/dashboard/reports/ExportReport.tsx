/**
 * Reporting → Export / Reports
 *
 * Three export formats:
 *   1. CSV  — campaigns table (instant download)
 *   2. CSV+ — extended CSV with demographics + placement sections
 *   3. PDF  — opens a formatted HTML report in a new tab → Cmd+P → Save as PDF
 *
 * The PDF generator builds a self-contained HTML page with executive summary,
 * campaign table, publisher breakdown, demographics, and attribution — all
 * print-optimised (A4 layout, clean tables, page-break rules).
 */

import React, { useState, useMemo, useRef } from "react";
import AnimatedNumber from "@/components/shared/AnimatedNumber";
import { FileText, Download, Printer, CheckCircle2, BarChart2, Users, Map as MapIcon2, GitBranch, Sparkles, Eye, ShoppingCart, Copy, Check } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { currencyFor, formatMoney } from "@/lib/currency";
import { toCSV, downloadCSV } from "@/lib/csv-export";
import { useAuthStore } from "@/store/auth";
import { toDisplayCredits } from "@/lib/ai-cost";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { ReportRequest } from "@/pages/api/ai/generate-report";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

const fmt = (n: number, cur?: string) =>
  cur ? formatMoney(n, cur, 0) : n.toLocaleString("en-IN");
const pct  = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(2) + "%" : "—";
const ratio = (a: number, b: number) => b > 0 ? (a / b).toFixed(2) : "—";

// ─── PDF Generator ────────────────────────────────────────────────────────────

function buildPdfHtml(opts: {
  startDate: string;
  endDate: string;
  currency: string;
  platform: string;
  campaigns: any[];
  pubRows: any[];
  ageRows: any[];
  genderRows: any[];
  windowRows: { window: string; campaigns: number; spend: number; conversions: number; roas: string }[];
  sections: Set<string>;
  pdfType?: "full" | "awareness" | "sales" | "executive";
}) {
  const { startDate, endDate, currency, campaigns, pubRows, ageRows, genderRows, windowRows, sections, pdfType = "full" } = opts;
  const cur = (n: number) => formatMoney(n, currency, 0);
  const cur2 = (n: number) => formatMoney(n, currency, 2);

  const totalSpend   = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr    = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks  = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalReach   = campaigns.reduce((s, c) => s + (c.reach || 0), 0);
  const totalViews   = campaigns.reduce((s, c) => s + (c.videoViews || 0), 0);
  const totalConv    = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const totalRoas    = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "—";
  const totalCpa     = totalConv  > 0 ? cur(totalSpend / totalConv) : "—";
  const totalCtr     = totalImpr  > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) + "%" : "—";
  const totalCpm     = totalImpr  > 0 ? cur2(totalSpend / totalImpr * 1000) : "—";
  const totalFreq    = totalReach > 0 ? (totalImpr / totalReach).toFixed(2) : "—";
  const totalVtr     = totalImpr  > 0 ? ((totalViews / totalImpr) * 100).toFixed(2) + "%" : "—";

  const PDF_TYPE_LABELS: Record<string, string> = {
    full: "Full Report",
    awareness: "Brand Awareness Report",
    sales: "Sales & Performance Report",
    executive: "Executive Summary",
  };

  // KPI cards vary by report type
  const kpiCards = pdfType === "awareness" ? [
    { label: "Total Spend",   value: cur(totalSpend) },
    { label: "Reach",         value: totalReach >= 1e6 ? `${(totalReach/1e6).toFixed(2)}M` : totalReach.toLocaleString() },
    { label: "Impressions",   value: totalImpr >= 1e6 ? `${(totalImpr/1e6).toFixed(2)}M` : totalImpr.toLocaleString() },
    { label: "Frequency",     value: totalFreq },
    { label: "CPM",           value: totalCpm },
    { label: "Clicks",        value: totalClicks.toLocaleString() },
    { label: "CTR",           value: totalCtr },
    { label: "Video Views",   value: totalViews >= 1e6 ? `${(totalViews/1e6).toFixed(2)}M` : totalViews.toLocaleString() },
    { label: "VTR",           value: totalVtr },
  ] : pdfType === "sales" ? [
    { label: "Total Spend",   value: cur(totalSpend) },
    { label: "Revenue",       value: cur(totalRevenue) },
    { label: "ROAS",          value: totalRoas !== "—" ? `${totalRoas}×` : "—" },
    { label: "Conversions",   value: Math.round(totalConv).toLocaleString() },
    { label: "CPA",           value: totalCpa },
    { label: "Clicks",        value: totalClicks.toLocaleString() },
    { label: "CTR",           value: totalCtr },
    { label: "Impressions",   value: totalImpr >= 1e6 ? `${(totalImpr/1e6).toFixed(2)}M` : totalImpr.toLocaleString() },
    { label: "CPM",           value: totalCpm },
  ] : [
    // full + executive: all metrics
    { label: "Total Spend",   value: cur(totalSpend) },
    { label: "Impressions",   value: totalImpr >= 1e6 ? `${(totalImpr/1e6).toFixed(2)}M` : totalImpr.toLocaleString() },
    { label: "Clicks",        value: totalClicks.toLocaleString() },
    { label: "CTR",           value: totalCtr },
    { label: "Conversions",   value: Math.round(totalConv).toLocaleString() },
    { label: "Conv. Value",   value: cur(totalRevenue) },
    { label: "ROAS",          value: totalRoas !== "—" ? `${totalRoas}×` : "—" },
    { label: "CPA",           value: totalCpa },
    { label: "CPM",           value: totalCpm },
  ];

  // Campaign table columns vary by type
  type ColDef = { h: string; v: (c: any) => string };
  const campaignCols: ColDef[] = pdfType === "awareness" ? [
    { h: "Campaign",    v: c => c.name },
    { h: "Spend",       v: c => cur(c.spend || 0) },
    { h: "Reach",       v: c => (c.reach || 0) >= 1e6 ? `${((c.reach||0)/1e6).toFixed(2)}M` : Math.round(c.reach||0).toLocaleString() },
    { h: "Frequency",   v: c => (c.reach||0) > 0 ? ((c.impressions||0)/(c.reach||1)).toFixed(2) : "—" },
    { h: "Impressions", v: c => (c.impressions||0) >= 1e6 ? `${((c.impressions||0)/1e6).toFixed(2)}M` : Math.round(c.impressions||0).toLocaleString() },
    { h: "CPM",         v: c => (c.impressions||0) > 0 ? cur2((c.spend||0)/(c.impressions||1)*1000) : "—" },
    { h: "CTR",         v: c => (c.impressions||0) > 0 ? (((c.clicks||0)/(c.impressions||1))*100).toFixed(2)+"%" : "—" },
    { h: "Views",       v: c => Math.round(c.videoViews||0).toLocaleString() },
    { h: "VTR",         v: c => (c.impressions||0) > 0 ? (((c.videoViews||0)/(c.impressions||1))*100).toFixed(2)+"%" : "—" },
  ] : pdfType === "sales" ? [
    { h: "Campaign",    v: c => c.name },
    { h: "Spend",       v: c => cur(c.spend || 0) },
    { h: "Revenue",     v: c => cur(c.conversionValue || 0) },
    { h: "ROAS",        v: c => (c.spend||0) > 0 && (c.conversionValue||0) > 0 ? ((c.conversionValue||0)/(c.spend||1)).toFixed(2)+"×" : "—" },
    { h: "Conv.",       v: c => Math.round(c.conversions||0).toLocaleString() },
    { h: "CPA",         v: c => (c.conversions||0) > 0 ? cur((c.spend||0)/(c.conversions||1)) : "—" },
    { h: "Clicks",      v: c => Math.round(c.clicks||0).toLocaleString() },
    { h: "CTR",         v: c => (c.impressions||0) > 0 ? (((c.clicks||0)/(c.impressions||1))*100).toFixed(2)+"%" : "—" },
  ] : [
    // full + executive
    { h: "Campaign",    v: c => c.name },
    { h: "Spend",       v: c => cur(c.spend || 0) },
    { h: "Impressions", v: c => Math.round(c.impressions||0).toLocaleString() },
    { h: "Clicks",      v: c => Math.round(c.clicks||0).toLocaleString() },
    { h: "CTR",         v: c => (c.impressions||0) > 0 ? (((c.clicks||0)/(c.impressions||1))*100).toFixed(2)+"%" : "—" },
    { h: "Conv.",       v: c => Math.round(c.conversions||0).toLocaleString() },
    { h: "ROAS",        v: c => (c.spend||0) > 0 && (c.conversionValue||0) > 0 ? ((c.conversionValue||0)/(c.spend||1)).toFixed(2)+"×" : "—" },
    { h: "CPA",         v: c => (c.conversions||0) > 0 ? cur((c.spend||0)/(c.conversions||1)) : "—" },
    { h: "CPM",         v: c => (c.impressions||0) > 0 ? cur2((c.spend||0)/(c.impressions||1)*1000) : "—" },
  ];

  // Executive only shows top 10; full/awareness/sales show all
  const maxCampaigns = pdfType === "executive" ? 10 : 50;
  const sortedCampaigns = [...campaigns]
    .sort((a, b) => pdfType === "sales" ? (b.conversionValue||0) - (a.conversionValue||0) : (b.spend||0) - (a.spend||0))
    .slice(0, maxCampaigns);

  function tableRow(cells: string[], isHeader = false): string {
    const tag = isHeader ? "th" : "td";
    return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  }

  function section(title: string, content: string): string {
    return `
      <div class="section">
        <h2>${title}</h2>
        ${content}
      </div>`;
  }

  const campaignTable = sections.has("campaigns") || pdfType === "executive" ? section("Campaign Performance", `
    <table>
      ${tableRow(campaignCols.map(col => col.h), true)}
      ${sortedCampaigns.map(c => tableRow(campaignCols.map(col => col.v(c)))).join("")}
    </table>`) : "";

  const pubTable = sections.has("placement") && pubRows.length > 0 ? section("Publisher Placement Breakdown", `
    <table>
      ${tableRow(["Publisher", "Spend", "Impressions", "Clicks", "CTR", "Conversions", "ROAS"], true)}
      ${pubRows.map(r => {
        const roas = r.spend > 0 && r.conversionValue > 0 ? `${(r.conversionValue/r.spend).toFixed(2)}×` : "—";
        return tableRow([
          r.label.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          cur(r.spend), r.impressions.toLocaleString(), r.clicks.toLocaleString(),
          pct(r.clicks, r.impressions), r.conversions.toLocaleString(), roas,
        ]);
      }).join("")}
    </table>`) : "";

  const ageTable = sections.has("demographics") && ageRows.length > 0 ? section("Age Demographics", `
    <table>
      ${tableRow(["Age Group", "Spend", "Impressions", "Clicks", "CTR", "Conversions", "ROAS"], true)}
      ${ageRows.sort((a: any, b: any) => b.spend - a.spend).map((r: any) => {
        const roas = r.spend > 0 && r.conversionValue > 0 ? `${(r.conversionValue/r.spend).toFixed(2)}×` : "—";
        return tableRow([r.label, cur(r.spend), r.impressions.toLocaleString(), r.clicks.toLocaleString(),
          pct(r.clicks, r.impressions), r.conversions.toLocaleString(), roas]);
      }).join("")}
    </table>`) : "";

  const genderTable = sections.has("demographics") && genderRows.length > 0 ? section("Gender Demographics", `
    <table>
      ${tableRow(["Gender", "Spend", "Impressions", "Clicks", "CTR", "Conversions", "ROAS"], true)}
      ${genderRows.map((r: any) => {
        const roas = r.spend > 0 && r.conversionValue > 0 ? `${(r.conversionValue/r.spend).toFixed(2)}×` : "—";
        return tableRow([
          r.label.charAt(0).toUpperCase() + r.label.slice(1),
          cur(r.spend), r.impressions.toLocaleString(), r.clicks.toLocaleString(),
          pct(r.clicks, r.impressions), r.conversions.toLocaleString(), roas]);
      }).join("")}
    </table>`) : "";

  const attrTable = sections.has("attribution") && windowRows.length > 0 ? section("Attribution Windows", `
    <table>
      ${tableRow(["Window", "Campaigns", "Spend", "Conversions", "ROAS"], true)}
      ${windowRows.map(r => tableRow([r.window, String(r.campaigns), cur(r.spend), Math.round(r.conversions).toString(), r.roas !== "—" ? `${r.roas}×` : "—"])).join("")}
    </table>`) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${PDF_TYPE_LABELS[pdfType]} · ${startDate} – ${endDate}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #fff; font-size: 11pt; }
    @page { size: A4 landscape; margin: 15mm 15mm 12mm; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }

    /* Cover / Header */
    .cover { padding: 28px 0 22px; border-bottom: 3px solid #2563eb; margin-bottom: 24px; display: flex; align-items: flex-end; justify-content: space-between; }
    .cover-logo { font-size: 22pt; font-weight: 800; color: #1d4ed8; letter-spacing: -0.5px; }
    .cover-sub { font-size: 10pt; color: #6b7280; margin-top: 3px; }
    .cover-meta { text-align: right; font-size: 9pt; color: #6b7280; line-height: 1.6; }
    .cover-meta strong { color: #111827; }

    /* KPI grid */
    .kpi-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 8px; margin-bottom: 24px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    .kpi-label { font-size: 7.5pt; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
    .kpi-value { font-size: 13pt; font-weight: 700; color: #111827; }
    .kpi-card:first-child { background: #eff6ff; border-color: #bfdbfe; }
    .kpi-card:first-child .kpi-value { color: #1d4ed8; }

    /* Sections */
    .section { margin-bottom: 22px; page-break-inside: avoid; }
    .section h2 { font-size: 11pt; font-weight: 700; color: #1e40af; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid #dbeafe; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th { background: #1e40af; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.3px; }
    td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; color: #374151; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    tr:last-child td { border-bottom: none; }
    .campaign-name { font-weight: 600; color: #111827; max-width: 220px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    td:first-child { max-width: 220px; }
    td:not(:first-child), th:not(:first-child) { text-align: right; }

    /* Footer */
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af; display: flex; justify-content: space-between; }

    /* Print helpers */
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <!-- Cover / Header -->
  <div class="cover">
    <div>
      <div class="cover-logo">📊 Auditor — ${PDF_TYPE_LABELS[pdfType]}</div>
      <div class="cover-sub">Campaign Intelligence · ${opts.platform === "meta" ? "Meta Ads" : opts.platform === "dv360" ? "DV360" : "Meta + DV360"}</div>
    </div>
    <div class="cover-meta">
      <div><strong>Period:</strong> ${startDate} → ${endDate}</div>
      <div><strong>Campaigns:</strong> ${campaigns.length}</div>
      <div><strong>Currency:</strong> ${currency}</div>
      <div><strong>Generated:</strong> ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
    </div>
  </div>

  <!-- KPI Summary -->
  <div class="kpi-grid">
    ${kpiCards.map(k => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
      </div>`).join("")}
  </div>

  ${campaignTable}
  ${pdfType !== "executive" ? pubTable : ""}
  ${pdfType !== "executive" ? ageTable : ""}
  ${pdfType !== "executive" ? genderTable : ""}
  ${pdfType !== "executive" && pdfType !== "awareness" ? attrTable : ""}

  <div class="footer">
    <span>Auditor · Ad Performance Report</span>
    <span>Generated ${new Date().toLocaleString("en-IN")} · Data via Meta Graph API</span>
  </div>

  <script>window.onload = () => { setTimeout(() => window.print(), 400); }</script>
</body>
</html>`;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function buildCampaignCsv(campaigns: any[], currency: string, startDate: string, endDate: string): string {
  const headers = [
    "Campaign", "Platform", "Status", "Objective",
    "Spend", "Impressions", "Clicks", "CTR (%)",
    "Conversions", "Conv. Value", "ROAS", "CPM", "CPC", "CPA", "Currency",
  ];
  const rows = campaigns.map(c => {
    const sp = c.spend||0, im = c.impressions||0, cl = c.clicks||0, cv = c.conversions||0, rev = c.conversionValue||0;
    return [c.name, c.platform==="meta"?"Meta":"DV360", c.status||"—", c.objective||"—",
      sp.toFixed(2), im, cl, im>0?((cl/im)*100).toFixed(2):"",
      cv, rev.toFixed(2), sp>0&&rev>0?(rev/sp).toFixed(2):"",
      im>0?(sp/im*1000).toFixed(2):"", cl>0?(sp/cl).toFixed(2):"", cv>0?(sp/cv).toFixed(2):"",
      c.currency||currency];
  });
  return toCSV(headers, rows);
}

function buildBreakdownCsv(label: string, rows: any[], currency: string): string {
  const headers = [label, "Spend", "Impressions", "Clicks", "CTR (%)", "Conversions", "Conv. Value", "ROAS", "CPA"];
  const data = rows.map(r => {
    const sp=r.spend, im=r.impressions, cl=r.clicks, cv=r.conversions, rev=r.conversionValue;
    return [r.label, sp.toFixed(2), im, cl, im>0?((cl/im)*100).toFixed(2):"",
      cv, rev.toFixed(2), sp>0&&rev>0?(rev/sp).toFixed(2):"", cv>0?(sp/cv).toFixed(2):""];
  });
  return toCSV(headers, data);
}

// ─── Section Preview Card ─────────────────────────────────────────────────────

function SectionToggle({ id, icon: Icon, label, desc, checked, onChange }: {
  id: string; icon: any; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition ${
        checked
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${checked ? "bg-blue-600" : "bg-gray-100"}`}>
        <Icon className={`w-4 h-4 ${checked ? "text-white" : "text-gray-400"}`} />
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-bold ${checked ? "text-blue-900" : "text-gray-800"}`}>{label}</div>
        <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{desc}</div>
      </div>
      <div className={`ml-auto shrink-0 w-4 h-4 rounded-full border-2 mt-1 flex items-center justify-center ${checked ? "border-blue-500 bg-blue-500" : "border-gray-300"}`}>
        {checked && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "campaigns",    icon: BarChart2, label: "Campaign Performance",     desc: "All campaigns: spend, impressions, clicks, CTR, conversions, ROAS, CPA" },
  { id: "placement",   icon: MapIcon2,  label: "Publisher Placement",       desc: "Facebook, Instagram, Audience Network, Messenger performance breakdown" },
  { id: "demographics",icon: Users,     label: "Age & Gender Demographics", desc: "Age groups + gender split — spend, CTR, ROAS per segment" },
  { id: "attribution", icon: GitBranch, label: "Attribution Windows",       desc: "Which attribution models are active and their conversion contribution" },
] as const;

export default function ExportReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const enabled = platform !== "dv360";
  const pubBreakdown = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, enabled);
  const ageBreakdown = useMetaBreakdown("age",  dateRange, customStart, customEnd, enabled);
  const genBreakdown = useMetaBreakdown("gender", dateRange, customStart, customEnd, enabled);

  const currency = currencyFor(campaigns, platform === "dv360" ? "dv360" : "meta");
  const cur = (n: number) => formatMoney(n, currency, 0);

  const [flash, setFlash]       = useState<string | null>(null);
  const [sections, setSections] = useState<Set<string>>(new Set(["campaigns", "placement", "demographics", "attribution"]));
  const [pdfType, setPdfType]   = useState<"full" | "awareness" | "sales" | "executive">("full");

  // AI Report state
  const addAiCredits = useAuthStore(s => s.addAiCredits);
  const demoMode     = useAuthStore(s => s.demoMode);
  const [aiReportType,    setAiReportType]    = useState<"awareness" | "sales">("awareness");
  const [aiBrandName,     setAiBrandName]     = useState("");
  const [aiReport,        setAiReport]        = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [aiReportError,   setAiReportError]   = useState<string | null>(null);
  const [aiCopied,        setAiCopied]        = useState(false);
  const aiReportRef = useRef<HTMLDivElement>(null);

  const toggleSection = (id: string, on: boolean) => {
    setSections(prev => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  };

  // Aggregate KPIs for the summary bar
  const kpis = useMemo(() => {
    const spend   = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const impr    = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
    const clicks  = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
    const conv    = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
    const revenue = campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
    return { spend, impr, clicks, conv, revenue,
      ctr:  impr  > 0 ? (clicks / impr  * 100).toFixed(2) : "—",
      roas: spend > 0 ? (revenue / spend).toFixed(2) : "—",
      cpa:  conv  > 0 ? cur(spend / conv) : "—",
      cpm:  impr  > 0 ? cur(spend / impr * 1000) : "—",
    };
  }, [campaigns]);

  // Attribution window rows for PDF
  const windowRows = useMemo(() => {
    const map = new Map<string, any>();
    campaigns.filter(c => c.platform === "meta").forEach(c => {
      const w = (c as any).effectiveAttribution || "Account default";
      const r = map.get(w) || { window: w, campaigns: 0, spend: 0, conversions: 0, conversionValue: 0 };
      r.campaigns++; r.spend += c.spend||0; r.conversions += c.conversions||0; r.conversionValue += c.conversionValue||0;
      map.set(w, r);
    });
    return [...map.values()].sort((a, b) => b.spend - a.spend).map(r => ({
      ...r,
      roas: r.spend > 0 && r.conversionValue > 0 ? (r.conversionValue/r.spend).toFixed(2) : "—",
    }));
  }, [campaigns]);

  const flashMsg = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 5000); };

  const handleCsvCampaigns = () => {
    if (!campaigns.length) return;
    const csv = buildCampaignCsv(campaigns, currency, startDate, endDate);
    downloadCSV(`campaigns-${startDate}-to-${endDate}.csv`, csv);
    flashMsg(`Downloaded campaigns CSV — ${campaigns.length} rows`);
  };

  const handleCsvAll = () => {
    if (!campaigns.length) return;
    const parts: string[] = [];
    if (sections.has("campaigns")) parts.push("=== CAMPAIGNS ===\r\n" + buildCampaignCsv(campaigns, currency, startDate, endDate));
    if (sections.has("placement") && pubBreakdown.rows.length) parts.push("\r\n\r\n=== PUBLISHER PLACEMENT ===\r\n" + buildBreakdownCsv("Publisher", pubBreakdown.rows, currency));
    if (sections.has("demographics") && ageBreakdown.rows.length) parts.push("\r\n\r\n=== AGE DEMOGRAPHICS ===\r\n" + buildBreakdownCsv("Age Group", ageBreakdown.rows, currency));
    if (sections.has("demographics") && genBreakdown.rows.length) parts.push("\r\n\r\n=== GENDER ===\r\n" + buildBreakdownCsv("Gender", genBreakdown.rows, currency));
    downloadCSV(`full-report-${startDate}-to-${endDate}.csv`, parts.join(""));
    flashMsg(`Downloaded full report CSV — ${sections.size} sections`);
  };

  const handlePdf = () => {
    const html = buildPdfHtml({
      startDate, endDate, currency,
      platform,
      campaigns,
      pubRows:    sections.has("placement")    ? pubBreakdown.rows : [],
      ageRows:    sections.has("demographics") ? ageBreakdown.rows : [],
      genderRows: sections.has("demographics") ? genBreakdown.rows : [],
      windowRows: sections.has("attribution")  ? windowRows : [],
      sections,
      pdfType,
    });
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups for this site to open the PDF report."); return; }
    w.document.write(html);
    w.document.close();
    flashMsg("PDF report opened in new tab — press Cmd+P / Ctrl+P to save as PDF");
  };

  const dataReady = !loading && campaigns.length > 0;

  const handleAiReport = async () => {
    if (!campaigns.length) return;
    setAiReportLoading(true);
    setAiReportError(null);
    setAiReport(null);
    try {
      const t = {
        spend:           campaigns.reduce((s, c) => s + (c.spend || 0), 0),
        impressions:     campaigns.reduce((s, c) => s + (c.impressions || 0), 0),
        clicks:          campaigns.reduce((s, c) => s + (c.clicks || 0), 0),
        reach:           campaigns.reduce((s, c) => s + (c.reach || 0), 0),
        videoViews:      campaigns.reduce((s, c) => s + (c.videoViews || 0), 0),
        conversions:     campaigns.reduce((s, c) => s + (c.conversions || 0), 0),
        conversionValue: campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0),
      };
      const body: ReportRequest = {
        reportType: aiReportType,
        platform,
        brandName:  aiBrandName || undefined,
        dateRange:  `${startDate} to ${endDate}`,
        currency,
        totals: t,
        campaigns: campaigns.slice(0, 40).map(c => ({
          name:            c.name,
          platform:        c.platform,
          spend:           c.spend || 0,
          impressions:     c.impressions || 0,
          clicks:          c.clicks || 0,
          reach:           c.reach || 0,
          videoViews:      c.videoViews || 0,
          conversions:     c.conversions || 0,
          conversionValue: c.conversionValue || 0,
          ctr:             (c.impressions||0) > 0 ? ((c.clicks||0) / (c.impressions||1)) * 100 : 0,
          cpm:             (c.impressions||0) > 0 ? ((c.spend||0) / (c.impressions||1)) * 1000 : 0,
          frequency:       (c.reach||0) > 0 ? (c.impressions||0) / (c.reach||1) : 0,
          vtr:             (c.impressions||0) > 0 ? ((c.videoViews || 0) / (c.impressions||1)) * 100 : 0,
          roas:            (c.spend||0) > 0 ? (c.conversionValue || 0) / (c.spend||1) : 0,
          cpa:             (c.conversions||0) > 0 ? (c.spend||0) / (c.conversions||1) : 0,
        })),
        publishers: pubBreakdown.rows.slice(0, 10).map(r => ({
          name: (r as any).publisher_platform || (r as any).label || "Unknown",
          impressions: r.impressions || 0,
          clicks: r.clicks || 0,
          spend: r.spend || 0,
        })),
        ageRows:    ageBreakdown.rows.slice(0, 10).map(r => ({ age: (r as any).age || (r as any).label || "Unknown", impressions: r.impressions || 0, clicks: r.clicks || 0, spend: r.spend || 0 })),
        genderRows: genBreakdown.rows.slice(0, 5).map(r => ({ gender: (r as any).gender || (r as any).label || "Unknown", impressions: r.impressions || 0, clicks: r.clicks || 0 })),
        isDemo: demoMode,
      };
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as any).error || `HTTP ${res.status}`);
      if (typeof json.creditsUsedUsd === "number") addAiCredits(json.creditsUsedUsd);
      setAiReport(json.report);
      setTimeout(() => aiReportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e) {
      setAiReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiReportLoading(false);
    }
  };

  const handleCopyReport = async () => {
    if (!aiReport) return;
    await navigator.clipboard.writeText(aiReport);
    setAiCopied(true);
    setTimeout(() => setAiCopied(false), 2000);
  };

  return (
    <div className="space-y-6 section-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-600 mt-1">Download client-ready CSV or PDF for the current date window.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            <span className="font-mono text-gray-700">{startDate}</span> → <span className="font-mono text-gray-700">{endDate}</span>
            {" · "}<span className="font-semibold">{campaigns.length} campaigns</span>
          </span>
          <AIExecutiveSummary
            tabName="Export Report"
            context={{
              period: `${startDate} → ${endDate}`,
              campaignCount: campaigns.length,
              totalSpend: Math.round(campaigns.reduce((s, c) => s + (c.spend || 0), 0)),
              totalImpressions: campaigns.reduce((s, c) => s + (c.impressions || 0), 0),
              totalConversions: campaigns.reduce((s, c) => s + (c.conversions || 0), 0),
              topCampaigns: [...campaigns]
                .sort((a, b) => (b.spend || 0) - (a.spend || 0))
                .slice(0, 20)
                .map((c) => ({
                  name: c.name, platform: c.platform, spend: Math.round(c.spend || 0),
                  impressions: c.impressions || 0, conversions: c.conversions || 0,
                })),
            }}
            platform={platform}
            dateRange={String(dateRange)}
            inline
          />
        </div>
      </div>

      {/* Flash */}
      {flash && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {flash}
        </div>
      )}

      {/* KPI summary bar */}
      {dataReady && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
          {[
            { l: "SPEND",        num: kpis.spend,     fmt: (n: number) => cur(n) },
            { l: "IMPRESSIONS",  num: kpis.impr,      fmt: (n: number) => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : Math.round(n).toLocaleString("en-IN") },
            { l: "CLICKS",       num: kpis.clicks,    fmt: (n: number) => Math.round(n).toLocaleString("en-IN") },
            { l: "CTR",          num: parseFloat(String(kpis.ctr)) || 0, fmt: (n: number) => n.toFixed(2) + "%" },
            { l: "CONVERSIONS",  num: kpis.conv,      fmt: (n: number) => Math.round(n).toLocaleString("en-IN") },
            { l: "CONV. VALUE",  num: kpis.revenue,   fmt: (n: number) => cur(n) },
            { l: "ROAS",         num: parseFloat(String(kpis.roas)) || 0, fmt: (n: number) => n.toFixed(2) + "×" },
            { l: "CPA",          num: kpis.conv > 0 ? kpis.spend / kpis.conv : 0, fmt: (n: number) => cur(n) },
            { l: "CPM",          num: kpis.impr > 0 ? kpis.spend / kpis.impr * 1000 : 0, fmt: (n: number) => cur(n) },
          ].map((k, i) => (
            <div key={k.l} className={`animate-fade-in-up stagger-${Math.min(i+1,9) as 1} rounded-lg border shadow-sm p-3 ${k.l === "SPEND" ? "border-blue-200 bg-blue-50" : "bg-white border-gray-200"}`}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{k.l}</div>
              <div className={`text-base font-bold mt-0.5 ${k.l === "SPEND" ? "text-blue-700" : "text-gray-900"}`}>
                <AnimatedNumber value={k.num} formatter={k.fmt} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Select sections to include in your report</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SECTIONS.map(s => (
            <SectionToggle
              key={s.id}
              id={s.id}
              icon={s.icon}
              label={s.label}
              desc={s.desc}
              checked={sections.has(s.id)}
              onChange={v => toggleSection(s.id, v)}
            />
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">{sections.size} of {SECTIONS.length} sections selected</p>
      </div>

      {/* Download cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* CSV — Campaigns only */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Download className="w-5 h-5 text-green-600" />
            <h3 className="text-base font-bold text-gray-900">CSV — Campaigns</h3>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold uppercase">Ready</span>
          </div>
          <p className="text-xs text-gray-500 mb-1 flex-1">
            Single sheet · all campaigns · spend, impressions, clicks, CTR, conversions, ROAS, CPA · UTF-8 BOM for Excel
          </p>
          <div className="text-[10px] text-gray-400 mb-3">{campaigns.length} rows · ~{Math.round(campaigns.length * 0.2 + 1)} KB</div>
          <button
            onClick={handleCsvCampaigns}
            disabled={!dataReady}
            className="w-full py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download CSV
          </button>
        </div>

        {/* CSV+ — All sections */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Download className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-gray-900">CSV+ — Full Report</h3>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold uppercase">Multi-section</span>
          </div>
          <p className="text-xs text-gray-500 mb-1 flex-1">
            All selected sections in one file — campaigns, publisher placement, age/gender demographics, attribution windows
          </p>
          <div className="text-[10px] text-gray-400 mb-3">{sections.size} sections selected</div>
          <button
            onClick={handleCsvAll}
            disabled={!dataReady}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download CSV+
          </button>
        </div>

        {/* PDF */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3 md:col-span-3">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-purple-600" />
            <h3 className="text-base font-bold text-gray-900">PDF Report</h3>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold uppercase">Print / Save</span>
          </div>
          <p className="text-xs text-gray-500">Choose the report type — each formats the KPI strip and campaign table for its objective. Opens in a new tab → Cmd+P → Save as PDF.</p>

          {/* Type selector */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              { id: "full",      label: "Full Report",      desc: "All metrics · all sections", icon: "📊" },
              { id: "awareness", label: "Awareness",        desc: "Reach · Freq · CPM · VTR",  icon: "👁️" },
              { id: "sales",     label: "Sales & ROI",      desc: "ROAS · CPA · Conv · Rev",    icon: "💰" },
              { id: "executive", label: "Exec Summary",     desc: "Top 10 campaigns · 1 page",  icon: "📋" },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setPdfType(t.id)}
                className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition ${pdfType === t.id ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}
              >
                <span className="text-lg">{t.icon}</span>
                <span className={`text-sm font-bold ${pdfType === t.id ? "text-purple-900" : "text-gray-800"}`}>{t.label}</span>
                <span className="text-[11px] text-gray-500 leading-snug">{t.desc}</span>
              </button>
            ))}
          </div>

          <button
            onClick={handlePdf}
            disabled={!dataReady}
            className="w-full py-2.5 rounded-lg bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Generate {pdfType === "full" ? "Full" : pdfType === "awareness" ? "Awareness" : pdfType === "sales" ? "Sales & ROI" : "Executive"} PDF
          </button>
        </div>
      </div>

      {/* ── AI Business Report ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">AI Business Report</h3>
            <p className="text-xs text-gray-500 mt-0.5">Haiku writes a structured analysis tailored to your campaign objective</p>
          </div>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold uppercase">~$0.01/report</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Report type toggle */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">Campaign Objective</p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <button
                onClick={() => setAiReportType("awareness")}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition ${aiReportType === "awareness" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <Eye className={`w-4 h-4 mt-0.5 shrink-0 ${aiReportType === "awareness" ? "text-blue-600" : "text-gray-400"}`} />
                <div>
                  <div className={`text-sm font-bold ${aiReportType === "awareness" ? "text-blue-900" : "text-gray-700"}`}>Awareness</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Reach · Views · Frequency · CPM · VTR</div>
                </div>
              </button>
              <button
                onClick={() => setAiReportType("sales")}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition ${aiReportType === "sales" ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <ShoppingCart className={`w-4 h-4 mt-0.5 shrink-0 ${aiReportType === "sales" ? "text-green-600" : "text-gray-400"}`} />
                <div>
                  <div className={`text-sm font-bold ${aiReportType === "sales" ? "text-green-900" : "text-gray-700"}`}>Sales</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">ROAS · ROI · Conversions · CPA · Revenue</div>
                </div>
              </button>
            </div>
          </div>

          {/* Brand name (optional) */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">Brand / Account Name <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={aiBrandName}
              onChange={e => setAiBrandName(e.target.value)}
              placeholder="e.g. Honer Homes, Plenaire India…"
              className="w-full max-w-sm px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder-gray-400"
            />
          </div>

          {/* What's included chips */}
          <div className="flex flex-wrap gap-1.5">
            {(aiReportType === "awareness"
              ? ["Executive Summary", "Reach & Frequency", "Impressions & CPM", "Engagement (CTR/VTR)", "Top Campaigns", "Publisher Insights", "Audience Insights", "Recommendations"]
              : ["Executive Summary", "Revenue & ROAS", "Conversion Analysis", "Spend Efficiency", "Top Campaigns", "Underperformers", "Audience Performance", "Recommendations"]
            ).map(s => (
              <span key={s} className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${aiReportType === "awareness" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-green-50 border-green-200 text-green-700"}`}>{s}</span>
            ))}
          </div>

          {/* Generate button */}
          <button
            onClick={handleAiReport}
            disabled={!dataReady || aiReportLoading}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white transition disabled:opacity-40 disabled:cursor-not-allowed ${aiReportType === "awareness" ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}`}
          >
            <Sparkles className="w-4 h-4" />
            {aiReportLoading ? "Generating report…" : `Generate ${aiReportType === "awareness" ? "Awareness" : "Sales"} Report`}
            <span className="text-white/70 font-normal text-xs">~${toDisplayCredits(0.013).toFixed(2)} credits</span>
          </button>

          {aiReportError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{aiReportError}</div>
          )}
        </div>

        {/* Report output */}
        {aiReport && (
          <div ref={aiReportRef} className="border-t border-gray-100">
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {aiReportType === "awareness" ? "Awareness" : "Sales"} Report · {startDate} – {endDate}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
                >
                  {aiCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {aiCopied ? "Copied!" : "Copy Markdown"}
                </button>
                <button
                  onClick={() => { const w = window.open("","_blank"); if(w){w.document.write(`<pre style="font-family:sans-serif;white-space:pre-wrap;padding:32px;max-width:900px;margin:auto">${aiReport.replace(/</g,"&lt;")}</pre>`);w.document.close();} }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
              </div>
            </div>
            <div className="px-5 py-5 prose prose-sm max-w-none text-gray-800 leading-relaxed">
              {aiReport.split("\n").map((line, i) => {
                if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold text-gray-900 mt-5 mb-2 pb-1 border-b border-gray-100">{line.replace("## ","")}</h2>;
                if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-bold text-gray-800 mt-3 mb-1">{line.replace("### ","")}</h3>;
                if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="ml-4 text-sm text-gray-700">{line.replace(/^[-*] /,"")}</li>;
                if (/^\d+\./.test(line)) return <li key={i} className="ml-4 text-sm text-gray-700 list-decimal">{line.replace(/^\d+\.\s*/,"")}</li>;
                if (line.startsWith("|")) return <div key={i} className="font-mono text-xs text-gray-700 leading-relaxed">{line}</div>;
                if (line.trim() === "") return <div key={i} className="h-2" />;
                return <p key={i} className="text-sm text-gray-700 leading-relaxed">{line.replace(/\*\*(.+?)\*\*/g, "$1")}</p>;
              })}
            </div>
          </div>
        )}
      </div>

      {/* PDF preview hint */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">PDF Report Structure</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Cover + Date Range", always: true },
            { label: "KPI Summary (9 metrics)", always: true },
            ...(sections.has("campaigns")    ? [{ label: "Campaign Performance Table", always: false }] : []),
            ...(sections.has("placement")    ? [{ label: "Publisher Placement Breakdown", always: false }] : []),
            ...(sections.has("demographics") ? [{ label: "Age Demographics", always: false }] : []),
            ...(sections.has("demographics") ? [{ label: "Gender Split", always: false }] : []),
            ...(sections.has("attribution")  ? [{ label: "Attribution Windows", always: false }] : []),
            { label: "Generated Timestamp", always: true },
          ].map((item, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                item.always ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${item.always ? "bg-blue-500" : "bg-gray-400"}`} />
              {item.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Blue = always included · White = based on section selection above
        </p>
      </div>
    </div>
  );
}
