/**
 * Shared loading placeholder — use anywhere data is still being fetched so the
 * user sees an explicit "loading" state instead of an empty/"no data" panel
 * (which reads as a final, broken result).
 *
 *   <LoadingState message="Loading creative data…" />              // card with spinner
 *   <LoadingState message="DV360 reports can take up to a minute…" hint />
 *
 * `hint` shows a secondary line explaining slow sources (e.g. DV360 Bid Manager
 * reports generate async and can take ~30–60s).
 */

import { Loader2 } from "lucide-react";

export default function LoadingState({
  message = "Loading…",
  hint,
  height = "h-48",
}: {
  message?: string;
  hint?: string | boolean;
  height?: string;
}) {
  const hintText =
    hint === true
      ? "This can take up to a minute for DV360 — reports generate on Google's side first."
      : hint || null;

  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${height} flex flex-col items-center justify-center gap-3`}>
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      <div className="text-center">
        <p className="text-sm font-medium text-gray-600">{message}</p>
        {hintText && <p className="text-xs text-gray-400 mt-1 max-w-xs">{hintText}</p>}
      </div>
    </div>
  );
}
