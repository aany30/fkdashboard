/**
 * Shared column-picker utilities.
 * - useColPicker: hook for ordered column state + picker/swap open state
 * - ColumnPickerButton: top-right "Columns N" button + grouped dropdown
 * - ColHeader: per-column <th> inner content with swap chevron + dropdown
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePersistentColumns } from "@/hooks/useColumnPrefs";

export interface ColDef {
  id: string;
  label: string;
  group: string;
  defaultOn?: boolean;
}

/** Full canonical KPI list — same 32 options shown across all tables. */
export const ALL_STANDARD_KPIS: ColDef[] = [
  // Core
  { id: "spend",          label: "Spend",           group: "Core" },
  { id: "revenue",        label: "Revenue",         group: "Core" },
  { id: "orders",         label: "Orders",          group: "Core" },
  { id: "roas",           label: "ROAS",            group: "Core" },
  { id: "cpa",            label: "CPA",             group: "Core" },
  { id: "cvr",            label: "CVR",             group: "Core" },
  { id: "aov",            label: "AOV",             group: "Core" },
  // Awareness
  { id: "impressions",    label: "Impressions",     group: "Awareness" },
  { id: "reach",          label: "Reach",           group: "Awareness" },
  { id: "cpm",            label: "CPM",             group: "Awareness" },
  { id: "frequency",      label: "Frequency",       group: "Awareness" },
  { id: "views",          label: "Views",           group: "Awareness" },
  { id: "cpv",            label: "CPV",             group: "Awareness" },
  // Creative Quality
  { id: "vtr",            label: "VTR",             group: "Creative Quality" },
  { id: "ctr",            label: "CTR",             group: "Creative Quality" },
  // Consideration
  { id: "clicks",         label: "Clicks",          group: "Consideration" },
  { id: "cpc",            label: "CPC",             group: "Consideration" },
  { id: "engagements",    label: "Engagements",     group: "Consideration" },
  { id: "engagementRate", label: "Engagement Rate", group: "Consideration" },
  { id: "cpe",            label: "CPE",             group: "Consideration" },
  // Preference
  { id: "leads",          label: "Leads",           group: "Preference" },
  { id: "convRate",       label: "Conv. Rate",      group: "Preference" },
  { id: "cpl",            label: "CPL",             group: "Preference" },
  { id: "traffic",        label: "Traffic",         group: "Preference" },
  { id: "addToCart",      label: "Add to Cart",     group: "Preference" },
  { id: "atcConvRate",    label: "ATC Conv. Rate",  group: "Preference" },
  { id: "install",        label: "Install",         group: "Preference" },
  { id: "cpi",            label: "CPI",             group: "Preference" },
  // Purchase
  { id: "sales",          label: "Sales",           group: "Purchase" },
  { id: "saleConvRate",   label: "Sale Conv. Rate", group: "Purchase" },
  { id: "cps",            label: "CPS",             group: "Purchase" },
  { id: "acos",           label: "ACOS",            group: "Purchase" },
];

export const STD_KPI_MAP = new Map(ALL_STANDARD_KPIS.map((k) => [k.id, k]));

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useColPicker(defaultIds: string[], storageKey?: string) {
  const [cols, setCols] = usePersistentColumns(storageKey, defaultIds);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function h(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  useEffect(() => {
    if (swapIdx === null) return;
    function h(e: MouseEvent) {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) setSwapIdx(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const toggleCol = (id: string) => {
    setCols((prev) => prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]);
  };

  const swapCol = (idx: number, newId: string) => {
    setCols((prev) => {
      const next = [...prev];
      const existingIdx = next.indexOf(newId);
      if (existingIdx !== -1) {
        [next[existingIdx], next[idx]] = [next[idx], next[existingIdx]];
      } else {
        next[idx] = newId;
      }
      return next;
    });
    setSwapIdx(null);
  };

  return {
    cols, setCols,
    pickerOpen, setPickerOpen, pickerRef,
    swapIdx, setSwapIdx, tableRef,
    toggleCol, swapCol,
    resetCols: (ids: string[]) => setCols([...ids]),
  };
}

// ─── Top-right picker button ─────────────────────────────────────────────────

interface PickerBtnProps {
  cols: string[];
  allDefs: ColDef[];
  defaultIds: string[];
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  pickerRef: React.RefObject<HTMLDivElement>;
  toggleCol: (id: string) => void;
  resetCols: (ids: string[]) => void;
}

export function ColumnPickerButton({
  cols, allDefs, defaultIds, pickerOpen, setPickerOpen, pickerRef, toggleCol, resetCols,
}: PickerBtnProps) {
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = Array.from(new Set(allDefs.map((k) => k.group)));

  // Portal target only exists in the browser.
  useEffect(() => setMounted(true), []);
  const matches = (label: string) => !query || label.toLowerCase().includes(query.toLowerCase());

  // Esc to close while open
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, setPickerOpen]);

  // Focus the search field without scrolling the page (autoFocus jumps the scroll).
  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus({ preventScroll: true });
  }, [pickerOpen]);

  return (
    <div className="flex justify-end mb-2" ref={pickerRef}>
      <button
        onClick={() => setPickerOpen(!pickerOpen)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4h12M4 8h8M6 12h4" />
        </svg>
        Columns
        <span className="ml-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">
          {cols.length}
        </span>
      </button>

      {pickerOpen && mounted && createPortal(
        <>
          {/* Backdrop — transparent click-catcher, no page dimming */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setPickerOpen(false)}
          />
          {/* Right drawer — floats as an inset rounded card.
              Portaled to <body> so ancestor transforms can't trap the fixed
              positioning. stopPropagation keeps in-drawer clicks from tripping
              the outside-click close handler. */}
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed right-3 top-3 bottom-3 z-[101] w-[360px] max-w-[calc(100vw-1.5rem)] bg-white shadow-2xl ring-1 ring-black/5 rounded-2xl flex flex-col overflow-hidden animate-slide-in-right"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 shrink-0 bg-gradient-to-b from-gray-50/80 to-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600">
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">Columns</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      <span className="font-semibold text-blue-600">{cols.length}</span> of {allDefs.length} selected
                    </p>
                  </div>
                </div>
                <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-700 transition p-1.5 -mr-1.5 rounded-lg hover:bg-gray-100" aria-label="Close">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M3 3l10 10M13 3L3 13" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="relative mt-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14" strokeLinecap="round"/></svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search metrics…"
                  className="w-full pl-9 pr-3 py-2 text-[13px] bg-gray-100 border border-transparent rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition placeholder:text-gray-400"
                />
              </div>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0 border-t border-gray-100">
              {groups.map((group) => {
                const groupItems = allDefs.filter((k) => k.group === group && matches(k.label));
                if (groupItems.length === 0) return null;
                const onCount = groupItems.filter((k) => cols.includes(k.id)).length;
                return (
                  <div key={group} className="pt-3 first:pt-3">
                    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm px-2 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{group}</span>
                      <span className="text-[10px] font-medium text-gray-300">{onCount}/{groupItems.length}</span>
                    </div>
                    <div className="space-y-0.5 mt-0.5">
                      {groupItems.map((k) => {
                        const on = cols.includes(k.id);
                        return (
                          <button
                            key={k.id}
                            onClick={() => toggleCol(k.id)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-left rounded-lg transition group/item ring-1 ${on ? "bg-blue-50 text-blue-900 font-semibold ring-blue-200" : "text-gray-600 ring-transparent hover:bg-gray-50 hover:ring-gray-200"}`}
                          >
                            <span className={`w-[16px] h-[16px] rounded-[5px] flex items-center justify-center shrink-0 transition ${on ? "bg-blue-600 border border-blue-600" : "border border-gray-300 bg-white group-hover/item:border-blue-400"}`}>
                              {on && (
                                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M1.5 5l2.5 2.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                            {k.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {groups.every(g => allDefs.filter(k => k.group === g && matches(k.label)).length === 0) && (
                <div className="px-3 py-12 text-center text-xs text-gray-400">No columns match &quot;{query}&quot;.</div>
              )}
            </div>
            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3 bg-gray-50/50">
              <button onClick={() => resetCols(defaultIds)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition">
                Reset to default
              </button>
              <button onClick={() => setPickerOpen(false)} className="px-5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition">
                Done
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ─── Per-column header with swap dropdown ─────────────────────────────────────

interface ColHeaderProps {
  colIdx: number;
  currentId: string;
  label: string;
  allDefs: ColDef[];
  swapIdx: number | null;
  setSwapIdx: (idx: number | null) => void;
  swapCol: (idx: number, newId: string) => void;
  /** Optional: render label as a clickable sort button */
  onSortClick?: () => void;
  sortIndicator?: string;
}

export function ColHeader({
  colIdx, currentId, label, allDefs, swapIdx, setSwapIdx, swapCol, onSortClick, sortIndicator,
}: ColHeaderProps) {
  const groups = Array.from(new Set(allDefs.map((k) => k.group)));
  const isOpen = swapIdx === colIdx;
  return (
    <div className="relative flex items-center justify-end gap-0.5">
      {onSortClick ? (
        <button
          onClick={onSortClick}
          className="text-[11px] font-semibold text-gray-600 uppercase cursor-pointer select-none whitespace-nowrap hover:text-gray-900"
        >
          {label}{sortIndicator ?? ""}
        </button>
      ) : (
        <span className="text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{label}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); setSwapIdx(isOpen ? null : colIdx); }}
        className="text-gray-400 hover:text-gray-700 transition shrink-0 ml-1"
        title="Change column"
      >
        <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 2v6M2 5l3 3 3-3" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white rounded-xl shadow-xl border border-gray-200 flex flex-col" style={{ maxHeight: "min(70vh, 560px)" }}>
          <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500 shrink-0">
            Change column
          </div>
          <div className="flex-1 overflow-y-auto py-1 min-h-0">
            {groups.map((group) => (
              <div key={group}>
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">{group}</div>
                {allDefs.filter((kk) => kk.group === group).map((kk) => {
                  const isCurrent = kk.id === currentId;
                  return (
                    <button
                      key={kk.id}
                      onClick={() => !isCurrent && swapCol(colIdx, kk.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${isCurrent ? "text-blue-600 font-semibold bg-blue-50 cursor-default" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      {isCurrent && (
                        <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                        </svg>
                      )}
                      {kk.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
