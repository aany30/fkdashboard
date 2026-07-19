import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/router";
import { Globe, ChevronDown, Check } from "lucide-react";
import { useAuthStore } from "@/store/auth";

export type PlatformValue = "all" | "meta" | "dv360" | "snapchat" | "x" | "linkedin";

const PLATFORM_OPTIONS: Array<{ value: PlatformValue; label: string; available: boolean }> = [
  { value: "all", label: "All", available: true },
  { value: "meta", label: "Meta", available: true },
  { value: "dv360", label: "DV360", available: true },
  { value: "snapchat", label: "Snapchat", available: false },
  { value: "x", label: "X", available: false },
  { value: "linkedin", label: "LinkedIn", available: false },
];

interface Props {
  value: PlatformValue;
  onChange: (value: PlatformValue) => void;
}

export default function PlatformFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { isMetaConnected, isDV360Connected, demoMode } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  const label = PLATFORM_OPTIONS.find((o) => o.value === value)?.label ?? "All";

  // Connection status per integrated platform (demo counts as connected).
  const connState: Partial<Record<PlatformValue, boolean>> = mounted
    ? {
        meta: demoMode || isMetaConnected(),
        dv360: demoMode || isDV360Connected(),
      }
    : {};

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition min-w-[130px]"
        title="Filter by platform"
      >
        <Globe className="w-4 h-4 text-blue-600" />
        <span className="flex-1 text-left">Platform: {label}</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="px-3 py-2 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Platform
            </span>
          </div>
          <div className="py-1">
            {PLATFORM_OPTIONS.map((opt) => {
              const isSelected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition"
                >
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                  <span className={`flex-1 text-left ${opt.available ? "text-gray-900" : "text-gray-400"}`}>
                    {opt.label}
                  </span>
                  {!opt.available && (
                    <span className="text-[10px] font-semibold text-gray-400 uppercase">
                      Soon
                    </span>
                  )}
                  {opt.available && connState[opt.value] === true && (
                    <span className="w-2 h-2 rounded-full bg-green-500" title="Connected" />
                  )}
                  {opt.available && connState[opt.value] === false && (
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); router.push("/"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); router.push("/"); } }}
                      className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                      title={`Connect ${opt.label} from the landing page`}
                    >
                      Connect
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Convert the broader platform filter into the legacy "meta" | "dv360" | "both"
 * shape that existing tabs consume. "all" + any not-yet-integrated platform
 * falls back to "both" so existing fetch logic still runs.
 */
export function toLegacyPlatform(p: PlatformValue): "meta" | "dv360" | "both" {
  if (p === "meta") return "meta";
  if (p === "dv360") return "dv360";
  return "both";
}
