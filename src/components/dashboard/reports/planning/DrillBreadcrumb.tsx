import { ChevronRight } from "lucide-react";
import type { DrillPathEntry } from "@/types/planning";

const TYPE_LABELS: Record<string, string> = {
  campaign: "Campaign",
  adset: "Ad Set",
  ad: "Ad",
  io: "IO",
  li: "Line Item",
};

export default function DrillBreadcrumb({
  path,
  onNavigate,
}: {
  path: DrillPathEntry[];
  onNavigate: (depth: number) => void;
}) {
  if (path.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 text-xs mb-3 flex-wrap">
      {path.map((entry, i) => {
        const isLast = i === path.length - 1;
        return (
          <span key={`${entry.type}-${entry.id}`} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
            <span className="text-gray-400 font-medium">{TYPE_LABELS[entry.type] || entry.type}:</span>
            {isLast ? (
              <span className="font-semibold text-gray-800 truncate max-w-[200px]" title={entry.name}>
                {entry.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(i)}
                className="font-semibold text-blue-600 hover:underline truncate max-w-[200px]"
                title={entry.name}
              >
                {entry.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
