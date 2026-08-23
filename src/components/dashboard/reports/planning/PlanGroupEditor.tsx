import { useState } from "react";
import { X, Check } from "lucide-react";

export default function PlanGroupEditor({
  defaultName,
  items,
  onSave,
  onCancel,
}: {
  defaultName: string;
  items: { entityType: string; entityId: string; entityName: string; checked: boolean }[];
  onSave: (name: string, selectedIds: Set<string>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(items.filter((it) => it.checked).map((it) => `${it.entityType}:${it.entityId}`))
  );

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || checked.size === 0) return;
    onSave(trimmed, checked);
  };

  const typeLabel = (t: string) => t === "campaign" ? "Campaign" : t === "adset" ? "Ad Set" : t === "ad" ? "Ad" : t === "io" ? "IO" : "LI";

  return (
    <div className="bg-white border border-blue-200 rounded-xl shadow-sm p-4 space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-700 block mb-1">Plan name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sunscreen Launch"
          className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </div>

      {items.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1">Include in this plan</label>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            {items.map((it) => {
              const key = `${it.entityType}:${it.entityId}`;
              const selected = checked.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 ${selected ? "bg-blue-50/60" : ""}`}
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center transition ${selected ? "bg-blue-600 border border-blue-600" : "border border-gray-300 bg-white"}`}>
                    {selected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium w-16 shrink-0">{typeLabel(it.entityType)}</span>
                  <span className="truncate font-medium text-gray-700" title={it.entityName}>{it.entityName}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!name.trim() || checked.size === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" /> Save Plan
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 transition"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}
