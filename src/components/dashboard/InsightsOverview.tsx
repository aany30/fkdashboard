import { Bot, Lightbulb } from "lucide-react";
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

export default function InsightsOverview({ platform, dateRange, customStart, customEnd, setActiveTab }: Props) {
  const { meta } = useAudit(platform, dateRange, customStart, customEnd);

  const recommendations = meta?.recommendations?.length || 0;

  return (
    <SectionOverview
      title="Insights"
      description="AI-prioritised recommendations from real account data"
      Icon={Lightbulb}
      onTileClick={setActiveTab}
      tiles={[
        {
          id: "recommendations",
          label: "AI Recommendations",
          description: "Priority engine: Critical, High, Medium, Low ranked fixes",
          Icon: Bot,
          metric: { label: "Open recommendations", value: recommendations },
          tone: recommendations === 0 ? "good" : "warn",
        },
      ]}
    />
  );
}
