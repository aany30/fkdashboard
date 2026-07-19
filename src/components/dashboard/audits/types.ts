import type { CampaignData } from "@/types";

export interface AuditProps {
  campaigns: CampaignData[];
  loading: boolean;
  platform: "meta" | "dv360" | "both";
  /**
   * Total campaigns on the ad account, BEFORE any objective filter is applied.
   * Audits that report shares (e.g. TOF/MOF/BOF as a % of the account) use this
   * as the denominator so percentages stay relative to the whole account, not
   * the filtered subset. Falls back to `campaigns.length` when omitted.
   */
  accountTotal?: number;
  /** Current dashboard date range — forwarded to sub-components (e.g. charts)
   *  so they can auto-switch to "window" basis when the date changes. */
  dateRange?: string;
  /** Custom range start (ISO yyyy-mm-dd). Set only when dateRange === "custom". */
  customStart?: string;
  /** Custom range end (ISO yyyy-mm-dd). Set only when dateRange === "custom". */
  customEnd?: string;
}

/** Account-level snapshot sent to the AI for fix recommendations. */
export interface AccountContext {
  totalCampaigns: number;
  activeCampaigns: number;
  pausedCampaigns: number;
  totalSpend: number;
  totalConversions: number;
  totalConversionValue: number;
  avgRoas: number;
  currency: string;
}

/**
 * Compute account-level aggregates from a campaign list. Called once per
 * audit-tab render; passed to every KpiCard's fixContext so each AI fix
 * has the surrounding picture.
 */
export function buildAccountContext(campaigns: CampaignData[]): AccountContext {
  const active = campaigns.filter(
    (c) => c.status === "ACTIVE" || c.status === "ENABLED"
  );
  const paused = campaigns.filter((c) => c.status === "PAUSED");

  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalConversions = campaigns.reduce(
    (s, c) => s + (c.conversions || 0),
    0
  );
  const totalConversionValue = campaigns.reduce(
    (s, c) => s + (c.conversionValue || 0),
    0
  );
  const avgRoas = totalSpend > 0 ? totalConversionValue / totalSpend : 0;
  const currency = campaigns.find((c) => c.currency)?.currency || "USD";

  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: active.length,
    pausedCampaigns: paused.length,
    totalSpend: Math.round(totalSpend),
    totalConversions: Math.round(totalConversions),
    totalConversionValue: Math.round(totalConversionValue),
    avgRoas: Math.round(avgRoas * 100) / 100,
    currency,
  };
}

/** Per-campaign context with derived metrics added for AI convenience. */
export interface CampaignContextEnriched extends CampaignData {
  roas?: number;
  ctr?: number;
  cpa?: number;
}

export function enrichCampaign(c: CampaignData): CampaignContextEnriched {
  const result: CampaignContextEnriched = { ...c };
  if (c.spend && c.spend > 0) {
    if (c.conversionValue !== undefined) result.roas = c.conversionValue / c.spend;
    if (c.conversions !== undefined) result.cpa = c.spend / c.conversions;
  }
  if (c.impressions && c.impressions > 0 && c.clicks !== undefined) {
    result.ctr = (c.clicks / c.impressions) * 100;
  }
  return result;
}
