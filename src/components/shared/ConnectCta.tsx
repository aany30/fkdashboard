import Link from "next/link";
import { Plug, ArrowRight } from "lucide-react";

interface Props {
  /** "Meta", "DV360", or any platform display name. */
  platform: string;
  /** Optional contextual description (e.g. "to see funnel drop-off"). */
  context?: string;
}

/**
 * Inline empty-state shown on dashboard sections that need a specific
 * platform connection. Keeps the dashboard layout consistent while making
 * the "go connect this" action one click away.
 */
export default function ConnectCta({ platform, context }: Props) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Plug className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-bold text-gray-900">{platform} not connected</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Connect {platform} {context || "to see this section"}. Takes ~5 minutes.
          </p>
        </div>
      </div>
      <Link
        href="/#connect"
        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        Connect {platform}
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
