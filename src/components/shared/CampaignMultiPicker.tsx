/**
 * Shared campaign multi-select — search box + checkbox list with colored dots,
 * Select-all / Clear. Stores campaign ids (empty array = "all"). Used by the
 * Key Metrics report's campaign filter and the Planning report's segment→campaign
 * assignment.
 */

import { useState, useMemo } from "react";
import { Megaphone, Plus, X, Search, Check } from "lucide-react";

// Deterministic color from id — used for campaign chip dots.
const DOT_COLORS = ["#a3e635", "#a78bfa", "#fbbf24", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15", "#22d3ee", "#c084fc"];
export function dotColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return DOT_COLORS[Math.abs(h) % DOT_COLORS.length];
}

export default function CampaignMultiPicker({
  options, values, onChange, allLabelText = "All campaigns", loading = false,
  entityLabel = "campaigns", icon,
}: {
  options: { id: string; name: string }[];
  values: string[];
  onChange: (next: string[]) => void;
  /** Label shown when nothing is selected (e.g. "All campaigns" or "Unassigned"). */
  allLabelText?: string;
  /** When true and options is empty, show "Loading…" instead of "No campaigns match." */
  loading?: boolean;
  /** Entity type label for search placeholder and empty state (default "campaigns"). */
  entityLabel?: string;
  /** Override the icon shown before the label. Null to hide. */
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter(o => o.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50),
    [options, query]
  );
  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter(v => v !== id) : [...values, id]);
  };
  const allLabel = values.length === 0 ? allLabelText : `${values.length} selected`;
  return (
    <div className="relative inline-flex items-center gap-2">
      {icon !== undefined ? icon : <Megaphone className="w-3.5 h-3.5 text-gray-400" />}
      <span className="text-xs italic text-gray-500">{allLabel}</span>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        <Plus className="w-3 h-3" /> Add
      </button>
      {values.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-500 hover:text-gray-700"
          title="Clear"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-50 w-[420px] max-w-[90vw] bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Search ${entityLabel}…`}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-xs border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-gray-400">{loading && options.length === 0 ? `Loading ${entityLabel}…` : `No ${entityLabel} match.`}</div>
              ) : filtered.map(c => {
                const selected = values.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2.5 ${selected ? "bg-blue-50/60" : ""}`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center transition ${selected ? "bg-blue-600 border border-blue-600" : "border border-gray-300 bg-white"}`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor(c.id) }} />
                    <span className="truncate font-medium" title={c.name}>{c.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <button onClick={() => onChange(options.map(o => o.id))} className="font-semibold text-blue-600 hover:underline">Select all</button>
              <button onClick={() => onChange([])} className="font-semibold text-gray-500 hover:text-gray-700">Clear</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
