import { KpiCard, AuditCard } from "./AuditCard";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";
import AboCboPerformance from "./AboCboPerformance";

/**
 * Classify a Meta campaign as CBO (budget at campaign level) vs ABO (budget at
 * ad-set level). DV360 campaigns or campaigns with no budget data fall back
 * to "Unknown". Same logic used in `LearningPhaseAudit` and `AboCboPerformance`.
 */
function classifyStructure(c: CampaignData): "ABO" | "CBO" | "Unknown" {
  if (c.platform !== "meta") return "Unknown";
  if (c.budgetLevel === "campaign") return "CBO";
  if (c.budgetLevel === "adset") return "ABO";
  const hasAdSets = (c.adSets || []).some(
    (a) => a.status !== "DELETED" && a.status !== "ARCHIVED"
  );
  if (hasAdSets) return "ABO";
  if ((c.dailyBudget ?? 0) > 0 || (c.lifetimeBudget ?? 0) > 0) return "CBO";
  return "Unknown";
}

export default function AboCboAudit({ campaigns }: AuditProps) {
  const counts = { ABO: 0, CBO: 0, Unknown: 0 };
  const spend = { ABO: 0, CBO: 0, Unknown: 0 };
  for (const c of campaigns) {
    const s = classifyStructure(c);
    counts[s] += 1;
    spend[s] += c.spend || 0;
  }
  const total = campaigns.length;
  const known = counts.ABO + counts.CBO;
  const knownSpend = spend.ABO + spend.CBO;
  const structureScore = total === 0 ? 0 : Math.round((known / total) * 100);

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const cboPctCount = pct(counts.CBO, known);
  const aboPctCount = pct(counts.ABO, known);
  const cboPctSpend = pct(spend.CBO, knownSpend);
  const aboPctSpend = pct(spend.ABO, knownSpend);

  const currency = campaigns.find((c) => c.currency)?.currency || "USD";
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-4">
      {/* Top KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Structure Score"
          value={`${structureScore}%`}
          subLabel="Campaigns with detected structure"
          tone={structureScore >= 70 ? "good" : structureScore >= 40 ? "warn" : "bad"}
        />
        <KpiCard label="ABO Campaigns" value={counts.ABO} subLabel="Ad-set budget optimisation" />
        <KpiCard label="CBO Campaigns" value={counts.CBO} subLabel="Campaign budget optimisation" />
      </div>

      {/* Number-of-campaigns + spend split — header summary matching the wireframe */}
      <AuditCard
        title="No of Campaigns & Spend split"
        description="How CBO and ABO compare on both counts and spend allocation."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">No of Campaigns</div>
            <div className="text-2xl font-bold text-gray-900">
              <span className="text-blue-700">{cboPctCount}% CBO</span>
              <span className="text-gray-400 mx-2">|</span>
              <span className="text-purple-700">{aboPctCount}% ABO</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {counts.CBO} CBO campaigns · {counts.ABO} ABO campaigns
              {counts.Unknown > 0 && <> · {counts.Unknown} unclassified</>}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Spend</div>
            <div className="text-2xl font-bold text-gray-900">
              <span className="text-blue-700">{cboPctSpend}% CBO</span>
              <span className="text-gray-400 mx-2">|</span>
              <span className="text-purple-700">{aboPctSpend}% ABO</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {fmtMoney(spend.CBO)} CBO · {fmtMoney(spend.ABO)} ABO
            </div>
          </div>
        </div>
      </AuditCard>

      {/* Distribution sidebar + dual-axis performance chart with metric dropdowns */}
      <AboCboPerformance campaigns={campaigns} />
    </div>
  );
}
