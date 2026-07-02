/**
 * Reporting → Attribution
 *
 * Shows ONLY data fetchable from Meta's Insights API:
 *   1. Full-Funnel View  — impressions → clicks → conversions (drop-off rates)
 *   2. Campaign Performance — Meta-reported last-click conversions per campaign
 *   3. Attribution Windows in use — which window each campaign group uses
 *
 * Removed: First-Click / Linear / Position-Based / Data-Driven model cards
 * and the Model Comparison chart — all were client-side math, not Meta data.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Info, TrendingUp, ArrowRight } from "lucide-react";
import { ColumnPickerButton, ALL_STANDARD_KPIS } from "@/components/shared/ColumnPicker";
import { formatStandardKpi } from "@/lib/standard-kpis";
import { usePersistentColumns } from "@/hooks/useColumnPrefs";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import SharedSortTh from "@/components/shared/SortTh";
import { useSort } from "@/hooks/useSort";
import { useCampaigns } from "@/hooks/useCampaigns";
import { detectCurrency, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { CampaignData } from "@/types";
import TabSummaryFooter from "@/components/shared/TabSummaryFooter";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

function fmtBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-IN");
}
function truncate(s: string, n = 28) { return s.length > n ? s.slice(0, n) + "…" : s; }

const WINDOW_NOTES: Record<string, string> = {
  "7d_click + 1d_view": "Meta default — recommended for most accounts.",
  "1d_click":           "Strict click-only — may undercount assisted conversions.",
  "7d_click":           "Click-only — view-through not credited.",
  "28d_click":          "Legacy long window — Meta is deprecating this.",
  "Account default":    "Using the account-level default attribution setting.",
};

// ─── §1 Full-Funnel View ──────────────────────────────────────────────────────

function FunnelStep({ label, value, pct, color, isLast }: {
  label: string; value: number; pct?: string; color: string; isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtBig(value)}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div className="h-3 rounded-full" style={{ width: pct ? "100%" : "100%", background: color }} />
        </div>
        {pct && (
          <div className="text-[10px] text-gray-400 mt-1">{pct} conversion rate</div>
        )}
      </div>
      {!isLast && <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />}
    </div>
  );
}

function FullFunnelView({ campaigns }: { campaigns: CampaignData[] }) {
  const impressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks      = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);

  const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cvr  = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const end2end = impressions > 0 ? (conversions / impressions) * 100 : 0;

  const steps = [
    { label: "Impressions", value: impressions, color: "#6366f1", barPct: 100 },
    { label: "Clicks",      value: clicks,      color: "#10b981", barPct: impressions > 0 ? (clicks / impressions) * 100 : 0 },
    { label: "Conversions", value: conversions, color: "#8b5cf6", barPct: impressions > 0 ? (conversions / impressions) * 100 : 0 },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-gray-900">Full-Funnel View</h3>
        <p className="text-xs text-gray-500 mt-0.5">Drop-off across the conversion journey — from Meta Insights API</p>
      </div>

      <div className="space-y-3">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">{s.label}</span>
              <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtBig(s.value)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full transition-all duration-700"
                style={{ width: `${Math.max(s.barPct, 1)}%`, background: s.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3">
        {[
          { label: "CTR",          value: `${ctr.toFixed(2)}%`,     sub: "Impr → Click" },
          { label: "CVR",          value: `${cvr.toFixed(2)}%`,     sub: "Click → Conv" },
          { label: "End-to-end",   value: `${end2end.toFixed(3)}%`, sub: "Impr → Conv"  },
        ].map(m => (
          <div key={m.label} className="text-center">
            <div className="text-base font-bold text-gray-900">{m.value}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── §2 Campaign Performance (Last-Click, Meta Reported) ─────────────────────

interface CampColDef { id: string; label: string; group: string; fmt: "money" | "int" | "pct" | "x"; defaultOn: boolean; lowerIsBetter?: boolean; }
const CAMP_ALL_COLS: CampColDef[] = [
  { id: "impressions",     label: "Impressions", group: "Display",    fmt: "int",   defaultOn: false },
  { id: "cpm",             label: "CPM",         group: "Display",    fmt: "money", defaultOn: false, lowerIsBetter: true },
  { id: "clicks",          label: "Clicks",      group: "Engagement", fmt: "int",   defaultOn: false },
  { id: "ctr",             label: "CTR",         group: "Engagement", fmt: "pct",   defaultOn: true  },
  { id: "cpc",             label: "CPC",         group: "Engagement", fmt: "money", defaultOn: false, lowerIsBetter: true },
  { id: "spend",           label: "Spend",       group: "Engagement", fmt: "money", defaultOn: true  },
  { id: "conversions",     label: "Conv.",       group: "Conversion", fmt: "int",   defaultOn: true  },
  { id: "conversionValue", label: "Revenue",     group: "Conversion", fmt: "money", defaultOn: false },
  { id: "roas",            label: "ROAS",        group: "Conversion", fmt: "x",     defaultOn: true  },
  { id: "cpa",             label: "CPA",         group: "Conversion", fmt: "money", defaultOn: true, lowerIsBetter: true },
  { id: "cvr",             label: "CVR",         group: "Conversion", fmt: "pct",   defaultOn: false },
  { id: "aov",             label: "AOV",         group: "Conversion", fmt: "money", defaultOn: false },
];
const CAMP_DEFAULT_COLS = CAMP_ALL_COLS.filter(c => c.defaultOn).map(c => c.id);

function CampColPicker({ cols, setCols }: { cols: string[]; setCols: (c: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };
  return (
    <ColumnPickerButton
      cols={cols}
      allDefs={CAMP_ALL_COLS}
      defaultIds={CAMP_DEFAULT_COLS}
      pickerOpen={open}
      setPickerOpen={setOpen}
      pickerRef={ref}
      toggleCol={toggleCol}
      resetCols={(ids) => setCols([...ids])}
    />
  );
}

function CampaignPerformanceTable({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const [cols, setCols] = usePersistentColumns("attr-camp", CAMP_DEFAULT_COLS);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const enriched = useMemo(() => campaigns.map(c => {
    const spend = c.spend || 0;
    const imps = c.impressions || 0;
    const clicks = c.clicks || 0;
    const conversions = c.conversions || 0;
    const conversionValue = c.conversionValue || 0;
    return {
      ...c,
      spend, impressions: imps, clicks, conversions, conversionValue,
      ctr:  imps > 0 ? (clicks / imps) * 100 : 0,
      cpm:  imps > 0 ? (spend / imps) * 1000 : 0,
      cpc:  clicks > 0 ? spend / clicks : 0,
      roas: spend > 0 ? conversionValue / spend : 0,
      cpa:  conversions > 0 ? spend / conversions : 0,
      cvr:  clicks > 0 ? (conversions / clicks) * 100 : 0,
      aov:  conversions > 0 ? conversionValue / conversions : 0,
    };
  }), [campaigns]);
  const { sorted, sort, toggle } = useSort(enriched, "spend", "desc");

  const maxSpend = Math.max(...enriched.map(c => c.spend), 1);

  const fmtVal = (id: string, v: number): string => {
    const def = CAMP_ALL_COLS.find(c => c.id === id)!;
    if (!Number.isFinite(v) || v === 0) return id === "spend" || id === "conversions" ? (v === 0 ? (def.fmt === "money" ? cur(0) : "0") : "—") : "—";
    if (def.fmt === "money") return cur(v);
    if (def.fmt === "pct")   return `${v.toFixed(2)}%`;
    if (def.fmt === "x")     return `${v.toFixed(2)}×`;
    return Math.round(v).toLocaleString("en-IN");
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Campaign Performance</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Conversions as reported by Meta (last-click, account default window) · Click headers to sort
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CampColPicker cols={cols} setCols={setCols} />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
            Meta API
          </span>
        </div>
      </div>
      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SharedSortTh col="name" sort={sort} onToggle={toggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600">Campaign</SharedSortTh>
              {cols.map(id => {
                const def = CAMP_ALL_COLS.find(c => c.id === id)!;
                return <SharedSortTh key={id} col={id} sort={sort} onToggle={toggle} className="px-4 py-2.5 text-[11px] uppercase font-semibold text-gray-600 whitespace-nowrap" align="right">{def.label}</SharedSortTh>;
              })}
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Window</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const spendPct = maxSpend > 0 ? (c.spend / maxSpend) * 100 : 0;
              return (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[260px]">
                    <div className="font-mono text-xs text-gray-900 truncate" title={c.name}>{c.name}</div>
                    <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden">
                      <div className="h-1 rounded-full bg-blue-400" style={{ width: `${spendPct}%` }} />
                    </div>
                  </td>
                  {cols.map(id => {
                    const v = (c as unknown as Record<string, number>)[id] ?? 0;
                    const cellClass = id === "roas"
                      ? `px-4 py-2.5 text-right font-semibold tabular-nums`
                      : id === "spend"
                        ? "px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums"
                        : "px-4 py-2.5 text-right text-gray-700 tabular-nums";
                    const roasColor = id === "roas" ? (v >= 2 ? "#059669" : v >= 1 ? "#d97706" : v > 0 ? "#dc2626" : undefined) : undefined;
                    return <td key={id} className={cellClass} style={roasColor ? { color: roasColor } : undefined}>{fmtVal(id, v)}</td>;
                  })}
                  <td className="px-4 py-2.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 text-gray-600">
                      {c.effectiveAttribution || "acct default"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── §3 Attribution Windows ───────────────────────────────────────────────────

const WIN_ALL_COLS: { id: string; label: string; group: string; defaultOn: boolean }[] = [
  { id: "campaigns",       label: "Camps",       group: "Core",       defaultOn: true  },
  { id: "spend",           label: "Spend",       group: "Engagement", defaultOn: true  },
  { id: "conversions",     label: "Conv.",       group: "Conversion", defaultOn: true  },
  { id: "roas",            label: "ROAS",        group: "Conversion", defaultOn: true  },
  { id: "impressions",     label: "Impressions", group: "Display",    defaultOn: false },
  { id: "reach",           label: "Reach",       group: "Display",    defaultOn: false },
  { id: "cpm",             label: "CPM",         group: "Display",    defaultOn: false },
  { id: "clicks",          label: "Clicks",      group: "Engagement", defaultOn: false },
  { id: "ctr",             label: "CTR",         group: "Engagement", defaultOn: false },
  { id: "cpc",             label: "CPC",         group: "Engagement", defaultOn: false },
  { id: "conversionValue", label: "Revenue",     group: "Conversion", defaultOn: false },
  { id: "cpa",             label: "CPA",         group: "Conversion", defaultOn: false },
  { id: "cvr",             label: "CVR",         group: "Conversion", defaultOn: false },
  { id: "aov",             label: "AOV",         group: "Conversion", defaultOn: false },
];
const WIN_DEFAULT_COLS = WIN_ALL_COLS.filter(c => c.defaultOn).map(c => c.id);

function AttributionWindowsSection({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const cur = (n: number) => formatMoney(n, currency, 0);
  const [cols, setCols] = usePersistentColumns("attr-win", WIN_DEFAULT_COLS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const toggleCol = (id: string) => {
    if (cols.includes(id)) { if (cols.length > 1) setCols(cols.filter(c => c !== id)); }
    else setCols([...cols, id]);
  };

  const windowRows = useMemo(() => {
    const map = new Map<string, { window: string; campaigns: number; spend: number; impressions: number; clicks: number; reach: number; conversions: number; conversionValue: number }>();
    campaigns.forEach(c => {
      const w = c.effectiveAttribution || "Account default";
      const row = map.get(w) || { window: w, campaigns: 0, spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, conversionValue: 0 };
      row.campaigns++;
      row.spend += c.spend || 0;
      row.impressions += c.impressions || 0;
      row.clicks += c.clicks || 0;
      row.reach += c.reach || 0;
      row.conversions += c.conversions || 0;
      row.conversionValue += c.conversionValue || 0;
      map.set(w, row);
    });
    return [...map.values()].map(r => ({
      ...r,
      ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
      cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
      cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
      roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
      cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
      aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [campaigns]);

  const chartData = windowRows.map(r => ({ name: r.window, Spend: r.spend, Conversions: r.conversions }));

  const fmtVal = (id: string, v: number): string => {
    if (!Number.isFinite(v)) return "—";
    if (id === "campaigns") return String(v);
    if (id === "spend" || id === "conversionValue" || id === "cpm" || id === "cpc" || id === "cpa" || id === "aov") return v > 0 ? cur(v) : "—";
    if (id === "ctr" || id === "cvr") return v > 0 ? `${v.toFixed(2)}%` : "—";
    if (id === "roas") return v > 0 ? `${v.toFixed(2)}×` : "—";
    if (id === "conversions" || id === "clicks" || id === "impressions" || id === "reach") return v > 0 ? Math.round(v).toLocaleString("en-IN") : "0";
    return String(v);
  };

  if (windowRows.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Attribution Windows in Use</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Effective attribution window per campaign group — from Meta campaign settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPickerButton
            cols={cols}
            allDefs={WIN_ALL_COLS}
            defaultIds={WIN_DEFAULT_COLS}
            pickerOpen={pickerOpen}
            setPickerOpen={setPickerOpen}
            pickerRef={pickerRef}
            toggleCol={toggleCol}
            resetCols={(ids) => setCols([...ids])}
          />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
            Meta API
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
        {/* Table */}
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Window</th>
                {cols.map(id => {
                  const def = WIN_ALL_COLS.find(c => c.id === id) ?? ALL_STANDARD_KPIS.find(c => c.id === id);
                  return <th key={id} className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{def?.label ?? id}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {windowRows.map(r => (
                <tr key={r.window} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs text-gray-900">{r.window}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{WINDOW_NOTES[r.window] || "—"}</div>
                  </td>
                  {cols.map(id => {
                    const isLocal = WIN_ALL_COLS.some(c => c.id === id);
                    const v = (r as unknown as Record<string, number>)[id] ?? 0;
                    const cell = isLocal ? fmtVal(id, v) : formatStandardKpi(r, id, currency);
                    const isCore = id === "spend";
                    const isRoas = id === "roas";
                    return (
                      <td key={id} className={`px-4 py-2.5 text-right tabular-nums ${isCore ? "font-semibold text-gray-900" : isRoas ? "font-semibold text-blue-700" : "text-gray-700"}`}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bar chart */}
        <div className="p-5">
          <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Spend by Window</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="name" fontSize={10} stroke="#9ca3af" tickLine={false} angle={-20} textAnchor="end" interval={0} />
              <YAxis fontSize={10} stroke="#9ca3af" tickLine={false} axisLine={false} tickFormatter={v => fmtBig(v)} />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [fmtBig(v), "Spend"]}
              />
              <Bar dataKey="Spend" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── §4 Conversion Window Comparison ─────────────────────────────────────────

function ConversionWindowComparison({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const cur = (n: number) => formatMoney(n, currency, 0);

  const rows = useMemo(() => {
    return campaigns
      .filter(c => c.conv1dClick !== undefined || c.conv7dClick !== undefined || c.conv1dView !== undefined)
      .map(c => ({
        id: c.id,
        name: c.name,
        spend: c.spend || 0,
        conv1dClick: c.conv1dClick ?? 0,
        conv7dClick: c.conv7dClick ?? 0,
        conv1dView:  c.conv1dView  ?? 0,
        reported:    c.conversions  ?? 0,
        ratio:       (c.conv1dClick ?? 0) > 0 ? (c.conv7dClick ?? 0) / (c.conv1dClick ?? 1) : 0,
      }));
  }, [campaigns]);

  const { sorted, sort, toggle } = useSort(rows, "spend", "desc");

  if (rows.length === 0) return null;

  const totals = rows.reduce((acc, r) => ({
    conv1dClick: acc.conv1dClick + r.conv1dClick,
    conv7dClick: acc.conv7dClick + r.conv7dClick,
    conv1dView:  acc.conv1dView  + r.conv1dView,
    reported:    acc.reported    + r.reported,
  }), { conv1dClick: 0, conv7dClick: 0, conv1dView: 0, reported: 0 });

  const chartData = rows.slice(0, 8).map(r => ({
    name: truncate(r.name, 20),
    "1d Click": r.conv1dClick,
    "7d Click": r.conv7dClick,
    "1d View":  r.conv1dView,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Conversion Window Comparison</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            How many conversions Meta attributes depending on the window — from{" "}
            <span className="font-mono">action_attribution_windows</span> API · same campaign, different credit rules
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
          Meta API
        </span>
      </div>

      {/* Summary totals */}
      <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
        {[
          { label: "1-Day Click", value: totals.conv1dClick, color: "#6366f1", note: "Strictest — only same-day click" },
          { label: "7-Day Click", value: totals.conv7dClick, color: "#10b981", note: "Most common default window" },
          { label: "1-Day View",  value: totals.conv1dView,  color: "#f59e0b", note: "View-through only" },
          { label: "Reported",    value: totals.reported,    color: "#3b82f6", note: "Account window (in use)" },
        ].map(m => (
          <div key={m.label} className="px-4 py-3 text-center">
            <div className="text-lg font-bold tabular-nums" style={{ color: m.color }}>
              {Math.round(m.value).toLocaleString("en-IN")}
            </div>
            <div className="text-[11px] font-semibold text-gray-700 mt-0.5">{m.label}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{m.note}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="p-5 border-b border-gray-100">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" fontSize={9} stroke="#9ca3af" tickLine={false} angle={-30} textAnchor="end" interval={0} />
            <YAxis fontSize={10} stroke="#9ca3af" tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
              contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11 }}
            />
            <Bar dataKey="1d Click" fill="#6366f1" radius={[2, 2, 0, 0]} />
            <Bar dataKey="7d Click" fill="#10b981" radius={[2, 2, 0, 0]} />
            <Bar dataKey="1d View"  fill="#f59e0b" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-campaign table */}
      <div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SharedSortTh col="name" sort={sort} onToggle={toggle} className="text-[11px] uppercase">Campaign</SharedSortTh>
              <SharedSortTh col="spend" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Spend</SharedSortTh>
              <SharedSortTh col="conv1dClick" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">1d Click</SharedSortTh>
              <SharedSortTh col="conv7dClick" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">7d Click</SharedSortTh>
              <SharedSortTh col="conv1dView" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">1d View</SharedSortTh>
              <SharedSortTh col="reported" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">Reported</SharedSortTh>
              <SharedSortTh col="ratio" sort={sort} onToggle={toggle} className="text-[11px] uppercase" align="right">7d/1d ratio</SharedSortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const ratio = r.conv1dClick > 0 ? r.conv7dClick / r.conv1dClick : null;
              return (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[240px]">
                    <div className="text-xs text-gray-800 truncate font-mono" title={r.name}>{r.name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums text-xs">{cur(r.spend)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-indigo-700 tabular-nums">{r.conv1dClick}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-700 tabular-nums">{r.conv7dClick}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{r.conv1dView}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-blue-700 tabular-nums">{r.reported}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                    {ratio !== null ? (
                      <span className={ratio > 1.5 ? "text-orange-600 font-semibold" : "text-gray-500"}>
                        {ratio.toFixed(2)}×
                        {ratio > 1.5 && <span className="ml-1 text-[9px]">↑</span>}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr>
              <td className="px-4 py-2.5 text-xs font-bold text-gray-700">Total</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-bold text-indigo-700 tabular-nums">{Math.round(totals.conv1dClick).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">{Math.round(totals.conv7dClick).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-amber-700 tabular-nums">{Math.round(totals.conv1dView).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-blue-700 tabular-nums">{Math.round(totals.reported).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                {totals.conv1dClick > 0 ? `${(totals.conv7dClick / totals.conv1dClick).toFixed(2)}× avg` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 rounded-b-xl text-xs text-amber-800">
        <strong>What the ratio means:</strong> A 7d/1d ratio above 1.5× means many conversions are credited between day 2 and day 7 after the click.
        If you switched to a 1d window, your reported conversions would drop significantly — your budget decisions may be based on 7d-inflated numbers.
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AttributionReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);

  const metaCampaigns = useMemo(
    () => campaigns.filter(c => c.platform === "meta"),
    [campaigns]
  );

  const totalConversions = metaCampaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalSpend       = metaCampaigns.reduce((s, c) => s + (c.spend || 0), 0);

  return (
    <div className="space-y-6 section-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <GitBranch className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Attribution</h1>
            <p className="text-gray-600 mt-1">
              {metaCampaigns.length} campaign{metaCampaigns.length !== 1 ? "s" : ""} ·{" "}
              {Math.round(totalConversions).toLocaleString()} conversions · all values from Meta Insights API
            </p>
          </div>
        </div>
        {platform !== "google" && (
          <AIExecutiveSummary
            tabName="Attribution"
            context={{ window: `${startDate} → ${endDate}`, campaignCount: metaCampaigns.length, totalConversions, totalSpend }}
            platform="meta"
            inline
          />
        )}
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Attribution data shown here uses Meta campaign data. Switch platform to Meta or Both.
        </div>
      )}

      {/* Data source notice */}
      {platform !== "google" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            All numbers on this page are <strong>fetched directly from Meta&apos;s Insights API</strong>.
            Conversions use Meta&apos;s default last-click attribution window for each campaign.
            Multi-touch models (First Click, Linear, Position-Based) require cross-session journey data that Meta does not expose via API and have been removed.
          </span>
        </div>
      )}

      {platform !== "google" && (
        <>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : metaCampaigns.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
              No Meta campaign data for this date range.
            </div>
          ) : (
            <>
              {/* §1 Full-Funnel View */}
              <FullFunnelView campaigns={metaCampaigns} />

              {/* §3 Attribution Windows */}
              <AttributionWindowsSection campaigns={metaCampaigns} currency={currency} />

              {/* §4 Conversion Window Comparison */}
              <ConversionWindowComparison campaigns={metaCampaigns} currency={currency} />
            </>
          )}
        </>
      )}

      {metaCampaigns.length > 0 && platform !== "google" && (() => {
        const cur = (n: number) => formatMoney(n, currency, 0);
        const overallRoas = totalSpend > 0 ? metaCampaigns.reduce((s, c) => s + (c.conversionValue || 0), 0) / totalSpend : 0;
        const topConv = [...metaCampaigns].sort((a, b) => (b.conversionValue || 0) - (a.conversionValue || 0))[0];
        const zeroConv = metaCampaigns.filter(c => (c.conversions || 0) === 0 && (c.spend || 0) > 0).length;
        return (
          <TabSummaryFooter
            lines={[
              `${metaCampaigns.length} campaign${metaCampaigns.length !== 1 ? "s" : ""} · ${Math.round(totalConversions).toLocaleString()} conversions · ${cur(totalSpend)} total spend${overallRoas > 0 ? ` · ${overallRoas.toFixed(2)}× blended ROAS` : ""}.`,
              topConv ? `Top revenue driver: "${topConv.name}" with ${cur(topConv.conversionValue || 0)} in conversion value.` : "No conversion value data available.",
              zeroConv > 0
                ? `${zeroConv} campaign${zeroConv !== 1 ? "s" : ""} spent with zero conversions — check attribution windows and pixel setup.`
                : `All campaigns recorded conversions — pixel and attribution appear healthy.`,
            ]}
            tabName="Attribution"
            context={{ campaignCount: metaCampaigns.length, totalConversions, totalSpend }}
            platform="meta"
            dateRange={String(dateRange)}
          />
        );
      })()}
    </div>
  );
}
