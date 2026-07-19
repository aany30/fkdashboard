/**
 * PdfReportPages — landscape 16:9 agency-deck report, rendered to a real
 * vector PDF server-side via Puppeteer's page.pdf() (see /api/reporting/pdf).
 *
 * Design language mirrors a professional media-review deck:
 *   • Cover: dark navy, brand pill, filter cards, KPI cards w/ trend badges
 *   • Content pages: light theme, dark header bar, 2×2 grid of white cards
 *     with colored icon badges, hand-rolled SVG/CSS charts, callout boxes.
 *
 * Constraints (static markup, no client JS):
 *   • No Recharts/ResponsiveContainer — all charts are inline SVG / CSS.
 *   • All colors explicit hex. lucide-react icons render to SVG fine here.
 *   • Each page is PDF_W×PDF_H with pageBreakAfter.
 */

import React from "react";
import {
  Calendar, MapPin, Share2, Wallet, Target, TrendingUp, Users, Image as ImageIcon,
  Layers, BarChart3, PieChart, Film, Activity, Award, AlertTriangle, Lightbulb,
  Globe, Megaphone, Filter, DollarSign, Zap, CheckCircle2, Eye, MousePointer,
} from "lucide-react";
import { formatMoney } from "@/lib/currency";
import type { CampaignData } from "@/types/index";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";

export const PDF_W = 1280;
export const PDF_H = 720;

// ── Palette ───────────────────────────────────────────────────────────────────
const INDIGO = "#6366F1";
const INDIGO_D = "#4F46E5";
const GREEN  = "#10B981";
const GREEN_D = "#059669";
const ORANGE = "#F59E0B";
const PINK   = "#EC4899";
const RED    = "#EF4444";
const BLUE   = "#3B82F6";

const PAGE_BG = "#EEF1F6";   // light slide bg
const CARD    = "#FFFFFF";
const CARD_BORDER = "#E5E9F0";
const HEADER_BG = "#0B1220"; // dark header bar
const NAVY    = "#0A0F28";   // cover bg
const NAVY2   = "#0E1533";

const TEXT    = "#1E293B";
const MUTED   = "#64748B";
const FAINT   = "#94A3B8";
const TRACK   = "#EEF1F6";   // bar track

const SERIES = [INDIGO, GREEN, ORANGE, PINK, RED, BLUE];

type Px = React.CSSProperties;
type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const page: Px = {
  width: PDF_W, height: PDF_H, position: "relative", overflow: "hidden",
  backgroundColor: PAGE_BG, color: TEXT, boxSizing: "border-box", lineHeight: 1.2,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  pageBreakAfter: "always", breakAfter: "page",
};

// ── Number helpers ──────────────────────────────────────────────────────────
const fmtInt = (n: number) => Math.round(n || 0).toLocaleString("en-IN");
const fmtBig = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}K`
  : fmtInt(n);
const pctStr = (a: number, b: number, dp = 2) => (b > 0 ? `${((a / b) * 100).toFixed(dp)}%` : "—");
const ratio = (a: number, b: number, suffix = "×") => (b > 0 && a > 0 ? `${(a / b).toFixed(2)}${suffix}` : "—");

// ─────────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────────

function IconBadge({ Icon, color, size = 34 }: { Icon: IconType; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 9, background: color,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <Icon size={size * 0.5} color="#FFFFFF" strokeWidth={2.4} />
    </div>
  );
}

function SlideHeader({ num, title, badge, rightText, Icon }: {
  num: number; title: string; badge?: string; rightText?: string; Icon: IconType;
}) {
  return (
    <div style={{
      height: 64, background: HEADER_BG, display: "flex", alignItems: "center",
      padding: "0 36px", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Icon size={26} color="#FFFFFF" strokeWidth={2.2} />
        <span style={{ fontSize: 23, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.01em" }}>
          {num}. {title}
        </span>
        {badge && (
          <span style={{
            marginLeft: 6, background: "#2A2F52", color: "#C7CBF0",
            fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 14,
            textAlign: "center", lineHeight: 1.15,
          }}>{badge}</span>
        )}
      </div>
      {rightText && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#8B93B8", fontSize: 13 }}>
          <Calendar size={14} color="#8B93B8" />
          {rightText}
        </div>
      )}
    </div>
  );
}

function Card({ Icon, color, title, rightLabel, children, style }: {
  Icon: IconType; color: string; title: string; rightLabel?: string;
  children: React.ReactNode; style?: Px;
}) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
      padding: "16px 18px", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
      display: "flex", flexDirection: "column", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <IconBadge Icon={Icon} color={color} />
        <span style={{ marginLeft: 11, fontSize: 16, fontWeight: 800, color: TEXT }}>{title}</span>
        {rightLabel && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: INDIGO_D }}>{rightLabel}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Callout({ variant, label, text }: { variant: "insight" | "optimization"; label: string; text: string }) {
  const accent = variant === "insight" ? ORANGE : GREEN;
  const bg = variant === "insight" ? "#FEF9EC" : "#ECFDF5";
  const Ico = variant === "insight" ? Lightbulb : CheckCircle2;
  return (
    <div style={{
      background: bg, borderLeft: `3px solid ${accent}`, borderRadius: 6,
      padding: "9px 12px", display: "flex", gap: 8, alignItems: "flex-start", marginTop: "auto",
    }}>
      <Ico size={14} color={accent} strokeWidth={2.5} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.45 }}>
        <span style={{ fontWeight: 800, color: accent === ORANGE ? "#B45309" : GREEN_D }}>{label}: </span>
        {text}
      </div>
    </div>
  );
}

function StatTile({ label, value, color = TEXT, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: FAINT, letterSpacing: "0.06em", marginBottom: 5 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: FAINT, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────
function MiniTable({ headers, rows, aligns, maxRows = 8 }: {
  headers: string[]; rows: (string | number)[][]; aligns?: ("l" | "r")[]; maxRows?: number;
}) {
  const shown = rows.slice(0, maxRows);
  const al = (i: number) => (aligns?.[i] === "r" || (aligns === undefined && i > 0) ? "right" : "left");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} style={{
              textAlign: al(i), padding: "6px 8px", color: MUTED, fontWeight: 700,
              fontSize: 10, letterSpacing: "0.04em", borderBottom: `1.5px solid ${CARD_BORDER}`, whiteSpace: "nowrap",
            }}>{h.toUpperCase()}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td key={ci} style={{
                textAlign: al(ci), padding: "6px 8px",
                color: ci === 0 ? TEXT : "#475569", fontWeight: ci === 0 ? 600 : 500,
                borderBottom: `1px solid #F1F5F9`, whiteSpace: "nowrap",
              }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Horizontal bar chart (CSS) ───────────────────────────────────────────────
function HBarChart({ data, valueRight }: {
  data: { label: string; value: number; color?: string }[];
  valueRight?: (v: number, pct: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {data.map((d, i) => {
        const w = (d.value / max) * 100;
        const pct = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 56, fontSize: 11, fontWeight: 600, color: TEXT, textAlign: "right" }}>{d.label}</div>
            <div style={{ flex: 1, height: 16, background: TRACK, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ width: `${w}%`, height: "100%", background: d.color || SERIES[i % SERIES.length], borderRadius: 8 }} />
            </div>
            <div style={{ width: 64, fontSize: 11, fontWeight: 700, color: "#334155", textAlign: "right" }}>
              {valueRight ? valueRight(d.value, pct) : `${pct.toFixed(0)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vertical bar chart (CSS) ─────────────────────────────────────────────────
function VBarChart({ data, height = 150, fmt }: {
  data: { label: string; value: number; color?: string }[]; height?: number; fmt?: (v: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height, paddingTop: 18 }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * (height - 36));
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
              {fmt ? fmt(d.value) : fmtBig(d.value)}
            </div>
            <div style={{ width: "100%", maxWidth: 54, height: h, background: d.color || SERIES[i % SERIES.length], borderRadius: "6px 6px 0 0" }} />
            <div style={{ fontSize: 10, color: MUTED, marginTop: 6, textAlign: "center", lineHeight: 1.2 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Line chart (inline SVG, per-series independent scaling) ──────────────────
function LineChartSVG({ series, labels, width = 540, height = 170, area = false }: {
  series: { name: string; color: string; points: number[] }[];
  labels: string[]; width?: number; height?: number; area?: boolean;
}) {
  const padL = 8, padR = 8, padT = 12, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(labels.length, 1);
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* gridlines */}
      {[0, 0.5, 1].map((g, i) => (
        <line key={i} x1={padL} x2={width - padR} y1={padT + g * innerH} y2={padT + g * innerH}
          stroke="#EDF1F7" strokeWidth={1} />
      ))}
      {series.map((s, si) => {
        const max = Math.max(...s.points, 1);
        const min = Math.min(...s.points, 0);
        const span = max - min || 1;
        const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;
        const pts = s.points.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const areaPts = `${padL},${padT + innerH} ${pts} ${width - padR},${padT + innerH}`;
        return (
          <g key={si}>
            {area && si === 0 && (
              <polygon points={areaPts} fill={s.color} fillOpacity={0.12} />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2.4}
              strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={s.color} />
            ))}
          </g>
        );
      })}
      {/* x labels */}
      {labels.map((l, i) => (
        (i === 0 || i === labels.length - 1 || i % Math.ceil(labels.length / 6) === 0) && (
          <text key={i} x={x(i)} y={height - 6} fontSize={9} fill={FAINT}
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{l}</text>
        )
      ))}
    </svg>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: MUTED, fontWeight: 600 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color }} />
          {it.name}
        </div>
      ))}
    </div>
  );
}

// ── Donut chart (inline SVG) ─────────────────────────────────────────────────
function DonutSVG({ data, size = 150 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 8;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {data.map((d, i) => {
          const frac = d.value / total;
          const len = frac * circ;
          const seg = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color}
              strokeWidth={16} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

// ── Funnel strip ──────────────────────────────────────────────────────────────
function FunnelStrip({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const next = i < stages.length - 1 ? stages[i + 1] : null;
        const dropNext = next && s.value > 0 ? (1 - next.value / s.value) * 100 : null;
        return (
          <React.Fragment key={i}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "100%", background: s.color, borderRadius: 10, padding: "14px 8px",
                textAlign: "center", color: "#FFFFFF",
              }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>{fmtBig(s.value)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.95, marginTop: 3 }}>{s.label}</div>
              </div>
              {i > 0 && prev && prev > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginTop: 6 }}>
                  {pctStr(s.value, prev, 1)} <span style={{ color: FAINT }}>pass-through</span>
                </div>
              )}
            </div>
            {next && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 6px", minWidth: 64 }}>
                <div style={{ fontSize: 18, color: FAINT, marginBottom: 4 }}>›</div>
                {dropNext !== null && (
                  <div style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 9.5, fontWeight: 800, padding: "3px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>
                    -{dropNext.toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PageFooter({ dateRange, pageNum, total }: { dateRange: string; pageNum: number; total: number }) {
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, height: 26,
      background: "#E2E7EF", display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 36px",
    }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: FAINT, letterSpacing: "0.06em" }}>AUDITOR · AD PERFORMANCE REPORT</span>
      <span style={{ fontSize: 9.5, color: FAINT }}>{dateRange}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: FAINT }}>{pageNum} / {total}</span>
    </div>
  );
}

// Body wrapper: 2×2 grid area beneath the header
function Body({ children, cols = "1fr 1fr", rows = "1fr 1fr" }: { children: React.ReactNode; cols?: string; rows?: string }) {
  return (
    <div style={{
      position: "absolute", top: 64, left: 0, right: 0, bottom: 26,
      padding: 24, display: "grid", gridTemplateColumns: cols, gridTemplateRows: rows, gap: 16,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data shapes + helpers
// ─────────────────────────────────────────────────────────────────────────────

export type BreakdownRow = {
  label: string; spend: number; impressions: number; clicks: number;
  conversions: number; conversionValue: number;
};

interface WeekBucket {
  label: string; spend: number; impressions: number; clicks: number;
  conversions: number; conversionValue: number; cpm: number; ctr: number; cpc: number;
}

function weeklyBuckets(daily: BreakdownRow[]): WeekBucket[] {
  if (!daily || daily.length === 0) return [];
  const sorted = [...daily].sort((a, b) => a.label.localeCompare(b.label));
  const out: WeekBucket[] = [];
  for (let i = 0; i < sorted.length; i += 7) {
    const chunk = sorted.slice(i, i + 7);
    const spend = chunk.reduce((s, r) => s + (r.spend || 0), 0);
    const impressions = chunk.reduce((s, r) => s + (r.impressions || 0), 0);
    const clicks = chunk.reduce((s, r) => s + (r.clicks || 0), 0);
    const conversions = chunk.reduce((s, r) => s + (r.conversions || 0), 0);
    const conversionValue = chunk.reduce((s, r) => s + (r.conversionValue || 0), 0);
    out.push({
      label: `W${out.length + 1}`, spend, impressions, clicks, conversions, conversionValue,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
    });
  }
  return out;
}

const cleanLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfReportPagesProps {
  campaigns: CampaignData[];
  pubRows: BreakdownRow[];
  ageRows: BreakdownRow[];
  genderRows: BreakdownRow[];
  countryRows: BreakdownRow[];
  deviceRows: BreakdownRow[];
  dailyRows: BreakdownRow[];
  regionRows: BreakdownRow[];
  adRows: AdInsightRow[];
  currency: string;
  startDate: string;
  endDate: string;
  platform: string;
  // Customization (optional — defaults to a full "sales"-style standard deck).
  objective?: ReportObjective;
  length?: ReportLength;
  narrative?: ReportNarrative | null;
  tracking?: TrackingSnapshot | null;
  /** Which sections to include (ids: ai, campaigns, audience, creative,
   *  placement, budget, funnel, tracking). Undefined = all. */
  sections?: string[];
}

export type ReportObjective = "awareness" | "sales" | "traffic" | "lead";
export type ReportLength = "concise" | "standard" | "detailed";
export interface ReportNarrative {
  execSummary: string;
  highlights: string[];
  sectionInsights: Array<{ section: string; text: string }>;
  recommendations: string[];
}
export interface TrackingSnapshot {
  activePixels?: string;
  capiSharePct?: number;
  emqScore?: number;
  totalEvents?: number;
  avgFrequency?: number;
  accountStructure?: { campaigns: number; adSets: number };
  attribution?: Array<{ name: string; clickLookbackDays: number; viewLookbackDays: number }>;
  funnel?: Array<{ stage: string; value: number }>;
}

const OBJECTIVE_TITLE: Record<ReportObjective, { title: string; sub: string }> = {
  awareness: { title: "Brand Awareness Review", sub: "Reach, Frequency & Impression Efficiency" },
  sales:     { title: "Sales & ROI Review", sub: "Revenue, ROAS & Conversion Performance" },
  traffic:   { title: "Traffic & Engagement Review", sub: "Clicks, CTR & Cost-per-Click Efficiency" },
  lead:      { title: "Lead Generation Review", sub: "Leads, Cost-per-Lead & Conversion Rate" },
};

/** Objective-aware KPI cards for the cover (all values from real data). */
function objectiveKpis(
  objective: ReportObjective,
  d: { spend: number; impr: number; clicks: number; conv: number; rev: number; reach: number; views: number },
  currency: string,
): Array<{ label: string; value: string; trend: string; good: boolean; Icon: IconType }> {
  const cur0 = (n: number) => formatMoney(n, currency, 0);
  const roas = d.spend > 0 && d.rev > 0 ? d.rev / d.spend : 0;
  const ctr = d.impr > 0 ? (d.clicks / d.impr) * 100 : 0;
  const cpm = d.impr > 0 ? (d.spend / d.impr) * 1000 : 0;
  const cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
  const cpa = d.conv > 0 ? d.spend / d.conv : 0;
  const freq = d.reach > 0 ? d.impr / d.reach : 0;
  const cvr = d.clicks > 0 ? (d.conv / d.clicks) * 100 : 0;

  if (objective === "awareness") return [
    { label: "Impressions", value: fmtBig(d.impr), trend: `${cur0(d.spend)} spend`, good: true, Icon: Eye as IconType },
    { label: "Reach", value: d.reach > 0 ? fmtBig(d.reach) : "—", trend: d.reach > 0 ? "↑ Unique users" : "No reach data", good: d.reach > 0, Icon: Users as IconType },
    { label: "Frequency", value: freq > 0 ? `${freq.toFixed(2)}×` : "—", trend: freq > 5 ? "↓ Too high" : freq >= 1.5 ? "→ Healthy" : "↑ Low", good: freq >= 1.5 && freq <= 5, Icon: Activity as IconType },
    { label: "CPM", value: d.impr > 0 ? cur0(cpm) : "—", trend: "Cost / 1k impr", good: true, Icon: TrendingUp as IconType },
  ];
  if (objective === "traffic") return [
    { label: "Clicks", value: fmtBig(d.clicks), trend: `${cur0(d.spend)} spend`, good: true, Icon: MousePointer as IconType },
    { label: "CTR", value: d.impr > 0 ? `${ctr.toFixed(2)}%` : "—", trend: ctr >= 1 ? "↑ Strong" : "→ Monitor", good: ctr >= 1, Icon: Activity as IconType },
    { label: "CPC", value: d.clicks > 0 ? formatMoney(cpc, currency, 2) : "—", trend: "Cost / click", good: true, Icon: Wallet as IconType },
    { label: "Impressions", value: fmtBig(d.impr), trend: `${fmtBig(d.reach)} reach`, good: true, Icon: Eye as IconType },
  ];
  if (objective === "lead") return [
    { label: "Leads", value: fmtInt(d.conv), trend: d.conv > 0 ? "↑ Generating" : "↓ None", good: d.conv > 0, Icon: Target as IconType },
    { label: "Cost / Lead", value: d.conv > 0 ? cur0(cpa) : "—", trend: "CPL", good: d.conv > 0, Icon: Wallet as IconType },
    { label: "Conv. Rate", value: d.clicks > 0 ? `${cvr.toFixed(2)}%` : "—", trend: cvr >= 2 ? "↑ Strong" : "→ Monitor", good: cvr >= 2, Icon: Activity as IconType },
    { label: "Total Spend", value: cur0(d.spend), trend: `${fmtInt(d.clicks)} clicks`, good: true, Icon: TrendingUp as IconType },
  ];
  // sales (default)
  return [
    { label: "Total Spend", value: cur0(d.spend), trend: `${fmtInt(d.conv)} conversions`, good: true, Icon: Wallet as IconType },
    { label: "Conversions", value: fmtInt(d.conv), trend: d.conv > 0 ? "↑ Converting" : "↓ None", good: d.conv > 0, Icon: Target as IconType },
    { label: "Revenue", value: cur0(d.rev), trend: d.rev > 0 ? "↑ Tracked" : "↓ No value", good: d.rev > 0, Icon: TrendingUp as IconType },
    { label: "ROAS", value: roas > 0 ? `${roas.toFixed(2)}×` : "—", trend: roas >= 2 ? "↑ Strong" : roas >= 1 ? "→ Monitor" : "↓ Needs lift", good: roas >= 1, Icon: Zap as IconType },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Cover (dark)
// ─────────────────────────────────────────────────────────────────────────────

function CoverPage(p: PdfReportPagesProps) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const spend = p.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const impr  = p.campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks = p.campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conv  = p.campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const rev   = p.campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const roas  = spend > 0 && rev > 0 ? rev / spend : 0;

  const reach = p.campaigns.reduce((s, c) => s + (c.reach || 0), 0);
  const views = p.campaigns.reduce((s, c) => s + (c.videoViews || 0), 0);
  const objective: ReportObjective = p.objective ?? "sales";
  const heading = OBJECTIVE_TITLE[objective];

  const platformLabel = p.platform === "meta" ? "Meta (FB/IG)" : p.platform === "dv360" ? "DV360" : "Meta + DV360";

  const filters = [
    { Icon: Calendar as IconType, color: INDIGO, label: "Period", value: `${p.startDate} – ${p.endDate}` },
    { Icon: Globe as IconType, color: GREEN, label: "Platform", value: platformLabel },
    { Icon: Share2 as IconType, color: ORANGE, label: "Campaigns", value: String(p.campaigns.length) },
  ];

  const kpis = objectiveKpis(objective, { spend, impr, clicks, conv, rev, reach, views }, p.currency);
  void roas;

  return (
    <div data-pdf-page="1" style={{ ...page, backgroundColor: NAVY, color: "#FFFFFF" }}>
      {/* glow */}
      <div style={{ position: "absolute", top: -160, right: -120, width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${INDIGO} 0%, transparent 70%)`, opacity: 0.16 }} />
      <div style={{ position: "absolute", bottom: -120, left: -80, width: 360, height: 360, borderRadius: "50%", background: `radial-gradient(circle, ${PINK} 0%, transparent 70%)`, opacity: 0.1 }} />

      <div style={{ position: "relative", padding: "44px 52px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* brand row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#7C84B0", fontWeight: 600, letterSpacing: "0.1em" }}>
            {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
          </span>
          <div style={{ background: NAVY2, border: "1px solid #232A52", borderRadius: 20, padding: "8px 18px" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.18em" }}>AUDITOR</span>
          </div>
        </div>

        {/* title */}
        <div style={{ marginTop: 56 }}>
          <div style={{ fontSize: 54, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{heading.title}</div>
          <div style={{ fontSize: 19, color: "#9098C4", marginTop: 14, fontWeight: 400 }}>{heading.sub}</div>
        </div>

        {/* filter cards */}
        <div style={{ display: "flex", gap: 16, marginTop: 36 }}>
          {filters.map((f, i) => (
            <div key={i} style={{ background: NAVY2, border: "1px solid #1E2547", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 13, minWidth: 230 }}>
              <IconBadge Icon={f.Icon} color={f.color} size={38} />
              <div>
                <div style={{ fontSize: 11, color: "#7C84B0", marginBottom: 3 }}>{f.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF" }}>{f.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: "auto" }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ background: NAVY2, border: "1px solid #1E2547", borderRadius: 14, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: SERIES[i % SERIES.length] }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "#8A92BE", fontWeight: 600 }}>{k.label}</span>
                <k.Icon size={16} color="#5B628F" />
              </div>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#FFFFFF", marginBottom: 10 }}>{k.value}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: k.good ? "#34D399" : "#FB7185" }}>{k.trend}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 26, marginTop: 22, paddingTop: 16, borderTop: "1px solid #1A2044" }}>
          {[
            ["Impressions", fmtBig(impr)],
            ["Clicks", fmtBig(clicks)],
            ["CTR", pctStr(clicks, impr)],
            ["CPM", impr > 0 ? cur0(spend / impr * 1000) : "—"],
            ["CPC", clicks > 0 ? formatMoney(spend / clicks, p.currency, 2) : "—"],
          ].map(([l, v], i) => (
            <div key={i}>
              <div style={{ fontSize: 10, color: "#6B72A0", marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {/* accent bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg, ${INDIGO}, ${PINK})` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Budget Utilization & Trend
// ─────────────────────────────────────────────────────────────────────────────

function BudgetPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const weeks = weeklyBuckets(p.dailyRows);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const totalSpend = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalRev = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);

  const budgetRows = sorted.slice(0, 6).map(c => {
    const monthly = (c.dailyBudget || 0) * 30;
    const util = monthly > 0 ? pctStr(c.spend || 0, monthly, 0) : "—";
    return [
      c.name.length > 26 ? c.name.slice(0, 26) + "…" : c.name,
      c.dailyBudget ? cur0(c.dailyBudget) + "/d" : "—",
      cur0(c.spend || 0),
      util,
    ];
  });

  const avgWoW = weeks.length > 1
    ? ((weeks[weeks.length - 1].spend - weeks[0].spend) / (weeks[0].spend || 1)) * 100
    : 0;

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Budget Utilization & Trend" badge="Spend Analysis" rightText={`${p.startDate} – ${p.endDate}`} Icon={Wallet as IconType} />
      <Body>
        <Card Icon={DollarSign as IconType} color={INDIGO} title="Budget vs Spend" rightLabel="Top 6 by spend">
          <MiniTable
            headers={["Campaign", "Daily Budget", "Spend", "Util."]}
            rows={budgetRows}
            maxRows={6}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto", paddingTop: 12 }}>
            <StatTile label="Total Spend" value={cur0(totalSpend)} color={INDIGO_D} />
            <StatTile label="Revenue" value={cur0(totalRev)} color={GREEN_D} />
          </div>
        </Card>

        <Card Icon={Activity as IconType} color={GREEN} title="Weekly Spend & Revenue" rightLabel={weeks.length ? `${weeks.length} weeks` : undefined}>
          {weeks.length > 0 ? (
            <>
              <Legend items={[{ name: "Spend", color: INDIGO }, { name: "Revenue", color: GREEN }]} />
              <LineChartSVG
                width={560} height={180}
                labels={weeks.map(w => w.label)}
                series={[
                  { name: "Spend", color: INDIGO, points: weeks.map(w => w.spend) },
                  { name: "Revenue", color: GREEN, points: weeks.map(w => w.conversionValue) },
                ]}
              />
            </>
          ) : <EmptyNote text="No daily time-series available for this range." />}
        </Card>

        <Card Icon={BarChart3 as IconType} color={ORANGE} title="Week-on-Week Performance">
          {weeks.length > 0 ? (
            <div style={{ display: "flex", gap: 10 }}>
              {weeks.slice(0, 6).map((w, i) => {
                const prev = i > 0 ? weeks[i - 1].spend : null;
                const chg = prev && prev > 0 ? ((w.spend - prev) / prev) * 100 : null;
                return (
                  <div key={i} style={{ flex: 1, background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "10px 6px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: FAINT, marginBottom: 5 }}>{w.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{fmtInt(w.conversions)}</div>
                    <div style={{ fontSize: 8.5, color: FAINT, margin: "2px 0 4px" }}>conv</div>
                    {chg !== null && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? GREEN_D : RED }}>
                        {chg >= 0 ? "+" : ""}{chg.toFixed(0)}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <EmptyNote text="No weekly data." />}
          {weeks.length > 1 && (
            <Callout variant="insight" label="Trend" text={`Weekly spend ${avgWoW >= 0 ? "grew" : "declined"} ${Math.abs(avgWoW).toFixed(0)}% from first to last week of the period.`} />
          )}
        </Card>

        <Card Icon={TrendingUp as IconType} color={PINK} title="Weekly Revenue">
          {weeks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {weeks.slice(0, 6).map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: `1px solid ${CARD_BORDER}` }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{w.label}</span>
                    <span style={{ fontSize: 10, color: FAINT, marginLeft: 8 }}>{fmtInt(w.conversions)} conv · {fmtBig(w.impressions)} impr</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: GREEN_D }}>{cur0(w.conversionValue)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No revenue trend data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: FAINT, fontSize: 12, fontStyle: "italic", textAlign: "center", padding: 16 }}>
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Campaign Performance
// ─────────────────────────────────────────────────────────────────────────────

function CampaignPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const best = [...sorted].filter(c => (c.conversions || 0) > 0)
    .sort((a, b) => ((b.conversionValue || 0) / (b.spend || 1)) - ((a.conversionValue || 0) / (a.spend || 1)))[0] || sorted[0];
  const worst = [...sorted].filter(c => (c.spend || 0) > 0 && c !== best)
    .sort((a, b) => ((a.conversionValue || 0) / (a.spend || 1)) - ((b.conversionValue || 0) / (b.spend || 1)))[0];

  const perfCard = (c: CampaignData, kind: "best" | "worst") => {
    const good = kind === "best";
    const accent = good ? GREEN : RED;
    const bg = good ? "#ECFDF5" : "#FEF2F2";
    const roasV = (c.spend || 0) > 0 && (c.conversionValue || 0) > 0 ? ((c.conversionValue || 0) / (c.spend || 1)) : 0;
    const metrics: [string, string][] = [
      ["Spend", cur0(c.spend || 0)],
      ["Conversions", fmtInt(c.conversions || 0)],
      ["ROAS", roasV > 0 ? `${roasV.toFixed(2)}×` : "—"],
      ["CPA", (c.conversions || 0) > 0 ? cur0((c.spend || 0) / (c.conversions || 1)) : "—"],
      ["Clicks", fmtInt(c.clicks || 0)],
      ["CTR", pctStr(c.clicks || 0, c.impressions || 0)],
    ];
    return (
      <div style={{ background: bg, border: `1px solid ${accent}33`, borderRadius: 10, padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {good ? <Award size={15} color={accent} /> : <AlertTriangle size={15} color={accent} />}
          <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: "0.06em" }}>
            {good ? "BEST PERFORMER" : "UNDERPERFORMING"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, marginBottom: 10, lineHeight: 1.3 }}>
          {c.name.length > 38 ? c.name.slice(0, 38) + "…" : c.name}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {metrics.map(([k, v]) => (
            <div key={k} style={{ background: "#FFFFFF", borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 8.5, color: FAINT, marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const tableRows = sorted.slice(0, 9).map(c => {
    const sp = c.spend || 0, rev = c.conversionValue || 0;
    return [
      c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
      cur0(sp), fmtBig(c.impressions || 0), pctStr(c.clicks || 0, c.impressions || 0),
      fmtInt(c.conversions || 0), ratio(rev, sp), (c.conversions || 0) > 0 ? cur0(sp / (c.conversions || 1)) : "—",
    ];
  });

  // comparison chart: best vs worst conversions
  const compData = [best, worst].filter(Boolean).map((c, i) => ({
    label: i === 0 ? "Best" : "Underperf.", value: c!.conversions || 0, color: i === 0 ? GREEN : RED,
  }));

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Campaign Performance" badge="Best vs Underperforming" rightText={`${p.startDate} – ${p.endDate}`} Icon={Megaphone as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Award as IconType} color={GREEN} title="Best vs Underperforming" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {best && perfCard(best, "best")}
            {worst && perfCard(worst, "worst")}
          </div>
        </Card>

        <Card Icon={BarChart3 as IconType} color={INDIGO} title="All Campaigns" rightLabel={`${sorted.length} total`}>
          <MiniTable
            headers={["Campaign", "Spend", "Impr.", "CTR", "Conv.", "ROAS", "CPA"]}
            rows={tableRows}
            maxRows={9}
          />
        </Card>

        <Card Icon={PieChart as IconType} color={ORANGE} title="Conversions: Best vs Underperforming">
          {compData.length > 0 ? (
            <VBarChart data={compData} height={190} fmt={(v) => fmtInt(v)} />
          ) : <EmptyNote text="Not enough campaigns to compare." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Funnel & Objective
// ─────────────────────────────────────────────────────────────────────────────

function FunnelPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const impr = p.campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks = p.campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conv = p.campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const spend = p.campaigns.reduce((s, c) => s + (c.spend || 0), 0);

  const objMap = new Map<string, { spend: number; conv: number; rev: number; camps: number }>();
  p.campaigns.forEach(c => {
    const o = (c.objective || "Unknown").replace(/OUTCOME_/, "");
    const r = objMap.get(o) || { spend: 0, conv: 0, rev: 0, camps: 0 };
    r.spend += c.spend || 0; r.conv += c.conversions || 0; r.rev += c.conversionValue || 0; r.camps++;
    objMap.set(o, r);
  });
  const objRows = [...objMap.entries()].sort((a, b) => b[1].spend - a[1].spend).map(([o, r]) => [
    o, String(r.camps), cur0(r.spend), fmtInt(r.conv), ratio(r.rev, r.spend), r.conv > 0 ? cur0(r.spend / r.conv) : "—",
  ]);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Funnel & Objective Performance" badge="Conversion Efficiency" rightText={`${p.startDate} – ${p.endDate}`} Icon={Filter as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Filter as IconType} color={INDIGO} title="Ad Delivery Funnel" rightLabel="Impressions → Clicks → Conversions" style={{ gridColumn: "1 / 3" }}>
          <FunnelStrip stages={[
            { label: "Impressions", value: impr, color: INDIGO },
            { label: "Clicks", value: clicks, color: GREEN },
            { label: "Conversions", value: conv, color: PINK },
          ]} />
        </Card>

        <Card Icon={Activity as IconType} color={GREEN} title="Efficiency Metrics">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile label="CTR (Impr→Click)" value={pctStr(clicks, impr)} color={INDIGO_D} />
            <StatTile label="CVR (Click→Conv)" value={pctStr(conv, clicks)} color={GREEN_D} />
            <StatTile label="CPA" value={conv > 0 ? cur0(spend / conv) : "—"} color={ORANGE} />
            <StatTile label="End-to-End" value={pctStr(conv, impr, 3)} color={PINK} />
          </div>
          <Callout variant="insight" label="Note" text="This is the real ad-delivery funnel from Meta (impressions → link clicks → conversions). On-site stages (add-to-cart, checkout) are not exposed by the API." />
        </Card>

        <Card Icon={Target as IconType} color={ORANGE} title="Performance by Objective" rightLabel={`${objRows.length} objectives`}>
          <MiniTable
            headers={["Objective", "Camps", "Spend", "Conv.", "ROAS", "CPA"]}
            rows={objRows}
            maxRows={7}
          />
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Audience & Geography
// ─────────────────────────────────────────────────────────────────────────────

function AudiencePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const ageSorted = [...p.ageRows].sort((a, b) => b.spend - a.spend).slice(0, 6);
  const ageDonut = ageSorted.map((r, i) => ({ label: r.label, value: r.spend, color: SERIES[i % SERIES.length] }));
  const ageTop = ageSorted[0];
  const ageTotal = ageSorted.reduce((s, r) => s + r.spend, 0);

  const genSorted = [...(p.genderRows as BreakdownRow[])].sort((a, b) => b.spend - a.spend).slice(0, 3);
  const genTotal = genSorted.reduce((s, r) => s + r.spend, 0);

  const geoRows = (p.regionRows.length > 0 ? p.regionRows : p.countryRows);
  const geoSorted = [...geoRows].sort((a, b) => b.spend - a.spend).slice(0, 6);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Audience Demographics & Geography" badge="Top Segments" rightText={`${p.startDate} – ${p.endDate}`} Icon={Users as IconType} />
      <Body>
        <Card Icon={Users as IconType} color={INDIGO} title="Age Distribution" rightLabel="By spend">
          {ageSorted.length > 0 ? (
            <>
              <HBarChart data={ageSorted.map((r, i) => ({ label: r.label, value: r.spend, color: SERIES[i % SERIES.length] }))} />
              {ageTop && (
                <Callout variant="insight" label="Key Insight" text={`The ${ageTop.label} bracket leads spend (${pctStr(ageTop.spend, ageTotal, 0)} of total), with ${fmtInt(ageTop.conversions)} conversions.`} />
              )}
            </>
          ) : <EmptyNote text="No age breakdown available." />}
        </Card>

        <Card Icon={PieChart as IconType} color={GREEN} title="Spend by Age" rightLabel="Share">
          {ageDonut.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <DonutSVG data={ageDonut} size={150} />
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {ageDonut.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                    <span style={{ color: TEXT, fontWeight: 600, width: 48 }}>{d.label}</span>
                    <span style={{ color: MUTED }}>{pctStr(d.value, ageTotal, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyNote text="No age data." />}
        </Card>

        <Card Icon={Users as IconType} color={PINK} title="Gender Split" rightLabel="By spend">
          {genSorted.length > 0 ? (
            <div style={{ display: "flex", gap: 12 }}>
              {genSorted.map((r, i) => (
                <div key={i} style={{ flex: 1, background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 10px", textAlign: "center", borderTop: `3px solid ${SERIES[i % SERIES.length]}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, textTransform: "capitalize", marginBottom: 6 }}>{r.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: SERIES[i % SERIES.length] }}>{pctStr(r.spend, genTotal, 0)}</div>
                  <div style={{ fontSize: 10, color: FAINT, marginTop: 5 }}>{cur0(r.spend)} · {fmtInt(r.conversions)} conv</div>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No gender data." />}
        </Card>

        <Card Icon={MapPin as IconType} color={ORANGE} title={p.regionRows.length > 0 ? "Top Regions" : "Top Countries"} rightLabel="By spend">
          {geoSorted.length > 0 ? (
            <VBarChart
              data={geoSorted.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) : r.label, value: r.spend, color: SERIES[i % SERIES.length] }))}
              height={180}
              fmt={(v) => cur0(v)}
            />
          ) : <EmptyNote text="No geographic data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Creative Performance
// ─────────────────────────────────────────────────────────────────────────────

function classifyCreative(row: AdInsightRow): "Video" | "Static" | "Carousel" {
  const t = (row.creativeType || "").toUpperCase();
  const n = row.name.toLowerCase();
  if (t === "CAROUSEL" || n.includes("carousel")) return "Carousel";
  if (t === "VIDEO" || t === "REEL" || n.includes("video") || n.includes("reel")) return "Video";
  return "Static";
}

function CreativePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);

  const groups: Record<string, { spend: number; impr: number; clicks: number; conv: number; rev: number; n: number }> = {};
  p.adRows.forEach(a => {
    const k = classifyCreative(a);
    const g = groups[k] || { spend: 0, impr: 0, clicks: 0, conv: 0, rev: 0, n: 0 };
    g.spend += a.spend || 0; g.impr += a.impressions || 0; g.clicks += a.clicks || 0;
    g.conv += a.conversions || 0; g.rev += a.conversionValue || 0; g.n++;
    groups[k] = g;
  });

  const formatCard = (name: string, color: string, Icon: IconType) => {
    const g = groups[name];
    if (!g) return null;
    const metrics: [string, string][] = [
      ["Ads", String(g.n)],
      ["Spend", cur0(g.spend)],
      ["Conv.", fmtInt(g.conv)],
      ["CTR", pctStr(g.clicks, g.impr)],
      ["CAC", g.conv > 0 ? cur0(g.spend / g.conv) : "—"],
      ["ROAS", ratio(g.rev, g.spend)],
    ];
    return (
      <div style={{ flex: 1, border: `1px solid ${color}33`, borderRadius: 10, padding: "12px 14px", background: `${color}0D` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <IconBadge Icon={Icon} color={color} size={28} />
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{name} Creatives</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {metrics.map(([k, v]) => (
            <div key={k} style={{ background: "#FFFFFF", borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 8.5, color: FAINT, marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const topAds = [...p.adRows].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 7).map(a => [
    a.name.length > 30 ? a.name.slice(0, 30) + "…" : a.name,
    classifyCreative(a),
    cur0(a.spend || 0),
    pctStr(a.clicks || 0, a.impressions || 0),
    fmtInt(a.conversions || 0),
    ratio(a.conversionValue || 0, a.spend || 0),
  ]);

  const effRows = (["Video", "Static", "Carousel"] as const)
    .filter(k => groups[k])
    .map(k => {
      const g = groups[k]!;
      return { name: k, roas: g.spend > 0 ? g.rev / g.spend : 0, color: k === "Video" ? INDIGO : k === "Static" ? ORANGE : PINK };
    });

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Creative Performance" badge="Video vs Static" rightText={`${p.startDate} – ${p.endDate}`} Icon={Film as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Layers as IconType} color={INDIGO} title="Performance by Creative Format" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {formatCard("Video", INDIGO, Film as IconType)}
            {formatCard("Static", ORANGE, ImageIcon as IconType)}
            {formatCard("Carousel", PINK, Layers as IconType)}
          </div>
        </Card>

        <Card Icon={Award as IconType} color={GREEN} title="Top Creatives" rightLabel="By spend">
          {topAds.length > 0 ? (
            <MiniTable
              headers={["Creative", "Type", "Spend", "CTR", "Conv.", "ROAS"]}
              rows={topAds}
              maxRows={7}
            />
          ) : <EmptyNote text="No ad-level creative data for this range." />}
        </Card>

        <Card Icon={Activity as IconType} color={ORANGE} title="Creative Effectiveness" rightLabel="ROAS by format">
          {effRows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {effRows.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: e.color }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{e.name} Creatives</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: e.roas >= 1 ? GREEN_D : RED }}>
                    {e.roas > 0 ? `${e.roas.toFixed(2)}× ROAS` : "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No creative data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Platform Metrics (weekly)
// ─────────────────────────────────────────────────────────────────────────────

function PlatformPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const cur2 = (n: number) => formatMoney(n, p.currency, 2);
  const weeks = weeklyBuckets(p.dailyRows);
  const labels = weeks.map(w => w.label);

  const avgCpm = weeks.length ? weeks.reduce((s, w) => s + w.cpm, 0) / weeks.length : 0;
  const avgCtr = weeks.length ? weeks.reduce((s, w) => s + w.ctr, 0) / weeks.length : 0;
  const avgCpc = weeks.length ? weeks.reduce((s, w) => s + w.cpc, 0) / weeks.length : 0;

  const tableRows = weeks.slice(0, 6).map(w => [
    w.label, cur0(w.spend), cur0(w.cpm), `${w.ctr.toFixed(2)}%`, cur2(w.cpc), fmtBig(w.clicks), fmtInt(w.conversions),
  ]);

  const pubSorted = [...p.pubRows].sort((a, b) => b.spend - a.spend);
  const pubTotal = pubSorted.reduce((s, r) => s + r.spend, 0);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Platform Metrics — Weekly" badge="CPM / CTR / CPC" rightText={`${p.startDate} – ${p.endDate}`} Icon={BarChart3 as IconType} />
      <Body>
        <Card Icon={Activity as IconType} color={INDIGO} title="CPM Trend" rightLabel="Cost / 1,000 impr">
          {weeks.length > 0 ? (
            <>
              <LineChartSVG width={540} height={170} area labels={labels} series={[{ name: "CPM", color: INDIGO, points: weeks.map(w => w.cpm) }]} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <StatTile label="Avg CPM" value={cur0(avgCpm)} color={INDIGO_D} />
                <StatTile label="Weeks" value={String(weeks.length)} />
              </div>
            </>
          ) : <EmptyNote text="No daily data for trend." />}
        </Card>

        <Card Icon={TrendingUp as IconType} color={GREEN} title="CTR & CPC Trends" rightLabel="Click performance">
          {weeks.length > 0 ? (
            <>
              <Legend items={[{ name: "CTR %", color: GREEN }, { name: "CPC", color: ORANGE }]} />
              <LineChartSVG width={540} height={170} labels={labels} series={[
                { name: "CTR", color: GREEN, points: weeks.map(w => w.ctr) },
                { name: "CPC", color: ORANGE, points: weeks.map(w => w.cpc) },
              ]} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <StatTile label="Avg CTR" value={`${avgCtr.toFixed(2)}%`} color={GREEN_D} />
                <StatTile label="Avg CPC" value={cur2(avgCpc)} color={ORANGE} />
              </div>
            </>
          ) : <EmptyNote text="No daily data for trend." />}
        </Card>

        <Card Icon={BarChart3 as IconType} color={ORANGE} title="Weekly Performance Data">
          {tableRows.length > 0 ? (
            <MiniTable
              headers={["Week", "Spend", "CPM", "CTR", "CPC", "Clicks", "Conv."]}
              rows={tableRows}
              maxRows={6}
            />
          ) : <EmptyNote text="No weekly data." />}
        </Card>

        <Card Icon={Layers as IconType} color={PINK} title="Spend by Placement" rightLabel="Publisher platform">
          {pubSorted.length > 0 ? (
            <HBarChart
              data={pubSorted.slice(0, 5).map((r, i) => ({ label: cleanLabel(r.label).slice(0, 9), value: r.spend, color: SERIES[i % SERIES.length] }))}
              valueRight={(v, pct) => `${cur0(v)} · ${pct.toFixed(0)}%`}
            />
          ) : <EmptyNote text="No placement data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Executive Summary
// ─────────────────────────────────────────────────────────────────────────────

function ExecutivePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const spend = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const conv = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const rev = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const roas = spend > 0 && rev > 0 ? rev / spend : 0;

  const wins = [...sorted].filter(c => (c.conversions || 0) > 0)
    .sort((a, b) => ((b.conversionValue || 0) / (b.spend || 1)) - ((a.conversionValue || 0) / (a.spend || 1))).slice(0, 3);
  const challenges = [...sorted].filter(c => (c.spend || 0) > 0)
    .sort((a, b) => ((a.conversionValue || 0) / (a.spend || 1)) - ((b.conversionValue || 0) / (b.spend || 1))).slice(0, 3);

  const col = (title: string, accent: string, Icon: IconType, items: { primary: string; secondary: string }[]) => (
    <div style={{ flex: 1, background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ background: `${accent}14`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${accent}22` }}>
        <Icon size={15} color={accent} strokeWidth={2.5} />
        <span style={{ fontSize: 12, fontWeight: 800, color: accent, letterSpacing: "0.04em" }}>{title}</span>
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
        {items.map((it, i) => (
          <div key={i}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, marginBottom: 2, lineHeight: 1.3 }}>{it.primary}</div>
            <div style={{ fontSize: 10, color: MUTED }}>{it.secondary}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const fallbackActions = [
    { t: "Scale top performers", b: wins[0] ? `Increase budget 15–20% on "${wins[0].name.slice(0, 28)}".` : "Shift budget to highest-ROAS campaigns.", c: GREEN },
    { t: "Cut underperformers", b: "Pause ad sets with 7+ days of spend and ROAS below 1×.", c: RED },
    { t: "Validate attribution", b: roas > 0 ? `Blended ROAS is ${roas.toFixed(2)}×; check 7d/1d click ratio for inflation.` : "Review attribution windows across campaigns.", c: ORANGE },
    { t: "Strengthen tracking", b: "Verify Conversions API to reduce iOS signal loss.", c: INDIGO },
  ];
  // AI recommendations (when a narrative was generated) replace the generic ones.
  const aiRecs = p.narrative?.recommendations ?? [];
  const accent = [GREEN, INDIGO, ORANGE, RED, PINK, GREEN];
  const actions = aiRecs.length > 0
    ? aiRecs.slice(0, 6).map((r, i) => ({ t: "", b: r, c: accent[i % accent.length] }))
    : fallbackActions;

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Executive Summary" badge="Wins · Challenges · Actions" rightText={`${p.startDate} – ${p.endDate}`} Icon={Award as IconType} />
      <Body rows="auto 1fr">
        <div style={{ gridColumn: "1 / 3", display: "flex", gap: 14 }}>
          {col("TOP WINS", GREEN, Award as IconType, wins.map(c => ({
            primary: c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
            secondary: `ROAS ${((c.conversionValue || 0) / (c.spend || 1)).toFixed(2)}× · ${fmtInt(c.conversions || 0)} conv`,
          })))}
          {col("KEY METRICS", INDIGO, BarChart3 as IconType, [
            { primary: cur0(spend), secondary: "Total spend" },
            { primary: roas > 0 ? `${roas.toFixed(2)}×` : "—", secondary: "Blended ROAS" },
            { primary: `${fmtInt(conv)} conversions`, secondary: `CPA ${conv > 0 ? cur0(spend / conv) : "—"}` },
          ])}
          {col("CHALLENGES", RED, AlertTriangle as IconType, challenges.map(c => ({
            primary: c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
            secondary: `ROAS ${((c.conversionValue || 0) / (c.spend || 1)).toFixed(2)}× · ${cur0(c.spend || 0)} spent`,
          })))}
        </div>

        <Card Icon={Zap as IconType} color={INDIGO} title="Immediate Actions" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "12px 14px", borderLeft: `3px solid ${a.c}` }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: a.c, color: "#FFFFFF", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                <div>
                  {a.t ? <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, marginBottom: 3 }}>{a.t}</div> : null}
                  <div style={{ fontSize: a.t ? 10.5 : 11.5, color: a.t ? MUTED : TEXT, lineHeight: 1.45 }}>{a.b}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — AI Analysis (only when a narrative was generated)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABEL: Record<string, string> = {
  kpis: "Key Metrics", campaigns: "Campaigns", funnel: "Funnel", audience: "Audience",
  creative: "Creative", placement: "Placement", tracking: "Tracking & Data Quality", attribution: "Attribution",
};

function AiAnalysisPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const nar = p.narrative!;
  const insights = (nar.sectionInsights ?? []).slice(0, 6);
  const highlights = (nar.highlights ?? []).slice(0, 4);
  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="AI Analysis" badge={OBJECTIVE_TITLE[p.objective ?? "sales"].title} rightText={`${p.startDate} – ${p.endDate}`} Icon={Lightbulb as IconType} />
      <div style={{ position: "absolute", top: 64, left: 0, right: 0, bottom: 26, padding: 24, display: "flex", flexDirection: "column", gap: 13, overflow: "hidden" }}>
        {/* Executive summary */}
        <div style={{ background: "#EEF0FF", border: `1px solid ${INDIGO}33`, borderLeft: `4px solid ${INDIGO}`, borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: INDIGO_D, letterSpacing: "0.05em", marginBottom: 6 }}>EXECUTIVE SUMMARY</div>
          <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.5 }}>{nar.execSummary}</div>
        </div>
        {/* Highlights */}
        {highlights.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(highlights.length, 4)}, 1fr)`, gap: 12 }}>
            {highlights.map((h, i) => (
              <div key={i} style={{ background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "11px 13px", borderTop: `3px solid ${SERIES[i % SERIES.length]}` }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, lineHeight: 1.35 }}>{h}</div>
              </div>
            ))}
          </div>
        )}
        {/* Section insights */}
        {insights.length > 0 && (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "min-content", gap: 12, overflow: "hidden" }}>
            {insights.map((s, i) => (
              <div key={i} style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: INDIGO_D, marginBottom: 5 }}>{SECTION_LABEL[s.section] ?? s.section}</div>
                <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.45 }}>{s.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Tracking & Data Quality (only when a tracking snapshot is present)
// ─────────────────────────────────────────────────────────────────────────────

function TrackingPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const tk = p.tracking!;
  const as = tk.accountStructure;
  const tiles: { label: string; value: string; color: string; sub?: string }[] = [
    { label: "Active Pixels", value: tk.activePixels ?? "—", color: INDIGO, sub: "Firing & healthy" },
    { label: "Server (CAPI) Share", value: tk.capiSharePct != null ? `${tk.capiSharePct}%` : "—", color: tk.capiSharePct != null && tk.capiSharePct >= 40 ? GREEN : ORANGE, sub: "Events server-side" },
    { label: "Event Match Quality", value: tk.emqScore != null ? String(tk.emqScore) : "—", color: tk.emqScore != null && tk.emqScore >= 60 ? GREEN : ORANGE, sub: "Signal match score" },
    { label: "Total Events", value: tk.totalEvents != null ? fmtBig(tk.totalEvents) : "—", color: TEXT, sub: "In selected range" },
    { label: "Avg Frequency", value: tk.avgFrequency != null ? `${tk.avgFrequency}×` : "—", color: tk.avgFrequency != null && tk.avgFrequency > 5 ? RED : TEXT, sub: "Impr / reach" },
    { label: "Campaigns", value: as ? String(as.campaigns) : "—", color: TEXT, sub: as && as.adSets > 0 ? `${as.adSets} ad sets / IOs` : "Account structure" },
  ];
  const funnel = (tk.funnel ?? []).filter(f => f.value > 0);
  const attr = tk.attribution ?? [];
  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Tracking, Data Quality & Attribution" badge="Audit · Tracking" rightText={`${p.startDate} – ${p.endDate}`} Icon={Activity as IconType} />
      <Body rows="auto 1fr">
        <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {tiles.map((t, i) => <StatTile key={i} label={t.label} value={t.value} color={t.color} sub={t.sub} />)}
        </div>
        <Card Icon={Filter as IconType} color={INDIGO} title="Conversion Funnel">
          {funnel.length > 0
            ? <HBarChart data={funnel.map((f, i) => ({ label: f.stage, value: f.value, color: SERIES[i % SERIES.length] }))} valueRight={(v) => fmtBig(v)} />
            : <div style={{ fontSize: 12, color: MUTED, padding: "8px 2px" }}>No funnel event data available for this window.</div>}
          {p.narrative?.sectionInsights?.find(s => s.section === "tracking") && (
            <Callout variant="insight" label="Insight" text={p.narrative.sectionInsights.find(s => s.section === "tracking")!.text} />
          )}
        </Card>
        <Card Icon={Award as IconType} color={GREEN} title={attr.length ? "Floodlight Attribution Windows (DV360)" : "Attribution"}>
          {attr.length > 0
            ? <MiniTable headers={["Activity", "Click Lookback", "View Lookback"]} rows={attr.slice(0, 7).map(a => [a.name, `${a.clickLookbackDays}d`, `${a.viewLookbackDays}d`])} aligns={["l", "r", "r"]} />
            : <div style={{ fontSize: 12, color: MUTED, padding: "8px 2px", lineHeight: 1.5 }}>Conversions use each platform&apos;s default attribution window. DV360 Floodlight lookback windows appear here when a Floodlight/CM360 link is available.</div>}
          {p.narrative?.sectionInsights?.find(s => s.section === "attribution") && (
            <Callout variant="optimization" label="Note" text={p.narrative.sectionInsights.find(s => s.section === "attribution")!.text} />
          )}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export default function PdfReportPages(props: PdfReportPagesProps) {
  const length: ReportLength = props.length ?? "standard";
  const hasNarrative = !!props.narrative && !!props.narrative.execSummary;
  const hasTracking = !!props.tracking && (
    props.tracking.activePixels != null || props.tracking.capiSharePct != null ||
    props.tracking.emqScore != null || (props.tracking.funnel?.length ?? 0) > 0 ||
    (props.tracking.attribution?.length ?? 0) > 0 || props.tracking.accountStructure != null
  );

  const hasDaily = props.dailyRows.length > 0;
  const hasAudience = props.ageRows.length > 0 || props.genderRows.length > 0 || props.countryRows.length > 0 || props.regionRows.length > 0;
  const hasCreative = props.adRows.length > 0;
  const hasPlatform = hasDaily || props.pubRows.length > 0;

  // Section selection is authoritative for inclusion (undefined = all). Length
  // still nudges the "heavy" pages: at "concise" the budget-trend and
  // placement/weekly pages stay off unless the user explicitly kept them.
  const sel = props.sections ?? ["ai", "campaigns", "audience", "creative", "placement", "budget", "funnel", "tracking"];
  const has = (id: string) => sel.includes(id);
  const inc = {
    ai:       hasNarrative && has("ai"),
    budget:   hasDaily && has("budget") && length !== "concise",
    campaign: has("campaigns"),
    funnel:   has("funnel"),
    audience: hasAudience && has("audience"),
    creative: hasCreative && has("creative"),
    platform: hasPlatform && has("placement") && length !== "concise",
    tracking: hasTracking && has("tracking"),
  };

  // Dynamic page numbering
  let n = 2; // cover is 1
  const pages: React.ReactNode[] = [<CoverPage key="cover" {...props} />];

  if (inc.ai)       { pages.push(<AiAnalysisPage key="ai" {...props} pageNum={n} total={0} />); n++; }
  if (inc.budget)   { pages.push(<BudgetPage key="budget" {...props} pageNum={n} total={0} />); n++; }
  if (inc.campaign) { pages.push(<CampaignPage key="camp" {...props} pageNum={n} total={0} />); n++; }
  if (inc.funnel)   { pages.push(<FunnelPage key="funnel" {...props} pageNum={n} total={0} />); n++; }
  if (inc.audience) { pages.push(<AudiencePage key="aud" {...props} pageNum={n} total={0} />); n++; }
  if (inc.creative) { pages.push(<CreativePage key="creative" {...props} pageNum={n} total={0} />); n++; }
  if (inc.platform) { pages.push(<PlatformPage key="platform" {...props} pageNum={n} total={0} />); n++; }
  if (inc.tracking) { pages.push(<TrackingPage key="tracking" {...props} pageNum={n} total={0} />); n++; }
  pages.push(<ExecutivePage key="exec" {...props} pageNum={n} total={0} />);
  const total = n;

  // Re-inject total into the page props by cloning
  const withTotal = pages.map((el) =>
    React.isValidElement(el) && (el.props as any).pageNum
      ? React.cloneElement(el as React.ReactElement<any>, { total })
      : el
  );

  return <div style={{ display: "flex", flexDirection: "column" }}>{withTotal}</div>;
}
