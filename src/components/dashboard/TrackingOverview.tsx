import { Activity, TrendingUp, Target, Settings2, Radio } from "lucide-react";
import SectionOverview from "./SectionOverview";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "dv360" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab: (id: string) => void;
}

export default function TrackingOverview({ platform, dateRange, customStart, customEnd, setActiveTab }: Props) {
  const { meta } = useAudit(platform, dateRange, customStart, customEnd);

  const pixelCount = meta?.pixels?.length || 0;
  const avgEmq = meta?.pixels?.length
    ? (meta.pixels.reduce((s, p) => s + p.emq.overallScore, 0) / meta.pixels.length).toFixed(1)
    : "—";
  const avgDedup = meta?.pixels?.length
    ? Math.round(meta.pixels.reduce((s, p) => s + p.capi.avgDedupRate, 0) / meta.pixels.length)
    : 0;
  const totalEvents = meta?.pixels?.reduce((s, p) => s + p.totalEvents, 0) || 0;

  return (
    <SectionOverview
      title="Tracking"
      description="Pixel firing, event quality, conversion funnel, attribution, and real-time signal health"
      Icon={Radio}
      onTileClick={setActiveTab}
      tiles={[
        {
          id: "pixel-health",
          label: "Pixel Health",
          description: "Pixel firing status, latency and event consistency",
          Icon: Activity,
          metric: { label: "Pixels monitored", value: pixelCount },
          tone: pixelCount > 0 ? "good" : "neutral",
        },
        {
          id: "event-quality",
          label: "Event Quality",
          description: "EMQ scoring, hash quality, match rate optimisation",
          Icon: TrendingUp,
          metric: { label: "Avg EMQ", value: avgEmq },
          tone: typeof avgEmq === "string" && avgEmq !== "—" && parseFloat(avgEmq) >= 7 ? "good" : "warn",
        },
        {
          id: "funnel",
          label: "Funnel Audit",
          description: "Conversion drop analysis across funnel stages",
          Icon: Target,
          metric: { label: "Total events", value: totalEvents.toLocaleString() },
        },
        {
          id: "attribution",
          label: "Attribution",
          description: "Attribution model readiness across Meta + DV360",
          Icon: Settings2,
          metric: { label: "Dedup rate", value: `${avgDedup}%` },
          tone: avgDedup >= 85 ? "good" : avgDedup >= 70 ? "warn" : "bad",
        },
      ]}
    />
  );
}
