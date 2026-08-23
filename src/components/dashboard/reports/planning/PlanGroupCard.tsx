import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, Pencil, Trash2 } from "lucide-react";
import type { PlanGroup } from "@/types/planning";
import { formatMoney } from "@/lib/currency";

const fmtInt = (n: number) => (n > 0 ? Math.round(n).toLocaleString("en-IN") : "—");

interface DeliveredLookup {
  (entityType: string, entityId: string): { spend: number; impressions: number } | undefined;
}

export default function PlanGroupCard({
  group,
  currency,
  getDelivered,
  onView,
  onEdit,
  onRename,
  onRemove,
}: {
  group: PlanGroup;
  currency: string;
  getDelivered: DeliveredLookup;
  onView: () => void;
  onEdit: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalPlannedSpend = group.items.reduce((s, it) => s + (it.plan.spend || 0), 0);
  const totalDeliveredSpend = group.items.reduce((s, it) => {
    const dv = getDelivered(it.entityType, it.entityId);
    return s + (dv?.spend || 0);
  }, 0);
  const pacing = totalPlannedSpend > 0 ? Math.round((totalDeliveredSpend / totalPlannedSpend) * 100) : null;
  const off = pacing == null ? 0 : Math.abs(pacing - 100);
  const pacingCls = off <= 10 ? "bg-green-100 text-green-800" : off <= 25 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

  const entityCount = group.items.length;
  const entityTypes = [...new Set(group.items.map((it) => it.entityType))];
  const entitySummary = entityTypes
    .map((t) => {
      const count = group.items.filter((it) => it.entityType === t).length;
      const label = t === "campaign" ? "campaign" : t === "adset" ? "ad set" : "ad";
      return `${count} ${label}${count > 1 ? "s" : ""}`;
    })
    .join(", ");

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
          <div className="min-w-0">
            <span className="text-sm font-bold text-gray-900 truncate block">{group.name}</span>
            <span className="text-[11px] text-gray-400">
              {entitySummary} · Saved {new Date(group.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {totalPlannedSpend > 0 && (
            <span className="text-xs text-gray-500">
              {formatMoney(totalDeliveredSpend, currency, 0)} / {formatMoney(totalPlannedSpend, currency, 0)}
            </span>
          )}
          {pacing != null && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${pacingCls}`}>{pacing}%</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-2">
          {group.items.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No items in this plan group.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-[10px] uppercase font-semibold text-gray-500">Name</th>
                    <th className="px-3 py-1.5 text-left text-[10px] uppercase font-semibold text-gray-500">Type</th>
                    <th className="px-3 py-1.5 text-right text-[10px] uppercase font-semibold text-gray-500">Planned</th>
                    <th className="px-3 py-1.5 text-right text-[10px] uppercase font-semibold text-gray-500">Delivered</th>
                    <th className="px-3 py-1.5 text-right text-[10px] uppercase font-semibold text-gray-500">Pacing</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((it) => {
                    const dv = getDelivered(it.entityType, it.entityId);
                    const dvSpend = dv?.spend || 0;
                    const itemPacing = it.plan.spend > 0 ? Math.round((dvSpend / it.plan.spend) * 100) : null;
                    const itemOff = itemPacing == null ? 0 : Math.abs(itemPacing - 100);
                    const itemCls = itemOff <= 10 ? "bg-green-100 text-green-800" : itemOff <= 25 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
                    const typeLabel = it.entityType === "campaign" ? "Campaign" : it.entityType === "adset" ? "Ad Set" : "Ad";
                    return (
                      <tr key={`${it.entityType}-${it.entityId}`} className="border-b border-gray-50 last:border-0">
                        <td className="px-3 py-2 text-gray-700 font-medium max-w-[240px] truncate" title={it.entityName}>{it.entityName}</td>
                        <td className="px-3 py-2 text-gray-500">{typeLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{it.plan.spend > 0 ? formatMoney(it.plan.spend, currency, 0) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">{dvSpend > 0 ? formatMoney(dvSpend, currency, 0) : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {itemPacing == null ? <span className="text-gray-300">—</span> : <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${itemCls}`}>{itemPacing}%</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {entityCount > 1 && (
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-3 py-2 text-gray-700">Total</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{totalPlannedSpend > 0 ? formatMoney(totalPlannedSpend, currency, 0) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">{totalDeliveredSpend > 0 ? formatMoney(totalDeliveredSpend, currency, 0) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {pacing != null && <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${pacingCls}`}>{pacing}%</span>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <button onClick={onView} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 rounded-md transition">
              <Eye className="w-3 h-3" /> View
            </button>
            <button onClick={onEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-100 rounded-md transition">
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <button onClick={onRename} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-100 rounded-md transition">
              Rename
            </button>
            <button onClick={onRemove} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-500 hover:bg-red-50 rounded-md transition ml-auto">
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
